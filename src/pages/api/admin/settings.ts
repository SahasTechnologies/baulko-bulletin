import type { APIRoute } from "astro";
import { getSettingsRow, saveSettings } from "@/lib/admin-db";
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

  for (const check of [title, description, ogImage]) {
    if (check.error) return flashTo(back, "error", check.error);
  }
  if (!title.value) return flashTo(back, "error", "Site title is required.");
  if (!isAllowedUrl(ogImage.value)) {
    return flashTo(back, "error", "Default social preview image URL must be a full http(s) URL or a path starting with “/”.");
  }

  try {
    // The footer is read back out of the database and written straight back, so
    // the panel can no longer set one but an existing one survives a save of
    // the fields beside it. `saveSettings` writes the whole row, so passing
    // null here would silently clear a footer someone had already written.
    const current = await getSettingsRow();
    await saveSettings({
      title: title.value,
      description: description.value,
      footer_html: current.footer_html,
      og_image_url: ogImage.value || null,
    });
    return flashTo(back, "ok", "Settings saved.");
  } catch (err) {
    console.error("[admin] settings save failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return flashTo(back, "error", `Could not save: ${message}`);
  }
};
