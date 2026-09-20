/**
 * Server-side environment variables, read the one way that works everywhere.
 *
 * There are three runtimes to satisfy, and the shape of this file is the shape
 * of that problem.
 *
 * On Vercel, `process.env` holds the values configured in the dashboard: that
 * is the real source, read at request time, and it is checked first.
 *
 * During `astro dev`, `process.env` is *not* filled from `.env` — but Vite
 * replaces `import.meta.env` with a stand-in that throws the moment it is
 * touched as an object, reaching for any property:
 *
 *   Error: [module runner] Dynamic access of "import.meta.env" is not supported.
 *
 * That is what makes the fallback below so fussy. Every name has to be written
 * out, so each read is the static `import.meta.env.NAME` Vite can substitute
 * rather than the `import.meta.env[name]` it refuses — and the refusal is at
 * runtime, so a dictionary lookup works in a production build and 500s the dev
 * server on every page. Which is the worst way for a difference to exist.
 *
 * Under plain Node — the unit tests, `scripts/hash-password.mjs`, anything that
 * imports one of these modules — `import.meta.env` is not defined at all, so
 * the object is not there to read. `typeof` looks at the reference without
 * following it, which is why the guard is spelled that way and not as a
 * property access.
 *
 * A production build is the fourth case, and the reason this is not simply
 * `import.meta.env`: at build time those reads are replaced by whatever the
 * variable held when the build ran, which is usually nothing. Reading
 * `process.env` first means a deployed function sees the values it was
 * configured with, not the values that happened to exist on the build machine.
 */

/** Every server-side variable this application reads. */
export type ServerEnvName =
  | "DATABASE_URL"
  | "ADMIN_PASSWORD_HASH"
  | "ADMIN_SESSION_SECRET"
  | "IMAGEKIT_PRIVATE_KEY"
  | "IMAGEKIT_PUBLIC_KEY"
  | "IMAGEKIT_URL_ENDPOINT"
  | "IMAGEKIT_UPLOAD_ENDPOINT"
  | "RESEND_API_KEY"
  | "RESEND_EMAIL_FROM"
  | "TURNSTILE_SECRET"
  | "TURNSTILE_HOSTNAMES";

/**
 * The values from `.env`, one named property at a time.
 *
 * Written out rather than looped over: see the note above about Vite refusing a
 * dynamic read. Adding a variable means adding it here, and the type makes that
 * unavoidable rather than optional.
 */
function envFileValues(): Partial<Record<ServerEnvName, string>> {
  // `typeof` touches the reference, not a property, so it is safe in every one
  // of the runtimes described above — including the one where this is simply
  // `"undefined"`.
  if (typeof import.meta.env !== "object") return {};
  return {
    DATABASE_URL: import.meta.env.DATABASE_URL,
    ADMIN_PASSWORD_HASH: import.meta.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: import.meta.env.ADMIN_SESSION_SECRET,
    IMAGEKIT_PRIVATE_KEY: import.meta.env.IMAGEKIT_PRIVATE_KEY,
    IMAGEKIT_PUBLIC_KEY: import.meta.env.IMAGEKIT_PUBLIC_KEY,
    IMAGEKIT_URL_ENDPOINT: import.meta.env.IMAGEKIT_URL_ENDPOINT,
    IMAGEKIT_UPLOAD_ENDPOINT: import.meta.env.IMAGEKIT_UPLOAD_ENDPOINT,
    RESEND_API_KEY: import.meta.env.RESEND_API_KEY,
    RESEND_EMAIL_FROM: import.meta.env.RESEND_EMAIL_FROM,
    TURNSTILE_SECRET: import.meta.env.TURNSTILE_SECRET,
    TURNSTILE_HOSTNAMES: import.meta.env.TURNSTILE_HOSTNAMES,
  };
}

/**
 * A server-side variable, or `""` when it is not set anywhere. Never throws:
 * a missing variable is a configuration problem the caller reports in its own
 * words ("RESEND_API_KEY is not set"), not an exception to catch.
 */
export function readEnv(name: ServerEnvName): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  return envFileValues()[name] || "";
}

/** The same, with the surrounding whitespace removed — for values pasted into a dashboard. */
export function readEnvTrimmed(name: ServerEnvName): string {
  return readEnv(name).trim();
}

/**
 * Whether this is the development server, as opposed to a build or a deployed
 * function. `NODE_ENV` is what Vite and the platform both set, and it is read
 * from `process.env` directly because it is not one of the variables above that
 * `.env` is allowed to fill.
 *
 * Deliberately a positive test: anything unrecognised — unset, empty, a typo —
 * counts as production, so the only way to get the development allowances is to
 * be a `astro dev` process. The other direction would hand a production
 * response `'unsafe-eval'` because a variable was missing.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
