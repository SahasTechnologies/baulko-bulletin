/**
 * Data access layer — Neon Postgres.
 * Env var: DATABASE_URL
 *
 * If DATABASE_URL is missing or a query fails, functions return empty/default
 * data so `npm run dev` still works.
 */

import { neon } from "@neondatabase/serverless";
import type {
  Extra,
  PageContent,
  Post,
  Puzzle,
  Settings,
} from "@/types/content";

const FALLBACK_SETTINGS: Settings = {
  title: "Baulko Bulletin",
  description:
    "The home of stories, articles, poetry, illustrations and more by Baulkham Hills High students.",
  footer_html: null,
  og_image_url: null,
};

function databaseUrl(): string {
  return (
    (import.meta.env.DATABASE_URL as string | undefined) ||
    process.env.DATABASE_URL ||
    ""
  );
}

function client() {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

async function run<T>(fn: (sql: ReturnType<typeof neon>) => Promise<T>, fallback: T): Promise<T> {
  const sql = client();
  if (!sql) return fallback;
  try {
    return await fn(sql);
  } catch (err) {
    console.error("[db]", err);
    return fallback;
  }
}

export async function getSettings(): Promise<Settings> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT title, description, footer_html, og_image_url
      FROM settings WHERE id = 1 LIMIT 1
    `;
    return (rows[0] as Settings) ?? FALLBACK_SETTINGS;
  }, FALLBACK_SETTINGS);
}

export async function getLatestPost(): Promise<Post | null> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt,
             date::text, pdf_url
      FROM posts
      ORDER BY date DESC
      LIMIT 1
    `;
    return (rows[0] as Post) ?? null;
  }, null);
}

export async function getMorePosts(limit = 4): Promise<Post[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt,
             date::text, pdf_url
      FROM posts
      ORDER BY date DESC
      OFFSET 1
      LIMIT ${limit}
    `;
    return rows as Post[];
  }, []);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt,
             date::text, pdf_url
      FROM posts
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return (rows[0] as Post) ?? null;
  }, null);
}

export async function getAllPostSlugs(): Promise<string[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT slug FROM posts ORDER BY date DESC`;
    return rows.map((r: { slug: string }) => r.slug);
  }, []);
}

export async function getAllExtras(): Promise<Extra[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt,
             date::text, author_name
      FROM extras
      ORDER BY date DESC
    `;
    return rows as Extra[];
  }, []);
}

export async function getExtraBySlug(slug: string): Promise<Extra | null> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt,
             date::text, author_name
      FROM extras
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return (rows[0] as Extra) ?? null;
  }, null);
}

export async function getAllExtraSlugs(): Promise<string[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT slug FROM extras ORDER BY date DESC`;
    return rows.map((r: { slug: string }) => r.slug);
  }, []);
}

export async function getPuzzles(): Promise<Puzzle[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT p.id, p.title, p.type, p.data, p.date::text, p.author_name,
             p.cover_image_url, p.post_id,
             posts.slug AS post_slug, posts.title AS post_title
      FROM puzzles p
      LEFT JOIN posts ON posts.id = p.post_id
      ORDER BY p.date DESC
    `;
    return rows as Puzzle[];
  }, []);
}

export async function getPage(
  slug: "about" | "faq" | "join"
): Promise<PageContent> {
  const fallback: PageContent = { title: slug, body_html: "", og_image_url: null };
  return run(async (sql) => {
    const rows = await sql`
      SELECT title, body_html, og_image_url
      FROM pages WHERE slug = ${slug} LIMIT 1
    `;
    return (rows[0] as PageContent) ?? fallback;
  }, fallback);
}
