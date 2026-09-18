import { test } from "node:test";
import assert from "node:assert/strict";
import { croppedCoverUrl, croppedSquareUrl } from "./images.ts";

test("image helpers return null for missing sources", () => {
  assert.equal(croppedCoverUrl(null), null);
  assert.equal(croppedCoverUrl(undefined), null);
  assert.equal(croppedCoverUrl(""), null);
  assert.equal(croppedSquareUrl(null), null);
});

test("croppedCoverUrl appends ImageKit transforms and preserves existing transforms", () => {
  assert.equal(
    croppedCoverUrl("https://ik.imagekit.io/demo/bulletin/cover.jpg"),
    "https://ik.imagekit.io/demo/bulletin/cover.jpg?tr=w-2000%2Ch-1000%2Cfo-auto",
  );
  assert.equal(
    croppedCoverUrl("https://ik.imagekit.io/demo/cover.jpg?tr=q-80"),
    "https://ik.imagekit.io/demo/cover.jpg?tr=q-80%2Cw-2000%2Ch-1000%2Cfo-auto",
  );
});

test("croppedSquareUrl creates the square ImageKit transform", () => {
  assert.equal(
    croppedSquareUrl("https://ik.imagekit.io/demo/puzzle.png?foo=bar"),
    "https://ik.imagekit.io/demo/puzzle.png?foo=bar&tr=w-1000%2Ch-1000%2Cfo-auto",
  );
});

test("Sanity URLs receive equivalent crop parameters", () => {
  const result = new URL(croppedCoverUrl("https://cdn.sanity.io/images/demo/project/cover.jpg")!);
  assert.equal(result.searchParams.get("w"), "2000");
  assert.equal(result.searchParams.get("h"), "1000");
  assert.equal(result.searchParams.get("fit"), "crop");
  assert.equal(result.searchParams.get("auto"), "format");
});

test("unknown and malformed URLs are returned unchanged", () => {
  assert.equal(croppedCoverUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg");
  assert.equal(croppedSquareUrl("not a URL"), "not a URL");
});
