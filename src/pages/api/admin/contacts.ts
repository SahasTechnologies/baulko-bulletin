import type { APIRoute } from "astro";
import { addRecipient, deleteRecipient, isUuid, listRecipients, updateRecipient } from "@/lib/admin-db";
import { csrfOk, flashTo, jsonResponse, originAllowed, requireAdmin } from "@/lib/admin";
import { resendConfigured, sendEmail, senderAddress } from "@/lib/mail";

export const prerender = false;

const BACK = "/admin/contacts";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, length-checked and shape-checked in one place — every action needs it. */
function readEmail(value: FormDataEntryValue | null): { email: string; error: string | null } {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email) return { email, error: "An email address is required." };
  if (email.length > 320) return { email, error: "That email address is too long." };
  if (!EMAIL_RE.test(email)) return { email, error: `“${email}” does not look like an email address.` };
  return { email, error: null };
}

function readName(value: FormDataEntryValue | null): { name: string | null; error: string | null } {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length > 120) return { name: null, error: "That name is too long (maximum 120 characters)." };
  return { name: name || null, error: null };
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
    return flashTo(BACK, "error", "Your session check failed — sign in again and retry.");
  }

  const action = String(form.get("action") ?? "");

  try {
    switch (action) {
      case "add": {
        const email = readEmail(form.get("email"));
        const name = readName(form.get("name"));
        if (email.error) return flashTo(BACK, "error", email.error);
        if (name.error) return flashTo(BACK, "error", name.error);
        const existing = await listRecipients();
        if (existing.some((r) => r.email.toLowerCase() === email.email.toLowerCase())) {
          return flashTo(BACK, "error", `${email.email} is already on the list.`);
        }
        await addRecipient(email.email, name.name);
        return flashTo(BACK, "ok", `Added ${email.email}.`);
      }

      case "update": {
        const id = String(form.get("id") ?? "");
        if (!isUuid(id)) return flashTo(BACK, "error", "Unknown recipient.");
        const email = readEmail(form.get("email"));
        const name = readName(form.get("name"));
        if (email.error) return flashTo(BACK, "error", email.error);
        if (name.error) return flashTo(BACK, "error", name.error);
        await updateRecipient(id, email.email, name.name, form.get("active") === "on");
        return flashTo(BACK, "ok", `Saved ${email.email}.`);
      }

      case "delete": {
        const id = String(form.get("id") ?? "");
        if (!isUuid(id)) return flashTo(BACK, "error", "Unknown recipient.");
        await deleteRecipient(id);
        return flashTo(BACK, "ok", "Recipient removed.");
      }

      case "test": {
        if (!resendConfigured()) {
          return flashTo(
            BACK,
            "error",
            "RESEND_API_KEY is not set, so nothing can be sent. Add it to the environment and redeploy."
          );
        }
        const recipients = (await listRecipients()).filter((r) => r.active);
        if (!recipients.length) {
          return flashTo(BACK, "error", "There are no active recipients to test with.");
        }
        const result = await sendEmail({
          to: recipients.map((r) => r.email),
          subject: "Baulko Bulletin contact form — test",
          text:
            "This is a test from the Baulko Bulletin admin panel.\n\n" +
            "If you received it, the contact form will reach everyone on the recipient list.",
          html:
            '<h2 style="margin:0 0 12px">Test message</h2>' +
            "<p>This is a test from the Baulko Bulletin admin panel.</p>" +
            "<p>If you received it, the contact form will reach everyone on the recipient list.</p>" +
            `<p style="opacity:.6;font-size:13px">Sent from ${senderAddress()} to ${recipients.length} address(es).</p>`,
        });
        return flashTo(
          BACK,
          result.ok ? "ok" : "error",
          result.ok
            ? `Test email sent to ${recipients.map((r) => r.email).join(", ")}.`
            : `Test failed — ${result.error}`
        );
      }

      default:
        return flashTo(BACK, "error", "Unknown action.");
    }
  } catch (err) {
    console.error("[admin] contact recipient action failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return flashTo(BACK, "error", `Could not save: ${message}`);
  }
};
