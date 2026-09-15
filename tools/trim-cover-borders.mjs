/**
 * Trim the uniform border some cover images carry — a page photographed against
 * a light backdrop leaves a grey frame around the artwork, which shows up on the
 * site because covers are displayed edge to edge.
 *
 * Usage:
 *   node tools/trim-cover-borders.mjs <slug|url> [more…]            # preview
 *   node tools/trim-cover-borders.mjs <slug|url> [more…] --write    # upload + save
 *
 * `--write` uploads the trimmed file to ImageKit and repoints the row that used
 * the original, so the public site picks it up. Without it, nothing is changed
 * and you just see how much border was found. `--index` surveys every post,
 * extra and puzzle cover instead of the listed ones — it only reports, and its
 * findings need a human eye, because a dark or flat corner in the artwork
 * itself can look like a border.
 *
 * Detection is a pixel scan rather than a fixed crop: the frame is rarely the
 * same thickness on every side, and it must not eat into the artwork.
 */

import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// sharp is not a declared dependency: Astro's image pipeline installs it, and
// adding it to package.json would rewrite half the lockfile for one script.
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "This script needs sharp, which normally comes with Astro. Install it with:\n  npm i -D sharp"
  );
  process.exit(1);
}

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

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const INDEX = args.includes("--index");
const targets = args.filter((a) => !a.startsWith("--"));
/** Colors within this distance of the border color count as border. */
const TOLERANCE = 10;
const sql = neon(process.env.DATABASE_URL);

/**
 * Finds how much uniform border surrounds the picture.
 *
 * The border color comes from the top-left pixel, then a set of scan lines is
 * walked inwards from each edge until something else appears.
 *
 * Two details matter. A scan line that starts inside the border on a
 * perpendicular edge walks the whole way across, so those runs are discarded.
 * And because the artwork itself often contains near-white pixels, the answer
 * for an edge is the median of the remaining runs — a couple of lines that run
 * into a bright wall must not inflate the crop.
 */
async function borderInsets(buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const border = [data[0], data[1], data[2]];
  const isBorder = (x, y) => {
    const i = (y * w + x) * c;
    return (
      Math.abs(data[i] - border[0]) <= TOLERANCE &&
      Math.abs(data[i + 1] - border[1]) <= TOLERANCE &&
      Math.abs(data[i + 2] - border[2]) <= TOLERANCE
    );
  };
  // Border can never be more than a quarter of the way across.
  const limitX = Math.floor(w / 4);
  const limitY = Math.floor(h / 4);
  const run = (count, limit, inside) => {
    const distances = [];
    const step = Math.max(1, Math.floor(count / 32));
    for (let i = 0; i < count; i += step) {
      let d = 0;
      while (d < limit && inside(d, i)) d++;
      if (d < limit) distances.push(d);
    }
    if (!distances.length) return 0;
    distances.sort((a, b) => a - b);
    return distances[Math.floor(distances.length / 2)];
  };

  const left = run(h, limitX, (d, y) => isBorder(d, y));
  const right = run(h, limitX, (d, y) => isBorder(w - 1 - d, y));
  const top = run(w, limitY, (d, x) => isBorder(x, d));
  const bottom = run(w, limitY, (d, x) => isBorder(x, h - 1 - d));

  return { left, top, right, bottom, width: w, height: h, border };
}

async function download(url) {
  let res = await fetch(url);
  if (!res.ok && url.includes("ik.imagekit.io")) {
    // ImageKit refuses to serve the original of very large images; ask for a resized copy.
    const sep = url.includes("?") ? "&" : "?";
    res = await fetch(`${url}${sep}tr=w-2400`);
  }
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(buffer, fileName, folder) {
  const body = new FormData();
  body.append("file", new Blob([buffer]), fileName);
  body.append("fileName", fileName);
  body.append("folder", folder);
  body.append("useUniqueFileName", "false");
  const auth = Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64");
  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.url;
}

/**
 * The trimmed file gets a new name rather than overwriting the original: a
 * changed file at an unchanged URL keeps serving the old bytes from ImageKit's
 * cache, and the site would look untouched. The dimensions make the result
 * obvious and keep the name unique per crop.
 */
function trimmedName(url, format, width, height) {
  const base = decodeURIComponent(new URL(url).pathname).split("/").pop() || "cover";
  const stem = base.replace(/(?:-\d+x\d+)?\.[a-z0-9]+$/i, "");
  const ext = format === "jpeg" ? "jpg" : format;
  return `${stem}-${width}x${height}.${ext}`;
}

async function trimOne(label, url, save) {
  if (!url) {
    console.log(`skip  ${label} — no cover`);
    return null;
  }
  const original = await download(url);
  const meta = await sharp(original).metadata();
  const insets = await borderInsets(original);
  const width = insets.width - insets.left - insets.right;
  const height = insets.height - insets.top - insets.bottom;
  const found = insets.left + insets.top + insets.right + insets.bottom;

  if (width < 32 || height < 32) {
    console.log(`skip  ${label} — trimming would leave a ${width}x${height} image`);
    return null;
  }
  if (found === 0) {
    console.log(`ok    ${label} — no border found (${insets.width}x${insets.height})`);
    return null;
  }

  const format = meta.format === "png" ? "png" : "jpeg";
  const trimmed = await sharp(original)
    .extract({ left: insets.left, top: insets.top, width, height })
    .toFormat(format, format === "png" ? { compressionLevel: 9 } : { quality: 90, mozjpeg: true })
    .toBuffer();

  const name = trimmedName(url, format, width, height);
  console.log(
    `trim  ${label} — border l${insets.left} t${insets.top} r${insets.right} b${insets.bottom} ` +
      `(rgb ${insets.border.join(",")})\n      ${insets.width}x${insets.height} → ${width}x${height} ` +
      `(${Math.round(original.length / 1024)}KB → ${Math.round(trimmed.length / 1024)}KB) → ${name}`
  );

  if (!WRITE) return null;
  const next = await upload(trimmed, name, "/bulletin");
  if (save) await save(next);
  console.log(`      ${next}`);
  return next;
}

async function coversFor(term) {
  if (/^https?:\/\//.test(term)) return [{ label: term, url: term, save: null }];
  const rows = await sql`
    SELECT 'extras' AS kind, id, slug, cover_image_url FROM extras WHERE slug = ${term}
    UNION ALL
    SELECT 'posts', id, slug, cover_image_url FROM posts WHERE slug = ${term}
    UNION ALL
    SELECT 'puzzles', id, title, cover_image_url FROM puzzles WHERE title = ${term}
  `;
  if (!rows[0]) throw new Error(`no row with slug/title "${term}"`);
  return rows.map((row) => ({
    label: `${row.kind} ${row.slug}`,
    url: row.cover_image_url,
    save: async (next) => {
      if (row.kind === "extras") await sql`UPDATE extras SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
      if (row.kind === "posts") await sql`UPDATE posts SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
      if (row.kind === "puzzles") await sql`UPDATE puzzles SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
    },
  }));
}

let list;
if (INDEX) {
  const rows = await sql`
    SELECT 'extras' AS kind, id, slug, cover_image_url FROM extras WHERE cover_image_url IS NOT NULL
    UNION ALL
    SELECT 'posts', id, slug, cover_image_url FROM posts WHERE cover_image_url IS NOT NULL
    UNION ALL
    SELECT 'puzzles', id, title AS slug, cover_image_url FROM puzzles WHERE cover_image_url IS NOT NULL
  `;
  list = rows.map((row) => ({
    label: `${row.kind} ${row.slug}`,
    url: row.cover_image_url,
    save: async (next) => {
      if (row.kind === "extras") await sql`UPDATE extras SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
      if (row.kind === "posts") await sql`UPDATE posts SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
      if (row.kind === "puzzles") await sql`UPDATE puzzles SET cover_image_url = ${next} WHERE id = ${row.id}::uuid`;
    },
  }));
} else {
  if (!targets.length) {
    console.error("Pass a slug, a cover URL, or --index. See the comment at the top of this file.");
    process.exit(1);
  }
  list = (await Promise.all(targets.map(coversFor))).flat();
}

for (const item of list) {
  try {
    await trimOne(item.label, item.url, item.save);
  } catch (err) {
    console.error(`FAILED ${item.label}: ${err.message}`);
  }
}
console.log(WRITE ? "done" : "dry run — re-run with --write to upload and save");
