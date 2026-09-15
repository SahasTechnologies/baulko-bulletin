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
