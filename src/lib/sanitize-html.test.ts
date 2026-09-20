import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeUrl, sanitizeHtml, sanitizeHtmlWithReport } from "./sanitize-html.ts";

test("sanitizeHtml leaves ordinary prose alone", () => {
  assert.equal(sanitizeHtml("Just a sentence about C11."), "Just a sentence about C11.");
  assert.equal(sanitizeHtml(""), "");
  assert.equal(sanitizeHtml(null), "");
  assert.equal(sanitizeHtml(undefined), "");
});

test("sanitizeHtml keeps the markup an article actually uses", () => {
  const html =
    '<p class="lede">Hello <strong>there</strong>.</p><h2>Section</h2><ul><li>One</li><li>Two</li></ul>' +
    '<figure><img src="https://ik.imagekit.io/demo/cover.png" alt="Cover" width="800"><figcaption>Cover</figcaption></figure>' +
    '<blockquote>Words</blockquote><a href="/about" class="link">About</a>';
  assert.equal(sanitizeHtml(html), html);
});

test("sanitizeHtml drops script elements with their contents", () => {
  const report = sanitizeHtmlWithReport('before<script>alert("xss")</script>after');
  assert.equal(report.html, "beforeafter");
  assert.deepEqual(report.removed, ["script"]);
});

test("sanitizeHtml drops every element that can navigate, embed or restyle", () => {
  const html = '<iframe src="https://evil.example"></iframe><object data="x"></object><form action="/x"><input></form><style>body{display:none}</style><p>Kept</p>';
  const report = sanitizeHtmlWithReport(html);
  assert.equal(report.html, "<p>Kept</p>");
  assert.deepEqual(report.removed, ["iframe", "object", "form", "style"]);
});

test("sanitizeHtml strips event handlers and inline styles", () => {
  const report = sanitizeHtmlWithReport('<img src="/cover.png" onerror="steal()" style="position:fixed" class="shadow">');
  assert.equal(report.html, '<img src="/cover.png" class="shadow">');
  assert.deepEqual(report.removed, ["img[onerror]", "img[style]"]);
});

test("sanitizeHtml rejects javascript: and other schemes, however they are spelled", () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="JaVaScRiPt:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="&\u0023x6a;avascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>'), "<a>x</a>");
});

test("sanitizeHtml keeps the URLs that are supposed to work", () => {
  assert.equal(sanitizeHtml('<a href="https://example.com/x">x</a>'), '<a href="https://example.com/x">x</a>');
  assert.equal(sanitizeHtml('<a href="/posts/n-33">x</a>'), '<a href="/posts/n-33">x</a>');
  assert.equal(sanitizeHtml('<a href="#notes">x</a>'), '<a href="#notes">x</a>');
  assert.equal(sanitizeHtml('<a href="mailto:news@example.com">x</a>'), '<a href="mailto:news@example.com">x</a>');
  assert.equal(sanitizeHtml('<a href="tel:+61000000000">x</a>'), '<a href="tel:+61000000000">x</a>');
  assert.equal(sanitizeHtml('<img src="https://cdn.sanity.io/images/demo/cover.jpg">'), '<img src="https://cdn.sanity.io/images/demo/cover.jpg">');
});

test("sanitizeHtml gives new-tab links the rel they need, and refuses other targets", () => {
  assert.equal(
    sanitizeHtml('<a href="https://example.com" target="_blank">x</a>'),
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
  );
  assert.equal(
    sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener">x</a>'),
    '<a href="https://example.com" target="_blank" rel="noopener">x</a>'
  );
  assert.equal(sanitizeHtml('<a href="/x" target="evil">x</a>'), '<a href="/x">x</a>');
});

test("sanitizeHtml validates every entry of a srcset", () => {
  assert.equal(
    sanitizeHtml('<img srcset="/a.png 1x, /b.png 2x" sizes="100vw" alt="A">'),
    '<img srcset="/a.png 1x, /b.png 2x" sizes="100vw" alt="A">'
  );
  assert.equal(sanitizeHtml('<img srcset="/a.png 1x, javascript:alert(1) 2x" alt="A">'), '<img alt="A">');
});

test("sanitizeHtml drops comments and declarations", () => {
  assert.equal(sanitizeHtml("<!-- hidden --><p>ok</p><!DOCTYPE html>"), "<p>ok</p>");
  assert.equal(sanitizeHtml("<!--[if IE]><script>x</script><![endif]-->"), "");
});

test("sanitizeHtml unwraps unknown elements but keeps their text", () => {
  const report = sanitizeHtmlWithReport("<blink>Careful</blink> <marquee>wow</marquee>");
  assert.equal(report.html, "Careful wow");
  assert.deepEqual(report.removed, ["blink", "marquee"]);
});

test("sanitizeHtml balances the markup it is given", () => {
  assert.equal(sanitizeHtml("<strong>bold"), "<strong>bold</strong>");
  assert.equal(sanitizeHtml("<div><p>one<p>two</div>after"), "<div><p>one</p><p>two</p></div>after");
  assert.equal(sanitizeHtml("stray</div>close"), "strayclose");
  assert.equal(sanitizeHtml("<ul><li>one<li>two</ul>"), "<ul><li>one</li><li>two</li></ul>");
});

test("sanitizeHtml shows unfinished markup as text instead of parsing it", () => {
  assert.equal(sanitizeHtml('Before <a href="/unfinished'), 'Before &lt;a href="/unfinished');
  assert.equal(sanitizeHtml("5 < 6 and 7 <8"), "5 &lt; 6 and 7 &lt;8");
});

test("sanitizeHtml respects quotes when looking for the end of a tag", () => {
  // A `>` inside a quoted value does not end the tag, and is escaped on the way
  // out so the attribute cannot be read as two.
  assert.equal(sanitizeHtml('<a title="a > b" href="/x">x</a>'), '<a title="a &gt; b" href="/x">x</a>');
  assert.equal(sanitizeHtml("<p class='a>b'>x</p>"), '<p class="a&gt;b">x</p>');
  assert.equal(sanitizeHtml(`<p class='say "hi"'>x</p>`), '<p class="say &quot;hi&quot;">x</p>');
});

test("sanitizeHtml keeps inline SVG but not its scripting cousins", () => {
  assert.equal(sanitizeHtml('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>'), '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>');
  const report = sanitizeHtmlWithReport('<svg><foreignObject><script>x</script></foreignObject></svg>');
  assert.equal(report.html, "<svg></svg>");
  assert.deepEqual(report.removed, ["foreignobject"]);
});

test("sanitizeHtml keeps aria and data attributes but not arbitrary ones", () => {
  assert.equal(
    sanitizeHtml('<p aria-label="Note" data-x="1" ondblclick="x()" contenteditable="true">x</p>'),
    '<p aria-label="Note" data-x="1">x</p>'
  );
});

test("sanitizeHtml survives a script tag that is never closed", () => {
  const report = sanitizeHtmlWithReport("<p>ok</p><script>while(true){}");
  assert.equal(report.html, "<p>ok</p>");
  assert.deepEqual(report.removed, ["script"]);
});

test("isSafeUrl judges one URL at a time", () => {
  assert.equal(isSafeUrl("https://example.com"), true);
  assert.equal(isSafeUrl("/posts/n-33"), true);
  assert.equal(isSafeUrl("#top"), true);
  assert.equal(isSafeUrl("cover.png"), true);
  assert.equal(isSafeUrl("mailto:a@b.c"), true);
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("  javascript:alert(1)  "), false);
  assert.equal(isSafeUrl(""), false);
});
