import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_PASSWORD = "correct horse battery staple";
delete process.env.ADMIN_SESSION_SECRET;

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  adminConfigured,
  clearLoginFailures,
  clearSessionCookie,
  clientIp,
  createSessionToken,
  csrfToken,
  isSecureRequest,
  loginBlocked,
  needsRenewal,
  noteLoginFailure,
  parseCookies,
  renewSessionToken,
  requestSession,
  retryAfterSeconds,
  serializeCookie,
  verifyCsrf,
  verifyPassword,
  verifySessionToken,
} from "./auth.ts";

const session = () => ({
  jti: "test-session",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
});

beforeEach(() => {
  clearLoginFailures("198.51.100.10");
});

test("adminConfigured and verifyPassword distinguish configured, valid, and invalid credentials", async () => {
  assert.equal(adminConfigured(), true);
  assert.equal(await verifyPassword("correct horse battery staple"), true);
  assert.equal(await verifyPassword("wrong"), false);
  assert.equal(await verifyPassword(""), false);
});

test("session tokens round-trip and preserve the session payload", async () => {
  const created = await createSessionToken();
  assert.match(created.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verifySessionToken(created.token), created.session);
  assert.notEqual((await createSessionToken()).session.jti, created.session.jti);
});

test("session signatures reject tampering, malformed tokens, and expiration", async () => {
  const created = await createSessionToken();
  const [payload, signature] = created.token.split(".");
  assert.equal(await verifySessionToken(`${payload}.${signature!.slice(0, -1)}x`), null);
  assert.equal(await verifySessionToken(`${payload}.not-base64`), null);
  assert.equal(await verifySessionToken("not-a-token"), null);

  const createdAt = await createSessionToken();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * SESSION_TTL_SECONDS * 1000;
    assert.equal(await verifySessionToken(createdAt.token), null);
  } finally {
    Date.now = realNow;
  }
});

test("renewing a session keeps its id and extends its expiry", async () => {
  const old = { jti: "same-id", iat: 1, exp: 2 };
  const renewed = await renewSessionToken(old);
  assert.equal(renewed.session.jti, old.jti);
  assert.ok(renewed.session.exp > old.exp);
  assert.deepEqual(await verifySessionToken(renewed.token), renewed.session);
});

test("CSRF tokens are session-bound and reject missing or wrong values", async () => {
  const first = session();
  const second = { ...first, jti: "other-session" };
  const token = await csrfToken(first);
  assert.equal(await verifyCsrf(first, token), true);
  assert.equal(await verifyCsrf(first, null), false);
  assert.equal(await verifyCsrf(first, token.slice(0, -1)), false);
  assert.equal(await verifyCsrf(second, token), false);
});

test("needsRenewal changes at the halfway point", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(needsRenewal({ jti: "x", iat: now, exp: now + SESSION_TTL_SECONDS }), false);
  assert.equal(needsRenewal({ jti: "x", iat: now, exp: now + SESSION_TTL_SECONDS / 2 - 1 }), true);
});

test("cookie parsing handles whitespace, encoding, and malformed values", () => {
  assert.deepEqual(parseCookies("a=1; bb_admin_session=hello%20world; broken; empty="), {
    a: "1",
    bb_admin_session: "hello world",
    empty: "",
  });
  assert.deepEqual(parseCookies(null), {});
  assert.equal(parseCookies("bad=%E0%A4%A").bad, "%E0%A4%A");
});

test("cookie serialization includes security attributes and supports clearing", () => {
  const cookie = serializeCookie("name", "a value", { maxAge: 60, secure: true, sameSite: "Lax" });
  assert.match(cookie, /^name=a%20value;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=60/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(clearSessionCookie(false), new RegExp(`^${SESSION_COOKIE}=;`));
  assert.match(clearSessionCookie(false), /Max-Age=0/);
});

test("secure-request detection honors forwarded protocol and request URL", () => {
  assert.equal(isSecureRequest(new Request("https://example.test/")), true);
  assert.equal(isSecureRequest(new Request("http://example.test/")), false);
  assert.equal(
    isSecureRequest(new Request("http://example.test/", { headers: { "x-forwarded-proto": "https,http" } })),
    true,
  );
});

test("requestSession reads the signed session cookie", async () => {
  const created = await createSessionToken();
  const request = new Request("https://example.test/admin", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(created.token)}` },
  });
  assert.deepEqual(await requestSession(request), created.session);
  assert.equal(await requestSession(new Request("https://example.test/admin")), null);
});

test("clientIp prefers the first forwarded address, then real IP, then fallback", () => {
  assert.equal(clientIp(new Request("https://example.test", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }), "fallback"), "1.2.3.4");
  assert.equal(clientIp(new Request("https://example.test", { headers: { "x-real-ip": "2.3.4.5" } }), "fallback"), "2.3.4.5");
  assert.equal(clientIp(new Request("https://example.test"), "fallback"), "fallback");
  assert.equal(clientIp(new Request("https://example.test")), "unknown");
});

test("login throttling blocks at eight failures and can be cleared", () => {
  const ip = "198.51.100.10";
  assert.equal(loginBlocked(ip), false);
  for (let i = 0; i < 8; i++) noteLoginFailure(ip);
  assert.equal(loginBlocked(ip), true);
  assert.ok(retryAfterSeconds(ip) > 0);
  clearLoginFailures(ip);
  assert.equal(loginBlocked(ip), false);
  assert.equal(retryAfterSeconds(ip), 0);
});
