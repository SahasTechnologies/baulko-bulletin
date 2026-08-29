/**
 * Import sanity-export.json into Neon.
 *
 * Usage:
 *   1. Copy sanity-export.json into this project (or pass full path)
 *   2. Set DATABASE_URL to your Neon connection string
 *   3. npm i pg
 *   4. node scripts/import-sanity.mjs [path/to/sanity-export.json]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL. Set it to your Neon connection string.");
  process.exit(1);
}

const exportPath = resolve(process.argv[2] || "./sanity-export.json");

/** Small Portable Text → HTML converter (good enough for this site). */
function blocksToHtml(blocks) {
  if (!blocks) return "";
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block) => {
      if (block._type !== "block") return "";
      const text = (block.children || [])
        .map((span) => {
          let t = span.text || "";
          const marks = span.marks || [];
          if (marks.includes("strong")) t = `<strong>${t}</strong>`;
          if (marks.includes("em")) t = `<em>${t}</em>`;
          return t;
        })
        .join("");

      if (block.listItem === "bullet") return `<li>${text}</li>`;
      if (block.style === "h2") return `<h2>${text}</h2>`;
      if (block.style === "h3") return `<h3>${text}</h3>`;
      if (block.style === "h4") return `<h4>${text}</h4>`;
      return `<p>${text}</p>`;
    })
    .join("\n");
}

function firstPdf(fileUrl) {
  if (!fileUrl) return null;
  if (Array.isArray(fileUrl)) return fileUrl[0] || null;
  return typeof fileUrl === "string" ? fileUrl : null;
}

async function main() {
  const fileText = readFileSync(exportPath, "utf8").replace(/^﻿/, "");
  const raw = JSON.parse(fileText);
  const docs = (raw.result || raw).filter(
    (d) => d && d._type && !String(d._id).startsWith("drafts.")
  );

  console.log(`Loaded ${docs.length} published documents from ${exportPath}`);

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Clean slate so the script is re-runnable
  await client.query(`
    TRUNCATE puzzles, posts, extras, pages, authors, settings RESTART IDENTITY CASCADE;
  `);
  await client.query(`INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;`);

  // Authors
  const authorMap = new Map();
  const authors = docs.filter((d) => d._type === "author");
  for (const a of authors) {
    const { rows } = await client.query(
      `INSERT INTO authors (name, picture_url, picture_alt)
       VALUES ($1, $2, $3) RETURNING id`,
      [a.name || "Unknown", a.pictureUrl || null, a.picture?.alt || null]
    );
    authorMap.set(a._id, rows[0].id);
  }
  console.log(`Inserted ${authors.length} authors`);

  // Posts
  const posts = docs.filter((d) => d._type === "post");
  for (const p of posts) {
    const slug = p.slug?.current || p._id;
    await client.query(
      `INSERT INTO posts
         (title, slug, excerpt, content, cover_image_url, cover_image_alt, date, author_id, pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         excerpt = EXCLUDED.excerpt,
         content = EXCLUDED.content,
         cover_image_url = EXCLUDED.cover_image_url,
         cover_image_alt = EXCLUDED.cover_image_alt,
         date = EXCLUDED.date,
         author_id = EXCLUDED.author_id,
         pdf_url = EXCLUDED.pdf_url`,
      [
        p.title || "Untitled",
        slug,
        p.excerpt || null,
        blocksToHtml(p.content),
        p.coverUrl || null,
        p.coverImage?.alt || null,
        p.date || new Date().toISOString(),
        p.author?._ref ? authorMap.get(p.author._ref) || null : null,
        firstPdf(p.fileUrl),
      ]
    );
  }
  console.log(`Inserted ${posts.length} posts`);

  // Extras
  const extras = docs.filter((d) => d._type === "extra");
  for (const e of extras) {
    const slug = e.slug?.current || e._id;
    await client.query(
      `INSERT INTO extras
         (title, slug, excerpt, content, cover_image_url, cover_image_alt, date, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         excerpt = EXCLUDED.excerpt,
         content = EXCLUDED.content,
         cover_image_url = EXCLUDED.cover_image_url,
         cover_image_alt = EXCLUDED.cover_image_alt,
         date = EXCLUDED.date,
         author_id = EXCLUDED.author_id`,
      [
        e.title || "Untitled",
        slug,
        e.excerpt || null,
        blocksToHtml(e.content),
        e.coverUrl || null,
        e.coverImage?.alt || null,
        e.date || new Date().toISOString(),
        e.author?._ref ? authorMap.get(e.author._ref) || null : null,
      ]
    );
  }
  console.log(`Inserted ${extras.length} extras`);

  // Puzzles
  const puzzles = docs.filter((d) => d._type === "puzzle");
  for (const pz of puzzles) {
    await client.query(
      `INSERT INTO puzzles
         (title, type, data, date, author_id, cover_image_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        pz.title || "Untitled",
        pz.type || "Crossword",
        pz.data || "",
        pz.date || new Date().toISOString(),
        pz.author?._ref ? authorMap.get(pz.author._ref) || null : null,
        pz.coverUrl || null,
      ]
    );
  }
  console.log(`Inserted ${puzzles.length} puzzles`);

  // Settings
  const settings = docs.find((d) => d._type === "settings");
  if (settings) {
    const desc =
      typeof settings.description === "string"
        ? settings.description
        : blocksToHtml(settings.description).replace(/<\/?p>/g, "").trim();
    await client.query(
      `UPDATE settings SET title = $1, description = $2 WHERE id = 1`,
      [settings.title || "Baulko Bulletin", desc || ""]
    );
    console.log("Updated settings");
  }

  // Pages
  for (const slug of ["about", "faq", "join"]) {
    const page = docs.find((d) => d._type === slug || d._id === slug);
    if (!page) continue;
    await client.query(
      `INSERT INTO pages (slug, title, body_html)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         body_html = EXCLUDED.body_html`,
      [slug, page.title || slug, blocksToHtml(page.detail || page.content)]
    );
    console.log(`Upserted page: ${slug}`);
  }

  await client.end();
  console.log("\nDone. Data is in Neon.");
  console.log("Cover/PDF URLs still point at Sanity CDN — re-upload to ImageKit/Filebase later if you want.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
