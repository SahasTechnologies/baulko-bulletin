/**
 * Outgoing mail, via Resend.
 *
 * Shared by the public contact form and the admin "send a test" button so both
 * go through exactly the same code — a test that passes has to mean the real
 * thing will work too.
 *
 * Nothing here throws. A contact submission is already saved in the database by
 * the time we send, and losing it because mail was down would be worse than a
 * missing email.
 */

import { getContactRecipients } from "@/lib/db";

// Resend's shared sender works without a verified domain, but it only delivers
// to the Resend account owner — RESEND_EMAIL_FROM overrides it in production.
const DEFAULT_FROM = "Baulko Bulletin <onboarding@resend.dev>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * `process.env` is the runtime value on Vercel; Vite only fills
 * `import.meta.env` from `.env` during `astro dev`. Reading both keeps a local
 * run from silently skipping the send.
 */
function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  return (import.meta.env as Record<string, string | undefined>)[name] || "";
}

export function resendConfigured(): boolean {
  return Boolean(env("RESEND_API_KEY"));
}

export function senderAddress(): string {
  return env("RESEND_EMAIL_FROM") || DEFAULT_FROM;
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };
  if (!input.to.length) return { ok: false, error: "There is nobody to send to." };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        from: senderAddress(),
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[mail] Resend rejected the send:", res.status, detail);
      // Resend explains itself well ("domain is not verified"), so pass it on.
      return { ok: false, error: `Resend said ${res.status}: ${detail.slice(0, 400)}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[mail] Resend request failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

/** Emails a contact submission to everyone on the active recipient list. */
export async function notifyContactRecipients(input: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  if (!resendConfigured()) {
    console.warn("[mail] RESEND_API_KEY is not set — saved without emailing");
    return;
  }

  const recipients = await getContactRecipients();
  if (!recipients.length) {
    console.warn("[mail] no active contact_recipients rows — saved without emailing");
    return;
  }

  const safe = {
    name: escapeHtml(input.name),
    email: escapeHtml(input.email),
    message: escapeHtml(input.message).replace(/\n/g, "<br>"),
  };

  const text = [
    `New message via the Baulko Bulletin contact form.`,
    ``,
    `Name:    ${input.name}`,
    `Email:   ${input.email}`,
    ``,
    input.message,
  ].join("\n");

  const html = `
    <h2 style="margin:0 0 16px">New contact form message</h2>
    <p style="margin:0 0 4px"><strong>Name:</strong> ${safe.name}</p>
    <p style="margin:0 0 16px"><strong>Email:</strong> ${safe.email}</p>
    <div style="padding:16px;border-radius:12px;background:#f4f4f5">${safe.message}</div>
  `;

  const result = await sendEmail({
    to: recipients.map((r) => r.email),
    subject: `Contact form: ${input.name}`,
    text,
    html,
    replyTo: input.email,
  });
  if (result.ok) console.log(`[mail] emailed ${recipients.length} recipient(s)`);
}
