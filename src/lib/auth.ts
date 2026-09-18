/**
 * Admin authentication for the single-operator bulletin site.
 *
 * There are no user accounts: ADMIN_PASSWORD is exchanged once for a signed,
 * HttpOnly session cookie, and every admin request proves possession of that
 * cookie. Nothing in this file may ever ship to the browser — the password and
 * the signing key stay server-side.
 *
 * Why a signed token instead of a session table: Vercel functions are
 * stateless and the site has one operator, so a self-contained HMAC'd token is
 * simpler than shared state. The trade-off is that individual sessions can't be
 * revoked before they expire; rotating ADMIN_SESSION_SECRET (or the password)
 * invalidates every session at once.
 */

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
 * Secrets are read from process.env first: it holds the *runtime* value on
 * Vercel, while import.meta.env can be baked in at build time. The ImportMeta
 * fallback keeps `astro dev` working if the dev server ever stops populating
 * process.env.
 */
function readSecret(name: "ADMIN_PASSWORD" | "ADMIN_SESSION_SECRET"): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  const fromImportMeta = meta.env?.[name];
  return fromImportMeta || "";
}

export function adminPassword(): string {
  return readSecret("ADMIN_PASSWORD");
}

/**
 * Whether the admin panel has a password at all. While this is false the login
 * form renders a "not configured" notice and every login attempt is rejected —
 * an unset env var must never mean "empty password is accepted".
 */
export function adminConfigured(): boolean {
  return adminPassword().length > 0;
}

/** Signing key. Defaults to a key *derived* from the password, never to a constant. */
async function sessionSecret(): Promise<Uint8Array> {
  const explicit = readSecret("ADMIN_SESSION_SECRET");
  const password = adminPassword();
  const material = explicit || password;
  if (!material) throw new Error("ADMIN_PASSWORD is not set");
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

/**
 * Compares the candidate against ADMIN_PASSWORD. Both sides are HMAC'd first so
 * the comparison is constant-time regardless of length — a plain `===` on
 * strings leaks length and prefix information.
 */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const password = adminPassword();
  if (!password) return false;
  if (!candidate) return false;
  const key = new TextEncoder().encode("baulko-bulletin/password-compare/v1");
  const [a, b] = await Promise.all([hmac(key, candidate), hmac(key, password)]);
  return timingSafeEqual(a, b);
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
