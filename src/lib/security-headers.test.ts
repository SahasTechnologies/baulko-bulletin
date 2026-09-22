import { test } from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, contentSecurityPolicy, readerOrigin, securityHeaders } from "./security-headers.ts";

/** Named here so the assertions read as intent rather than as a URL. */
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

/** Read one directive out of a policy string, as the browser would. */
function directive(policy: string, name: string): string[] | null {
  for (const part of policy.split(";")) {
    const [key, ...values] = part.trim().split(/\s+/);
    if (key === name) return values;
  }
  return null;
}

test("contentSecurityPolicy locks down the things that can navigate or execute", () => {
  const policy = contentSecurityPolicy();
  assert.deepEqual(directive(policy, "default-src"), ["'self'"]);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(policy, "form-action"), ["'self'"]);
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
  const script = directive(policy, "script-src") ?? [];
  assert.ok(script.includes("'self'"));
  assert.ok(script.includes("https://challenges.cloudflare.com"));
  assert.ok(!script.includes("'unsafe-eval'"));
  assert.ok(!script.some((value) => value.includes("imagekit")));
});

test("contentSecurityPolicy names every host the site actually loads", () => {
  const policy = contentSecurityPolicy();
  assert.ok(directive(policy, "style-src")?.includes("https://fonts.googleapis.com"));
  assert.ok(directive(policy, "font-src")?.includes("https://fonts.gstatic.com"));
  assert.ok(directive(policy, "frame-src")?.includes("https://challenges.cloudflare.com"));
  assert.ok(directive(policy, "worker-src")?.includes("blob:"));
  // Loose on purpose — an editor can point a cover or an article at any host.
  assert.ok(directive(policy, "img-src")?.includes("https:"));
});

test("contentSecurityPolicy only lets the admin talk to ImageKit", () => {
  assert.ok(!(directive(contentSecurityPolicy(), "connect-src") ?? []).includes("https://upload.imagekit.io"));
  const admin = directive(contentSecurityPolicy({ admin: true }), "connect-src") ?? [];
  assert.ok(admin.includes("https://upload.imagekit.io"));
  assert.ok(admin.includes("https://api.imagekit.io"));
  assert.ok(admin.includes("'self'"));
});

test("contentSecurityPolicy lets the reader fetch an issue, on every page", () => {
  // The reader downloads the PDF itself, so this is a `connect-src` host. Left
  // out, every issue fails to open in the reader while its own URL works when
  // opened by hand — which is the bug this directive is here to prevent.
  for (const admin of [false, true]) {
    const connect = directive(contentSecurityPolicy({ admin }), "connect-src") ?? [];
    assert.ok(connect.includes("https://ik.imagekit.io"), `admin: ${admin}`);
  }
});

test("readerOrigin follows the configured endpoint, and falls back to ImageKit's CDN", () => {
  // The origin, not the URL: a policy names hosts, and an endpoint that carries
  // an account path must not turn into one.
  assert.equal(readerOrigin("https://ik.imagekit.io/sahas"), "https://ik.imagekit.io");
  assert.equal(readerOrigin("https://media.example.com/bulletin/"), "https://media.example.com");
  // A custom endpoint moves the policy with it, rather than leaving it pointing
  // at a host nothing is served from any more.
  const connect =
    directive(contentSecurityPolicy({ reader: readerOrigin("https://media.example.com/x") }), "connect-src") ?? [];
  assert.ok(connect.includes("https://media.example.com"));
  // Unset, empty, or nonsense is not a reason to break the reader.
  for (const value of [undefined, "", "   ", "not a url"]) {
    assert.equal(readerOrigin(value), "https://ik.imagekit.io", JSON.stringify(value));
  }
});

test("contentSecurityPolicy emits each directive once, as a single header value", () => {
  const policy = contentSecurityPolicy({ secure: true });
  const names = policy.split(";").map((part) => part.trim().split(/\s+/)[0]);
  assert.equal(new Set(names).size, names.length);
  assert.ok(!policy.includes("\n"));
  assert.ok(policy.includes("upgrade-insecure-requests"));
});

test("contentSecurityPolicy only upgrades insecure requests over https", () => {
  // On a plain http dev server, or a phone pointed at a laptop's LAN address,
  // upgrading would rewrite every subresource to a port nothing is listening on.
  assert.ok(!contentSecurityPolicy().includes("upgrade-insecure-requests"));
  assert.ok(contentSecurityPolicy({ secure: true }).includes("upgrade-insecure-requests"));
});

test("contentSecurityPolicy adds only what the dev server needs, and adds it only in dev", () => {
  const production = contentSecurityPolicy();
  assert.ok(!(directive(production, "connect-src") ?? []).includes("ws:"));
  assert.ok(!(directive(production, "script-src") ?? []).includes("'unsafe-eval'"));

  const dev = contentSecurityPolicy({ dev: true });
  assert.ok(directive(dev, "connect-src")?.includes("ws:"));
  assert.ok(directive(dev, "script-src")?.includes("'unsafe-eval'"));
  // Everything that matters is unchanged: the dev server is not a way to get a
  // policy that would be unsafe to ship.
  for (const name of ["default-src", "object-src", "base-uri", "form-action", "frame-ancestors"]) {
    assert.deepEqual(directive(dev, name), directive(production, name), name);
  }
  assert.deepEqual(directive(dev, "frame-src"), [TURNSTILE_HOST]);
});

test("securityHeaders always carries the sniffing, framing and referrer guards", () => {
  const headers = securityHeaders();
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.match(headers["Permissions-Policy"] ?? "", /camera=\(\)/);
  assert.match(headers["Permissions-Policy"] ?? "", /geolocation=\(\)/);
});

test("securityHeaders only promises HSTS over https", () => {
  assert.equal(securityHeaders()["Strict-Transport-Security"], undefined);
  const secure = securityHeaders({ secure: true })["Strict-Transport-Security"];
  assert.match(secure ?? "", /^max-age=\d{8}/);
  assert.match(secure ?? "", /includeSubDomains/);
});

test("applySecurityHeaders leaves a header that is already set", () => {
  const headers = new Headers({ "X-Frame-Options": "SAMEORIGIN" });
  applySecurityHeaders(headers, { secure: true });
  assert.equal(headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok(headers.get("Content-Security-Policy"));
});
