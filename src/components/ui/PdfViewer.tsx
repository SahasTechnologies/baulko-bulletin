import { useEffect, useRef, useState } from "react";

export default function PdfViewer({ src }: { src: string }) {
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [spread, setSpread] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setSpread(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const doc = await pdfjs.getDocument({
          url: `/api/pdf?src=${encodeURIComponent(src)}`,
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

  const pages = (() => {
    if (!numPages) return [] as number[];
    if (!spread) return [page];
    if (page <= 1) return [1];
    const left = page % 2 === 0 ? page : page - 1;
    const right = left + 1;
    return right <= numPages ? [left, right] : [left];
  })();

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const canvases = [leftRef.current, rightRef.current];
      for (let i = 0; i < pages.length; i++) {
        const canvas = canvases[i];
        if (!canvas) continue;
        const pdfPage = await pdf.getPage(pages[i]);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const maxH = Math.min(window.innerHeight * 0.78, 980);
        const maxW = spread && pages.length === 2 ? window.innerWidth * 0.42 : window.innerWidth * 0.86;
        const scale = Math.min(maxW / base.width, maxH / base.height) * (window.devicePixelRatio || 1);
        const viewport = pdfPage.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
        canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pages.join(","), spread]);

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
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const label = pages.length === 2 ? `${pages[0]}–${pages[1]} / ${numPages}` : `${pages[0] || 1} / ${numPages || "…"}`;

  return (
    <div className="rounded-3xl bg-neutral-200/80 dark:bg-neutral-900 px-3 py-6 md:px-8 md:py-10">
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
      <div className={loading || error ? "hidden" : ""}>
        <div className="flex items-center justify-center gap-0 overflow-x-auto">
          <canvas
            ref={leftRef}
            className="bg-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
            style={{ borderRadius: pages.length === 1 ? "4px" : "4px 0 0 4px" }}
          />
          {pages.length === 2 && (
            <canvas
              ref={rightRef}
              className="bg-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
              style={{ borderRadius: "0 4px 4px 0" }}
            />
          )}
        </div>
        <div className="mt-8 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={page <= 1}
            className="size-12 rounded-full bg-black text-white disabled:opacity-30 dark:bg-white dark:text-black transition hover:scale-105"
            aria-label="Previous page"
          >
            ‹
          </button>
          <div className="min-w-28 text-center text-sm font-medium tracking-wide opacity-70">
            {label}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={page >= numPages}
            className="size-12 rounded-full bg-black text-white disabled:opacity-30 dark:bg-white dark:text-black transition hover:scale-105"
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
