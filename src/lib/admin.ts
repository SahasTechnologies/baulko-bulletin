/**
 * Request- and form-level helpers shared by the admin pages and admin API
 * routes: session lookup, CSRF and Origin checks, flash redirects, and the
 * declarative form validation driven by `admin-entities.ts`.
 *
 * Validation lives here rather than in each route so every write path enforces
 * the same limits — the admin panel is the only writer, and a typo in a URL or
 * a blank title should fail loudly instead of landing in the database.
 */

import type { AdminSession } from "@/lib/auth";
import { requestSession, verifyCsrf } from "@/lib/auth";
import type { EntityDef, FieldDef, FieldName } from "@/lib/admin-entities";
import { formatPuzzleProblems, parsePuzzleData } from "@/lib/puzzle-data";

/** Defence in depth: middleware also gates these routes. */
export async function requireAdmin(request: Request): Promise<AdminSession | null> {
  return requestSession(request);
}

/**
 * Rejects a cross-site write. Browsers always send Origin on POST, so a
 * mismatch (or a missing Origin with a mismatched Referer) is a forged request.
 * Authorization headers and cookies are not needed for this, which is why it
 * still protects the login route, where no session exists yet.
 */
export function originAllowed(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

/** Authenticated writes additionally require the per-session CSRF token. */
export async function csrfOk(session: AdminSession, form: FormData): Promise<boolean> {
  const token = form.get("csrf");
  return verifyCsrf(session, typeof token === "string" ? token : null);
}

export function redirectTo(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export type FlashKind = "ok" | "error";

/**
 * Redirects back to a page carrying a one-shot message, e.g.
 * `/admin/posts?ok=Issue+saved`. The admin layout renders and then hides it.
 */
export function flashTo(path: string, kind: FlashKind, message: string): Response {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing);
  params.set(kind, message);
  return redirectTo(`${base}?${params.toString()}`);
}

export function flashFromUrl(url: URL): { kind: FlashKind; message: string } | null {
  const error = url.searchParams.get("error");
  if (error) return { kind: "error", message: error };
  const ok = url.searchParams.get("ok");
  if (ok) return { kind: "ok", message: ok };
  return null;
}

/** URL-safe slug matching the existing rows (`n+32: Medieval History` → `n-32`). */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

const MAX_LENGTHS: Record<string, number> = {
  title: 200,
  slug: 80,
  excerpt: 600,
  content: 200_000,
  cover_image_url: 2000,
  cover_image_alt: 400,
  pdf_url: 2000,
  data: 100_000,
  author_name: 120,
  type: 40,
  post_id: 64,
};

/** Shared by the validator and the form's maxlength, so both agree. */
export function maxLengthFor(name: FieldName): number {
  return MAX_LENGTHS[name] ?? 1000;
}

function isAllowedUrl(value: string): boolean {
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Dates are edited as calendar days and read back as Sydney days, which is the
 * timezone DateComponent renders in. Storing UTC midnight keeps the day the
 * editor picked identical to the day readers see.
 */
export function dateInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const sydneyDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Australia/Sydney",
});

/** ISO timestamp → `YYYY-MM-DD` as seen in Sydney, for prefilling date inputs. */
export function isoToDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return sydneyDateFormatter.format(parsed);
}

/** Same shape `admin-db` accepts, repeated here so validation has no database import. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidatedValues {
  values: Record<string, string>;
  error: string | null;
}

function readField(form: FormData, field: FieldDef): string {
  const raw = form.get(field.name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Validates a submitted form against an entity's field definitions. Returns the
 * cleaned values on success, or a single human-readable error on the first
 * problem found (the form is only ever filled in by one operator, so a
 * field-by-field error map would be noise).
 */
export function validateEntityForm(def: EntityDef, form: FormData): ValidatedValues {
  const values: Record<string, string> = {};

  for (const field of def.fields) {
    const value = readField(form, field);
    values[field.name] = value;

    if (field.required && !value) {
      return { values, error: `${field.label} is required.` };
    }
    if (!value) continue;

    // Rejected rather than silently truncated: an editor who pastes a novel into
    // Excerpt should be told, not have it quietly cut in half.
    const max = field.maxLength ?? maxLengthFor(field.name);
    if (value.length > max) {
      return { values, error: `${field.label} is too long (maximum ${max} characters).` };
    }

    // Uploaded media lands here as a URL, so it is validated exactly like one.
    if ((field.type === "url" || field.type === "image" || field.type === "pdf") && !isAllowedUrl(value)) {
      return { values, error: `${field.label} must be a full http(s) URL or a path starting with "/".` };
    }
    if (field.type === "date" && !dateInputToIso(value)) {
      return { values, error: `${field.label} must be a valid date.` };
    }
    if (field.type === "issue" && !UUID_RE.test(value)) {
      return { values, error: `${field.label} must be one of the listed issues.` };
    }
    // Only options declared up front can be checked; `issue` options come from the database.
    if (field.type === "select" && field.options && !field.options.includes(value)) {
      return { values, error: `${field.label} must be one of: ${field.options.join(", ")}.` };
    }
    if (field.name === "slug" && !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
      return {
        values,
        error: "Slug may only contain lowercase letters, numbers and hyphens.",
      };
    }
    // Puzzle data is what the public readers parse, so it is held to their
    // standard at the only place a write can happen. The parser is the exact
    // one the readers run, meaning anything that passes here renders — the
    // admin editor applies the same check live, so this normally fires only
    // for a request that skipped the browser's own checks.
    //
    // The type is read off the form rather than out of `values`, which happens
    // to hold it only because the type field is declared before this one. A
    // puzzle is validated against the reader its type names, and that pairing
    // should not depend on the order of a list in another file.
    if (def.key === "puzzles" && field.name === "data") {
      const type = String(form.get("type") ?? "").trim();
      const parsed = parsePuzzleData(type, value);
      if (!parsed.ok) {
        const detail = formatPuzzleProblems(parsed.problems);
        return {
          values,
          error: `Puzzle data does not fit the ${type || "chosen"} format — ${detail}`,
        };
      }
    }
  }

  return { values, error: null };
}

/**
 * Escapes text for use inside a `<textarea>`. Editors type HTML on purpose, so
 * escaping is about keeping the value *verbatim* (a literal `</textarea>` in a
 * field must not close the tag), not about sanitising what they write.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

/**
 * Constrains a `next` parameter to an internal admin path. Without this, a
 * crafted `?next=https://evil.example` would turn the login form into an open
 * redirect.
 */
export function safeAdminPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/admin") || value.startsWith("//")) return "/admin";
  return value;
}

/**
 * Reads a free-form field (meta fields that aren't part of an entity's declared
 * schema) and reports an over-length value instead of silently truncating it.
 */
export function readLimited(
  form: FormData,
  name: string,
  max: number,
  label = name
): { value: string; error: string | null } {
  const raw = form.get(name);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length > max) {
    return { value, error: `${label} is too long (maximum ${max} characters).` };
  }
  return { value, error: null };
}

/** Falls back to a slug derived from the title when the field is left blank. */
export function resolvedSlug(values: Record<string, string>): string {
  return values.slug || slugify(values.title ?? "");
}
