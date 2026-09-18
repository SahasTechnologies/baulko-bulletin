import type { APIRoute } from "astro";
import { neon } from "@neondatabase/serverless";
import { placeFor } from "@/lib/geo";
import { notifyContactRecipients } from "@/lib/mail";

export const prerender = false;

const TURNSTILE_ACTION = "contact";
const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Hostnames we insist the token was solved on. Empty means "don't check": the
 * Turnstile widget already restricts which domains may render it, so an
 * unconfigured allowlist shouldn't be able to reject real submissions (preview
 * deployments, a new custom domain, Cloudflare's test keys, …).
 */
function allowedTurnstileHostnames() {
  return (process.env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Verifies a Turnstile token.
 *
 * Unconfigured (no TURNSTILE_SECRET) is treated as "CAPTCHA not switched on yet":
 * the submission is accepted and a loud warning is logged, so a missing env var
 * never takes the contact form down. Once the secret is set, every submission is
 * verified and a bad or missing token is rejected.
 */
async function verifyTurnstile(token: string, remoteIp: string | null) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    console.warn(
      "[contact] TURNSTILE_SECRET is not set — accepting this submission WITHOUT captcha verification. " +
        "Set TURNSTILE_SECRET to switch Turnstile on."
    );
    return { ok: true, reason: "captcha-not-configured" };
  }

  if (!token || token.length > 2048) {
    return { ok: false, reason: "captcha-missing" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(TURNSTILE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);

    const result = (await res.json()) as {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!result.success) {
      console.warn("[contact] Turnstile rejected:", result["error-codes"] || "no error codes");
      return { ok: false, reason: "captcha-failed" };
    }
    // Reject a token minted for a different form, but tolerate an absent action:
    // Cloudflare's test keys never return one, and a missing field shouldn't be
    // able to take the live contact form down.
    if (result.action && result.action !== TURNSTILE_ACTION) {
      console.warn(`[contact] Turnstile action mismatch: ${result.action}`);
      return { ok: false, reason: "captcha-action" };
    }
    const allowed = allowedTurnstileHostnames();
    if (allowed.length && result.hostname && !allowed.includes(result.hostname)) {
      console.warn(`[contact] Turnstile hostname not allowed: ${result.hostname}`);
      return { ok: false, reason: "captcha-hostname" };
    }
    if (result.hostname) console.log(`[contact] Turnstile ok (host ${result.hostname})`);
    return { ok: true, reason: "" };
  } catch (err) {
    console.error("[contact] Turnstile verification failed:", err);
    return { ok: false, reason: "captcha-error" };
  }
}

function getSql() {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  const url = process.env.DATABASE_URL || meta.env?.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/**
 * Submission throttling, mirroring the login limiter in lib/auth.ts. Turnstile
 * is the real gate, but it is optional — with TURNSTILE_SECRET unset every
 * submission is accepted — so this is the only other thing between a script and
 * the recipients' inboxes. In-memory, so on Vercel the window is per instance
 * rather than global: enough to blunt a flood without a database round trip on
 * every message. A client with no identifiable address is not throttled, since
 * one shared "unknown" bucket would lock everybody out at once.
 */
const MAX_SUBMISSIONS = 5;
const SUBMISSION_WINDOW_MS = 10 * 60 * 1000;
const submissions = new Map<string, number[]>();

function recentSubmissions(ip: string): number[] {
  const cutoff = Date.now() - SUBMISSION_WINDOW_MS;
  const kept = (submissions.get(ip) ?? []).filter((at) => at > cutoff);
  if (kept.length) submissions.set(ip, kept);
  else submissions.delete(ip);
  return kept;
}

/** Seconds before this address may send again, or 0 when this one may go through. */
function submissionWaitSeconds(ip: string): number {
  const kept = recentSubmissions(ip);
  const oldest = kept[0];
  if (kept.length < MAX_SUBMISSIONS || oldest == null) return 0;
  return Math.max(1, Math.ceil((oldest + SUBMISSION_WINDOW_MS - Date.now()) / 1000));
}

function noteSubmission(ip: string): void {
  const kept = recentSubmissions(ip);
  kept.push(Date.now());
  submissions.set(ip, kept);
}

/**
 * The form is a plain HTML POST with no JavaScript behind it, so a JSON body is
 * unreadable to the person who submitted it — a failed captcha or an over-long
 * message would dump `{"ok":false,…}` into the browser tab. Browser submits are
 * bounced back to the form with the reason in the query string; anything that
 * asked for JSON (a script, or curl) still gets JSON and the status code.
 */
function failure(request: Request, status: number, message: string): Response {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { Location: `/contact?error=${encodeURIComponent(message)}` },
    });
  }
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    let name = "";
    let email = "";
    let message = "";
    let website = "";
    let turnstileToken = "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      name = String(body.name || "").trim();
      email = String(body.email || "").trim();
      message = String(body.message || "").trim();
      website = String(body.website || "").trim();
      turnstileToken = String(body["cf-turnstile-response"] || "").trim();
    } else {
      const form = await request.formData();
      name = String(form.get("name") || "").trim();
      email = String(form.get("email") || "").trim();
      message = String(form.get("message") || "").trim();
      website = String(form.get("website") || "").trim();
      turnstileToken = String(form.get("cf-turnstile-response") || "").trim();
    }

    if (website) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // The sender's own address, off the submission itself — Vercel overwrites
    // `x-forwarded-for`, so the first entry is the client and not something the
    // form could have chosen. Used for the throttle, the captcha check and the
    // location; never replaced by an address of our own.
    const forwarded = request.headers.get("x-forwarded-for") || "";
    const remoteIp = forwarded.split(",")[0]?.trim() || null;

    if (remoteIp) {
      const wait = submissionWaitSeconds(remoteIp);
      if (wait > 0) {
        console.warn(`[contact] throttled ${remoteIp} (${wait}s remaining)`);
        return failure(
          request,
          429,
          `That is a lot of messages in a row. Please try again in ${wait} second${wait === 1 ? "" : "s"}.`
        );
      }
    }

    const captcha = await verifyTurnstile(turnstileToken, remoteIp);
    if (!captcha.ok) {
      return failure(request, 403, "Verification failed. Please try again.");
    }

    if (!name || !email || !message) {
      return failure(request, 400, "Name, email and message are required.");
    }

    if (name.length > 200 || email.length > 320 || message.length > 5000) {
      return failure(request, 400, "Input too long.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return failure(request, 400, "Invalid email address.");
    }

    // Where the message was sent from, read off the address it arrived on. Done
    // here, before the insert, rather than left to whoever opens the panel
    // later: the answer belongs to the submission, and the operator's own
    // address would say nothing about where this came from.
    const location = await placeFor(remoteIp);

    const sql = getSql();
    await sql`
      INSERT INTO contact_submissions (name, email, message, location)
      VALUES (${name}, ${email}, ${message}, ${location})
    `;

    // Awaited: a serverless function can be frozen as soon as we respond.
    await notifyContactRecipients({ name, email, message });

    if (remoteIp) noteSubmission(remoteIp);

    const accept = request.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/contact?sent=1" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("contact form error:", err);
    return failure(request, 500, "Something went wrong. Please try again.");
  }
};
