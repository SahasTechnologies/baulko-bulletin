import { neon } from "@neondatabase/serverless";
import type {
  ContactRecipient,
  Extra,
  ExtraCard,
  PageContent,
  Post,
  PostCard,
  Puzzle,
  PuzzleSummary,
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

function mapPostCard(row: Record<string, unknown>): PostCard {
  return {
    id: asText(row.id),
    title: asText(row.title),
    slug: asText(row.slug),
    excerpt: row.excerpt == null ? null : asText(row.excerpt),
    cover_image_url: row.cover_image_url == null ? null : asText(row.cover_image_url),
    cover_image_alt: row.cover_image_alt == null ? null : asText(row.cover_image_alt),
    date: asText(row.date),
  };
}

function mapExtraCard(row: Record<string, unknown>): ExtraCard {
  return {
    ...mapPostCard(row),
    author_name: row.author_name == null ? null : asText(row.author_name),
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

/** The columns a listing draws, plus the issue it belongs to. */
function mapPuzzleSummary(
  row: Record<string, unknown>,
  postsById: Map<string, { slug: string; title: string }>
): PuzzleSummary {
  const postId = row.post_id == null ? null : asText(row.post_id);
  const post = postId ? postsById.get(postId) : undefined;
  return {
    id: asText(row.id),
    slug: asText(row.slug),
    title: asText(row.title),
    type: asText(row.type),
    date: asText(row.date),
    author_name: row.author_name == null ? null : asText(row.author_name),
    cover_image_url: row.cover_image_url == null ? null : asText(row.cover_image_url),
    post_id: postId,
    post_slug: post?.slug ?? null,
    post_title: post?.title ?? null,
  };
}

/** A summary plus the grid the reader renders. */
function mapPuzzle(
  row: Record<string, unknown>,
  postsById: Map<string, { slug: string; title: string }>
): Puzzle {
  return { ...mapPuzzleSummary(row, postsById), data: asText(row.data) };
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

// Card-only column lists. `SELECT *` here also pulled `content` and `pdf_url`,
// which the cards never read — but the homepage hands these rows to a
// `client:load` island, and every prop it receives is serialised into the page.
const POST_CARD_COLUMNS = `id, title, slug, excerpt, cover_image_url, cover_image_alt, date`;

export async function getMorePosts(limit = 100): Promise<PostCard[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT ${sql.unsafe(POST_CARD_COLUMNS)}
      FROM posts
      ORDER BY date DESC
      OFFSET 1
      LIMIT ${limit}
    `;
    return rows.map((row) => mapPostCard(row as Record<string, unknown>));
  }, []);
}

// Every issue including the hero, newest first — what the /posts listing shows.
export async function getAllPostCards(): Promise<PostCard[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT ${sql.unsafe(POST_CARD_COLUMNS)}
      FROM posts
      ORDER BY date DESC
    `;
    return rows.map((row) => mapPostCard(row as Record<string, unknown>));
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

// Extras and puzzles store an author_id, so the byline name has to come from the
// authors table — `SELECT *` alone leaves `author_name` empty and every story
// reads "Anonymous".
export async function getAllExtras(limit?: number): Promise<ExtraCard[]> {
  return run(async (sql) => {
    const rows = limit
      ? await sql`
          SELECT extras.id, extras.title, extras.slug, extras.excerpt,
                 extras.cover_image_url, extras.cover_image_alt, extras.date,
                 authors.name AS author_name
          FROM extras
          LEFT JOIN authors ON authors.id = extras.author_id
          ORDER BY extras.date DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT extras.id, extras.title, extras.slug, extras.excerpt,
                 extras.cover_image_url, extras.cover_image_alt, extras.date,
                 authors.name AS author_name
          FROM extras
          LEFT JOIN authors ON authors.id = extras.author_id
          ORDER BY extras.date DESC
        `;
    return rows.map((row) => mapExtraCard(row as Record<string, unknown>));
  }, []);
}

export async function getExtraBySlug(slug: string): Promise<Extra | null> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT extras.*, authors.name AS author_name
      FROM extras
      LEFT JOIN authors ON authors.id = extras.author_id
      WHERE extras.slug = ${slug}
      LIMIT 1
    `;
    return rows[0] ? mapExtra(rows[0] as Record<string, unknown>) : null;
  }, null);
}

export async function getAllExtraSlugs(): Promise<string[]> {
  return run(async (sql) => {
    const rows = await sql`SELECT slug FROM extras ORDER BY date DESC`;
    return rows.map((r) => asText((r as { slug: string }).slug));
  }, []);
}

async function postsById(sql: Sql) {
  const posts = await sql`SELECT id, slug, title FROM posts`;
  const map = new Map<string, { slug: string; title: string }>();
  for (const p of posts as { id: string; slug: string; title: string }[]) {
    map.set(asText(p.id), { slug: asText(p.slug), title: asText(p.title) });
  }
  return map;
}

/**
 * What a puzzle listing draws, and where the picture comes from.
 *
 * Every puzzle of an issue was printed with the same artwork — the issue's own
 * — so a puzzle with no cover of its own falls back to the issue it belongs to.
 * One file per issue is fetched and cached instead of one per puzzle, the tile
 * is never empty, and setting a cover on a single puzzle still overrides it.
 * (The two stand-alone test puzzles belong to no issue and keep the plain tile.)
 *
 * Shared by both puzzle queries so the listing and the reader cannot drift
 * apart over which picture they show.
 */
const PUZZLE_COLUMNS = `puzzles.id, puzzles.slug, puzzles.title, puzzles.type, puzzles.date,
             puzzles.post_id,
             COALESCE(puzzles.cover_image_url, issues.cover_image_url) AS cover_image_url,
             authors.name AS author_name`;

const PUZZLE_JOINS = `LEFT JOIN authors ON authors.id = puzzles.author_id
      LEFT JOIN posts AS issues ON issues.id = puzzles.post_id`;

/**
 * The puzzles, newest first, without their solution grids. `data` is the whole
 * puzzle — a few kilobytes each — and only the reader on the puzzle's own page
 * needs it; a listing draws the title, type, date, author and cover.
 */
export async function getPuzzles(): Promise<PuzzleSummary[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT ${sql.unsafe(PUZZLE_COLUMNS)}
      FROM puzzles
      ${sql.unsafe(PUZZLE_JOINS)}
      ORDER BY puzzles.date DESC
    `;
    const byId = await postsById(sql);
    return rows.map((row) => mapPuzzleSummary(row as Record<string, unknown>, byId));
  }, []);
}

/**
 * The puzzle at `index` in the newest-first list above.
 *
 * Nothing links here any more — a puzzle is addressed by its slug — but the
 * numbers this replaced were live URLs for months, so the route still reads
 * them and redirects to the puzzle they name.
 */
export async function getPuzzleByIndex(index: number): Promise<Puzzle | null> {
  if (!Number.isInteger(index) || index < 0) return null;
  return run(async (sql) => {
    const rows = await sql`
      SELECT ${sql.unsafe(PUZZLE_COLUMNS)}, puzzles.data
      FROM puzzles
      ${sql.unsafe(PUZZLE_JOINS)}
      ORDER BY puzzles.date DESC
      OFFSET ${index} LIMIT 1
    `;
    if (!rows[0]) return null;
    const byId = await postsById(sql);
    return mapPuzzle(rows[0] as Record<string, unknown>, byId);
  }, null);
}

/** A puzzle plus its position in the newest-first list, which the tile prints. */
export interface IndexedPuzzle {
  puzzle: PuzzleSummary;
  index: number;
}

/**
 * One puzzle by its slug, the address the puzzles page links with and the one
 * anyone sharing a puzzle will paste. It carries `data`, since this is the one
 * caller that renders the puzzle itself.
 */
export async function getPuzzleBySlug(slug: string): Promise<Puzzle | null> {
  if (!slug) return null;
  return run(async (sql) => {
    const rows = await sql`
      SELECT ${sql.unsafe(PUZZLE_COLUMNS)}, puzzles.data
      FROM puzzles
      ${sql.unsafe(PUZZLE_JOINS)}
      WHERE puzzles.slug = ${slug}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    const byId = await postsById(sql);
    return mapPuzzle(rows[0] as Record<string, unknown>, byId);
  }, null);
}

/**
 * The puzzles that belong to one issue, for the list at the foot of its page.
 *
 * The position is only printed on the tile now that the slug is the address —
 * but it is still derived from the newest-first order, the same order the
 * puzzles page renders.
 */
export async function getPuzzlesForPost(postId: string): Promise<IndexedPuzzle[]> {
  const all = await getPuzzles();
  return all
    .map((puzzle, index) => ({ puzzle, index }))
    .filter((entry) => entry.puzzle.post_id === postId);
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getContactRecipients(): Promise<ContactRecipient[]> {
  return run(async (sql) => {
    const rows = await sql`
      SELECT id, email, name
      FROM contact_recipients
      WHERE active
      ORDER BY created_at
    `;
    const recipients: ContactRecipient[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      // Addresses get pasted in, so trim stray whitespace (tabs included — a
      // trailing tab survives btrim() and makes Resend reject the address).
      const email = asText(r.email).trim();
      if (!EMAIL_RE.test(email)) {
        console.warn(`[db] skipping invalid contact recipient: ${JSON.stringify(email)}`);
        continue;
      }
      recipients.push({
        id: asText(r.id),
        email,
        name: r.name == null ? null : asText(r.name).trim() || null,
      });
    }
    return recipients;
  }, []);
}
