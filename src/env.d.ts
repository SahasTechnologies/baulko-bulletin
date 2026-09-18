/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
  /** Password for /admin. Server-side only — never expose as PUBLIC_*. */
  readonly ADMIN_PASSWORD?: string;
  /** Optional HMAC key for admin sessions; defaults to a key derived from the password. */
  readonly ADMIN_SESSION_SECRET?: string;
  /** ImageKit keys used to sign browser uploads from the admin panel. */
  readonly IMAGEKIT_PUBLIC_KEY?: string;
  readonly IMAGEKIT_PRIVATE_KEY?: string;
  readonly IMAGEKIT_URL_ENDPOINT?: string;
  readonly IMAGEKIT_UPLOAD_ENDPOINT?: string;
  readonly RESEND_API_KEY?: string;
  readonly RESEND_EMAIL_FROM?: string;
  readonly TURNSTILE_SECRET?: string;
  readonly TURNSTILE_HOSTNAMES?: string;
  readonly TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** Set by middleware for every request; null when the visitor is not signed in. */
    adminSession: import("@/lib/auth").AdminSession | null;
    /** CSRF token matching `adminSession`, for embedding in admin forms. */
    adminCsrf: string;
    /** False when ADMIN_PASSWORD is unset, so the login page can explain the fix. */
    adminConfigured: boolean;
  }
}
