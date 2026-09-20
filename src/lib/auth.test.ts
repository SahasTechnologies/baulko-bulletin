import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// There is no plaintext password variable any more, and this is the place that
// says so out loud: the one a developer's shell might still be carrying is
// deleted, so every test below runs against a hash.
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_SESSION_SECRET;

import {
  HASH_ALGORITHM,
  HASH_SEPARATOR,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  adminConfigured,
  adminHashMalformed,
  adminPasswordHash,
  clearLoginFailures,
  clearSessionCookie,
  clientIp,
  createSessionToken,
  csrfToken,
  hashPassword,
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

/**
 * The one credential the whole file runs against — the panel is configured here
 * and nowhere else, because a hash is the only thing auth.ts will read.
 *
 * This sits above the first test deliberately: `node:test` starts running tests
 * as soon as the module gives the event loop a turn, so anything hashed below a
 * top-level `await` would configure the panel halfway through the suite.
 *
 * Iterations are the minimum the verifier accepts rather than production's
 * 600 000, which is what keeps the suite in seconds; the encoded format is
 * byte-for-byte the one a deployment stores.
 */
const encoded = await hashPassword("a much better password", { iterations: 120_000 });
process.env.ADMIN_PASSWORD_HASH = encoded;

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
  assert.equal(await verifyPassword("a much better password"), true);
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

/* --------------------------------------------------------- hashed password */

/** Swaps the configured hash for the length of one test, then puts it back. */
async function withHash(hash: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = hash;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = previous;
  }
}

test("hashPassword writes a self-describing hash", () => {
  const [algorithm, iterations, salt, hash] = encoded.split(HASH_SEPARATOR);
  assert.equal(algorithm, HASH_ALGORITHM);
  assert.equal(iterations, "120000");
  assert.match(salt ?? "", /^[A-Za-z0-9_-]+$/);
  assert.match(hash ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(encoded, "");
  // The value is pasted into `.env` files and dashboards, where a `$` would be
  // expanded away (Vite's dotenv does exactly that) and a `-` is harmless.
  assert.ok(!encoded.includes("$"), encoded);
});

test("the same password hashes differently every time, but against the same salt it does not", async () => {
  const salt = new Uint8Array(16).fill(7);
  const first = await hashPassword("same password", { iterations: 120_000, salt });
  const second = await hashPassword("same password", { iterations: 120_000, salt });
  assert.equal(first, second);
  const other = await hashPassword("same password", { iterations: 120_000 });
  assert.notEqual(first, other);
});

test("the configured hash is the credential, and it verifies its own password", async () => {
  assert.equal(adminConfigured(), true);
  assert.equal(adminPasswordHash(), encoded);
  assert.equal(await verifyPassword("a much better password"), true);
  assert.equal(await verifyPassword("wrong"), false);
  assert.equal(await verifyPassword(""), false);
});

test("a plaintext ADMIN_PASSWORD is inert — only the hash is a way in", async () => {
  // The variable was removed from the code; this pins that down, so a stray one
  // in a shell or on a dashboard cannot quietly become a way back in.
  process.env.ADMIN_PASSWORD = "some other password entirely";
  try {
    await withHash(encoded, async () => {
      assert.equal(await verifyPassword("some other password entirely"), false);
      assert.equal(await verifyPassword("a much better password"), true);
    });
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("with no hash at all the panel is off, whatever else is set", async () => {
  process.env.ADMIN_PASSWORD = "a much better password";
  try {
    await withHash("", async () => {
      assert.equal(adminPasswordHash(), "");
      assert.equal(adminConfigured(), false);
      // Fail closed: an unset variable is not an empty password.
      assert.equal(await verifyPassword("a much better password"), false);
    });
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("the hash alone derives the session signing key", async () => {
  // No ADMIN_SESSION_SECRET is set anywhere in this file, so this is the
  // fallback path: a session signed and verified with a key derived from the
  // hash, which is what a deployment that sets only the hash relies on.
  await withHash(encoded, async () => {
    const created = await createSessionToken();
    assert.deepEqual(await verifySessionToken(created.token), created.session);
  });
});

test("a malformed hash refuses every password instead of falling back", async () => {
  const [, , salt, hash] = encoded.split(HASH_SEPARATOR);
  const cases = [
    "not-a-hash",
    "pbkdf2-sha256.120000.onlythreeparts",
    `scrypt.120000.${salt}.${hash}`,
    `${HASH_ALGORITHM}..${salt}.${hash}`,
    `${HASH_ALGORITHM}.10.${salt}.${hash}`,
    `${HASH_ALGORITHM}.120000.${hash}`,
    // The `$`-separated form this used to write, and the shape a value takes
    // when a `.env` file's `$` expansion has eaten the salt and the digest.
    `${HASH_ALGORITHM}$${salt}$${hash}`,
    `${HASH_ALGORITHM}$600000`,
  ];
  for (const bad of cases) {
    await withHash(bad, async () => {
      assert.equal(adminPasswordHash(), bad.trim());
      // Set but unusable still counts as configured: the panel is on and
      // nothing gets in, rather than the check falling back to something weaker.
      assert.equal(adminConfigured(), true);
      assert.equal(adminHashMalformed(), true, `expected ${bad} to look malformed`);
      assert.equal(await verifyPassword("a much better password"), false, `accepted ${bad}`);
      assert.equal(await verifyPassword(""), false);
    });
  }
});

test("a readable hash is not flagged, and an unset one is not either", async () => {
  assert.equal(adminHashMalformed(), false);
  await withHash("", async () => {
    // Nothing to warn about: the panel says it is not configured instead.
    assert.equal(adminHashMalformed(), false);
  });
});

test("surrounding whitespace in the environment variable is tolerated", async () => {
  await withHash(`  ${encoded}\n`, async () => {
    assert.equal(await verifyPassword("a much better password"), true);
  });
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
