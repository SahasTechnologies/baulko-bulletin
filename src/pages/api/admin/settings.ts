import type { APIRoute } from "astro";
import { saveSettings } from "@/lib/admin-db";
import { csrfOk, flashTo, jsonResponse, originAllowed, readLimited, requireAdmin } from "@/lib/admin";

export const prerender = false;

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
    return flashTo("/admin/settings", "error", "Your session check failed — sign in again and retry.");
  }

  const back = "/admin/settings";
  const title = readLimited(form, "title", 200, "Site title");
  const description = readLimited(form, "description", 600, "Site description");
  const ogImage = readLimited(form, "og_image_url", 2000, "Default social preview image URL");
  const footer = readLimited(form, "footer_html", 200_000, "Footer");

  for (const check of [title, description, ogImage, footer]) {
    if (check.error) return flashTo(back, "error", check.error);
  }
  if (!title.value) return flashTo(back, "error", "Site title is required.");
  if (!isAllowedUrl(ogImage.value)) {
    return flashTo(back, "error", "Default social preview image URL must be a full http(s) URL or a path starting with “/”.");
  }

  try {
    // Blank footer_html means "use the built-in footer", which BaseLayout does
    // when the column is null.
    await saveSettings({
      title: title.value,
      description: description.value,
      footer_html: footer.value || null,
      og_image_url: ogImage.value || null,
    });
    return flashTo(back, "ok", "Settings saved.");
  } catch (err) {
    console.error("[admin] settings save failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return flashTo(back, "error", `Could not save: ${message}`);
  }
};
