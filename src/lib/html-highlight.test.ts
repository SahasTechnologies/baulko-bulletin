import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeHtml } from "./html-highlight.ts";

test("tokenizeHtml keeps ordinary prose as text", () => {
  assert.deepEqual(tokenizeHtml("Hello < world"), [{ text: "Hello < world", kind: "text" }]);
});

test("tokenizeHtml separates tags, attributes, values, and punctuation", () => {
  assert.deepEqual(tokenizeHtml('<a href="/about" aria-label="About">Read</a>'), [
    { text: "<", kind: "punct" },
    { text: "a", kind: "tag" },
    { text: " ", kind: "text" },
    { text: "href", kind: "attr" },
    { text: "=", kind: "punct" },
    { text: '"/about"', kind: "value" },
    { text: " ", kind: "text" },
    { text: "aria-label", kind: "attr" },
    { text: "=", kind: "punct" },
    { text: '"About"', kind: "value" },
    { text: ">", kind: "punct" },
    { text: "Read", kind: "text" },
    { text: "</", kind: "punct" },
    { text: "a", kind: "tag" },
    { text: ">", kind: "punct" },
  ]);
});

test("tokenizeHtml recognizes comments and declarations", () => {
  assert.deepEqual(tokenizeHtml("<!-- note --><!DOCTYPE html>"), [
    { text: "<!-- note -->", kind: "comment" },
    { text: "<!", kind: "punct" },
    { text: "DOCTYPE", kind: "tag" },
    { text: " ", kind: "text" },
    { text: "html", kind: "attr" },
    { text: ">", kind: "punct" },
  ]);
});

test("tokenizeHtml handles self-closing and unquoted attributes", () => {
  assert.deepEqual(tokenizeHtml("<img src=/cover.jpg alt=Cover />"), [
    { text: "<", kind: "punct" },
    { text: "img", kind: "tag" },
    { text: " ", kind: "text" },
    { text: "src", kind: "attr" },
    { text: "=", kind: "punct" },
    { text: "/cover.jpg", kind: "value" },
    { text: " ", kind: "text" },
    { text: "alt", kind: "attr" },
    { text: "=", kind: "punct" },
    { text: "Cover", kind: "value" },
    { text: " ", kind: "text" },
    { text: "/>" , kind: "punct" },
  ]);
});

test("tokenizeHtml safely returns partial tokens for unfinished markup", () => {
  const tokens = tokenizeHtml("Before <a href=\"/unfinished");
  assert.equal(tokens.at(0)?.text, "Before ");
  assert.equal(tokens.at(-1)?.kind, "value");
  assert.equal(tokens.at(-1)?.text, '\"/unfinished');
  assert.deepEqual(tokenizeHtml("<"), [{ text: "<", kind: "text" }]);
});
