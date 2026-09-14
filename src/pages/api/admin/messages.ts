import type { APIRoute } from "astro";
import { deleteSubmission, isUuid, setSubmissionRead } from "@/lib/admin-db";
import { csrfOk, flashTo, jsonResponse, originAllowed, requireAdmin } from "@/lib/admin";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ ok: false, error: "Not signed in." }, 401);
  if (!originAllowed(request)) {
    return jsonResponse({ ok: false, error: "Cross-origin request rejected." }, 403);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ ok: false, error: "Malformed form submission." }, 400);
  if (!(await csrfOk(session, form))) {
    return flashTo("/admin/messages", "error", "Your session check failed — sign in again and retry.");
  }

  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  if (!isUuid(id)) return flashTo("/admin/messages", "error", "Unknown message.");

  try {
    switch (action) {
      case "read":
      case "unread":
        await setSubmissionRead(id, action === "read");
        return flashTo("/admin/messages", "ok", action === "read" ? "Marked as read." : "Marked as unread.");
      case "delete":
        await deleteSubmission(id);
        return flashTo("/admin/messages", "ok", "Message deleted.");
      default:
        return flashTo("/admin/messages", "error", "Unknown action.");
    }
  } catch (err) {
    console.error("[admin] message action failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return flashTo("/admin/messages", "error", `Could not update: ${message}`);
  }
};
