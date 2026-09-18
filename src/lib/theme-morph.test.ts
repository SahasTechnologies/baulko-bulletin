/**
 * The move itself: what the icon is doing at each moment of it.
 *
 * `frameAt` is the only thing standing between the two icons and the animation,
 * and every way it could be wrong is a way that still looks like motion — a
 * shape that never quite arrives, a ray that comes back before it has gone, a
 * rotation that starts halfway round. So this walks the whole move and says what
 * it should be: both ends exact, nothing that runs backwards, and the three
 * things it does happening in the order that makes them legible.
 *
 * Run with `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MOON_PATH, RAYS, SUN_PATH, VIEW, bodyTransform, frameAt, rayTransform } from "./theme-morph.ts";
import { area, bounds, flatten } from "./path-geometry.ts";

/** The move, sampled as finely as a frame at 120Hz would. */
const samples = Array.from({ length: 121 }, (_, at) => frameAt(at / 120));

/** A path's outline as a ring, for measuring what it encloses. */
function ringOf(path: string) {
  return flatten(path, 1)[0];
}

test("both ends of the move are the icons themselves, not an approximation", () => {
  assert.equal(frameAt(0).path, SUN_PATH);
  assert.equal(frameAt(1).path, MOON_PATH);
  assert.equal(frameAt(-1).path, SUN_PATH, "before the start is the start");
  assert.equal(frameAt(2).path, MOON_PATH, "past the end is the end");
});

test("the move begins as the sun and ends as the moon", () => {
  const start = frameAt(0);
  assert.equal(start.rays, 1, "the rays are out");
  assert.equal(start.warmth, 1, "the sun's colours are on top");
  assert.equal(start.turn, 0, "nothing has turned");
  assert.equal(start.scale, 1, "and nothing has shrunk");

  const end = frameAt(1);
  assert.equal(end.rays, 0, "the rays are gone");
  assert.equal(end.warmth, 0, "the moon's colours are on top");
  assert.equal(end.turn, 360, "the shape has turned once");
  assert.equal(end.scale, 1, "and come back to its own size");
});

test("nothing about the move runs backwards", () => {
  for (let at = 1; at < samples.length; at++) {
    const was = samples[at - 1];
    const now = samples[at];
    assert.ok(now.rays <= was.rays + 1e-9, `the rays grew again at ${at}`);
    assert.ok(now.warmth <= was.warmth + 1e-9, `the warmth came back at ${at}`);
    assert.ok(now.turn >= was.turn - 1e-9, `the turn went backwards at ${at}`);
  }
});

test("the rays are gone before the shape has finished changing", () => {
  // The sun should stand alone for a moment as a bare disc: that is what makes
  // the retracting read as a stage rather than as noise over the morph.
  const half = frameAt(0.5);
  assert.equal(half.rays, 0, "the rays are still out halfway through");
  const ringAtHalf = ringOf(half.path);
  assert.ok(area(ringAtHalf) > 0, "the shape is something, not nothing");

  // And the first tenth is the disc holding still while the rays retract.
  const early = ringOf(frameAt(0.1).path);
  assert.ok(Math.abs(area(early) - area(ringOf(SUN_PATH))) < 1, "the disc moved before the rays were gone");
});

test("the shape between the two is neither of them, and grows into the moon", () => {
  const disc = area(ringOf(SUN_PATH));
  const moon = area(ringOf(MOON_PATH));
  let middle = 0;
  for (const sample of samples) {
    const enclosed = area(ringOf(sample.path));
    assert.ok(enclosed > disc - 1, `a frame shrank inside the disc: ${enclosed}`);
    assert.ok(enclosed < moon + 1, `a frame spilled past the moon: ${enclosed}`);
    if (enclosed > disc + 1000 && enclosed < moon - 1000) middle++;
  }
  assert.ok(middle > 20, `only ${middle} frames were between the two shapes`);
});

test("the whole move happens inside the icon's own box", () => {
  for (const sample of samples) {
    const [minX, minY, maxX, maxY] = bounds(ringOf(sample.path));
    assert.ok(minX > -1 && minY > -1 && maxX < VIEW + 1 && maxY < VIEW + 1, `escaped at ${sample.turn}`);
    assert.ok(maxX - minX > 100, "the outline collapsed to nothing");
  }
});

test("the shape dips and comes back, and turns about its own middle", () => {
  const dip = Math.min(...samples.map((sample) => sample.scale));
  assert.ok(dip < 0.97 && dip > 0.9, `the dip was ${dip}`);
  assert.equal(frameAt(0.5).scale, Math.min(...samples.map((frame) => frame.scale)));

  const turn = bodyTransform(frameAt(0.5));
  assert.match(turn, /rotate\(180 256 256\)/, `not a turn about the middle: ${turn}`);
  assert.equal(bodyTransform(frameAt(0)), "", "at rest the shape needs no transform at all");
  assert.equal(bodyTransform(frameAt(1)), bodyTransform(frameAt(0)), "and neither does it when it lands");
});

test("each ray is pulled into its own middle, and put back", () => {
  for (const ray of RAYS) {
    assert.equal(rayTransform(ray, 1), "", "a ray that is out needs no transform");
    const pulled = rayTransform(ray, 0);
    assert.match(pulled, new RegExp(`translate\\(${ray.cx} ${ray.cy}\\)`), "not pulled to its own middle");
    assert.match(pulled, /scale\(0\)/, "not pulled all the way in");
  }
});
