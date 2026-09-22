/**
 * The response headers that harden every page.
 *
 * Until now only `/admin` carried any of these. The public site — the part of
 * the application a stranger can actually reach — answered with nothing but
 * what the framework set, so it had no clickjacking protection, no content-type
 * sniffing protection, and no policy at all about what a stored page is allowed
 * to load.
 *
 * A `Content-Security-Policy` is the interesting one, and the honest summary of
 * what this one buys: scripts can only come from this origin and Cloudflare's
 * Turnstile, forms can only post back here, nothing can be embedded, and the
 * document cannot be framed. Its weakness is `'unsafe-inline'` in `script-src`,
 * which is needed because the theme is applied by an inline script in the head
 * — without it, dark-mode readers get a white flash on every navigation. So
 * this is not a defence against injected inline script; that is what
 * `lib/sanitize-html.ts` is for. It is a defence against *everything else*: an
 * injected `<script src="https://…">`, a form posting a password elsewhere, a
 * `base` tag rewriting every relative URL on the page, a plugin embed.
 *
 * `img-src` and `media-src` are deliberately loose (`https:`), because an editor
 * can paste a picture URL from anywhere into a cover or an article body and a
 * strict origin list would silently break those articles. Loosening the two
 * directives that cannot execute anything is the right side of that trade;
 * `script-src` stays tight.
 *
 * `connect-src` is the one directive that cannot be loose, because it is where
 * `fetch` and XHR go and so where anything injected would send what it read —
 * and it is also where the issue reader's own download lands, since the PDF
 * lives on ImageKit's CDN and not on this origin. Naming that one host is the
 * difference between a reader that opens an issue and one that refuses a file
 * which plainly exists; see `readerOrigin` below.
 *
 * The policy has to name everything the site actually loads. If a future change
 * adds an embedding, a font host or an API call from the browser, it belongs in
 * the lists below — otherwise it will work in `astro dev` and fail in
 * production, which is the worst way to find out.
 */

/** Turnstile's widget and its verification traffic. */
const TURNSTILE = "https://challenges.cloudflare.com";

/** Google Fonts: the stylesheet is imported from `global.css`, the files come from a second host. */
const FONTS_CSS = "https://fonts.googleapis.com";
const FONTS_FILES = "https://fonts.gstatic.com";

/** ImageKit, where uploads go from the admin panel's browser. */
const IMAGEKIT = ["https://api.imagekit.io", "https://upload.imagekit.io"];

/** Where ImageKit serves the files it holds, when no endpoint says otherwise. */
const IMAGEKIT_CDN = "https://ik.imagekit.io";

/**
 * The origin the issue reader fetches a PDF from.
 *
 * The reader downloads the whole file with `fetch` before pdf.js sees it (see
 * `components/ui/PdfViewer.tsx`), and `connect-src` is what judges that request
 * — not `media-src`, which is why a loose `media-src` never covered it. Without
 * the host named here the reader answers "Could not open this issue" for every
 * issue on the site, while the same URL opened by hand works perfectly, because
 * a top-level navigation is not a `connect-src` request at all.
 *
 * Read from `IMAGEKIT_URL_ENDPOINT` rather than hardcoded, so an endpoint moved
 * to a custom domain moves the policy with it. A value that is empty or not a
 * URL falls back to ImageKit's own CDN, which is what the panel uploads to when
 * nothing has been configured.
 */
export function readerOrigin(urlEndpoint?: string): string {
  if (!urlEndpoint) return IMAGEKIT_CDN;
  try {
    return new URL(urlEndpoint).origin;
  } catch {
    return IMAGEKIT_CDN;
  }
}

export interface PolicyOptions {
  /** Adds the origins the admin's own uploader needs. */
  admin?: boolean;
  /**
   * The origin the issue reader downloads from — pass `readerOrigin(…)` of the
   * configured `IMAGEKIT_URL_ENDPOINT`. Passed in rather than read here so this
   * stays a pure function of its options, and so a test does not depend on what
   * happens to be configured on the machine running it.
   */
  reader?: string;
  /**
   * Relaxes the two directives the development server itself needs: Vite's HMR
   * channel is a websocket, and its dev tooling is allowed `eval`. Nothing else
   * changes, so the policy a page is developed against is still the policy it
   * ships with — the alternative, no policy in dev, is how a CSP that breaks
   * production gets written in the first place.
   */
  dev?: boolean;
  /**
   * Whether the request arrived over https. Decides HSTS and
   * `upgrade-insecure-requests`: promising https on a plain http dev server
   * would pin `localhost` to https in that browser for good, and rewrite every
   * request to a port nothing is listening on.
   */
  secure?: boolean;
}

/**
 * The policy itself, as a single header value. Kept as data rather than a
 * string literal so it can be asserted in tests directive by directive.
 */
export function contentSecurityPolicy(options: PolicyOptions = {}): string {
  const connect = [
    "'self'",
    TURNSTILE,
    // The reader's own download of an issue, on every page that shows one.
    options.reader || IMAGEKIT_CDN,
    ...(options.admin ? IMAGEKIT : []),
    ...(options.dev ? ["ws:"] : []),
  ];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // The inline script in the head that avoids a theme flash, and the inline
    // `<style>` blocks Astro emits. See the note above about the trade.
    ["script-src", ["'self'", "'unsafe-inline'", TURNSTILE, ...(options.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'", FONTS_CSS]],
    ["font-src", ["'self'", FONTS_FILES, "data:"]],
    // Loose on purpose: covers and article bodies may point anywhere, and
    // neither can run code.
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["media-src", ["'self'", "https:"]],
    ["connect-src", connect],
    ["frame-src", [TURNSTILE]],
    // pdf.js spawns its worker from /pdfjs/<version>/ and builds blob URLs for
    // the rendered pages.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  // Only over https. The directive tells the browser to fetch *every* http
  // subresource over https instead, same-origin ones included — which on a plain
  // `astro dev` server, or a phone pointed at the laptop's LAN address, means
  // fetching from a port nothing is listening on. Localhost itself is exempt
  // because browsers treat it as trustworthy; `--host` is not.
  if (options.secure) directives.push(["upgrade-insecure-requests", []]);
  return directives.map(([name, values]) => [name, ...values].join(" ")).join("; ");
}

/** The headers take the same options as the policy — `secure` decides HSTS as well. */
export type HeaderOptions = PolicyOptions;

/**
 * The headers every response carries.
 *
 * `Content-Security-Policy-Report-Only` is not used: there is no collector to
 * report *to*, and a policy nobody reads is worse than no policy, because it
 * looks like protection.
 */
export function securityHeaders(options: HeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(options),
    // The legacy half of `frame-ancestors 'none'`, for engines that predate it.
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // Nothing here uses a camera, a microphone, a location or a payment API.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  };
  // Two years, subdomains included: the site and its API are the same origin,
  // so there is nothing an http visit could still be needed for.
  if (options.secure) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return headers;
}

/** Applies the headers above to an existing `Headers`, leaving anything already set. */
export function applySecurityHeaders(headers: Headers, options: HeaderOptions = {}): Headers {
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}
