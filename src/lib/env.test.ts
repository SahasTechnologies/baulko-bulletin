import { test } from "node:test";
import assert from "node:assert/strict";
import { isDevelopment, readEnv, readEnvTrimmed } from "./env.ts";

/**
 * What these can and cannot cover is worth stating: under plain Node there is no
 * `import.meta.env` at all, so the `.env` branch is not exercised here — what is
 * exercised is that its absence is harmless, which is the property the tests,
 * the helper script and any script that imports these modules depend on. The
 * other branch is checked by `astro dev` actually serving a page, which is the
 * only place it can be.
 */
test("readEnv reads process.env when a variable is set there", () => {
  process.env.TURNSTILE_HOSTNAMES = "example.test,www.example.test";
  try {
    assert.equal(readEnv("TURNSTILE_HOSTNAMES"), "example.test,www.example.test");
  } finally {
    delete process.env.TURNSTILE_HOSTNAMES;
  }
});

test("readEnv returns an empty string, rather than throwing, when nothing is set", () => {
  delete process.env.IMAGEKIT_UPLOAD_ENDPOINT;
  assert.equal(readEnv("IMAGEKIT_UPLOAD_ENDPOINT"), "");
  // The whole point: a runtime with no import.meta.env must not explode on the
  // fallback path that every one of these reads goes through.
  assert.equal(typeof import.meta.env, "undefined");
});

test("readEnvTrimmed strips the whitespace a pasted value arrives with", () => {
  process.env.RESEND_EMAIL_FROM = "  Baulko Bulletin <news@example.test>\n";
  try {
    assert.equal(readEnvTrimmed("RESEND_EMAIL_FROM"), "Baulko Bulletin <news@example.test>");
    // ...and readEnv leaves it exactly as it was found.
    assert.equal(readEnv("RESEND_EMAIL_FROM"), "  Baulko Bulletin <news@example.test>\n");
  } finally {
    delete process.env.RESEND_EMAIL_FROM;
  }
});

test("isDevelopment only says yes for a development process", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    assert.equal(isDevelopment(), true);
    for (const value of ["production", "test", "Development", ""]) {
      process.env.NODE_ENV = value;
      assert.equal(isDevelopment(), false, value);
    }
    // Anything unrecognised is treated as production, so a missing variable
    // cannot hand a deployed response the development allowances.
    delete process.env.NODE_ENV;
    assert.equal(isDevelopment(), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("readEnv treats an empty variable as unset", () => {
  process.env.DATABASE_URL = "";
  try {
    assert.equal(readEnv("DATABASE_URL"), "");
  } finally {
    delete process.env.DATABASE_URL;
  }
});
