/**
 * All database access used by the admin panel.
 *
 * Deliberately separate from `lib/db.ts`: the public read helpers swallow
 * errors and fall back to empty content (a dead database should not 500 the
 * public site), while an admin write must fail loudly — silently pretending a
 * save worked is the worst possible outcome here.
 */

import { neon } from "@neondatabase/serverless";
import { readEnv } from "@/lib/env";
import type { ContentRow, EntityKey } from "@/lib/admin-entities";
import type { AdminSession } from "@/lib/auth";

type Sql = ReturnType<typeof neon<false, false>>;

const NO_UUID = "00000000-0000-0000-0000-000000000000";

function sqlClient(): Sql {
  const url = readEnv("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function rowFrom(record: Record<string, unknown>): ContentRow {
  const row: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(record)) row[key] = asText(value);
  return { ...row, id: String(record.id) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* ------------------------------------------------------------------ content */

/**
 * Which entities are addressed by a slug. All three are: a puzzle used to be
 * addressed by its position in a list, which every new puzzle renumbered.
 */
const HAS_SLUG: Record<EntityKey, boolean> = { posts: true, extras: true, puzzles: true };

export async function listRows(key: EntityKey): Promise<ContentRow[]> {
  const sql = sqlClient();
  if (key === "posts") {
    const rows = await sql`
      SELECT id, title, slug, date, excerpt, cover_image_url
      FROM posts
      ORDER BY date DESC
    `;
    return rows.map((row) => rowFrom(row as Record<string, unknown>));
  }
  if (key === "extras") {
    const rows = await sql`
      SELECT extras.id, extras.title, extras.slug, extras.date, extras.excerpt,
             extras.cover_image_url, authors.name AS author_name
      FROM extras
      LEFT JOIN authors ON authors.id = extras.author_id
      ORDER BY extras.date DESC
    `;
    return rows.map((row) => rowFrom(row as Record<string, unknown>));
  }
  const rows = await sql`
    SELECT puzzles.id, puzzles.slug, puzzles.title, puzzles.type, puzzles.date,
           puzzles.cover_image_url, puzzles.post_id, authors.name AS author_name
    FROM puzzles
    LEFT JOIN authors ON authors.id = puzzles.author_id
    ORDER BY puzzles.date DESC
  `;
  return rows.map((row) => rowFrom(row as Record<string, unknown>));
}

/** Options for the puzzle "issue" picker, newest issue first. */
export async function listIssueOptions(): Promise<{ id: string; title: string }[]> {
  const sql = sqlClient();
  const rows = await sql`SELECT id, title FROM posts ORDER BY date DESC`;
  return rows.map((row) => ({
    id: String((row as { id: unknown }).id),
    title: asText((row as { title: unknown }).title) ?? "",
  }));
}

export async function getRow(key: EntityKey, id: string): Promise<ContentRow | null> {
  if (!isUuid(id)) return null;
  const sql = sqlClient();
  if (key === "posts") {
    const rows = await sql`
      SELECT id, title, slug, excerpt, content, cover_image_url, cover_image_alt, date, pdf_url
      FROM posts WHERE id = ${id}::uuid LIMIT 1
    `;
    return rows[0] ? rowFrom(rows[0] as Record<string, unknown>) : null;
  }
  if (key === "extras") {
    const rows = await sql`
      SELECT extras.id, extras.title, extras.slug, extras.excerpt, extras.content,
             extras.cover_image_url, extras.cover_image_alt, extras.date,
             authors.name AS author_name
      FROM extras
      LEFT JOIN authors ON authors.id = extras.author_id
      WHERE extras.id = ${id}::uuid LIMIT 1
    `;
    return rows[0] ? rowFrom(rows[0] as Record<string, unknown>) : null;
  }
  const rows = await sql`
    SELECT puzzles.id, puzzles.slug, puzzles.title, puzzles.type, puzzles.data, puzzles.date,
           puzzles.cover_image_url, puzzles.post_id, authors.name AS author_name
    FROM puzzles
    LEFT JOIN authors ON authors.id = puzzles.author_id
    WHERE puzzles.id = ${id}::uuid LIMIT 1
  `;
  return rows[0] ? rowFrom(rows[0] as Record<string, unknown>) : null;
}

/**
 * Finds an author by name, creating one if needed. Names are matched
 * case-insensitively and reused, so the authors table stays a directory rather
 * than a new row per save.
 */
export async function resolveAuthorId(name: string | null): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const sql = sqlClient();
  const existing = await sql`
    SELECT id FROM authors WHERE lower(name) = lower(${trimmed}) ORDER BY created_at LIMIT 1
  `;
  const found = existing[0] ? String((existing[0] as { id: unknown }).id) : null;
  if (found) return found;
  const created = await sql`INSERT INTO authors (name) VALUES (${trimmed}) RETURNING id`;
  return created[0] ? String((created[0] as { id: unknown }).id) : null;
}

export async function listAuthorNames(): Promise<string[]> {
  const sql = sqlClient();
  const rows = await sql`SELECT DISTINCT name FROM authors ORDER BY name`;
  return rows.map((row) => String((row as { name: unknown }).name));
}

/** Appends -2, -3 … until the slug is free, ignoring the row being edited. */
export async function uniqueSlug(key: EntityKey, base: string, excludeId: string | null): Promise<string> {
  const sql = sqlClient();
  const exclude = isUuid(excludeId) ? excludeId : NO_UUID;
  for (let suffix = 1; suffix <= 50; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const rows =
      key === "posts"
        ? await sql`SELECT 1 FROM posts WHERE slug = ${candidate} AND id <> ${exclude}::uuid LIMIT 1`
        : key === "extras"
          ? await sql`SELECT 1 FROM extras WHERE slug = ${candidate} AND id <> ${exclude}::uuid LIMIT 1`
          : await sql`SELECT 1 FROM puzzles WHERE slug = ${candidate} AND id <> ${exclude}::uuid LIMIT 1`;
    if (!rows[0]) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface SaveResult {
  id: string;
  slug: string | null;
}

/**
 * Creates (id === null) or updates one content row. Only the columns declared
 * for that entity are written, so fields the admin doesn't edit — such as
 * `author_id` on posts — are never clobbered.
 *
 * `values.date` arrives as a Sydney wall clock reading (`YYYY-MM-DD HH:MM`,
 * assembled in `lib/admin.ts`), and the cast below is what turns it into a
 * moment. The timezone is named in the SQL rather than computed in JavaScript
 * because Sydney is +10 for half the year and +11 for the other half, and only
 * Postgres resolves which one applies to a given day — a fixed offset here
 * would put every summer publication an hour out.
 *
 * This column is also the publication switch: the public reads in `lib/db.ts`
 * only return a row whose date has arrived, so a moment in the future is a row
 * that exists in the panel and nowhere else.
 */
export async function saveRow(
  key: EntityKey,
  id: string | null,
  values: Record<string, string>
): Promise<SaveResult> {
  const sql = sqlClient();
  const date = values.date;
  const title = values.title;
  const excerpt = values.excerpt || null;
  const content = values.content ?? "";
  const coverUrl = values.cover_image_url || null;
  const coverAlt = values.cover_image_alt || null;

  if (key === "posts") {
    const slug = await uniqueSlug("posts", values.slug, id);
    const pdfUrl = values.pdf_url || null;
    if (id) {
      await sql`
        UPDATE posts SET
          title = ${title}, slug = ${slug}, excerpt = ${excerpt}, content = ${content},
          cover_image_url = ${coverUrl}, cover_image_alt = ${coverAlt},
          date = ${date}::timestamp AT TIME ZONE 'Australia/Sydney', pdf_url = ${pdfUrl}
        WHERE id = ${id}::uuid
      `;
      return { id, slug };
    }
    // New issues are attributed to the team account the existing issues use.
    const authorId = await resolveAuthorId("Team Bulletin");
    const created = await sql`
      INSERT INTO posts (title, slug, excerpt, content, cover_image_url, cover_image_alt, date, pdf_url, author_id)
      VALUES (${title}, ${slug}, ${excerpt}, ${content}, ${coverUrl}, ${coverAlt},
              ${date}::timestamp AT TIME ZONE 'Australia/Sydney', ${pdfUrl}, ${authorId}::uuid)
      RETURNING id
    `;
    return { id: String((created[0] as { id: unknown }).id), slug };
  }

  if (key === "extras") {
    const slug = await uniqueSlug("extras", values.slug, id);
    const authorId = await resolveAuthorId(values.author_name ?? "");
    if (id) {
      await sql`
        UPDATE extras SET
          title = ${title}, slug = ${slug}, excerpt = ${excerpt}, content = ${content},
          cover_image_url = ${coverUrl}, cover_image_alt = ${coverAlt},
          date = ${date}::timestamp AT TIME ZONE 'Australia/Sydney', author_id = ${authorId}::uuid
        WHERE id = ${id}::uuid
      `;
      return { id, slug };
    }
    const created = await sql`
      INSERT INTO extras (title, slug, excerpt, content, cover_image_url, cover_image_alt, date, author_id)
      VALUES (${title}, ${slug}, ${excerpt}, ${content}, ${coverUrl}, ${coverAlt},
              ${date}::timestamp AT TIME ZONE 'Australia/Sydney', ${authorId}::uuid)
      RETURNING id
    `;
    return { id: String((created[0] as { id: unknown }).id), slug };
  }

  const type = values.type;
  const data = values.data ?? "";
  const slug = await uniqueSlug("puzzles", values.slug, id);
  const authorId = await resolveAuthorId(values.author_name ?? "");
  // A blank picker clears the link; Postgres is happy to take null through the cast.
  const postId = isUuid(values.post_id) ? values.post_id : null;
  if (id) {
    await sql`
      UPDATE puzzles SET
        title = ${title}, slug = ${slug}, type = ${type}, data = ${data},
        cover_image_url = ${coverUrl}, date = ${date}::timestamp AT TIME ZONE 'Australia/Sydney',
        author_id = ${authorId}::uuid, post_id = ${postId}::uuid
      WHERE id = ${id}::uuid
    `;
    return { id, slug };
  }
  const created = await sql`
    INSERT INTO puzzles (title, slug, type, data, cover_image_url, date, author_id, post_id)
    VALUES (${title}, ${slug}, ${type}, ${data}, ${coverUrl}, ${date}::timestamp AT TIME ZONE 'Australia/Sydney',
            ${authorId}::uuid, ${postId}::uuid)
    RETURNING id
  `;
  return { id: String((created[0] as { id: unknown }).id), slug };
}

export async function deleteRow(key: EntityKey, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const sql = sqlClient();
  const rows =
    key === "posts"
      ? await sql`DELETE FROM posts WHERE id = ${id}::uuid RETURNING id`
      : key === "extras"
        ? await sql`DELETE FROM extras WHERE id = ${id}::uuid RETURNING id`
        : await sql`DELETE FROM puzzles WHERE id = ${id}::uuid RETURNING id`;
  return Boolean(rows[0]);
}

export function entityUsesSlug(key: EntityKey): boolean {
  return HAS_SLUG[key];
}

/**
 * How many rows still point at a media file, anywhere on the site.
 *
 * Takes the file's *path* rather than its full URL, because the same file is
 * referred to with and without an ImageKit transform query (`?tr=w-1000`) and
 * the path is the part every form of the URL has in common.
 *
 * Body copy counts as much as a cover. A picture uploaded into an article is
 * embedded as a `<figure>` with the URL inside it, so a file that no cover
 * column mentions can still be the only copy of an illustration in a story —
 * and `settings.footer_html` and `pages.body_html` are edited the same way.
 *
 * The path is escaped before it reaches the LIKE. `_` and `%` are wildcards to
 * SQL, and although the panel slugifies the filenames it uploads, an editor can
 * paste any URL they like into a media field.
 */
export async function countMediaReferences(path: string): Promise<number> {
  const sql = sqlClient();
  const pattern = `%${path.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql`
    SELECT (
      (SELECT count(*) FROM posts
        WHERE cover_image_url LIKE ${pattern}
           OR pdf_url LIKE ${pattern}
           OR content LIKE ${pattern}) +
      (SELECT count(*) FROM extras
        WHERE cover_image_url LIKE ${pattern}
           OR content LIKE ${pattern}) +
      (SELECT count(*) FROM puzzles
        WHERE cover_image_url LIKE ${pattern}) +
      (SELECT count(*) FROM pages
        WHERE og_image_url LIKE ${pattern}
           OR body_html LIKE ${pattern}) +
      (SELECT count(*) FROM settings
        WHERE og_image_url LIKE ${pattern}
           OR footer_html LIKE ${pattern})
    )::int AS n
  `;
  return Number((rows[0] as { n?: unknown })?.n ?? 0);
}

/* ------------------------------------------------------- dashboard + meta */

export interface AdminCounts {
  posts: number;
  extras: number;
  puzzles: number;
  unread: number;
}

export async function getCounts(): Promise<AdminCounts> {
  const sql = sqlClient();
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM extras) AS extras,
      (SELECT count(*)::int FROM puzzles) AS puzzles,
      (SELECT count(*)::int FROM contact_submissions WHERE NOT read) AS unread
  `;
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    posts: Number(row.posts ?? 0),
    extras: Number(row.extras ?? 0),
    puzzles: Number(row.puzzles ?? 0),
    unread: Number(row.unread ?? 0),
  };
}

export async function listAuthorCount(): Promise<number> {
  const sql = sqlClient();
  const rows = await sql`SELECT count(*)::int AS n FROM authors`;
  return Number((rows[0] as { n?: unknown })?.n ?? 0);
}

/* ------------------------------------------------------------------- pages */

export interface PageRow {
  slug: string;
  title: string;
  body_html: string;
  og_image_url: string | null;
}

export async function listPages(): Promise<PageRow[]> {
  const sql = sqlClient();
  const rows = await sql`SELECT slug, title, body_html, og_image_url FROM pages ORDER BY slug`;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      slug: String(record.slug),
      title: asText(record.title) ?? "",
      body_html: asText(record.body_html) ?? "",
      og_image_url: asText(record.og_image_url),
    };
  });
}

export async function getPageRow(slug: string): Promise<PageRow | null> {
  const sql = sqlClient();
  const rows = await sql`SELECT slug, title, body_html, og_image_url FROM pages WHERE slug = ${slug} LIMIT 1`;
  const record = rows[0] as Record<string, unknown> | undefined;
  if (!record) return null;
  return {
    slug: String(record.slug),
    title: asText(record.title) ?? "",
    body_html: asText(record.body_html) ?? "",
    og_image_url: asText(record.og_image_url),
  };
}

export async function savePage(
  slug: string,
  values: { title: string; body_html: string; og_image_url: string | null }
): Promise<void> {
  const sql = sqlClient();
  await sql`
    INSERT INTO pages (slug, title, body_html, og_image_url)
    VALUES (${slug}, ${values.title}, ${values.body_html}, ${values.og_image_url})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      body_html = EXCLUDED.body_html,
      og_image_url = EXCLUDED.og_image_url
  `;
}

/* ---------------------------------------------------------------- settings */

export interface SettingsRow {
  title: string;
  description: string;
  footer_html: string | null;
  og_image_url: string | null;
}

export async function getSettingsRow(): Promise<SettingsRow> {
  const sql = sqlClient();
  const rows = await sql`SELECT * FROM settings LIMIT 1`;
  const record = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    title: asText(record.title) ?? "Baulko Bulletin",
    description: asText(record.description) ?? "",
    footer_html: asText(record.footer_html),
    og_image_url: asText(record.og_image_url),
  };
}

export async function saveSettings(values: SettingsRow): Promise<void> {
  const sql = sqlClient();
  await sql`
    INSERT INTO settings (id, title, description, footer_html, og_image_url)
    VALUES (1, ${values.title}, ${values.description}, ${values.footer_html}, ${values.og_image_url})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      footer_html = EXCLUDED.footer_html,
      og_image_url = EXCLUDED.og_image_url
  `;
}

/* ---------------------------------------------------------------- messages */

export interface SubmissionRow {
  id: string;
  name: string;
  email: string;
  message: string;
  /** Where the sender was, resolved as the message arrived; null if unplaced. */
  location: string | null;
  read: boolean;
  created_at: string | null;
}

export async function listSubmissions(limit = 200): Promise<SubmissionRow[]> {
  const sql = sqlClient();
  const rows = await sql`
    SELECT id, name, email, message, location, read, created_at
    FROM contact_submissions
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      name: asText(record.name) ?? "",
      email: asText(record.email) ?? "",
      message: asText(record.message) ?? "",
      location: asText(record.location),
      read: Boolean(record.read),
      created_at: asText(record.created_at),
    };
  });
}

export async function setSubmissionRead(id: string, read: boolean): Promise<void> {
  if (!isUuid(id)) return;
  const sql = sqlClient();
  await sql`UPDATE contact_submissions SET read = ${read} WHERE id = ${id}::uuid`;
}

export async function deleteSubmission(id: string): Promise<void> {
  if (!isUuid(id)) return;
  const sql = sqlClient();
  await sql`DELETE FROM contact_submissions WHERE id = ${id}::uuid`;
}

/* ------------------------------------------------------- contact recipients */

/**
 * Unlike `db.getContactRecipients`, which returns only the addresses the form
 * actually sends to, this lists every row so paused ones can be managed.
 */
export interface RecipientRow {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
}

export async function listRecipients(): Promise<RecipientRow[]> {
  const sql = sqlClient();
  const rows = await sql`SELECT id, email, name, active FROM contact_recipients ORDER BY created_at`;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      email: asText(record.email) ?? "",
      name: asText(record.name),
      active: Boolean(record.active),
    };
  });
}

export async function addRecipient(email: string, name: string | null): Promise<void> {
  const sql = sqlClient();
  await sql`INSERT INTO contact_recipients (email, name, active) VALUES (${email}, ${name}, true)`;
}

export async function updateRecipient(id: string, email: string, name: string | null, active: boolean): Promise<void> {
  if (!isUuid(id)) return;
  const sql = sqlClient();
  await sql`
    UPDATE contact_recipients SET email = ${email}, name = ${name}, active = ${active}
    WHERE id = ${id}::uuid
  `;
}

export async function deleteRecipient(id: string): Promise<void> {
  if (!isUuid(id)) return;
  const sql = sqlClient();
  await sql`DELETE FROM contact_recipients WHERE id = ${id}::uuid`;
}

/** Sessions carry no database state; kept here so admin routes import one module. */
export type { AdminSession };
