import { createElement, useEffect, useRef, useState } from "react";

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

export default function PdfViewer({ src, title }: { src: string; title?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const leftWrapRef = useRef<HTMLDivElement>(null);
  const rightWrapRef = useRef<HTMLDivElement>(null);
  const leftTextRef = useRef<HTMLDivElement>(null);
  const rightTextRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  // The loaded pdf.js module, so the render effect can build text layers.
  const pdfjsRef = useRef<any>(null);

  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [spread, setSpread] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // A canvas is 300x150 until we size it, so keep the placeholder up until the
  // first page has actually been painted — otherwise the page flashes tiny.
  const [painted, setPainted] = useState(false);
  const [stageW, setStageW] = useState(0);

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
  useEffect(() => {
    const measure = () => setStageW(stageRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, error]);

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

  // Deep link: /posts/<slug>?page=7 opens on that page.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("page");
    const n = Number.parseInt(raw ?? "", 10);
    if (Number.isFinite(n) && n >= 1) setPage(n);
  }, []);

  useEffect(() => {
    if (numPages) setPage((p) => Math.min(Math.max(1, p), numPages));
  }, [numPages]);

  const pages = (() => {
    if (!numPages) return [] as number[];
    if (!spread) return [page];
    if (page <= 1) return [1];
    const left = page % 2 === 0 ? page : page - 1;
    const right = left + 1;
    return right <= numPages ? [left, right] : [left];
  })();

  useEffect(() => {
    if (!pdf || !stageW) return;
    let cancelled = false;
    (async () => {
      const canvases = [leftRef.current, rightRef.current];
      const textDivs = [leftTextRef.current, rightTextRef.current];
      const maxH = Math.min(window.innerHeight * 0.78, 980);
      const perPage = spread && pages.length === 2 ? stageW / 2 : stageW;
      const dpr = window.devicePixelRatio || 1;

      for (let i = 0; i < pages.length; i++) {
        const canvas = canvases[i];
        if (!canvas) continue;
        const pdfPage = await pdf.getPage(pages[i]);
        if (cancelled) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.min(perPage / base.width, maxH / base.height);
        const cssW = base.width * fit;
        const cssH = base.height * fit;

        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await pdfPage.render({
          canvasContext: ctx,
          viewport: pdfPage.getViewport({ scale: fit * dpr }),
        }).promise;

        // Transparent text over the canvas, so text can be selected and copied.
        const textDiv = textDivs[i];
        const pdfjs = pdfjsRef.current;
        if (textDiv && pdfjs?.TextLayer) {
          const layer = new pdfjs.TextLayer({
            textContentSource: pdfPage.streamTextContent(),
            container: textDiv,
            viewport: pdfPage.getViewport({ scale: fit }),
          });
          textDiv.replaceChildren();
          try {
            await layer.render();
          } catch (e) {
            console.error("[pdf] text layer failed:", e);
          }
          if (cancelled) {
            layer.cancel();
            return;
          }
        }
      }
      if (!cancelled) setPainted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pages.join(","), spread, stageW]);

  function go(delta: number) {
    if (!numPages) return;
    if (spread) {
      if (page <= 1 && delta < 0) return;
      if (delta > 0) {
        const next = page <= 1 ? 2 : page % 2 === 0 ? page + 2 : page + 1;
        if (next > numPages) return;
        setPage(next);
      } else {
        const next = page <= 2 ? 1 : page % 2 === 0 ? page - 2 : page - 1;
        setPage(Math.max(1, next));
      }
    } else {
      setPage((p) => Math.min(numPages, Math.max(1, p + delta)));
    }
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

  return (
    <div className="relative rounded-3xl bg-neutral-200/80 px-3 py-6 dark:bg-neutral-900 md:px-8 md:py-10">
      {loading && (
        <div className="flex min-h-[60vh] items-center justify-center text-lg opacity-60">
          Opening issue…
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

      <div className={loading || error || !painted ? "hidden" : ""}>
        <div className="flex items-center justify-center overflow-hidden">
          <div
            ref={leftWrapRef}
            className="relative shrink-0"
            style={{ borderRadius: pages.length === 1 ? "4px" : "4px 0 0 4px" }}
          >
            <canvas
              ref={leftRef}
              className="block bg-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
              style={{ borderRadius: "inherit" }}
            />
            <div ref={leftTextRef} className="pdfTextLayer" />
          </div>
          {pages.length === 2 && (
            <div ref={rightWrapRef} className="relative shrink-0" style={{ borderRadius: "0 4px 4px 0" }}>
              <canvas
                ref={rightRef}
                className="block bg-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
                style={{ borderRadius: "inherit" }}
              />
              <div ref={rightTextRef} className="pdfTextLayer" />
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={page <= 1}
            className={iconButton}
            aria-label="Previous page"
          >
            {createElement("ion-icon", { name: "chevron-back" })}
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
            disabled={page >= numPages}
            className={iconButton}
            aria-label="Next page"
          >
            {createElement("ion-icon", { name: "chevron-forward" })}
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
            {createElement("ion-icon", { name: "share-social" })}
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
              createElement("ion-icon", { name: "download" })
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
