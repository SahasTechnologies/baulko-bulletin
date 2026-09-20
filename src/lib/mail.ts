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
import { readEnv } from "@/lib/env";
import { retryWithBackoff } from "@/lib/retry";

// Resend's shared sender works without a verified domain, but it only delivers
// to the Resend account owner — RESEND_EMAIL_FROM overrides it in production.
const DEFAULT_FROM = "Baulko Bulletin <onboarding@resend.dev>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * The whole send, retries included, has to fit inside the visitor's wait.
 *
 * A single attempt used to be allowed 15 seconds, which on its own is longer
 * than a serverless function is given — so the previous behaviour under a slow
 * Resend was a request that never answered. Nine seconds is enough for a normal
 * send several times over, and now covers every attempt rather than one.
 */
const SEND_DEADLINE_MS = 9_000;
const PER_ATTEMPT_MS = 6_000;

/** Both runtimes are handled in `lib/env.ts`; this is just the typed door to it. */
function env(name: "RESEND_API_KEY" | "RESEND_EMAIL_FROM"): string {
  return readEnv(name);
}

export function resendConfigured(): boolean {
  return Boolean(env("RESEND_API_KEY"));
}

export function senderAddress(): string {
  return env("RESEND_EMAIL_FROM") || DEFAULT_FROM;
}

export interface SendInput {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/**
 * One attempt at the send. Its own outcome type, because the retry loop needs
 * to know whether trying again could plausibly help: a 429 or a 5xx might, a
 * 422 ("domain is not verified") never will, and an unreachable network might.
 */
type Attempt =
  | { ok: true }
  | { ok: false; retryable: boolean; error: string };

async function attemptSend(
  input: SendInput,
  apiKey: string,
  idempotencyKey: string,
  timeoutMs: number
): Promise<Attempt> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // The same key on every try, so a retry after a connection that died
        // mid-request cannot send the message twice. Resend ignores a repeat of
        // a key it has seen in the last day. See
        // https://resend.com/docs/dashboard/emails/idempotency-keys
        "Idempotency-Key": idempotencyKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
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
      return {
        ok: false,
        retryable: res.status === 429 || res.status >= 500,
        error: `Resend said ${res.status}: ${detail.slice(0, 400)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[mail] Resend request failed:", err);
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sends one email, trying again briefly when the failure looks temporary.
 *
 * A contact submission is already in the database by the time this runs, so a
 * failed send loses nothing but the notification — which is exactly why it is
 * worth a second attempt now: nobody is watching for the email that never came.
 * The whole loop is bounded by a deadline, because the visitor is still waiting
 * on the form's response while it runs.
 */
export async function sendEmail(input: SendInput): Promise<{ ok: boolean; error?: string }> {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };
  if (!input.to.length) return { ok: false, error: "There is nobody to send to." };

  const idempotencyKey = crypto.randomUUID();
  const outcome = await retryWithBackoff<Attempt>(
    // The request timeout follows what is left of the deadline, so the three
    // attempts together cannot outlast the function that is waiting on them —
    // and the floor keeps a last, hopeless attempt from being launched with
    // five milliseconds to run in.
    ({ remainingMs }) =>
      attemptSend(input, apiKey, idempotencyKey, Math.max(1_000, Math.min(PER_ATTEMPT_MS, remainingMs))),
    {
      attempts: 3,
      baseDelayMs: 300,
      factor: 3,
      maxDelayMs: 2_000,
      deadlineMs: SEND_DEADLINE_MS,
      shouldRetry: (result) => result?.ok === false && result.retryable,
      onRetry: ({ attempt, delayMs }) =>
        console.warn(`[mail] send attempt ${attempt} failed — retrying in ${delayMs}ms`),
    }
  );

  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
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
