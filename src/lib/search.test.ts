import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, searchItems } from "./search.ts";

test("fuzzyScore matches literal terms case-insensitively", () => {
  const score = fuzzyScore("culture", ["East Asian Culture", null]);
  assert.ok(score > 0);
  assert.equal(fuzzyScore("culture", ["science"]), -1);
});

test("fuzzyScore requires every query term, even across different fields", () => {
  assert.ok(fuzzyScore("nature 2025", ["Nature", "Published in 2025"]) >= 0);
  assert.equal(fuzzyScore("nature 2025", ["Nature", "Published in 2024"]), -1);
  assert.equal(fuzzyScore("", ["anything"]), 0);
  assert.equal(fuzzyScore("term", [null, undefined, ""]), -1);
});

test("fuzzyScore accepts nearby characters but rejects distant accidental matches", () => {
  assert.ok(fuzzyScore("scfi", ["Sci-Fi"]) >= 0);
  assert.equal(fuzzyScore("nature", ["n+29: East Asian Culture"]), -1);
});

test("searchItems preserves input order for an empty query", () => {
  const items = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(searchItems(items, "   ", (item) => [String(item.id)]), items);
});

test("searchItems filters and ranks matches without mutating the input", () => {
  const items = [
    { id: "description", title: "Other", description: "A culture story" },
    { id: "title", title: "Culture", description: "Other" },
    { id: "none", title: "Weather", description: "Rain" },
  ];
  const original = items.slice();
  const result = searchItems(items, "culture", (item) => [item.title, item.description]);
  assert.deepEqual(result.map((item) => item.id), ["title", "description"]);
  assert.deepEqual(items, original);
});

test("searchItems keeps equal-score matches stable", () => {
  const items = [
    { id: "first", text: "abc" },
    { id: "second", text: "abc" },
    { id: "third", text: "abc" },
  ];
  assert.deepEqual(searchItems(items, "x", (item) => [item.text]), []);
  assert.deepEqual(searchItems(items, "a", (item) => [item.text]).map((item) => item.id), ["first", "second", "third"]);
});
