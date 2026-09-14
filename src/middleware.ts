/**
 * The admin gate.
 *
 * Every `/admin` page and `/api/admin` write passes through here, and an
 * unauthenticated visitor is turned away before a page or route handler ever
 * runs. Handlers still check the session themselves (defence in depth): a
 * matcher that drifts must never be able to expose a write.
 *
 * Only admin paths are touched, so the public site's latency and behaviour are
 * unchanged.
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
 * Headers every admin response carries: never cached (shared computers and the
 * CDN), never framed, never indexed, and no referrer leaking the URL onwards.
 */
function harden(headers: Headers): void {
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  context.locals.adminSession = null;
  context.locals.adminCsrf = "";
  context.locals.adminConfigured = adminConfigured();

  if (!isAdminPath(pathname)) return next();

  const session = await requestSession(context.request);
  context.locals.adminSession = session;
  if (session) context.locals.adminCsrf = await csrfToken(session);

  if (!session && !isLoginEndpoint(pathname)) {
    if (pathname.startsWith("/api/admin/")) {
      return jsonResponse({ ok: false, error: "Not signed in." }, 401);
    }
    // Remember where they were headed, so the login can bounce them back.
    const target = encodeURIComponent(pathname === "/admin" ? "/admin" : `${pathname}${context.url.search}`);
    const response = redirectTo(`${LOGIN_PATH}?next=${target}`);
    harden(response.headers);
    return response;
  }

  const response = await next();
  harden(response.headers);

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
