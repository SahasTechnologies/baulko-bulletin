import { useEffect, useRef, useState } from "react";

import Icon from "@/components/ui/Icon";

/**
 * pdf.js 6's modern build calls `Uint8Array.prototype.toHex()`, a method that only
 * reached browsers in Chrome 140 / Safari 18.2 / Firefox 133 (Sept 2025). On
 * anything older, opening an issue failed outright with "toHex is not a
 * function" — a blank reader rather than a degraded one. pdf.js ships a legacy
 * build of the same version for exactly this case, with those methods polyfilled
 * in, so we choose per browser: a recent engine keeps the smaller, faster
 * bundle, and an older one still gets a reader that opens. `toHex` is the newest
 * method pdf.js uses, so its presence implies the older ones are there too.
 */
function hasModernPdfEngine() {
  // `toHex` shipped with the same ES2026 wave as the other newer methods pdf.js
  // uses; if it is present the rest are too, so it is a cheap single probe.
  // (Cast: the installed lib.es dts does not declare `toHex` yet.)
  const proto = Uint8Array.prototype as Uint8Array & { toHex?: unknown };
  return typeof proto.toHex === "function";
}

/**
 * Load the pdf.js build this browser can run, pointed at the matching worker and
 * at the wasm decoders — all served from our own origin, copied into
 * public/pdfjs/<version>/ by scripts/sync-pdfjs-assets.mjs. That script is not
 * just about avoiding a CDN: a module worker cannot be started from another
 * origin, and pdf.js silently falls back to running on the main thread when it
 * cannot start one. The worker must come from the same build as this module, or
 * the two disagree about the message protocol.
 */
async function loadPdfjs() {
  const modern = hasModernPdfEngine();
  const pdfjs = modern
    ? await import("pdfjs-dist")
    : await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!modern) {
    console.info(
      "[pdf] this browser lacks Uint8Array.prototype.toHex — using the legacy pdf.js build"
    );
  }
  const assets = `/pdfjs/${pdfjs.version}`;
  pdfjs.GlobalWorkerOptions.workerSrc = modern
    ? `${assets}/pdf.worker.min.mjs`
    : `${assets}/legacy/pdf.worker.min.mjs`;
  return { pdfjs, assets };
}

/** The pages shown together when `p` is the current page. */
function spreadPages(p: number, numPages: number, spread: boolean): number[] {
  if (!numPages) return [];
  if (!spread) return [p];
  if (p <= 1) return [1];
  const left = p % 2 === 0 ? p : p - 1;
  const right = left + 1;
  return right <= numPages ? [left, right] : [left];
}

function nextPageOf(p: number, numPages: number, spread: boolean): number | null {
  if (spread) {
    const next = p <= 1 ? 2 : p % 2 === 0 ? p + 2 : p + 1;
    return next <= numPages ? next : null;
  }
  return p < numPages ? p + 1 : null;
}

function prevPageOf(p: number, spread: boolean): number | null {
  if (spread) {
    if (p <= 1) return null;
    return p <= 2 ? 1 : p % 2 === 0 ? p - 2 : p - 1;
  }
  return p > 1 ? p - 1 : null;
}

/** pdf.js rejects cancelled work with these; they are control flow, not errors. */
function isCancellation(err: unknown) {
  const name = (err as { name?: string } | null)?.name;
  return name === "RenderingCancelledException" || name === "AbortException";
}

type CachedPage = { canvas: HTMLCanvasElement; text: HTMLDivElement };

export default function PdfViewer({ src, title }: { src: string; title?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const leftWrapRef = useRef<HTMLDivElement>(null);
  const rightWrapRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  // The loaded pdf.js module, so the render loop can build text layers.
  const pdfjsRef = useRef<any>(null);

  // Fully rendered pages — canvas plus text layer, sized for the current
  // scale — ready to be moved into the stage. This cache is what makes flips
  // instant: navigation mounts an already-rendered page instead of kicking off
  // a rasterization on click, and a background loop keeps it filled ahead of
  // the reader (current spread first, then the spreads on either side), so by
  // the time "next" is pressed the next pages have usually been rendered for
  // seconds already.
  const cacheRef = useRef(new Map<number, CachedPage>());
  // The render/text-layer task currently in flight, so a priority change can
  // cancel a lookahead render that is no longer wanted.
  const inFlightRef = useRef<{ page: number; cancel: () => void } | null>(null);
  // Generation counter for the background loop: bumped whenever the scale
  // context (document, spread mode, stage width) changes, invalidating the
  // loop and everything cached at the old scale.
  const genRef = useRef(0);
  // Pages to render, most wanted first. Read by the loop, written by an effect.
  const priorityRef = useRef<number[]>([]);
  // Wakes the parked loop when the priority list changes.
  const nudgeRef = useRef<() => void>(() => {});

  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [spread, setSpread] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // True once the first spread has been mounted — the loader hides then, and
  // stays hidden for the rest of the session.
  const [ready, setReady] = useState(false);
  // A visible page isn't rendered yet and there is nothing stale to keep on
  // screen — a small overlay covers the gap until it lands.
  const [pending, setPending] = useState(false);
  const [stageW, setStageW] = useState(0);
  // Bumped every time a page lands in the cache, so the stage re-checks it.
  const [tick, setTick] = useState(0);

  const [editingPage, setEditingPage] = useState(false);
  const [pageDraft, setPageDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Two pages side by side only when there's room for both.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setSpread(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Measure the usable width so the pages always fit — no horizontal scroll.
  // A ResizeObserver (rather than a window resize listener) also catches the
  // layout settling after mount and container-driven size changes.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { pdfjs, assets } = await loadPdfjs();
        pdfjsRef.current = pdfjs;
        const doc = await pdfjs.getDocument({
          url: src,
          // Issues embed JPEG2000/JBIG2 art; without the wasm decoders pdf.js
          // drops those images and logs "OpenJPEG failed to initialize".
          wasmUrl: `${assets}/wasm/`,
        }).promise;
        if (cancelled) return;
        cacheRef.current.clear();
        setReady(false);
        setPdf(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Could not open this issue.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Deep link: /posts/<slug>?page=7 opens on that page. The render loop reads
  // the current page for its priority list, so the deep-linked page renders
  // first and the opener waits only for pages it will actually show.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("page");
    const n = Number.parseInt(raw ?? "", 10);
    if (Number.isFinite(n) && n >= 1) setPage(n);
  }, []);

  useEffect(() => {
    if (numPages) setPage((p) => Math.min(Math.max(1, p), numPages));
  }, [numPages]);

  // Priority list for the render loop: the visible pages, then the next
  // spread, the previous one, and one more beyond the next — a reader who taps
  // "next" a few times in a row still lands on pages that are already rendered.
  // Also cancels a lookahead render that fell out of the list so the newly
  // wanted page can start immediately.
  useEffect(() => {
    const wanted: number[] = [];
    const push = (p: number | null) => {
      if (p == null) return;
      for (const q of spreadPages(p, numPages, spread)) {
        if (!wanted.includes(q)) wanted.push(q);
      }
    };
    push(page);
    const next = nextPageOf(page, numPages, spread);
    push(next);
    push(prevPageOf(page, spread));
    if (next != null) push(nextPageOf(next, numPages, spread));
    priorityRef.current = wanted;
    const inFlight = inFlightRef.current;
    if (inFlight && !wanted.includes(inFlight.page)) inFlight.cancel();
    nudgeRef.current();
  }, [page, numPages, spread]);

  // The background render loop. One page at a time, highest priority first;
  // parks on a nudge when everything wanted is cached. Restarted (and the
  // cache dropped) whenever the scale context changes, since cached pages are
  // rasterized for one exact size.
  useEffect(() => {
    if (!pdf || !stageW || !pdfjsRef.current) return;
    const gen = ++genRef.current;
    cacheRef.current.clear();

    const maxH = Math.min(window.innerHeight * 0.78, 980);
    // Lookahead pages at the raw device ratio would multiply canvas memory by
    // up to 9 on a 3x phone for no visible gain — 2 is the usual ceiling.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Render attempts per page this generation — a transient worker hiccup
    // gets one retry, a genuinely broken page can't spin the loop forever.
    const attempts = new Map<number, number>();

    const waitForNudge = () =>
      new Promise<void>((resolve) => {
        nudgeRef.current = resolve;
      });

    async function renderOne(p: number) {
      const pdfPage = await pdf.getPage(p);
      if (genRef.current !== gen) return;
      const pdfjs = pdfjsRef.current;

      // The cover and a trailing unpaired page sit alone on their spread, so
      // they get the full stage width; everything else shares it.
      const alone = spreadPages(p, numPages, spread).length === 1;
      const perPage = alone ? stageW : stageW / 2;
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(perPage / base.width, maxH / base.height);
      const cssW = base.width * fit;
      const cssH = base.height * fit;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.style.display = "block";

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const renderTask = pdfPage.render({
        canvasContext: ctx,
        viewport: pdfPage.getViewport({ scale: fit * dpr }),
      });
      inFlightRef.current = { page: p, cancel: () => renderTask.cancel() };
      try {
        await renderTask.promise;
      } finally {
        if (inFlightRef.current?.page === p) inFlightRef.current = null;
      }
      if (genRef.current !== gen) return;

      // Transparent, selectable text over the canvas. TextLayer positions the
      // spans itself; the scale inputs it cannot know are set here (see the
      // .pdfTextLayer rules in global.css). It multiplies the scale by the
      // device ratio internally, so this viewport is the CSS-scale one.
      const cssViewport = pdfPage.getViewport({ scale: fit });
      const text = document.createElement("div");
      text.className = "pdfTextLayer";
      text.style.setProperty("--scale-factor", String(fit));
      if (cssViewport.userUnit && cssViewport.userUnit !== 1) {
        text.style.setProperty("--user-unit", String(cssViewport.userUnit));
      }
      const layer = new pdfjs.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: text,
        viewport: cssViewport,
      });
      inFlightRef.current = { page: p, cancel: () => layer.cancel() };
      try {
        await layer.render();
      } finally {
        if (inFlightRef.current?.page === p) inFlightRef.current = null;
      }
      if (genRef.current !== gen) return;

      // Like pdf.js's own viewer: a filler below the last line, combined with
      // the "selecting" class, lets a drag past the end of the page extend the
      // selection to the end instead of collapsing. The class is toggled by
      // the document-wide listener below; mousedown adds it up front so the
      // very first drag already behaves.
      const end = document.createElement("div");
      end.className = "endOfContent";
      text.append(end);
      text.addEventListener("mousedown", () => text.classList.add("selecting"));

      cacheRef.current.set(p, { canvas, text });
      // Bound memory: the canvases are the expensive part (~10 MB each on a
      // retina display). Evict pages that are no longer near the current one,
      // oldest first — they re-render on demand if the reader flips back.
      const keep = new Set(priorityRef.current);
      for (const key of [...cacheRef.current.keys()]) {
        if (cacheRef.current.size <= 8) break;
        if (!keep.has(key)) cacheRef.current.delete(key);
      }
      setTick((t) => t + 1);
    }

    (async () => {
      while (genRef.current === gen) {
        const target = priorityRef.current.find(
          (p) => !cacheRef.current.has(p) && (attempts.get(p) ?? 0) < 2
        );
        if (target == null) {
          await waitForNudge();
          continue;
        }
        try {
          await renderOne(target);
        } catch (err) {
          // A cancelled render is either a priority change (the page left the
          // list, so it won't be picked again) or a generation bump (the loop
          // exits below) — neither is retried; real failures are, but only
          // once per page, so a broken page can't spin the loop.
          if (!isCancellation(err)) {
            attempts.set(target, (attempts.get(target) ?? 0) + 1);
            console.error("[pdf] page render failed:", err);
          }
        }
        if (genRef.current !== gen) return;
      }
    })();

    return () => {
      genRef.current += 1;
      inFlightRef.current?.cancel();
      inFlightRef.current = null;
    };
  }, [pdf, spread, stageW, numPages]);

  // Mount whichever visible pages are already rendered. If one is still
  // rendering, whatever was on screen stays there (no flash on resize or
  // spread toggle); only a slot with nothing to show gets the overlay.
  useEffect(() => {
    if (!pdf || !stageW) return;
    const visible = spreadPages(page, numPages, spread);
    const slots = [leftWrapRef.current, rightWrapRef.current];
    let missing = false;
    let blank = false;
    for (let i = 0; i < 2; i++) {
      const p = visible[i];
      const slot = slots[i];
      if (p == null || !slot) continue;
      const hit = cacheRef.current.get(p);
      if (hit) {
        if (slot.firstElementChild !== hit.canvas) {
          slot.replaceChildren(hit.canvas, hit.text);
        }
      } else {
        missing = true;
        if (slot.childElementCount === 0) blank = true;
      }
    }
    setPending(blank);
    if (!missing) setReady(true);
  }, [pdf, page, numPages, spread, stageW, tick]);

  // Mirror pdf.js's selection handling across all cached layers: while the
  // selection intersects a layer it keeps its "selecting" class (see the
  // endOfContent note in the render loop).
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = document.getSelection();
      const active = !!sel && sel.rangeCount > 0;
      for (const { text } of cacheRef.current.values()) {
        text.classList.toggle("selecting", active && sel!.containsNode(text, true));
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Functional update: several clicks (or a held arrow key) arriving in one
  // render must each advance a page, not all resolve against the same stale
  // `page` and collapse into a single step.
  function go(delta: number) {
    if (!numPages) return;
    setPage((p) => {
      const target =
        delta > 0 ? nextPageOf(p, numPages, spread) : prevPageOf(p, spread);
      return target ?? p;
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Close the share popover on an outside click.
  useEffect(() => {
    if (!shareOpen) return;
    const onDown = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [shareOpen]);

  const pages = spreadPages(page, numPages, spread);
  const first = pages[0] || 1;
  const label = pages.length === 2 ? `${pages[0]}–${pages[1]} / ${numPages}` : `${first} / ${numPages || "…"}`;

  function startEditing() {
    if (!numPages) return;
    setPageDraft(String(first));
    setEditingPage(true);
    requestAnimationFrame(() => pageInputRef.current?.select());
  }

  function commitPage() {
    setEditingPage(false);
    const n = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(n) && n >= 1) setPage(Math.min(numPages, n));
  }

  function shareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(first));
    url.hash = "";
    return url.toString();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink());
    } catch {
      // The clipboard API needs a secure context. If it's unavailable, select
      // the link so the reader can copy it themselves.
      const input = shareRef.current?.querySelector("input");
      input?.focus();
      input?.select();
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    const name = fileName();
    try {
      // Fetch as a blob so the download actually saves the file; a bare
      // cross-origin `download` attribute is ignored by browsers.
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  }

  function fileName() {
    const fromTitle = (title || "").replace(/[:/\\?*"<>|]/g, " ").replace(/\s+/g, " ").trim();
    if (fromTitle) return `${fromTitle}.pdf`;
    const last = src.split("?")[0].split("/").pop() || "issue.pdf";
    return last.toLowerCase().endsWith(".pdf") ? last : `${last}.pdf`;
  }

  const iconButton =
    "inline-flex size-11 items-center justify-center rounded-full bg-black text-white text-xl transition hover:scale-105 dark:bg-white dark:text-black disabled:opacity-40";

  const pageSlot =
    "relative shrink-0 overflow-hidden bg-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]";

  return (
    <div className="relative rounded-3xl bg-neutral-200/80 px-3 py-6 dark:bg-neutral-900 md:px-8 md:py-10">
      {(loading || (!error && !ready)) && (
        <div className="flex min-h-[60vh] items-center justify-center text-lg opacity-60">
          {loading ? "Opening issue…" : "Preparing pages…"}
        </div>
      )}
      {error && (
        <div className="flex min-h-[40vh] items-center justify-center text-lg opacity-70">
          {error}
        </div>
      )}

      {/* Zero-height probe: its width is the usable stage width. It must stay
          OUTSIDE the container below, since a display:none element reports a
          clientWidth of 0 — which would deadlock the first render. */}
      <div ref={stageRef} className="h-0 w-full" aria-hidden="true" />

      <div className={loading || error || !ready ? "hidden" : ""}>
        <div className="relative flex items-center justify-center overflow-hidden">
          {/* The canvases and text layers are created by the render loop and
              moved in here when ready; the slots only own chrome (shadow,
              rounded corners). */}
          <div
            ref={leftWrapRef}
            className={pageSlot}
            style={{ borderRadius: pages.length === 1 ? "4px" : "4px 0 0 4px" }}
          />
          {pages.length === 2 && (
            <div
              ref={rightWrapRef}
              className={pageSlot}
              style={{ borderRadius: "0 4px 4px 0" }}
            />
          )}
          {pending && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span className="pdfSpinner" style={{ width: 28, height: 28 }} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={prevPageOf(page, spread) == null}
            className={iconButton}
            aria-label="Previous page"
          >
            <Icon name="chevron-back" />
          </button>

          {editingPage ? (
            <input
              ref={pageInputRef}
              value={pageDraft}
              onChange={(e) =>
                // Digits only — no hyphens, so nobody types "2-3".
                setPageDraft(e.target.value.replace(/\D/g, "").slice(0, String(numPages).length))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPage();
                if (e.key === "Escape") setEditingPage(false);
              }}
              onBlur={commitPage}
              inputMode="numeric"
              aria-label="Go to page"
              className="w-24 rounded-lg border border-black/20 bg-white px-2 py-1 text-center text-sm font-medium tabular-nums outline-none focus:border-black/50 dark:border-white/25 dark:bg-neutral-800 dark:focus:border-white/60"
            />
          ) : (
            <button
              type="button"
              onClick={startEditing}
              title="Click to jump to a page"
              className="min-w-24 rounded-lg px-2 py-1 text-center text-sm font-medium tracking-wide tabular-nums opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            >
              {label}
            </button>
          )}

          <button
            type="button"
            onClick={() => go(1)}
            disabled={nextPageOf(page, numPages, spread) == null}
            className={iconButton}
            aria-label="Next page"
          >
            <Icon name="chevron-forward" />
          </button>
        </div>

        <div ref={shareRef} className="relative mt-6 flex items-center justify-end gap-3 md:absolute md:bottom-8 md:right-8 md:mt-0">
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            className={iconButton}
            aria-label="Share this page"
            aria-expanded={shareOpen}
          >
            <Icon name="share-social" />
          </button>
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className={iconButton}
            aria-label="Download this issue"
          >
            {downloading ? (
              <span className="pdfSpinner" aria-hidden="true" />
            ) : (
              <Icon name="download" />
            )}
          </button>

          {shareOpen && (
            <div className="absolute bottom-14 right-0 z-20 w-[min(20rem,80vw)] rounded-2xl border border-black/10 bg-white p-4 text-left shadow-xl dark:border-white/15 dark:bg-neutral-800">
              <p className="mb-2 text-sm font-semibold">
                {pages.length === 2 ? `Pages ${pages[0]}–${pages[1]}` : `Page ${first}`}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareLink()}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Link to this page"
                  className="min-w-0 flex-1 rounded-lg border border-black/15 bg-black/5 px-2 py-1.5 text-xs outline-none dark:border-white/15 dark:bg-white/10"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition hover:scale-105 dark:bg-white dark:text-black"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
