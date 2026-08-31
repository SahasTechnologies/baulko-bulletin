import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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

const bucket = process.env.FILEBASE_BUCKET.trim();
const sql = neon(process.env.DATABASE_URL);
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: "https://s3.filebase.com",
  forcePathStyle: false,
  maxAttempts: 8,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 60_000,
    requestTimeout: 600_000,
  }),
  credentials: {
    accessKeyId: process.env.FILEBASE_ACCESS_KEY,
    secretAccessKey: process.env.FILEBASE_SECRET_KEY,
  },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(label, fn) {
  let last;
  for (let i = 1; i <= 8; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err.Code === "NoSuchBucket" || err.name === "NoSuchBucket") throw err;
      const wait = Math.min(30_000, 1000 * 2 ** (i - 1));
      console.warn(`${label} failed (${i}/8): ${err.code || err.message}. retry in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

function filenameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "file");
}

async function download(url) {
  return retry(`download ${url}`, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, type: res.headers.get("content-type") || "application/octet-stream" };
  });
}

async function uploadImageKit(buf, fileName) {
  return retry(`imagekit ${fileName}`, async () => {
    const body = new FormData();
    body.append("file", new Blob([buf]), fileName);
    body.append("fileName", fileName);
    body.append("folder", "/bulletin");
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
  });
}

async function uploadFilebase(buf, key, type) {
  return retry(`filebase ${key} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`, async () => {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: type,
      })
    );
    return `https://${bucket}.s3.filebase.com/${key}`;
  });
}

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("Filebase bucket ok:", bucket);
} catch (err) {
  console.error(`Filebase bucket "${bucket}" was not found.`);
  console.error("In https://console.filebase.com create a bucket, copy its exact name into FILEBASE_BUCKET in .env, then re-run.");
  console.error(err.Code || err.message);
  process.exit(1);
}

const cache = new Map();
const failed = [];

async function migrateUrl(url) {
  if (!url) return url;
  const s = String(url);
  if (!s.includes("cdn.sanity.io")) return s;
  if (cache.has(s)) return cache.get(s);
  const name = filenameFromUrl(s);
  try {
    const { buf, type } = await download(s);
    console.log(`got ${name} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
    const next =
      type.includes("pdf") || name.toLowerCase().endsWith(".pdf")
        ? await uploadFilebase(buf, `pdfs/${name}`, "application/pdf")
        : await uploadImageKit(buf, name);
    cache.set(s, next);
    console.log(s, "->", next);
    return next;
  } catch (err) {
    failed.push({ url: s, error: err.message || String(err) });
    console.error("skip", s, err.message || err);
    return s;
  }
}

const posts = await sql`SELECT id, cover_image_url, pdf_url FROM posts`;
const extras = await sql`SELECT id, cover_image_url FROM extras`;
const puzzles = await sql`SELECT id, cover_image_url FROM puzzles`;
console.log(`Neon: ${posts.length} posts, ${extras.length} extras, ${puzzles.length} puzzles`);

for (const row of posts) {
  const cover = await migrateUrl(row.cover_image_url);
  const pdf = await migrateUrl(row.pdf_url);
  await sql`UPDATE posts SET cover_image_url = ${cover}, pdf_url = ${pdf} WHERE id = ${row.id}`;
}
for (const row of extras) {
  const cover = await migrateUrl(row.cover_image_url);
  await sql`UPDATE extras SET cover_image_url = ${cover} WHERE id = ${row.id}`;
}
for (const row of puzzles) {
  const cover = await migrateUrl(row.cover_image_url);
  await sql`UPDATE puzzles SET cover_image_url = ${cover} WHERE id = ${row.id}`;
}

console.log("moved", cache.size, "files");
if (failed.length) {
  console.error("still failed:", failed.length);
  for (const f of failed) console.error("-", f.url, f.error);
  process.exit(1);
}
console.log("done");
