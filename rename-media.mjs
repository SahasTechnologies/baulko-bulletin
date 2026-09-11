// Rename existing covers and issue PDFs to readable, issue-code based names.
// Everything lives on ImageKit. Idempotent: anything already named correctly is
// left alone, so it's safe to re-run after adding new rows.
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    if (!existsSync(name)) continue;
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnv();

const DRY = process.env.DRY === "1";
const sql = neon(process.env.DATABASE_URL);

// Keep "+" so an issue titled "n+32: Medieval History" becomes n+32, not n-32.
function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, "-")
      .replace(/^[-+]+|[-+]+$/g, "")
      .slice(0, 80) || "file"
  );
}

// "n+32: Medieval History" -> "n+32". Odd titles fall back to the slug.
function issueName(row) {
  const head = String(row.title || "").split(":")[0].trim();
  return slugify(head || row.slug || row.title);
}

function extOf(url, fallback) {
  const p = new URL(url).pathname.split(".").pop() || "";
  return /^[a-z0-9]{2,5}$/i.test(p) ? p.toLowerCase() : fallback;
}

// ImageKit rewrites "+" to "_" in stored filenames.
function ikFileName(name, ext) {
  return `${name.replace(/\+/g, "_")}.${ext}`;
}

function alreadyThere(url, folder, fileName) {
  if (!url) return false;
  try {
    return decodeURIComponent(new URL(url).pathname) === `${folder}/${fileName}`;
  } catch {
    return false;
  }
}

async function download(url) {
  let res = await fetch(url);
  if (!res.ok && url.includes("ik.imagekit.io")) {
    // ImageKit refuses to serve the original of very large images; ask for a resized copy.
    const sep = url.includes("?") ? "&" : "?";
    res = await fetch(`${url}${sep}tr=w-2000`);
  }
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(buf, fileName, folder) {
  const body = new FormData();
  body.append("file", new Blob([buf]), fileName);
  body.append("fileName", fileName);
  body.append("folder", folder);
  body.append("useUniqueFileName", "false");
  const auth = Buffer.from(process.env.IMAGEKIT_PRIVATE_KEY + ":").toString("base64");
  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.url;
}

async function renameImage(url, name) {
  if (!url) return url;
  const fileName = ikFileName(name, extOf(url, "jpg"));
  if (alreadyThere(url, "/bulletin", fileName)) return url;
  if (DRY) {
    console.log("img", name, "->", fileName);
    return url;
  }
  const next = await upload(await download(url), fileName, "/bulletin");
  console.log("img", name, "->", next);
  return next;
}

async function renamePdf(url, name) {
  if (!url) return url;
  const fileName = ikFileName(name, "pdf");
  if (alreadyThere(url, "/bulletin/pdfs", fileName)) return url;
  if (DRY) {
    console.log("pdf", name, "->", `pdfs/${fileName}`);
    return url;
  }
  const next = await upload(await download(url), fileName, "/bulletin/pdfs");
  console.log("pdf", name, "->", next);
  return next;
}

// One broken file shouldn't abort the whole run.
async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`FAILED ${label}: ${err.message}`);
  }
}

const posts = await sql`SELECT id, title, slug, cover_image_url, pdf_url FROM posts`;
const extras = await sql`SELECT id, title, slug, cover_image_url FROM extras`;
const puzzles = await sql`SELECT id, title, type, cover_image_url FROM puzzles`;

for (const row of posts) {
  await step(`post ${row.slug}`, async () => {
    const name = issueName(row);
    const cover = await renameImage(row.cover_image_url, name);
    const pdf = await renamePdf(row.pdf_url, name);
    if (!DRY) {
      await sql`UPDATE posts SET cover_image_url = ${cover}, pdf_url = ${pdf} WHERE id = ${row.id}`;
    }
  });
}
for (const row of extras) {
  await step(`extra ${row.slug}`, async () => {
    const name = slugify(row.slug || row.title);
    const cover = await renameImage(row.cover_image_url, name);
    if (!DRY) {
      await sql`UPDATE extras SET cover_image_url = ${cover} WHERE id = ${row.id}`;
    }
  });
}
for (const row of puzzles) {
  await step(`puzzle ${row.title}-${row.type}`, async () => {
    const name = slugify(`${row.title}-${row.type}`);
    const cover = await renameImage(row.cover_image_url, name);
    if (!DRY) {
      await sql`UPDATE puzzles SET cover_image_url = ${cover} WHERE id = ${row.id}`;
    }
  });
}
console.log(DRY ? "dry run done" : "done");
