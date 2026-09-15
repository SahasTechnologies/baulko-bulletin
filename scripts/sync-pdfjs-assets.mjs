/**
 * Copy pdf.js's workers and wasm decoders into `public/pdfjs/<version>/`.
 *
 * `PdfViewer` used to point pdf.js at unpkg for both. That is two problems: a
 * module worker cannot be started from another origin, and a CDN outage would
 * take the reader down with it, and its query string was the one network
 * dependency on a page that otherwise renders entirely from our own files.
 *
 * pdf.js ships two builds of the same version. The modern one is smaller and
 * faster but assumes a very new engine — it calls `Uint8Array.prototype.toHex()`,
 * which only reached browsers in Chrome 140 / Safari 18.2 / Firefox 133. The
 * legacy one is transpiled and carries core-js polyfills for exactly those
 * methods. `PdfViewer` picks between them at runtime, so both workers have to be
 * here: a main-thread build and a worker from different builds would disagree
 * about the message protocol, which is why they are copied together and keyed to
 * the same version.
 *
 * The files are deliberately not committed — they are a copy of whatever
 * pdfjs-dist version is installed, and the target directory is versioned so a
 * pdfjs upgrade writes a new path instead of serving a stale worker next to a
 * new API. `npm install` and `npm run build` both run this (see package.json),
 * so the assets are present in dev and in the deployed output.
 *
 * Run it by hand with `node scripts/sync-pdfjs-assets.mjs`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "pdfjs-dist");
const publicDir = join(root, "public", "pdfjs");

const packageJson = join(from, "package.json");
if (!existsSync(packageJson)) {
  // A fresh clone runs this before node_modules exists; that is not an error,
  // the build will run it again once dependencies are in place.
  console.log("[pdfjs] pdfjs-dist is not installed yet — skipping");
  process.exit(0);
}

const version = JSON.parse(readFileSync(packageJson, "utf8")).version;
const WORKER = "pdf.worker.min.mjs";
const sourceWasm = join(from, "wasm");
const target = join(publicDir, version);

/**
 * The two builds, in the layout `PdfViewer` expects. `sub` is both the
 * directory under the version folder and the path fragment in the worker URL,
 * so they cannot drift apart.
 */
const builds = [
  { name: "modern", sub: "", source: join(from, "build", WORKER) },
  { name: "legacy", sub: "legacy", source: join(from, "legacy", "build", WORKER) },
];

const missing = builds.filter((build) => !existsSync(build.source));
if (missing.length || !existsSync(sourceWasm)) {
  console.error(
    `[pdfjs] pdfjs-dist@${version} is missing ${missing.map((b) => b.source).join(", ") || ""}${
      existsSync(sourceWasm) ? "" : " and wasm/"
    }. The reader needs every one of them.`
  );
  process.exit(1);
}

/** Same version, same worker bytes: nothing to do. */
function fingerprint() {
  const workers = builds.map((build) => `${build.name}:${statSync(build.source).size}`).join("|");
  const wasm = readdirSync(sourceWasm)
    .filter((name) => name.endsWith(".wasm"))
    .sort()
    .map((name) => `${name}:${statSync(join(sourceWasm, name)).size}`)
    .join(",");
  return `${version}|${workers}|${wasm}`;
}

const marker = join(target, ".synced");
const expected = fingerprint();
if (existsSync(marker) && readFileSync(marker, "utf8") === expected) {
  console.log(`[pdfjs] public/pdfjs/${version} is up to date`);
  process.exit(0);
}

// Only ever keep the version in use, so a pdfjs bump cannot leave two copies
// behind (and an old directory can never be served by mistake).
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const written = [];
for (const build of builds) {
  const dest = join(target, build.sub, WORKER);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(build.source, dest);
  written.push(`${build.name} worker ${Math.round(statSync(dest).size / 1024)} KB`);
}

// The whole wasm directory: the decoders are fetched lazily by name, so any
// subset risks a missing file the day a PDF uses JBIG2 or JPX art. Both builds
// read this same directory — pdfjs-dist ships no separate legacy copy.
cpSync(sourceWasm, join(target, "wasm"), { recursive: true });

writeFileSync(marker, expected);
console.log(`[pdfjs] wrote public/pdfjs/${version}/ (${written.join(", ")}, wasm directory copied)`);
