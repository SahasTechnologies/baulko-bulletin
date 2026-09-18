/**
 * The sun turning into the moon, one frame at a time.
 *
 * The geometry is all in `src/lib/theme-morph.generated.ts` — which the build
 * derives from the two ionicons — and the shapes at rest are the icons
 * themselves, drawn by `ThemeMorph.tsx`. What lives here is the *move*: given a
 * progress from 0 (the sun) to 1 (the moon), what the drawing is doing at that
 * moment. Keeping that a pure function is what makes the animation checkable —
 * `src/lib/theme-morph.test.ts` says it starts as the sun, ends as the moon,
 * never goes backwards and never takes a step it did not mean to.
 *
 * The move is three things at once, which is what makes it read as a
 * transformation rather than a fade:
 *
 *   - the rays retract into their own middles and are gone by a little over
 *     halfway, so the sun is a bare disc before the disc becomes anything else;
 *   - the disc's outline eases into the moon's, point for point, so what was the
 *     sun's rim becomes the crescent's edge;
 *   - the whole shape turns once and dips slightly as it goes.
 *
 * The colours are not here at all: the warm and cool layers of the icon are
 * crossfaded against each other by the same progress, and each layer's palette
 * comes from CSS. See the `.theme-morph` rules in src/styles/global.css.
 */

import { MOON, RAYS, STEPS, SUN } from "./theme-morph.generated.ts";
import { mixRings, ringToPath, type Point } from "./path-geometry.ts";

export { RAYS, STEPS };

/** The icons' own viewBox; the morph never leaves it. */
export const VIEW = 512;

/** The centre everything turns about, and the icons' midpoint. */
const CENTRE = VIEW / 2;

export type Ray = (typeof RAYS)[number];

/**
 * Where the rays have finished retracting. Halfway, so the sun is a bare disc for
 * the whole of the second half of the move — which is what makes the retracting
 * read as its own stage rather than as noise over a shape that is already
 * changing.
 */
const RAYS_GONE = 0.5;

/** Where the disc starts and finishes becoming the moon. */
const MORPH_FROM = 0.12;
const MORPH_TO = 0.9;

/** How far the shape dips in the middle of the move, as a fraction of itself. */
const DIP = 0.05;

/** The sun's disc, as the build sampled it. */
const SUN_RING: Point[] = pairs(SUN);
/** The moon, sampled the same way and turned to face it. */
const MOON_RING: Point[] = pairs(MOON);

/** The two shapes at rest, drawn exactly as the icons draw them. */
export const SUN_PATH = ringToPath(SUN_RING);
export const MOON_PATH = ringToPath(MOON_RING);

/** One moment of the move. */
export interface Frame {
  /** The core's outline: the disc, the crescent, or the shape between them. */
  path: string;
  /** How far the rays are out — 1 as the sun, 0 once they have gone. */
  rays: number;
  /** How much of the sun's warmth is on top: 1 at the sun, 0 at the moon. */
  warmth: number;
  /** The shape's rotation about its centre, in degrees. */
  turn: number;
  /** Its scale, which dips a little mid-move. */
  scale: number;
}

export function frameAt(progress: number): Frame {
  const at = clamp(progress);
  // The disc holds still for the first tenth and is finished by nine tenths, so
  // the retracting rays are read as a stage of their own rather than as noise
  // over a shape that is already changing.
  const core = smooth(clamp((at - MORPH_FROM) / (MORPH_TO - MORPH_FROM)));

  return {
    // Exact at both ends, where the icon itself is the better drawing, and the
    // sampled ring in between, where the two are paired point for point.
    path: core <= 0 ? SUN_PATH : core >= 1 ? MOON_PATH : ringToPath(mixRings(SUN_RING, MOON_RING, core)),
    rays: 1 - smooth(clamp(at / RAYS_GONE)),
    warmth: 1 - smooth(at),
    turn: 360 * smooth(at),
    scale: 1 - DIP * Math.sin(Math.PI * at),
  };
}

/** The transform that pulls one ray in towards its own middle, `out` of 1. */
export function rayTransform(ray: Ray, out: number): string {
  if (out >= 1) return "";
  return `translate(${ray.cx} ${ray.cy}) scale(${round(out)}) translate(${-ray.cx} ${-ray.cy})`;
}

/**
 * The transform for the whole shape at one moment of the move: turned about the
 * middle of the icon and dipped about the same point, so neither drifts.
 */
export function bodyTransform(frame: Frame): string {
  // A whole turn is no turn: the last frame of the move needs no transform at
  // all, so the stylesheet's shape can take over without anything shifting.
  const turn = frame.turn % 360;
  if (turn === 0 && frame.scale === 1) return "";
  return (
    `rotate(${round(turn)} ${CENTRE} ${CENTRE}) ` +
    `translate(${CENTRE} ${CENTRE}) scale(${round(frame.scale)}) translate(${-CENTRE} ${-CENTRE})`
  );
}

/** `[x, y, x, y, …]` as points, once, at module load. */
function pairs(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let at = 0; at < flat.length; at += 2) points.push([flat[at], flat[at + 1]]);
  return points;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Slow at both ends, quick through the middle — for anything that moves. */
function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

/** Four decimals is well past what the attribute can show at this size. */
function round(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
