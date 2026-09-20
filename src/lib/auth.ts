/**
 * Admin authentication for the single-operator bulletin site.
 *
 * There are no user accounts: the admin password is exchanged once for a signed,
 * HttpOnly session cookie, and every admin request proves possession of that
 * cookie. Nothing in this file may ever ship to the browser — the password and
 * the signing key stay server-side.
 *
 * The password is never configured in the clear. ADMIN_PASSWORD_HASH holds a
 * PBKDF2-SHA256 hash of it (`npm run password:hash` writes one), and it is the
 * only credential this file reads — there is deliberately no plaintext
 * alternative, because an environment variable is visible to everyone with
 * dashboard access and turns up in screenshots, export files and support
 * tickets, and a hash is worthless to whoever reads it. A deployment with no
 * hash has no admin panel rather than a panel with a password in an env var.
 *
 * Why a signed token instead of a session table: Vercel functions are
 * stateless and the site has one operator, so a self-contained HMAC'd token is
 * simpler than shared state. The trade-off is that individual sessions can't be
 * revoked before they expire; rotating ADMIN_SESSION_SECRET (or the password)
 * invalidates every session at once.
 */

import { readEnv } from "./env.ts";

export const SESSION_COOKIE = "bb_admin_session";

/** Sessions last a school day; middleware slides the window on activity. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AdminSession {
  /** Session id — stable across sliding renewals, and the CSRF token's salt. */
  jti: string;
  /** Issued at / expires at, in epoch seconds. */
  iat: number;
  exp: number;
}

/**
 * Secrets come from `lib/env.ts`, which owns the runtime-dependent part of
 * reading them — and, importantly, is the one place that reads `import.meta.env`
 * statically. A dictionary lookup there is a runtime error under `astro dev`,
 * not a subtle one; the long explanation lives in that file.
 */
type SecretName = "ADMIN_PASSWORD_HASH" | "ADMIN_SESSION_SECRET";

function readSecret(name: SecretName): string {
  return readEnv(name);
}

/** The encoded hash from ADMIN_PASSWORD_HASH, or empty when it is not set. */
export function adminPasswordHash(): string {
  return readSecret("ADMIN_PASSWORD_HASH").trim();
}

/**
 * Whether the admin panel has a password at all. While this is false the login
 * form renders a "not configured" notice and every login attempt is rejected —
 * an unset env var must never mean "empty password is accepted". A hash that is
 * set but malformed is a different case: it counts as configured and refuses
 * every password (see verifyHashedPassword).
 */
export function adminConfigured(): boolean {
  return adminPasswordHash().length > 0;
}

/** Signing key. Defaults to a key *derived* from the password hash, never to a constant. */
async function sessionSecret(): Promise<Uint8Array> {
  const explicit = readSecret("ADMIN_SESSION_SECRET");
  // The hash stands in for a password here, so a deployment that sets only the
  // hash still has a signing key that is not a constant. Rotating either one
  // invalidates every existing session.
  const material = explicit || adminPasswordHash();
  if (!material) throw new Error("ADMIN_PASSWORD_HASH is not set");
  // Derive so the raw password is never used as a signing key directly.
  return hmac(new TextEncoder().encode("baulko-bulletin/session-key/v1"), material);
}

function webCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto is unavailable in this runtime");
  return c;
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const crypto = webCrypto();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

/**
 * Length-independent, value-constant comparison. Both inputs are hashed by the
 * caller where lengths would otherwise leak (see verifyPassword).
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------- the password */

/** Algorithm name in the encoded hash, so the format can change later. */
export const HASH_ALGORITHM = "pbkdf2-sha256";

/**
 * What separates the four fields of the encoded hash — and why it is not `$`.
 *
 * `$` is PBKDF2's conventional separator, and it was the first choice here. It
 * does not survive being pasted into the one place this value is meant to go.
 * Vite reads `.env` with dotenv, which expands `$name` inside every value, so
 * `pbkdf2-sha256$600000$salt$hash` arrives as `pbkdf2-sha256$600000` — silently,
 * with the salt and the digest gone, and the panel refusing every password. A
 * shell does the same thing to an unquoted `$6`. A full stop appears in neither
 * base64url nor the algorithm name, so a value that uses it survives `.env`
 * files, shells and dashboards unchanged.
 */
export const HASH_SEPARATOR = ".";

/**
 * OWASP's current floor for PBKDF2-HMAC-SHA256. Web Crypto does the stretching,
 * so this runs wherever the rest of the session code does — on the Node runtime
 * and on an edge one — without dragging `node:crypto` into this file.
 */
export const HASH_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const HASH_BITS = 256;
const MIN_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const crypto = webCrypto();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    key,
    HASH_BITS
  );
  return new Uint8Array(derived);
}

/**
 * Encodes a password as `pbkdf2-sha256.<iterations>.<salt>.<hash>`, the value
 * ADMIN_PASSWORD_HASH expects. Exported so the generator script and the tests
 * use the same code the verifier does — a hash written by one and read by the
 * other cannot drift.
 */
export async function hashPassword(
  password: string,
  options: { iterations?: number; salt?: Uint8Array } = {}
): Promise<string> {
  const iterations = options.iterations ?? HASH_ITERATIONS;
  const salt = options.salt ?? webCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, iterations);
  return [HASH_ALGORITHM, iterations, b64urlEncode(salt), b64urlEncode(hash)].join(HASH_SEPARATOR);
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  expected: Uint8Array;
}

/**
 * Reads the encoded form, or returns null for anything that is not it — the
 * single place that knows the format, so the verifier and the "is this value
 * even usable" check below cannot disagree about it.
 */
function parseHash(encoded: string): ParsedHash | null {
  const parts = encoded.split(HASH_SEPARATOR);
  if (parts.length !== 4) return null;
  const [algorithm, iterationsText, saltText, hashText] = parts;
  if (algorithm !== HASH_ALGORITHM || !saltText || !hashText) return null;
  const iterations = Number.parseInt(iterationsText ?? "", 10);
  // A needlessly low work factor is a configuration mistake worth failing on.
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) return null;
  try {
    return { iterations, salt: b64urlDecode(saltText), expected: b64urlDecode(hashText) };
  } catch {
    return null;
  }
}

/**
 * Checks a candidate against an encoded hash. A string that is not in this
 * format is refused rather than compared: a typo in the environment variable
 * must not quietly become a weaker check.
 */
async function verifyHashedPassword(candidate: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  try {
    const actual = await pbkdf2(candidate, parsed.salt, parsed.iterations);
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

/**
 * Whether the configured value is set but unreadable — the failure that is
 * otherwise indistinguishable from a wrong password, forever, with nothing in
 * any log to say which. The admin pages say so out loud instead of silently
 * refusing every login, because the usual cause is a value that was mangled on
the way in rather than a typo in the password.
 */
export function adminHashMalformed(): boolean {
  const hash = adminPasswordHash();
  return hash.length > 0 && parseHash(hash) === null;
}

/**
 * Compares the candidate against the configured hash — the only credential
 * there is. The comparison itself is constant-time: PBKDF2 stretches both to
 * the same length before they meet, so a plain string compare is not what this
 * ends up being. Nothing here creates, reads or falls back to a password held
 * in an environment variable.
 */
export async function verifyPassword(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const hash = adminPasswordHash();
  if (!hash) return false;
  return verifyHashedPassword(candidate, hash);
}

/** Signs a session: base64url(payload).base64url(HMAC(payload)). */
async function signSession(session: AdminSession): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(session)));
  const signature = b64urlEncode(await hmac(await sessionSecret(), payload));
  return `${payload}.${signature}`;
}

export async function createSessionToken(): Promise<{ token: string; session: AdminSession }> {
  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    jti: b64urlEncode(webCrypto().getRandomValues(new Uint8Array(16))),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  return { token: await signSession(session), session };
}

/**
 * Extends a session without changing its id, so an editor working through a
 * long sitting is never logged out mid-edit — and CSRF tokens (derived from the
 * id) keep working across the renewal.
 */
export async function renewSessionToken(session: AdminSession): Promise<{ token: string; session: AdminSession }> {
  const now = Math.floor(Date.now() / 1000);
  const renewed: AdminSession = { jti: session.jti, iat: now, exp: now + SESSION_TTL_SECONDS };
  return { token: await signSession(renewed), session: renewed };
}

/**
 * Verifies a session token's signature and expiry. Returns null for anything
 * malformed, unsigned, expired, or signed with a different key.
 */
export async function verifySessionToken(token: string | null | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const expected = await hmac(await sessionSecret(), payload);
    if (!timingSafeEqual(b64urlDecode(signature), expected)) return null;
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as AdminSession;
    if (typeof parsed?.jti !== "string" || typeof parsed?.exp !== "number") return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { jti: parsed.jti, iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

/**
 * CSRF token bound to the session id, so a form can only be submitted by
 * whoever holds that session's cookie. No extra cookie or server state needed —
 * the session signature already proves the token wasn't forged.
 */
export async function csrfToken(session: AdminSession): Promise<string> {
  return b64urlEncode(await hmac(new TextEncoder().encode("baulko-bulletin/csrf/v1"), session.jti));
}

export async function verifyCsrf(session: AdminSession, token: string | null): Promise<boolean> {
  if (!token) return false;
  return timingSafeEqual(new TextEncoder().encode(token), new TextEncoder().encode(await csrfToken(session)));
}

/** True once a session is past its halfway point — middleware renews it then. */
export function needsRenewal(session: AdminSession): boolean {
  const now = Math.floor(Date.now() / 1000);
  return session.exp - now < SESSION_TTL_SECONDS / 2;
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

/**
 * Serialises a cookie. Secure is set only for https requests: forcing it on
 * localhost would silently drop the cookie and make dev login impossible.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean; sameSite?: "Strict" | "Lax" }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite ?? "Strict"}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** A Set-Cookie value that deletes the session cookie. */
export function clearSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure });
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Reads and verifies the session cookie on a request. */
export async function requestSession(request: Request): Promise<AdminSession | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

/**
 * The caller's IP, for throttling. On Vercel `x-forwarded-for` is authoritative
 * (the platform overwrites it); `fallback` is Astro's `clientAddress`, which is
 * all that exists when running the dev server or a plain Node deployment.
 */
export function clientIp(request: Request, fallback?: string | null): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip") || fallback || "unknown";
}

/**
 * Login throttling. In-memory, so on Vercel the window is per instance rather
 * than global — enough to make online guessing of a long password pointless
 * without adding a database round trip to every login.
 */
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, number[]>();

function recentFailures(ip: string): number[] {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  const kept = (failures.get(ip) ?? []).filter((at) => at > cutoff);
  if (kept.length) failures.set(ip, kept);
  else failures.delete(ip);
  return kept;
}

export function loginBlocked(ip: string): boolean {
  return recentFailures(ip).length >= MAX_FAILURES;
}

export function noteLoginFailure(ip: string): void {
  const kept = recentFailures(ip);
  kept.push(Date.now());
  failures.set(ip, kept);
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}

export function retryAfterSeconds(ip: string): number {
  const kept = recentFailures(ip);
  const oldest = kept[0];
  if (oldest == null) return 0;
  return Math.max(1, Math.ceil((oldest + FAILURE_WINDOW_MS - Date.now()) / 1000));
}
