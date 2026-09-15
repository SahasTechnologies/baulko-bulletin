import type { APIRoute } from "astro";
import { neon } from "@neondatabase/serverless";
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
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
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

    const forwarded = request.headers.get("x-forwarded-for") || "";
    const remoteIp = forwarded.split(",")[0]?.trim() || null;
    const captcha = await verifyTurnstile(turnstileToken, remoteIp);
    if (!captcha.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Verification failed. Please try again." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Name, email and message are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (name.length > 200 || email.length > 320 || message.length > 5000) {
      return new Response(
        JSON.stringify({ ok: false, error: "Input too long." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid email address." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const sql = getSql();
    await sql`
      INSERT INTO contact_submissions (name, email, message)
      VALUES (${name}, ${email}, ${message})
    `;

    // Awaited: a serverless function can be frozen as soon as we respond.
    await notifyContactRecipients({ name, email, message });

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
    return new Response(
      JSON.stringify({ ok: false, error: "Something went wrong. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
