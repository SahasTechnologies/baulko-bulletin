/**
 * ImageKit upload authentication.
 *
 * Files are uploaded straight from the browser to ImageKit, not through this
 * app: Vercel caps a function's request body at 4.5 MB, and the issue PDFs run
 * well past that. ImageKit's upload API accepts an upload only when it carries a
 * signature made with the private key, so the browser asks an authenticated
 * admin endpoint for a short-lived one and then talks to ImageKit directly.
 *
 * The private key never leaves the server, and the signature is scoped to a
 * single upload attempt (a random token plus an expiry, both of which ImageKit
 * checks).
 */

import { createHmac, randomUUID } from "node:crypto";

/** Long enough for a slow upload on a school connection, short enough to be useless if leaked. */
const AUTH_TTL_SECONDS = 10 * 60;

export interface UploadAuth {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
}

export type UploadKind = "image" | "pdf";

/**
 * Same precedence as the admin secrets: `process.env` holds the runtime value on
 * Vercel, while `import.meta.env` is what `astro dev` populates from `.env`.
 */
function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess.trim();
  const fromImportMeta = (import.meta.env as Record<string, string | undefined>)[name];
  return (fromImportMeta || "").trim();
}

export function imageKitConfigured(): boolean {
  return Boolean(env("IMAGEKIT_PRIVATE_KEY") && env("IMAGEKIT_PUBLIC_KEY"));
}


/** Mirrors `rename-media.mjs`: covers at the bucket root, issue PDFs under `pdfs`. */
export function uploadFolder(kind: UploadKind): string {
  return kind === "pdf" ? "/bulletin/pdfs" : "/bulletin";
}

/**
 * Builds the `{ token, expire, signature }` triple ImageKit expects, plus the
 * public key the browser has to send alongside it. Returns null when the
 * integration is not configured, so the route can say so instead of handing the
 * browser an upload that is guaranteed to be rejected.
 */
export function uploadAuth(): UploadAuth | null {
  const privateKey = env("IMAGEKIT_PRIVATE_KEY");
  const publicKey = env("IMAGEKIT_PUBLIC_KEY");
  if (!privateKey || !publicKey) return null;

  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS;
  const signature = createHmac("sha1", privateKey).update(`${token}${expire}`).digest("hex");

  return { token, expire, signature, publicKey };
}

/**
 * The URL to POST to, overridable for tests. Kept here so the browser component
 * and any future server-side uploader agree on one endpoint.
 */
export function uploadEndpoint(): string {
  return env("IMAGEKIT_UPLOAD_ENDPOINT") || "https://upload.imagekit.io/api/v1/files/upload";
}

/* ---------------------------------------------------------------- deleting */

function privateKey(): string {
  return env("IMAGEKIT_PRIVATE_KEY");
}

export function imageKitUrlEndpoint(): string {
  return env("IMAGEKIT_URL_ENDPOINT");
}

/**
 * The file path behind one of our own ImageKit URLs, or null if it is not ours.
 *
 * `https://ik.imagekit.io/<id>/bulletin/cover-abc1.png?tr=w-1000` →
 * `/bulletin/cover-abc1.png`. The transform query is dropped because it is
 * added at render time (`lib/images.ts`) and is not part of the file.
 *
 * The path is returned exactly as it appears in the URL rather than decoded:
 * the same string is what a reference check has to find in the stored text, and
 * an encoded form that no longer matches the database is worse than useless.
 * Everything the panel uploads is named from `[a-z0-9-]` plus a suffix, so the
 * two forms coincide in practice anyway.
 *
 * Returning null is the safety catch: a URL an editor pasted from somewhere
 * else is not ours to delete, and nothing here will ever touch it.
 */
export function filePathFromImageKitUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const endpoint = imageKitUrlEndpoint();
  if (!endpoint) return null;

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.host !== base.host) return null;

  const prefix = base.pathname.replace(/\/+$/, "");
  if (prefix && !parsed.pathname.startsWith(`${prefix}/`)) return null;
  const path = parsed.pathname.slice(prefix.length);
  return path.startsWith("/") && path.length > 1 ? path : null;
}

export type DeleteOutcome = "deleted" | "missing" | "unconfigured" | "failed";

/**
 * Removes one file from ImageKit.
 *
 * ImageKit's delete API takes a `fileId`, not a path, and the panel stores only
 * URLs — so the id is looked up by filename first. The random suffix
 * `MediaField` puts on every upload is what makes that safe, and the full path
 * is compared before anything is deleted rather than trusting the name alone.
 *
 * The lookup goes through ImageKit's search index, which does not see a file
 * the instant it is uploaded: measured on this account, a new file is
 * unlistable for about eleven seconds, by search and by plain folder listing
 * alike. That is why the caller is told "missing" rather than an error when
 * nothing comes back — a file replaced within seconds of its own upload is the
 * one case this cannot see, and it stays in the bucket rather than being
 * reported as a failure. Everything else it deletes is old enough to be found
 * on the first try, so no retry is worth the latency on the save.
 */
export async function deleteImageKitFile(path: string): Promise<DeleteOutcome> {
  const key = privateKey();
  if (!key) return "unconfigured";
  const authorization = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

  const name = path.split("/").filter(Boolean).pop();
  if (!name) return "missing";

  let found: { fileId?: string; filePath?: string }[];
  try {
    const query = new URLSearchParams({ searchQuery: `name = "${name}"`, limit: "10" });
    const response = await fetch(`https://api.imagekit.io/v1/files?${query}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
    });
    if (!response.ok) {
      console.error(`[imagekit] lookup ${path} failed: ${response.status} ${await response.text()}`);
      return "failed";
    }
    found = (await response.json()) as typeof found;
  } catch (err) {
    console.error(`[imagekit] lookup ${path} threw:`, err);
    return "failed";
  }

  const file = found.find((entry) => entry.filePath === path);
  if (!file?.fileId) {
    // Named rather than silent: if this file was uploaded seconds before it was
    // replaced, this is the lag described above, and the path is the only way
    // anyone will find the orphan later.
    console.warn(`[imagekit] no file at ${path} — nothing to delete`);
    return "missing";
  }

  try {
    const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(file.fileId)}`, {
      method: "DELETE",
      headers: { Authorization: authorization },
    });
    // A file that is already gone is the outcome that was asked for, not a
    // failure — ImageKit answers 404 for it.
    if (response.status === 404) return "missing";
    if (!response.ok) {
      console.error(`[imagekit] delete ${path} failed: ${response.status} ${await response.text()}`);
      return "failed";
    }
    return "deleted";
  } catch (err) {
    console.error(`[imagekit] delete ${path} threw:`, err);
    return "failed";
  }
}
