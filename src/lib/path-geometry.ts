/**
 * SVG path geometry, without a DOM.
 *
 * The theme toggle morphs the sun into the moon, and a morph needs both shapes
 * as the same kind of thing: two rings of equal length, paired point for point,
 * so one can be eased into the other. A browser does the hard part of that with
 * `getPointAtLength`, and flubber does it with a great deal more care — but
 * neither is available where this has to run, which is at build time in Node, so
 * that the runtime ships a table of points rather than a library. Flubber is not
 * a dependency here and adding one to move two icons would be a poor trade, so
 * this is the small part of it that is actually needed: flatten a path, resample
 * it by arc length, line the two rings up.
 *
 * Everything is pure — a string in, arrays of `[x, y]` out — which is what makes
 * it testable, and `src/lib/path-geometry.test.ts` is what says the arc
 * conversion and the sampling are right. A morph that is subtly wrong still
 * looks like *something* moving, so this is the part that has to be checked.
 */

/** `[x, y]`, in the path's own user units. */
export type Point = [number, number];

/** Fine enough for a 512-unit icon: four units is under a pixel at any size drawn. */
const FLATNESS = 4;

/** The whole of the path grammar. */
type Command = "M" | "L" | "H" | "V" | "C" | "S" | "Q" | "T" | "A" | "Z";

const ARGUMENTS: Record<Command, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** A cubic segment, absolute: two controls and the end point. */
type Cubic = [number, number, number, number, number, number];

/** One command, resolved: absolute from/to, whichever spelling it arrived in. */
interface Step {
  command: Command;
  args: number[];
  relative: boolean;
  from: Point;
  to: Point;
  start: Point;
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

/**
 * A path as resolved commands.
 *
 * A path string is a stream of letters and numbers, and one letter can carry
 * more than one set of arguments (`M0 0 1 1` is a move and a line), so the
 * arguments are consumed a command's worth at a time and the letter is
 * remembered until another appears. Relative commands are kept relative here —
 * the curves need to know — but their end points are resolved, since that is
 * what everything after this works from.
 */
function* steps(d: string): Generator<Step> {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  let cursor: Point = [0, 0];
  let start: Point = [0, 0];
  let previous: Command | null = null;
  let wasRelative = true;
  let at = 0;

  while (at < tokens.length) {
    const token = tokens[at];
    const spelled = /[MmLlHhVvCcSsQqTtAaZz]/.test(token) ? token : null;
    if (spelled) at++;

    // Without a letter of its own, the arguments repeat the last command — and a
    // repeated `M` is a line, which the grammar says and nothing else does. The
    // spelling carries too: a repeat of `m` stays relative.
    const letter: Command | undefined = spelled?.toUpperCase() as Command | undefined;
    const carried: Command | undefined = letter ?? previous ?? undefined;
    // Only a *carried* `M` is a line: a move that is spelled out is a move.
    const command: Command | undefined = !letter && carried === "M" ? "L" : carried;
    if (!command) throw new Error(`path starts without a command: ${d.slice(0, 24)}`);

    const relative: boolean = spelled ? spelled === spelled.toLowerCase() : wasRelative;
    const count = ARGUMENTS[command];
    const args = tokens.slice(at, at + count).map(Number);
    if (args.length < count) throw new Error(`${command} is short of arguments in ${d.slice(0, 24)}`);
    at += count;

    const from = cursor;
    const to = target(command, args, from, relative, command === "M" ? [0, 0] : start);

    yield { command, args, relative, from, to, start };
    if (command === "M") start = to;
    cursor = to;
    previous = letter ?? command;
    wasRelative = relative;
  }
}

/** Where a command lands, in absolute coordinates. */
function target(command: Command, args: number[], from: Point, relative: boolean, start: Point): Point {
  const shift = (x: number, y: number): Point => (relative ? [from[0] + x, from[1] + y] : [x, y]);
  switch (command) {
    case "M":
    case "L":
    case "T":
      return shift(args[0], args[1]);
    case "H":
      return relative ? [from[0] + args[0], from[1]] : [args[0], from[1]];
    case "V":
      return relative ? [from[0], from[1] + args[0]] : [from[0], args[0]];
    case "C":
      return shift(args[4], args[5]);
    case "S":
    case "Q":
      return shift(args[2], args[3]);
    case "A":
      return shift(args[5], args[6]);
    case "Z":
      return start;
  }
}

/**
 * An elliptical arc as cubics, by the SVG specification's conversion (F.6.5,
 * endpoint to centre parameterisation). An arc of more than 90° is cut into
 * pieces first, since a single cubic cannot hold one.
 */
export function arcToCubics(
  from: Point,
  rx: number,
  ry: number,
  rotation: number,
  largeArc: number,
  sweep: number,
  to: Point
): Cubic[] {
  if (rx === 0 || ry === 0) return [[from[0], from[1], to[0], to[1], to[0], to[1]]];

  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x = cos * dx + sin * dy;
  const y = -sin * dx + cos * dy;

  let a = Math.abs(rx);
  let b = Math.abs(ry);
  // A radius too small to reach is grown until it just does, as the spec asks.
  const reach = (x * x) / (a * a) + (y * y) / (b * b);
  if (reach > 1) {
    const scale = Math.sqrt(reach);
    a *= scale;
    b *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = a * a * b * b - a * a * y * y - b * b * x * x;
  const denominator = a * a * y * y + b * b * x * x;
  const factor = sign * Math.sqrt(Math.max(0, numerator) / denominator);
  const cx = (factor * a * y) / b;
  const cy = (-factor * b * x) / a;

  const centre: Point = [
    cos * cx - sin * cy + (from[0] + to[0]) / 2,
    sin * cx + cos * cy + (from[1] + to[1]) / 2,
  ];

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const theta = Math.acos(Math.min(1, Math.max(-1, dot / length)));
    return ux * vy - uy * vx < 0 ? -theta : theta;
  };

  const from1 = [(x - cx) / a, (y - cy) / b] as Point;
  const to1 = [(-x - cx) / a, (-y - cy) / b] as Point;
  const startAngle = angle(1, 0, from1[0], from1[1]);
  let sweepAngle = angle(from1[0], from1[1], to1[0], to1[1]);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const step = sweepAngle / pieces;
  const alpha = (4 / 3) * Math.tan(step / 4);

  const at = (t: number): Point => [
    centre[0] + a * Math.cos(t) * cos - b * Math.sin(t) * sin,
    centre[1] + a * Math.cos(t) * sin + b * Math.sin(t) * cos,
  ];
  const tangent = (t: number): Point => [
    -a * Math.sin(t) * cos - b * Math.cos(t) * sin,
    -a * Math.sin(t) * sin + b * Math.cos(t) * cos,
  ];

  const cubics: Cubic[] = [];
  let theta = startAngle;
  let point = from;

  for (let piece = 0; piece < pieces; piece++) {
    const next = theta + step;
    const end = piece === pieces - 1 ? to : at(next);
    const outward = tangent(theta);
    const inward = tangent(next);
    cubics.push([
      point[0] + alpha * outward[0],
      point[1] + alpha * outward[1],
      end[0] - alpha * inward[0],
      end[1] - alpha * inward[1],
      end[0],
      end[1],
    ]);
    point = end;
    theta = next;
  }

  return cubics;
}

/** The cubics one command draws, with the smooth variants' reflected control. */
function cubicsOf(step: Step, previous: Cubic | Point | null): Cubic[] {
  const { args, from, relative } = step;
  const shift = (x: number, y: number): Point => (relative ? [from[0] + x, from[1] + y] : [x, y]);

  switch (step.command) {
    case "C":
      return [[...shift(args[0], args[1]), ...shift(args[2], args[3]), ...shift(args[4], args[5])]];
    case "S": {
      const mirrored: Point =
        previous && Array.isArray(previous) && previous.length === 6
          ? [2 * from[0] - previous[2], 2 * from[1] - previous[3]]
          : from;
      return [[...mirrored, ...shift(args[0], args[1]), ...shift(args[2], args[3])]];
    }
    case "Q":
      return [quadraticToCubic(from, shift(args[0], args[1]), shift(args[2], args[3]))];
    case "T": {
      const control: Point =
        previous && Array.isArray(previous) && previous.length === 2
          ? [2 * from[0] - previous[0], 2 * from[1] - previous[1]]
          : from;
      return [quadraticToCubic(from, control, shift(args[0], args[1]))];
    }
    case "A":
      return arcToCubics(from, args[0], args[1], args[2], args[3], args[4], shift(args[5], args[6]));
    default:
      // Straight lines are not curves and are not flattened as such; `flatten`
      // takes their end point directly.
      return [];
  }
}

function quadraticToCubic(from: Point, control: Point, to: Point): Cubic {
  return [
    from[0] + (2 / 3) * (control[0] - from[0]),
    from[1] + (2 / 3) * (control[1] - from[1]),
    to[0] + (2 / 3) * (control[0] - to[0]),
    to[1] + (2 / 3) * (control[1] - to[1]),
    to[0],
    to[1],
  ];
}

/** One point along a cubic. Its start is not part of the tuple, so it is given. */
function cubicAt(start: Point, cubic: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * start[0] + b * cubic[0] + c * cubic[2] + e * cubic[4],
    a * start[1] + b * cubic[1] + c * cubic[3] + e * cubic[5],
  ];
}

/**
 * A path as polylines: one per subpath, in order.
 *
 * Curves are cut into straight pieces fine enough that the difference is not
 * visible at the size these icons are drawn. Each segment's piece count comes
 * from its own length rather than being fixed, so a long ray and a short one come
 * out equally smooth and neither is oversampled.
 */
export function flatten(d: string, flatness = FLATNESS): Point[][] {
  const polylines: Point[][] = [];
  let current: Point[] | null = null;
  let previous: Cubic | Point | null = null;

  for (const step of steps(d)) {
    if (step.command === "M") {
      current = [step.to];
      polylines.push(current);
      previous = null;
      continue;
    }

    if (!current) {
      current = [step.from];
      polylines.push(current);
    }

    if (step.command === "Z") {
      current.push(step.to);
      previous = null;
      continue;
    }

    if (step.command === "L" || step.command === "H" || step.command === "V") {
      current.push(step.to);
      previous = null;
      continue;
    }

    for (const cubic of cubicsOf(step, previous)) {
      const span =
        distance([cubic[0], cubic[1]], [cubic[2], cubic[3]]) +
        distance([cubic[2], cubic[3]], [cubic[4], cubic[5]]) +
        distance([cubic[4], cubic[5]], [cubic[0], cubic[1]]);
      const pieces = Math.min(64, Math.max(1, Math.ceil(span / flatness)));
      // Where this curve begins is whatever the polyline last reached, which for
      // the first curve of a subpath is the move that started it.
      const start = current[current.length - 1] ?? step.from;
      for (let piece = 1; piece <= pieces; piece++) current.push(cubicAt(start, cubic, piece / pieces));
      previous = cubic;
    }

    if (step.command === "Q" || step.command === "T") {
      // The reflected control has to come from the original quadratic, not from
      // the cubic it was converted into — the two differ at the midpoint — and
      // in absolute coordinates, which is not how it was written.
      const control: Point = step.relative
        ? [step.from[0] + step.args[0], step.from[1] + step.args[1]]
        : [step.args[0], step.args[1]];
      previous = step.command === "Q" ? control : null;
    }
  }

  return polylines;
}

/** A path's subpaths, split where a move begins one. */
export function subpaths(d: string): string[] {
  return d.split(/(?=[Mm])/).filter((part) => part.trim().length > 0);
}

/** The area a ring encloses, by the shoelace formula. */
export function area(ring: Point[]): number {
  let sum = 0;
  for (let at = 0; at < ring.length; at++) {
    const here = ring[at];
    const next = ring[(at + 1) % ring.length];
    sum += here[0] * next[1] - next[0] * here[1];
  }
  return Math.abs(sum) / 2;
}

/** A ring's box, as `[minX, minY, maxX, maxY]`. */
export function bounds(ring: Point[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** The average of a ring's points. */
export function centroid(ring: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}

export function perimeter(ring: Point[], closed = true): number {
  let total = 0;
  for (let at = 1; at < ring.length; at++) total += distance(ring[at - 1], ring[at]);
  if (closed && ring.length > 1) total += distance(ring[ring.length - 1], ring[0]);
  return total;
}

/** A polyline as a closed ring: its first point repeated if it did not close. */
export function close(polyline: Point[]): Point[] {
  if (polyline.length < 2) return polyline;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  return distance(first, last) < 1e-6 ? polyline : [...polyline, first];
}

/**
 * A ring resampled to exactly `count` points, spaced evenly along it by arc
 * length — so that two rings of different shapes can be paired point for point
 * rather than by their own vertices, which is the whole trick of a morph.
 */
export function resample(ring: Point[], count: number): Point[] {
  const closed = close(ring);
  const lengths: number[] = [];
  let total = 0;
  for (let at = 1; at < closed.length; at++) {
    const length = distance(closed[at - 1], closed[at]);
    lengths.push(length);
    total += length;
  }
  if (!total) throw new Error("ring has no length");

  const points: Point[] = [];
  let segment = 0;
  let travelled = 0;

  for (let index = 0; index < count; index++) {
    const wanted = (total * index) / count;
    while (segment < lengths.length - 1 && travelled + lengths[segment] < wanted) {
      travelled += lengths[segment];
      segment++;
    }
    const length = lengths[segment] || total;
    const at = Math.min(1, Math.max(0, (wanted - travelled) / length));
    const from = closed[segment];
    const to = closed[segment + 1];
    points.push([from[0] + (to[0] - from[0]) * at, from[1] + (to[1] - from[1]) * at]);
  }

  return points;
}

/**
 * The ring `mover` rotated so that it starts at the point which pairs best with
 * `still`'s first point.
 *
 * Without this, a circle and a crescent morph with a twist in them: each shape
 * begins wherever its own path happened to begin, and the points between them
 * travel the long way round. Trying every offset and keeping the one whose points
 * are nearest overall is a few thousand multiplications at build time, and it is
 * the difference between a morph and a swirl.
 */
export function alignRing(still: Point[], mover: Point[]): Point[] {
  let best = 0;
  let bestCost = Infinity;

  for (let offset = 0; offset < mover.length; offset++) {
    let cost = 0;
    for (let at = 0; at < still.length; at++) {
      const point = mover[(at + offset) % mover.length];
      const dx = point[0] - still[at][0];
      const dy = point[1] - still[at][1];
      cost += dx * dx + dy * dy;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = offset;
    }
  }

  return [...mover.slice(best), ...mover.slice(0, best)];
}

/**
 * A ring as path data, cut to a hundredth of a unit — a tenth of a pixel even
 * when the icon is drawn large — with the padding trimmed, since this string is
 * rebuilt on every frame of the morph and goes straight into an attribute.
 */
export function ringToPath(ring: Point[]): string {
  const round = (value: number): string =>
    value
      .toFixed(2)
      .replace(/0+$/, "")
      .replace(/\.$/, "")
      .replace(/^(-?)0\./, "$1.");
  return `M${ring.map((point) => `${round(point[0])} ${round(point[1])}`).join("L")}Z`;
}

/** One ring eased into another: `t = 0` is `from`, `t = 1` is `to`. */
export function mixRings(from: Point[], to: Point[], t: number): Point[] {
  if (from.length !== to.length) throw new Error(`rings differ in length: ${from.length} and ${to.length}`);
  return from.map((point, at) => [
    point[0] + (to[at][0] - point[0]) * t,
    point[1] + (to[at][1] - point[1]) * t,
  ]);
}

/** How far apart two paired rings are, point for point — for the tests to hold. */
export function totalDistance(from: Point[], to: Point[]): number {
  let total = 0;
  for (let at = 0; at < from.length; at++) total += distance(from[at], to[at]);
  return total;
}
