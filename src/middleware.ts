/**
 * The request gate, and the one place response headers are set.
 *
 * Every `/admin` page and `/api/admin` write passes through the auth check, and
 * an unauthenticated visitor is turned away before a page or route handler ever
 * runs. Handlers still check the session themselves (defence in depth): a
 * matcher that drifts must never be able to expose a write.
 *
 * Every response, public and admin alike, also leaves through here carrying the
 * baseline security headers in `lib/security-headers.ts`. Doing it in one place
 * rather than in the layout means an API route or a 404 gets them too — those
 * are responses a page-level component would never see.
 */

import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  adminConfigured,
  csrfToken,
  isSecureRequest,
  needsRenewal,
  renewSessionToken,
  requestSession,
  serializeCookie,
} from "@/lib/auth";
import { jsonResponse, redirectTo } from "@/lib/admin";
import { isDevelopment, readEnvTrimmed } from "@/lib/env";
import { applySecurityHeaders, readerOrigin } from "@/lib/security-headers";

const LOGIN_PATH = "/admin/login";
const LOGIN_API = "/api/admin/login";

/** `/admin`, `/admin/…`, `/api/admin/…` — but not `/administrator`, `/adminfoo`. */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Login is the one admin endpoint reachable while signed out. */
function isLoginEndpoint(pathname: string): boolean {
  const path = normalize(pathname);
  return path === LOGIN_PATH || path === LOGIN_API;
}

/**
 * The admin half of the headers: never cached (shared computers and the CDN) and
 * never indexed. Framing, sniffing, the referrer policy and the content policy
 * come from `lib/security-headers.ts`, which every response carries — this only
 * adds what is specific to the panel.
 */
function harden(headers: Headers): void {
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  headers.set("X-Robots-Tag", "noindex, nofollow");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const secure = isSecureRequest(context.request);
  // Vite's dev server needs a websocket and `eval`; a deployed function must
  // not have either. See `lib/security-headers.ts`.
  //
  // The reader's origin is named from the configured endpoint rather than
  // assumed: the issue reader downloads every PDF with `fetch`, so a policy that
  // does not allow ImageKit's CDN leaves the reader unable to open a file the
  // browser can reach perfectly well by hand.
  const options = {
    secure,
    dev: isDevelopment(),
    reader: readerOrigin(readEnvTrimmed("IMAGEKIT_URL_ENDPOINT")),
  };

  context.locals.adminSession = null;
  context.locals.adminCsrf = "";
  context.locals.adminConfigured = adminConfigured();

  if (!isAdminPath(pathname)) {
    const response = await next();
    applySecurityHeaders(response.headers, options);
    return response;
  }

  const session = await requestSession(context.request);
  context.locals.adminSession = session;
  if (session) context.locals.adminCsrf = await csrfToken(session);

  if (!session && !isLoginEndpoint(pathname)) {
    if (pathname.startsWith("/api/admin/")) {
      const denied = jsonResponse({ ok: false, error: "Not signed in." }, 401);
      applySecurityHeaders(denied.headers, { ...options, admin: true });
      return denied;
    }
    // Remember where they were headed, so the login can bounce them back.
    const target = encodeURIComponent(pathname === "/admin" ? "/admin" : `${pathname}${context.url.search}`);
    const response = redirectTo(`${LOGIN_PATH}?next=${target}`);
    harden(response.headers);
    applySecurityHeaders(response.headers, { ...options, admin: true });
    return response;
  }

  const response = await next();
  harden(response.headers);
  applySecurityHeaders(response.headers, { ...options, admin: true });

  if (session && needsRenewal(session)) {
    const renewed = await renewSessionToken(session);
    response.headers.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, renewed.token, {
        maxAge: SESSION_TTL_SECONDS,
        secure: isSecureRequest(context.request),
      })
    );
  }

  return response;
});
