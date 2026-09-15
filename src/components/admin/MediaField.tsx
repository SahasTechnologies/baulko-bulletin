"use client";

/**
 * Cover-image and PDF fields for the admin forms.
 *
 * Both upload straight to ImageKit using a short-lived signature fetched from
 * `/api/admin/upload-auth`; nothing large passes through this app, which is what
 * makes multi-megabyte issue PDFs possible despite Vercel's 4.5 MB function body
 * limit.
 *
 * Images get a crop step first. Covers are displayed edge to edge at a fixed
 * ratio, so the interesting part of a tall poster needs choosing rather than
 * leaving to automatic focal detection: pick a ratio, drag the picture to say
 * which part to keep, zoom, then upload — the crop is rendered at full
 * resolution off the original file, not from the on-screen preview.
 *
 * The result is written into a hidden input carrying the field's name, so the
 * surrounding Astro form still submits a plain URL as it always did.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Icon from "@/components/ui/Icon";

type Kind = "image" | "pdf";

interface UploadConfig {
  endpoint: string;
  folder: string;
  publicKey: string;
  token: string;
  expire: number;
  signature: string;
}

/** Longest side of the rendered crop. Covers are 2000x1000 on the site, so this leaves headroom. */
const MAX_OUTPUT = 2400;

const RATIOS: { label: string; value: number | null; hint?: string }[] = [
  { label: "Cover 2:1", value: 2, hint: "matches the site's cover crop" },
  { label: "Wide 16:9", value: 16 / 9 },
  { label: "Square", value: 1 },
  { label: "Portrait 4:5", value: 4 / 5 },
  { label: "Original", value: null },
];

const buttonClass =
  "inline-flex items-center gap-2 rounded-full border border-black/20 px-5 py-2 text-base transition-transform hover:scale-105 dark:border-white/20";
const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-full bg-black px-6 py-2 text-base font-bold text-white transition-transform hover:scale-105 disabled:opacity-40 dark:bg-white dark:text-black";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function fileNameFor(original: string, extension: string): string {
  const stem =
    original
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image";
  // A fresh suffix every time: uploading over an existing name leaves ImageKit's
  // CDN serving the old bytes at the same URL, and the change looks like it did
  // not happen.
  return `${stem}-${randomSuffix()}.${extension}`;
}

export default function MediaField({
  name,
  initial,
  kind,
  fieldId,
  required = false,
}: {
  name: string;
  initial: string;
  kind: Kind;
  fieldId: string;
  required?: boolean;
}) {
  const [url, setUrl] = useState(initial);
  const [source, setSource] = useState<{ file: File; objectUrl: string; width: number; height: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(kind === "image" ? 2 : null);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [frameWidth, setFrameWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; focusX: number; focusY: number } | null>(null);
  const configRef = useRef<UploadConfig | null>(null);

  // The frame is a fixed aspect box, so its height follows from the measured width.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setFrameWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [source]);

  // Release the object URL when the picture is replaced or the field unmounts.
  useEffect(() => {
    const objectUrl = source?.objectUrl;
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [source]);

  const natural = source ? { width: source.width, height: source.height } : null;
  const activeRatio = ratio ?? (natural ? natural.width / natural.height : 1);
  const frameHeight = activeRatio > 0 ? frameWidth / activeRatio : 0;

  /** Scale that makes the picture exactly cover the frame before any zoom. */
  const drawScale = useMemo(() => {
    if (!natural || !frameWidth || !frameHeight) return 0;
    return Math.max(frameWidth / natural.width, frameHeight / natural.height) * zoom;
  }, [natural, frameWidth, frameHeight, zoom]);

  const draw = useMemo(() => {
    if (!natural || !drawScale) return null;
    const width = natural.width * drawScale;
    const height = natural.height * drawScale;
    // Crop window size in source pixels — the same maths the canvas export uses.
    const cropW = frameWidth / drawScale;
    const cropH = frameHeight / drawScale;
    const halfW = cropW / 2 / natural.width;
    const halfH = cropH / 2 / natural.height;
    const fx = clamp(focus.x, halfW, 1 - halfW);
    const fy = clamp(focus.y, halfH, 1 - halfH);
    const left = clamp(frameWidth / 2 - fx * width, frameWidth - width, 0);
    const top = clamp(frameHeight / 2 - fy * height, frameHeight - height, 0);
    return { width, height, left, top, cropW, cropH, fx, fy };
  }, [natural, drawScale, focus, frameWidth, frameHeight]);

  const loadImage = useCallback((file: File) => {
    setError("");
    setDone(false);
    if (kind === "pdf" && !/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("That file is not a PDF.");
      return;
    }
    if (kind === "image" && !file.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setSource({ file, objectUrl, width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setFocus({ x: 0.5, y: 0.5 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError("Could not read that file.");
    };
    image.src = objectUrl;
  }, [kind]);

  async function auth(kindForUpload: Kind): Promise<UploadConfig> {
    const cached = configRef.current;
    if (cached && cached.expire * 1000 > Date.now() + 30_000) return cached;
    const res = await fetch(`/api/admin/upload-auth?kind=${kindForUpload}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || "Could not get an upload signature.");
    }
    configRef.current = body as UploadConfig;
    return configRef.current;
  }

  /** XHR rather than fetch: an issue PDF is slow enough that a progress bar matters. */
  function send(config: UploadConfig, file: File, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("file", file, fileName);
      body.append("fileName", fileName);
      body.append("folder", config.folder);
      // Keep the exact name that was asked for; the random suffix already makes it unique.
      body.append("useUniqueFileName", "false");
      body.append("publicKey", config.publicKey);
      body.append("token", config.token);
      body.append("expire", String(config.expire));
      body.append("signature", config.signature);

      const request = new XMLHttpRequest();
      request.open("POST", config.endpoint);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => {
        let payload: { url?: string; message?: string } = {};
        try {
          payload = JSON.parse(request.responseText);
        } catch {
          /* fall through to the generic message */
        }
        if (request.status >= 200 && request.status < 300 && payload.url) resolve(payload.url);
        else reject(new Error(payload.message || `ImageKit rejected the upload (${request.status}).`));
      };
      request.onerror = () => reject(new Error("The upload failed — check your connection."));
      request.send(body);
    });
  }

  async function upload(blob: Blob, fileName: string, kindForUpload: Kind) {
    setBusy(true);
    setProgress(0);
    setError("");
    try {
      const config = await auth(kindForUpload);
      setUrl(await send(config, new File([blob], fileName, { type: blob.type }), fileName));
      setSource(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  /** Renders the chosen window of the original file at full resolution. */
  async function uploadCrop() {
    if (!source || !draw) return;
    const image = new Image();
    image.src = source.objectUrl;
    try {
      await image.decode();
    } catch {
      setError("Could not read that image.");
      return;
    }

    const scale = Math.min(1, MAX_OUTPUT / Math.max(draw.cropW, draw.cropH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(draw.cropW * scale));
    canvas.height = Math.max(1, Math.round(draw.cropH * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setError("This browser cannot crop images.");
      return;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      source.width * draw.fx - draw.cropW / 2,
      source.height * draw.fy - draw.cropH / 2,
      draw.cropW,
      draw.cropH,
      0,
      0,
      canvas.width,
      canvas.height
    );

    // Keep PNG for transparent art, JPEG for photographs.
    const isPng = source.file.type === "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.92)
    );
    if (!blob) {
      setError("Could not prepare the cropped image.");
      return;
    }
    await upload(blob, fileNameFor(source.file.name, isPng ? "png" : "jpg"), "image");
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!draw) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      focusX: focus.x,
      focusY: focus.y,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !draw || drag.pointerId !== event.pointerId) return;
    // Moving the picture right shows more of its left side, so the focus moves left.
    setFocus({
      x: drag.focusX - (event.clientX - drag.startX) / draw.width,
      y: drag.focusY - (event.clientY - drag.startY) / draw.height,
    });
  }

  function endDrag() {
    dragRef.current = null;
  }

  const accept = kind === "pdf" ? "application/pdf,.pdf" : "image/*";

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={url} />
      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        accept={accept}
        className="hidden"
        required={required && !url}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (kind === "pdf") {
            void upload(file, fileNameFor(file.name, "pdf"), "pdf");
          } else {
            loadImage(file);
          }
        }}
      />

      {/* What is currently saved */}
      <div className="flex flex-wrap items-center gap-4">
        {kind === "image" && url ? (
          <img
            src={url}
            alt=""
            className="h-20 w-40 rounded-lg border border-black/10 object-cover dark:border-white/15"
          />
        ) : null}
        <button type="button" className={buttonClass} onClick={() => inputRef.current?.click()} disabled={busy}>
          <Icon name={kind === "pdf" ? "document-attach-outline" : "image-outline"} />
          {url ? (kind === "pdf" ? "Replace PDF" : "Choose another image") : kind === "pdf" ? "Upload PDF" : "Upload image"}
        </button>
        {url ? (
          <button
            type="button"
            className="text-sm text-red-700 underline underline-offset-4 dark:text-red-400"
            onClick={() => {
              setUrl("");
              setDone(false);
            }}
          >
            Remove
          </button>
        ) : null}
      </div>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
        >
          {url}
        </a>
      )}

      {busy && (
        <p className="text-sm" role="status">
          Uploading… {progress}%
        </p>
      )}
      {done && !busy && !source && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          Uploaded.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* Crop step */}
      {kind === "image" && source && (
        <div className="rounded-2xl border border-black/15 p-4 dark:border-white/15">
          <p className="mb-3 text-sm font-medium">
            Crop the picture — drag to choose which part to keep, then upload.
          </p>

          <div className="mb-3 flex flex-wrap gap-2">
            {RATIOS.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  setRatio(option.value);
                  setFocus({ x: 0.5, y: 0.5 });
                  setZoom(1);
                }}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  ratio === option.value
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/20 dark:border-white/20"
                }`}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div
            ref={frameRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative mx-auto w-full max-w-[560px] cursor-grab touch-none overflow-hidden rounded-xl bg-black/10 active:cursor-grabbing"
            style={{ aspectRatio: String(activeRatio) }}
          >
            {draw && (
              <img
                src={source.objectUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{ width: draw.width, height: draw.height, left: draw.left, top: draw.top }}
              />
            )}
            {/* Rule-of-thirds guides */}
            <div className="pointer-events-none absolute inset-0">
              {[33.33, 66.66].map((p) => (
                <div key={`v${p}`} className="absolute inset-y-0 border-l border-white/25" style={{ left: `${p}%` }} />
              ))}
              {[33.33, 66.66].map((p) => (
                <div key={`h${p}`} className="absolute inset-x-0 border-t border-white/25" style={{ top: `${p}%` }} />
              ))}
            </div>
          </div>

          <label className="mt-4 flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full max-w-xs"
            />
          </label>

          <p className="mt-2 text-sm opacity-60">
            Output: {draw ? `${Math.round(draw.cropW)} × ${Math.round(draw.cropH)}` : "…"} px
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button type="button" className={primaryButtonClass} onClick={uploadCrop} disabled={busy}>
              <Icon name="cloud-upload-outline" />
              Crop and upload
            </button>
            <button
              type="button"
              className="underline underline-offset-4 opacity-70 hover:opacity-100"
              onClick={() => {
                setSource(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
