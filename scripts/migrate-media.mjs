import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

const required = [
  "DATABASE_URL",
  "IMAGEKIT_PRIVATE_KEY",
  "FILEBASE_ACCESS_KEY",
  "FILEBASE_SECRET_KEY",
  "FILEBASE_BUCKET",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: "https://s3.filebase.com",
  credentials: {
    accessKeyId: process.env.FILEBASE_ACCESS_KEY,
    secretAccessKey: process.env.FILEBASE_SECRET_KEY,
  },
});

function filenameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "file");
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, type: res.headers.get("content-type") || "application/octet-stream" };
}

async function uploadImageKit(buf, fileName) {
  const body = new FormData();
  body.append("file", new Blob([buf]), fileName);
  body.append("fileName", fileName);
  body.append("folder", "/bulletin");
  body.append("useUniqueFileName", "true");
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

async function uploadFilebase(buf, key, type) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.FILEBASE_BUCKET,
      Key: key,
      Body: buf,
      ContentType: type,
      ACL: "public-read",
    })
  );
  return `https://${process.env.FILEBASE_BUCKET}.s3.filebase.com/${key}`;
}

const cache = new Map();

async function migrateUrl(url) {
  if (!url || !String(url).includes("cdn.sanity.io")) return url;
  if (cache.has(url)) return cache.get(url);
  const name = filenameFromUrl(url);
  const { buf, type } = await download(url);
  const next =
    type.includes("pdf") || name.toLowerCase().endsWith(".pdf")
      ? await uploadFilebase(buf, `pdfs/${name}`, "application/pdf")
      : await uploadImageKit(buf, name);
  cache.set(url, next);
  console.log(url, "->", next);
  return next;
}

const posts = await sql`SELECT id, cover_image_url, pdf_url FROM posts`;
for (const row of posts) {
  const cover = await migrateUrl(row.cover_image_url);
  const pdf = await migrateUrl(row.pdf_url);
  await sql`UPDATE posts SET cover_image_url = ${cover}, pdf_url = ${pdf} WHERE id = ${row.id}`;
}

const extras = await sql`SELECT id, cover_image_url FROM extras`;
for (const row of extras) {
  const cover = await migrateUrl(row.cover_image_url);
  await sql`UPDATE extras SET cover_image_url = ${cover} WHERE id = ${row.id}`;
}

const puzzles = await sql`SELECT id, cover_image_url FROM puzzles`;
for (const row of puzzles) {
  const cover = await migrateUrl(row.cover_image_url);
  await sql`UPDATE puzzles SET cover_image_url = ${cover} WHERE id = ${row.id}`;
}

console.log("done", cache.size, "files");
