import type { APIRoute } from "astro";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  adminConfigured,
  adminHashMalformed,
  clearLoginFailures,
  clientIp,
  createSessionToken,
  isSecureRequest,
  loginBlocked,
  noteLoginFailure,
  retryAfterSeconds,
  serializeCookie,
  verifyPassword,
} from "@/lib/auth";
import { flashTo, jsonResponse, originAllowed, safeAdminPath } from "@/lib/admin";

export const prerender = false;

/**
 * Deliberate pause after a wrong password. Cheap online guessing is the main
 * threat to a single shared secret, and this makes it 400 ms per attempt even
 * before the failure counter locks the caller out.
 */
const FAILURE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Anything other than a successful POST is not a login attempt. */
export const GET: APIRoute = () =>
  jsonResponse({ ok: false, error: "Use POST to sign in." }, 405);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Login CSRF: no session exists yet, so the Origin check is the guard. A
  // browser always sends Origin on a cross-site POST, so a mismatch is forged.
  if (!originAllowed(request)) {
    console.warn("[admin] login rejected: cross-origin request");
    return jsonResponse({ ok: false, error: "Cross-origin login rejected." }, 403);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ ok: false, error: "Malformed form submission." }, 400);

  const next = safeAdminPath(typeof form.get("next") === "string" ? String(form.get("next")) : null);
  const backToLogin = `/admin/login?next=${encodeURIComponent(next)}`;

  if (!adminConfigured()) {
    console.error("[admin] no admin password hash is set — refusing every login");
    return flashTo(backToLogin, "error", "Admin is not configured: set ADMIN_PASSWORD_HASH.");
  }

  // A set-but-unreadable hash is worth one line in the log: from the outside it
  // is indistinguishable from everyone suddenly forgetting the password.
  if (adminHashMalformed()) {
    console.error(
      "[admin] ADMIN_PASSWORD_HASH is set but does not parse — every login will be refused. " +
        "Expected pbkdf2-sha256.<iterations>.<salt>.<hash>; a value pasted into .env loses " +
        "everything after a $ character."
    );
  }

  const ip = clientIp(request, clientAddress);
  if (loginBlocked(ip)) {
    const retry = retryAfterSeconds(ip);
    console.warn(`[admin] login blocked for ${ip} (${retry}s remaining)`);
    const response = flashTo(
      backToLogin,
      "error",
      `Too many failed attempts. Try again in ${retry} second${retry === 1 ? "" : "s"}.`
    );
    response.headers.set("Retry-After", String(retry));
    return new Response(response.body, { status: 429, headers: response.headers });
  }

  const password = typeof form.get("password") === "string" ? String(form.get("password")).slice(0, 512) : "";
  if (!(await verifyPassword(password))) {
    noteLoginFailure(ip);
    await sleep(FAILURE_DELAY_MS);
    console.warn(`[admin] failed login from ${ip}`);
    return flashTo(backToLogin, "error", "Incorrect password.");
  }

  clearLoginFailures(ip);
  const { token } = await createSessionToken();
  console.log(`[admin] signed in from ${ip}`);

  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": serializeCookie(SESSION_COOKIE, token, {
        maxAge: SESSION_TTL_SECONDS,
        secure: isSecureRequest(request),
      }),
    },
  });
};
