/**
 * Stored HTML, made safe to render.
 *
 * Article bodies, the three fixed pages and the footer are written in the panel
 * as raw HTML and rendered with `set:html`, which means whatever is stored there
 * runs as the site. One paste from a compromised page — `<script>`,
 * `<img onerror=…>`, `<a href="javascript:…">` — would then execute for every
 * visitor, and nothing between the editor and the database stops it.
 *
 * So the markup is filtered on the way in *and* on the way out. On the way in
 * it is the fix; on the way out it is the belt to that pair of braces, because
 * rows written before this existed are still in the database and a future
 * importer or admin tool might not go through the panel at all.
 *
 * The rule is an allowlist, not a blocklist. Anything not named below is
 * removed — an element it does not recognise keeps its children but loses its
 * own tag, and a dangerous element (`script`, `style`, `iframe`, `object`,
 * `form`, `svg`'s scripting cousins) loses its contents too. That is the
 * opposite trade-off to a blocklist, which is always one forgotten tag or one
 * new browser feature behind.
 *
 * What it deliberately will not do: it is not a full HTML5 parser, so it does
 * not re-serialise the tree the way a browser will. It treats the source as
 * text, keeps what is allowed, drops what is not, and closes any element left
 * open at the end. In practice that is enough — the same document handed to a
 * browser is already being re-parsed leniently — while keeping the transform
 * byte-for-byte predictable, which is what the tests rely on.
 *
 * `style` attributes are dropped on purpose. Inline CSS can cover the page,
 * hide its own origin, or fetch a URL of the attacker's choosing, and none of
 * that is prevented by anything else here. Class names, which is what the
 * site's own markup uses, survive.
 */

/** The one place URL schemes are judged. Anything else — `javascript:`, `data:`, `vbscript:` — fails. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Attributes that hold a URL, and so have to pass the scheme check. */
const URL_ATTRIBUTES = new Set(["href", "src", "poster", "cite", "action", "formaction", "background", "longdesc"]);

/** Every element that survives a save, with the attributes allowed on it beyond the global ones. */
const ALLOWED: Record<string, readonly string[]> = {
  // Structure and text.
  p: [],
  div: [],
  span: [],
  section: [],
  article: [],
  aside: [],
  header: [],
  footer: [],
  main: [],
  nav: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  br: [],
  hr: [],
  blockquote: ["cite"],
  pre: [],
  code: [],
  kbd: [],
  samp: [],
  var: [],
  small: [],
  sub: [],
  sup: [],
  mark: [],
  abbr: [],
  cite: [],
  q: ["cite"],
  time: ["datetime"],
  b: [],
  i: [],
  u: [],
  s: [],
  strong: [],
  em: [],
  del: ["cite", "datetime"],
  ins: ["cite", "datetime"],
  details: ["open"],
  summary: [],

  // Lists.
  ul: [],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  dl: [],
  dt: [],
  dd: [],

  // Links and media.
  a: ["href", "target", "rel", "download"],
  img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
  figure: [],
  figcaption: [],
  picture: [],
  source: ["src", "srcset", "sizes", "type", "media"],
  track: ["src", "kind", "srclang", "label", "default"],
  audio: ["src", "controls", "loop", "muted", "preload"],
  video: ["src", "poster", "controls", "loop", "muted", "preload", "playsinline", "width", "height"],

  // Tables.
  table: ["summary", "width", "border", "cellpadding", "cellspacing"],
  caption: [],
  colgroup: ["span"],
  col: ["span", "width"],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  th: ["colspan", "rowspan", "scope", "headers", "abbr", "align", "valign"],
  td: ["colspan", "rowspan", "scope", "headers", "align", "valign"],

  // Inline SVG, minus anything that can script, link or embed.
  svg: ["viewbox", "xmlns", "width", "height", "fill", "stroke", "role"],
  g: ["fill", "stroke", "stroke-width", "opacity", "transform"],
  path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "opacity"],
  circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity"],
  ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity"],
  rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "opacity"],
  line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity"],
  polyline: ["points", "fill", "stroke", "stroke-width", "opacity"],
  polygon: ["points", "fill", "stroke", "stroke-width", "opacity"],
  text: ["x", "y", "dx", "dy", "fill", "font-size", "text-anchor", "opacity"],
  defs: [],
  lineargradient: ["id", "x1", "y1", "x2", "y2", "gradientunits"],
  radialgradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientunits"],
  stop: ["offset", "stop-color", "stop-opacity"],
};

/** Allowed on any element: presentational, plus the ARIA and data hooks the site uses. */
const GLOBAL_ATTRIBUTES = new Set(["class", "id", "title", "dir", "lang", "role", "hidden"]);

/**
 * Removed with their contents. Every one of these either executes, navigates,
 * restyles the whole document, or hands the browser a new parser to run.
 */
const DISCARDED_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "label",
  "fieldset",
  "legend",
  "base",
  "link",
  "meta",
  "head",
  "title",
  "noscript",
  "template",
  "canvas",
  "dialog",
  "portal",
  "foreignobject",
  "use",
]);

/** Elements that never take a closing tag. */
const VOID_ELEMENTS = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Elements that close themselves when another starts, so `<li>a<li>b` does not
 * nest. Without this the end of the document would carry a wall of stray tags,
 * which a browser discards but a reader of the stored copy would see.
 */
const AUTO_CLOSE: Record<string, ReadonlySet<string>> = {
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  p: new Set(["p"]),
  tr: new Set(["tr"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  option: new Set(["option"]),
};

export interface SanitizeReport {
  /** The cleaned markup. */
  html: string;
  /** Names of the elements that were dropped or unwrapped, in the order met. */
  removed: string[];
}

/**
 * Decodes the character references that matter for a URL check.
 *
 * A scheme can be spelled `javascript&#58;`, `&#106;avascript:` or with a tab or
 * newline in the middle, and the browser decodes all of it before it decides
 * what the URL is. The value itself is emitted untouched — the stored form may
 * legitimately hold `&amp;` — so this is only ever used to *judge* it.
 */
function decodeForCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|colon|tab|newline|sol|bsol|num|period|quest|equals|semi);/gi, (entity) => {
      const table: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        colon: ":",
        tab: "\t",
        newline: "\n",
        sol: "/",
        bsol: "\\",
        num: "#",
        period: ".",
        quest: "?",
        equals: "=",
        semi: ";",
      };
      return table[entity.slice(1, -1).toLowerCase()] ?? "";
    });
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Whether one URL may be kept.
 *
 * Judged after decoding and after stripping the control characters browsers
 * ignore, because `java\tscript:` is a scheme to every engine that opens links.
 * Relative references — `/cover.png`, `#notes`, `../about` — are always fine:
 * they cannot leave the origin.
 */
export function isSafeUrl(value: string): boolean {
  const decoded = decodeForCheck(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020\u007f]+/g, "")
    .trim();
  if (!decoded) return false;
  if (/^[/#?]/.test(decoded)) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(decoded);
  if (!scheme) return true;
  return ALLOWED_SCHEMES.has(`${scheme[1].toLowerCase()}:`);
}

/** `srcset` is a list of URLs with optional descriptors; all of them have to pass. */
function isSafeSrcset(value: string): boolean {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return false;
  return entries.every((entry) => isSafeUrl(entry.split(/\s+/)[0] ?? ""));
}

/** Attribute names that are always dropped, whatever else allows them. */
function isForbiddenAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("on") || lower === "style" || lower === "srcdoc" || lower === "formaction" || lower === "xlink:href";
}

function attributeAllowed(tag: string, name: string): boolean {
  const lower = name.toLowerCase();
  if (isForbiddenAttribute(lower)) return false;
  if (GLOBAL_ATTRIBUTES.has(lower)) return true;
  if (lower.startsWith("aria-") || lower.startsWith("data-")) return true;
  return (ALLOWED[tag] ?? []).includes(lower);
}

/** The only three characters that could end an attribute early. */
const ATTRIBUTE_ESCAPES: Record<string, string> = { '"': "&quot;", "<": "&lt;", ">": "&gt;" };

/** Escapes a run of text that has to be shown literally rather than parsed. */
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The index just past the `>` that ends a tag, skipping any `>` inside a quoted
 * attribute value. Returns -1 when the tag never closes — the sign that the
 * editor is halfway through typing and the rest is text, not markup.
 */
function findTagEnd(source: string, from: number): number {
  let quote = "";
  for (let index = from; index < source.length; index++) {
    const char = source[index] as string;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

interface Attribute {
  name: string;
  /** Raw value as written, quotes removed; `null` for a bare attribute. */
  value: string | null;
}

/** Reads the attributes out of `<tag …>`, starting after the name. */
function parseAttributes(source: string, from: number, end: number): Attribute[] {
  const attributes: Attribute[] = [];
  let index = from;

  while (index < end) {
    while (index < end && /\s/.test(source[index] as string)) index++;
    if (index >= end || source[index] === "/") break;

    const nameMatch = /^[^\s=/>]+/.exec(source.slice(index, end));
    if (!nameMatch) {
      index++;
      continue;
    }
    const name = nameMatch[0];
    index += name.length;

    let value: string | null = null;
    let cursor = index;
    while (cursor < end && /\s/.test(source[cursor] as string)) cursor++;
    if (source[cursor] === "=") {
      cursor++;
      while (cursor < end && /\s/.test(source[cursor] as string)) cursor++;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, cursor + 1);
        const stop = close < 0 || close > end ? end : close;
        value = source.slice(cursor + 1, stop);
        index = stop + 1;
      } else {
        const bare = /^[^\s>]*/.exec(source.slice(cursor, end));
        value = bare ? bare[0] : "";
        index = cursor + value.length;
      }
    }

    attributes.push({ name, value });
  }

  return attributes;
}

/** Rewrites one tag's attributes to the allowed set, or to nothing. */
function rebuildAttributes(tag: string, attributes: Attribute[], removed: string[]): string {
  const kept: string[] = [];

  for (const attribute of attributes) {
    if (!attributeAllowed(tag, attribute.name)) {
      removed.push(`${tag}[${attribute.name.toLowerCase()}]`);
      continue;
    }
    if (attribute.value === null) {
      kept.push(attribute.name);
      continue;
    }
    const name = attribute.name.toLowerCase();
    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) {
      removed.push(`${tag}[${name}]`);
      continue;
    }
    if (name === "srcset" && !isSafeSrcset(attribute.value)) {
      removed.push(`${tag}[srcset]`);
      continue;
    }
    if (name === "target" && !/^_(blank|self)$/i.test(attribute.value.trim())) {
      removed.push(`${tag}[target]`);
      continue;
    }
    // Re-quoted with double quotes, so a value that arrived in single quotes
    // cannot carry the quote that would end the attribute. `&` is left alone:
    // `&amp;` in a stored URL is meant to stay as it is.
    const escaped = attribute.value.replace(/["<>]/g, (char) => ATTRIBUTE_ESCAPES[char] as string);
    kept.push(`${attribute.name}="${escaped}"`);
  }

  // A link that opens a new tab needs the rel that stops the new document from
  // reaching back through `window.opener`, whether or not the editor wrote one.
  if (tag === "a" && kept.some((attribute) => /^target="_blank"/i.test(attribute))) {
    if (!kept.some((attribute) => /^rel=/i.test(attribute))) kept.push('rel="noopener noreferrer"');
  }

  return kept.length ? ` ${kept.join(" ")}` : "";
}

/** Where the contents of a discarded element stop. */
function findDiscardEnd(source: string, from: number, name: string): number {
  const pattern = new RegExp(`</${name}(?=[\\s/>])|</${name}$`, "i");
  const match = pattern.exec(source.slice(from));
  if (!match) return source.length;
  const closeEnd = findTagEnd(source, from + match.index);
  return closeEnd < 0 ? source.length : closeEnd + 1;
}

/**
 * Filters stored markup down to what it is safe to render.
 *
 * The output is balanced — every element left open is closed at the end — so it
 * can be embedded anywhere without spilling out of its container.
 */
export function sanitizeHtmlWithReport(input: string | null | undefined): SanitizeReport {
  const removed: string[] = [];
  if (!input) return { html: "", removed };

  const output: string[] = [];
  const openStack: string[] = [];
  let index = 0;

  const closeDownTo = (name: string): void => {
    const at = openStack.lastIndexOf(name);
    if (at < 0) return;
    for (let i = openStack.length - 1; i >= at; i--) {
      output.push(`</${openStack[i] as string}>`);
      openStack.pop();
    }
  };

  while (index < input.length) {
    const open = input.indexOf("<", index);
    if (open < 0) {
      output.push(input.slice(index));
      break;
    }

    output.push(input.slice(index, open));

    // Comments and declarations carry nothing renderable, and a conditional
    // comment is a script vector in old engines.
    if (input.startsWith("<!--", open)) {
      const end = input.indexOf("-->", open + 4);
      index = end < 0 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<!", open) || input.startsWith("<?", open)) {
      const end = input.indexOf(">", open + 1);
      index = end < 0 ? input.length : end + 1;
      continue;
    }

    const nameMatch = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(input.slice(open));
    if (!nameMatch) {
      // A `<` that opens nothing — "5 < 6" in a caption. Shown, not parsed.
      output.push("&lt;");
      index = open + 1;
      continue;
    }

    const closing = input[open + 1] === "/";
    const name = nameMatch[1]!.toLowerCase();
    const tagIdentLength = (closing ? 2 : 1) + nameMatch[1]!.length;
    const end = findTagEnd(input, open);

    if (end < 0) {
      // The tag never closes: everything from here is text the editor is in the
      // middle of writing, so it is shown rather than swallowed.
      output.push(escapeText(input.slice(open)));
      index = input.length;
      break;
    }

    index = end + 1;

    if (closing) {
      if (ALLOWED[name] && !VOID_ELEMENTS.has(name) && openStack.includes(name)) closeDownTo(name);
      continue;
    }

    if (DISCARDED_CONTENT.has(name)) {
      removed.push(name);
      index = findDiscardEnd(input, index, name);
      continue;
    }

    if (!ALLOWED[name]) {
      // Unwrapped, not discarded: an unknown element's text is still worth
      // reading, and losing it would silently shorten an article.
      removed.push(name);
      continue;
    }

    const autoClose = AUTO_CLOSE[name];
    if (autoClose) {
      for (let i = openStack.length - 1; i >= 0; i--) {
        const openName = openStack[i] as string;
        if (!autoClose.has(openName)) break;
        output.push(`</${openName}>`);
        openStack.pop();
      }
    }

    const attributes = parseAttributes(input, open + 1 + tagIdentLength, end);
    const selfClosing = !VOID_ELEMENTS.has(name) && /\/\s*$/.test(input.slice(open, end));

    if (VOID_ELEMENTS.has(name) || selfClosing) {
      output.push(`<${name}${rebuildAttributes(name, attributes, removed)}${name === "svg" || !VOID_ELEMENTS.has(name) ? " /" : ""}>`);
      continue;
    }

    output.push(`<${name}${rebuildAttributes(name, attributes, removed)}>`);
    openStack.push(name);
  }

  // Anything still open — a paragraph the editor never closed — is closed here,
  // so the fragment cannot escape into the page around it.
  while (openStack.length) output.push(`</${openStack.pop() as string}>`);

  return { html: output.join(""), removed };
}

/** The cleaned markup alone. */
export function sanitizeHtml(input: string | null | undefined): string {
  return sanitizeHtmlWithReport(input).html;
}
