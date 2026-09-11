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

// Plain row results: no array mode, no full-result envelope. Spelling the two
// generics out keeps `rows[0]` and `rows.map(...)` typed instead of collapsing
// into the query function's union return type.
type Sql = ReturnType<typeof neon<false, false>>;

function client(): Sql | null {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

async function run<T>(
  fn: (sql: Sql) => Promise<T>,
  fallback: T
): Promise<T> {
  const sql = client();
  if (!sql) return fallback;
  try {
    return await fn(sql);
  } catch (err) {
    console.error("[db]", err);
    return fallback;
  }
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapPost(row: Record<string, unknown>): Post {
  return {
    id: asText(row.id),
    title: asText(row.title),
    slug: asText(row.slug),
    excerpt: row.excerpt == null ? null : asText(row.excerpt),
    content: asText(row.content),
    cover_image_url: row.cover_image_url == null ? null : asText(row.cover_image_url),
    cover_image_alt: row.cover_image_alt == null ? null : asText(row.cover_image_alt),
    date: asText(row.date),
    pdf_url: row.pdf_url == null ? null : asText(row.pdf_url),
  };
}

function mapExtra(row: Record<string, unknown>): Extra {
  return {
    id: asText(row.id),
    title: asText(row.title),
    slug: asText(row.slug),
    excerpt: row.excerpt == null ? null : asText(row.excerpt),
    content: asText(row.content),
    cover_image_url: row.cover_image_url == null ? null : asText(row.cover_image_url),
    cover_image_alt: row.cover_image_alt == null ? null : asText(row.cover_image_alt),
    date: asText(row.date),
    author_name: row.author_name == null ? null : asText(row.author_name),
  };
}

function mapPuzzle(
  row: Record<string, unknown>,
  postsById: Map<string, { slug: string; title: string }>
): Puzzle {
  const postId = row.post_id == null ? null : asText(row.post_id);
  const post = postId ? postsById.get(postId) : undefined;
  return {
    id: asText(row.id),
    title: asText(row.title),
    type: asText(row.type),
    data: asText(row.data),
    date: asText(row.date),
    author_name: row.author_name == null ? null : asText(row.author_name),
    cover_image_url: row.cover_image_url == null ? null : asText(row.cover_image_url),
    post_id: postId,
    post_slug: post?.slug ?? null,
    post_title: post?.title ?? null,
  };
}

export async function getSettings(): Promise<Settings> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM settings LIMIT 1`;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return FALLBACK_SETTINGS;
    return {
      title: asText(row.title) || FALLBACK_SETTINGS.title,
      description: asText(row.description) || FALLBACK_SETTINGS.description,
      footer_html: row.footer_html == null ? null : asText(row.footer_html),
      og_image_url: row.og_image_url == null ? null : asText(row.og_image_url),
    };
  }, FALLBACK_SETTINGS);
}

export async function getLatestPost(): Promise<Post | null> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM posts ORDER BY date DESC LIMIT 1`;
    return rows[0] ? mapPost(rows[0] as Record<string, unknown>) : null;
  }, null);
}

export async function getMorePosts(limit = 100): Promise<Post[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM posts ORDER BY date DESC OFFSET 1 LIMIT ${limit}`;
    return rows.map((row) => mapPost(row as Record<string, unknown>));
  }, []);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM posts WHERE slug = ${slug} LIMIT 1`;
    return rows[0] ? mapPost(rows[0] as Record<string, unknown>) : null;
  }, null);
}

export async function getAllPostSlugs(): Promise<string[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT slug FROM posts ORDER BY date DESC`;
    return rows.map((r) => asText((r as { slug: string }).slug));
  }, []);
}

export async function getAllExtras(): Promise<Extra[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM extras ORDER BY date DESC`;
    return rows.map((row) => mapExtra(row as Record<string, unknown>));
  }, []);
}

export async function getExtraBySlug(slug: string): Promise<Extra | null> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM extras WHERE slug = ${slug} LIMIT 1`;
    return rows[0] ? mapExtra(rows[0] as Record<string, unknown>) : null;
  }, null);
}

export async function getAllExtraSlugs(): Promise<string[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT slug FROM extras ORDER BY date DESC`;
    return rows.map((r) => asText((r as { slug: string }).slug));
  }, []);
}

export async function getPuzzles(): Promise<Puzzle[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM puzzles ORDER BY date DESC`;
    const posts = await sql`SELECT id, slug, title FROM posts`;
    const postsById = new Map<string, { slug: string; title: string }>();
    for (const p of posts as { id: string; slug: string; title: string }[]) {
      postsById.set(asText(p.id), { slug: asText(p.slug), title: asText(p.title) });
    }
    return rows.map((row) => mapPuzzle(row as Record<string, unknown>, postsById));
  }, []);
}

export async function getPage(
  slug: "about" | "faq" | "join"
): Promise<PageContent> {
  const fallback: PageContent = { title: slug, body_html: "", og_image_url: null };
  return run(async (sql) => {
    const rows = await sql`SELECT * FROM pages WHERE slug = ${slug} LIMIT 1`;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return fallback;
    return {
      title: asText(row.title) || slug,
      body_html: asText(row.body_html),
      og_image_url: row.og_image_url == null ? null : asText(row.og_image_url),
    };
  }, fallback);
}
