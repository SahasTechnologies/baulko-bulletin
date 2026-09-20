import type { APIRoute } from "astro";
import { savePage } from "@/lib/admin-db";
import { csrfOk, flashTo, jsonResponse, originAllowed, readLimited, requireAdmin } from "@/lib/admin";
import { sanitizeHtmlWithReport } from "@/lib/sanitize-html";

export const prerender = false;

/** The public site only renders these; other slugs would be unreachable rows. */
const EDITABLE_SLUGS = ["about", "faq", "join"];

function isAllowedUrl(value: string): boolean {
  if (!value) return true;
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ ok: false, error: "Not signed in." }, 401);
  if (!originAllowed(request)) {
    return jsonResponse({ ok: false, error: "Cross-origin request rejected." }, 403);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ ok: false, error: "Malformed form submission." }, 400);
  if (!(await csrfOk(session, form))) {
    return flashTo("/admin/pages", "error", "Your session check failed — sign in again and retry.");
  }

  const slug = String(form.get("slug") ?? "");
  if (!EDITABLE_SLUGS.includes(slug)) return flashTo("/admin/pages", "error", "Unknown page.");

  const back = `/admin/pages/${slug}`;
  const title = readLimited(form, "title", 200, "Title");
  const ogImage = readLimited(form, "og_image_url", 2000, "Social preview image URL");
  const body = readLimited(form, "body_html", 200_000, "Body");

  for (const check of [title, ogImage, body]) {
    if (check.error) return flashTo(back, "error", check.error);
  }
  if (!title.value) return flashTo(back, "error", "Title is required.");
  if (!isAllowedUrl(ogImage.value)) {
    return flashTo(back, "error", "Social preview image URL must be a full http(s) URL or a path starting with “/”.");
  }

  // The body is rendered with `set:html` on the public page, so it is filtered
  // here as well as on the way out — see `lib/sanitize-html.ts`.
  const { html, removed } = sanitizeHtmlWithReport(body.value);

  try {
    await savePage(slug, {
      title: title.value,
      body_html: html,
      og_image_url: ogImage.value || null,
    });
    return flashTo(
      back,
      "ok",
      removed.length
        ? `Page saved, with unsafe markup removed (${removed.length} item${removed.length === 1 ? "" : "s"}).`
        : "Page saved."
    );
  } catch (err) {
    console.error("[admin] page save failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return flashTo(back, "error", `Could not save: ${message}`);
  }
};
