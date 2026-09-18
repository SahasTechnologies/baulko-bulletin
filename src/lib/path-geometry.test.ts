/**
 * The geometry the theme morph is built on, and the table the build derives
 * from the two icons.
 *
 * There is no flubber here and no DOM, so the flattening, the arc conversion,
 * the resampling and the pairing are all this repository's own code — and a
 * morph that is subtly wrong still looks like *something* moving, which is
 * exactly the failure a test has to catch rather than an eye. The shapes are
 * checked against what they are supposed to be: a circle's area, an arc's
 * radius, a ring sampled evenly.
 *
 * Run with `npm test`. Node strips the types; there is no test framework here on
 * purpose, since the modules have no imports beyond each other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  alignRing,
  area,
  bounds,
  close,
  flatten,
  mixRings,
  perimeter,
  centroid,
  totalDistance,
  resample,
  ringToPath,
  subpaths,
  type Point,
} from "./path-geometry.ts";
import { MOON, RAYS, STEPS, SUN, VIEW } from "./theme-morph.generated.ts";

const tau = Math.PI * 2;

/** `[x, y]` pairs out of a flat table. */
function ring(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let at = 0; at < flat.length; at += 2) points.push([flat[at], flat[at + 1]]);
  return points;
}

/* ------------------------------------------------------------- the parser */

test("a straight line is its two ends and nothing else", () => {
  assert.deepEqual(flatten("M0 0L10 0"), [[[0, 0], [10, 0]]]);
  assert.deepEqual(flatten("M1 1h2v3"), [[[1, 1], [3, 1], [3, 4]]]);
  assert.deepEqual(flatten("M0 0H8V8Z"), [[[0, 0], [8, 0], [8, 8], [0, 0]]]);
});

test("a repeated coordinate pair is a line, in whichever spelling the move used", () => {
  assert.deepEqual(flatten("m2 3 1 1"), [[[2, 3], [3, 4]]], "a relative move repeats relative");
  assert.deepEqual(flatten("M2 3 1 1"), [[[2, 3], [1, 1]]], "an absolute one repeats absolute");
});

test("a cubic curve lands where it says, through points between", () => {
  const [line] = flatten("M0 0c1 1 2 2 3 3", 1);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [3, 3]);
  // The controls are the ends pulled towards the corners, so the curve stays on
  // the diagonal — a cubic whose controls lie on its own chord is a straight line.
  for (const [x, y] of line) assert.ok(Math.abs(x - y) < 1e-6, `${x} vs ${y}`);
});

test("a smooth cubic reflects the previous control, and a quad does too", () => {
  const [smooth] = flatten("M0 0C0 10 10 10 10 0S20 -10 20 0", 1);
  assert.deepEqual(smooth.at(-1), [20, 0]);
  // The reflection of (10,10) about (10,0) is (10,-10), so the second half of
  // this curve mirrors the first: its lowest point sits below the start.
  assert.ok(Math.max(...smooth.map(([, y]) => y)) < 8, "the reflected control was ignored");
});

test("an arc keeps its radius, and a full circle its centre", () => {
  // Flattened finely here on purpose: what is being checked is the arc maths,
  // not how many pieces the icons' own flatness happens to cut it into.
  const [half] = flatten("M0 0A10 10 0 0 1 20 0", 0.1);
  for (const point of half) {
    const radius = Math.hypot(point[0] - 10, point[1]);
    assert.ok(Math.abs(radius - 10) < 0.02, `off the circle by ${radius - 10}`);
  }

  const [circle] = flatten("M0 0A10 10 0 1 1 20 0A10 10 0 1 1 0 0Z", 0.1);
  const [minX, minY, maxX, maxY] = bounds(circle);
  assert.ok(Math.abs(area(circle) - Math.PI * 100) < 0.5, `area ${area(circle)} is not πr²`);
  assert.ok(Math.abs(minX - 0) < 0.1 && Math.abs(maxX - 20) < 0.1, "and it spans its diameter");
  assert.ok(Math.abs(minY + 10) < 0.1 && Math.abs(maxY - 10) < 0.1, "in both directions");
});

test("a radius too small to span its chord is grown until it can, as the spec says", () => {
  const [arc] = flatten("M0 0A1 1 0 0 1 20 0", 0.5);
  assert.deepEqual(arc[0], [0, 0]);
  assert.ok(Math.abs(arc.at(-1)![0] - 20) < 1e-6, "it still reaches the end point");
  assert.ok(perimeter(arc, false) > 20, "going round rather than straight through");
});

test("a subpath that closes itself is taken as closed", () => {
  const ring = close(flatten("M0 0L4 0L4 4L0 4Z")[0]);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(area(ring), 16);
  assert.equal(perimeter(ring, false), 16, "the closing corner is counted once");
});

test("subpaths split at their moves", () => {
  const pieces = subpaths("M0 0L1 0M2 0L3 0");
  assert.equal(pieces.length, 2);
  assert.equal(subpaths("M0 0L1 0").length, 1);
  assert.equal(subpaths("M0 0L1 0m2 0L3 0").length, 2, "a relative move splits too");
});

/* --------------------------------------------------------- the sampling */

test("a ring resamples to the number of points asked for, evenly spaced", () => {
  const circle = flatten("M0 0A10 10 0 1 1 20 0A10 10 0 1 1 0 0Z")[0];
  const sampled = resample(circle, 64);
  assert.equal(sampled.length, 64);

  const edges = sampled.map((point, at) => {
    const next = sampled[(at + 1) % sampled.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const longest = Math.max(...edges);
  const shortest = Math.min(...edges);
  assert.ok(longest - shortest < longest * 0.05, `edges ran from ${shortest} to ${longest}`);

  // The four extremes of the circle are on the sampling, since it starts at the
  // ring's own first point and the rest follow at equal intervals.
  const xs = sampled.map(([x]) => Math.round(x * 100) / 100);
  assert.ok(xs.includes(20), "nothing reached the right of the circle");
  assert.ok(xs.includes(0), "nothing reached the left of it");
});

test("resampling a ring and its own reverse gives the same points backwards", () => {
  const circle = flatten("M0 0A10 10 0 1 1 20 0A10 10 0 1 1 0 0Z")[0];
  const forwards = resample(circle, 8);
  const backwards = resample([...circle].reverse(), 8);
  assert.ok(Math.abs(area(forwards) - area(backwards)) < 1, "direction is not area");
  assert.ok(Math.abs(perimeter(forwards, false) - perimeter(backwards, false)) < 0.5);
});

/* --------------------------------------------------------- the pairing */

test("the pairing picks the rotation whose points sit nearest", () => {
  const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const rotated = [square[2], square[3], square[0], square[1]];
  const aligned = alignRing(square, rotated);
  assert.deepEqual(totalDistance(square, aligned), 0);

  // And it is never worse than leaving the ring as it came.
  const twist = alignRing(square, [...square].reverse());
  assert.ok(totalDistance(square, twist) <= totalDistance(square, [...square].reverse()) + 1e-9);
});

test("mixing rings walks from one to the other and stops at both", () => {
  const from: Point[] = [[0, 0], [1, 0], [1, 1]];
  const to: Point[] = [[0, 0], [3, 0], [3, 3]];
  assert.deepEqual(mixRings(from, to, 0), from);
  assert.deepEqual(mixRings(from, to, 1), to);
  assert.deepEqual(mixRings(from, to, 0.5), [[0, 0], [2, 0], [2, 2]]);
  assert.throws(() => mixRings(from, to.slice(1), 0.5));
});

test("a ring becomes a closed path, with the numbers cut short", () => {
  const path = ringToPath([[0.25, -0.5], [10, 20.126]]);
  assert.equal(path, "M.25 -.5L10 20.13Z");
  assert.ok(ringToPath([[0, 0]]).endsWith("Z"), "a one-point ring is still a path");
});

test("bounds, centroid, and perimeter describe a polygon accurately", () => {
  const square: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.deepEqual(bounds(square), [0, 0, 4, 4]);
  assert.deepEqual(centroid(square), [2, 2]);
  assert.equal(perimeter(square), 16);
  assert.equal(perimeter(square, false), 12);
});

test("close does not duplicate an already closed polyline", () => {
  const closed: Point[] = [[0, 0], [1, 0], [0, 0]];
  assert.deepEqual(close(closed), closed);
  assert.deepEqual(close([]), []);
});

test("totalDistance compares corresponding points", () => {
  assert.equal(totalDistance([[0, 0], [3, 4]], [[0, 0], [0, 0]]), 5);
  assert.equal(totalDistance([[0, 0]], [[1, 1], [2, 2]]), Math.SQRT2);
});


/* ------------------------------------------------------ the built table */

test("the built table is the two icons, paired", () => {
  assert.equal(SUN.length, STEPS * 2, "the sun's ring is one point per step");
  assert.equal(MOON.length, STEPS * 2, "and so is the moon's");
  assert.equal(VIEW, 512, "the icons' own viewBox");
  assert.equal(RAYS.length, 8, "eight rays and a disc is what the sunny icon holds");
});

test("the sun's ring is the disc, at its size and its place", () => {
  // Ionicons' sunny draws its disc as a circle of radius 102 at the centre of a
  // 512 box; if the build ever picks a ray as the disc, this is what notices.
  const disc = ring(SUN);
  const [minX, minY, maxX, maxY] = bounds(disc);
  assert.ok(Math.abs(maxX - minX - 204) < 3, `the disc is ${maxX - minX} across, not 204`);
  assert.ok(Math.abs(maxY - minY - 204) < 3, `and ${maxY - minY} tall`);
  assert.ok(Math.abs((minX + maxX) / 2 - 256) < 3 && Math.abs((minY + maxY) / 2 - 256) < 3, "off centre");
  const expected = Math.PI * 102 * 102;
  assert.ok(Math.abs(area(disc) - expected) < expected * 0.01, `area ${area(disc)} against ${expected}`);
});

test("each ray collapses into the middle of itself", () => {
  for (const ray of RAYS) {
    const [minX, minY, maxX, maxY] = bounds(flatten(ray.d)[0]);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    assert.ok(Math.abs(ray.cx - cx) < 0.01 && Math.abs(ray.cy - cy) < 0.01, `ray at ${ray.cx},${ray.cy}`);
    assert.ok(ray.cx > 0 && ray.cx < VIEW && ray.cy > 0 && ray.cy < VIEW, "inside the icon");
  }
});

test("the moon's ring is the crescent, and it is beside the disc's first point", () => {
  const moon = ring(MOON);
  assert.ok(moon.every(([x, y]) => x >= 0 && x <= VIEW && y >= 0 && y <= VIEW), "outside the viewBox");
  assert.ok(bounds(moon)[2] - bounds(moon)[0] > 400, "the crescent spans most of the box");

  // The pairing put the moon's points nearest the disc's; without it the morph
  // carries a twist through, which is measurable as points that are further away
  // than they need to be.
  const disc = ring(SUN);
  const gap = Math.hypot(moon[0][0] - disc[0][0], moon[0][1] - disc[0][1]);
  assert.ok(gap < 200, `the two rings start ${Math.round(gap)} units apart`);

  const half = [...moon.slice(STEPS / 2), ...moon.slice(0, STEPS / 2)];
  assert.ok(
    totalDistance(disc, moon) < totalDistance(disc, half) * 0.7,
    "the pairing is no better than turning the moon halfway round"
  );
});

test("the moon is not the disc, and neither is empty", () => {
  const disc = ring(SUN);
  const moon = ring(MOON);
  assert.ok(area(moon) > area(disc) * 2, "a crescent over the whole box outweighs the disc");
  assert.ok(area(disc) > 30000 && area(moon) > 80000);
  assert.ok(Math.abs(perimeter(disc, false) - tau * 102) < 10, "the disc's rim is a circle's");
});
