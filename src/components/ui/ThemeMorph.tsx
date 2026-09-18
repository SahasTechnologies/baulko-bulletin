/**
 * The theme toggle's icon: the sun and the moon, as one shape that moves.
 *
 * Three things are worth knowing about how this is put together, and they are
 * the reasons it is built this way rather than as two icons swapping.
 *
 * **What is at rest is CSS.** Both layers — the sun with its rays, and the moon —
 * are always in the markup, and which one is painted is decided by the theme
 * class on `<html>`: the sun while it is light, the moon once it is dark. That is
 * what the page arrives with, before any script has run, which matters because
 * the theme is chosen by an inline script and the server does not know what it
 * chose: rendering one shape server-side and correcting it after mount would
 * flash the wrong icon on half the page loads. It also leaves this component
 * with no state at all.
 *
 * **While it moves, the script owns every style it touches** — the two
 * outlines, the two opacities, the rays and the rotation — and hands them back
 * when it lands. None of them is a prop on a rendered element, since React would
 * otherwise write a shape from its last render over the frame being drawn.
 *
 * **The move itself is `frameAt` in src/lib/theme-morph.ts**, which is pure and
 * tested; this file applies it and nothing else. The palette is CSS's business,
 * too: both layers inherit `currentColor`, just like every other icon, so the
 * morph changes shape and opacity without changing colour when the theme toggles.
 *
 * At rest the icon is the theme a visitor is *in* — a sun while it is light, a
 * moon once it is dark — so `play("moon")` is the move towards the dark, and it
 * is the toggle's business to say which way it is going.
 */

import { useEffect, useId, useImperativeHandle, useRef, type Ref } from "react";

import {
  MOON_PATH,
  RAYS,
  SUN_PATH,
  VIEW,
  bodyTransform,
  frameAt,
  rayTransform,
} from "@/lib/theme-morph";

export type MorphShape = "sun" | "moon";

/** How long the move takes. Long enough to read, short enough to wait for. */
export const MORPH_MS = 760;

export interface ThemeMorphHandle {
  /**
   * Plays the move towards `shape`, and answers how long it will take in
   * milliseconds — or 0 when there is nothing to wait for, which is the case
   * when the visitor has asked for less motion and when the icon is already the
   * shape asked for. The caller puts the page's colours over while the icon is
   * still travelling, so it needs to know which of those it is.
   */
  play(shape: MorphShape): number;
}

interface Props {
  ref?: Ref<ThemeMorphHandle>;
}

/** Progress through the move: the sun is 0, the moon is 1. */
const SUN = 0;
const MOON = 1;

export default function ThemeMorph({ ref }: Props) {
  // Gradient ids have to be unique on the page, and stable between the server's
  // render and the client's.
  const uid = useId();
  const sunGradient = `morph-sun-${uid}`;
  const moonGradient = `morph-moon-${uid}`;

  const body = useRef<SVGGElement>(null);
  const warm = useRef<SVGGElement>(null);
  const cool = useRef<SVGGElement>(null);
  const rays = useRef<(SVGPathElement | null)[]>([]);
  /** The sun's outline and the moon's, which are the two the move crosses. */
  const outlines = useRef<{ outline: SVGPathElement | null; rest: string }[]>([
    { outline: null, rest: SUN_PATH },
    { outline: null, rest: MOON_PATH },
  ]);

  const playing = useRef(false);
  const frame = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      timers.current.forEach(clearTimeout);
    },
    []
  );

  /** Draws one moment of the move: everything the stylesheet would otherwise own. */
  function draw(progress: number): void {
    const at = frameAt(progress);

    for (const layer of outlines.current) layer.outline?.setAttribute("d", at.path);
    if (warm.current) warm.current.style.opacity = String(at.warmth);
    if (cool.current) cool.current.style.opacity = String(1 - at.warmth);
    if (body.current) body.current.setAttribute("transform", bodyTransform(at));

    RAYS.forEach((ray, index) => {
      rays.current[index]?.setAttribute("transform", rayTransform(ray, at.rays));
    });
  }

  /**
   * Hands everything back to the stylesheet, which is what leaves the icon in
   * the shape and the colours its theme asks for — and by now that is the theme
   * the move was heading towards, so nothing changes when it lands.
   */
  function rest(): void {
    for (const layer of outlines.current) layer.outline?.setAttribute("d", layer.rest);
    if (warm.current) warm.current.removeAttribute("style");
    if (cool.current) cool.current.removeAttribute("style");
    body.current?.removeAttribute("transform");
    for (const ray of rays.current) ray?.removeAttribute("transform");
  }

  useImperativeHandle(
    ref,
    () => ({
      play(shape: MorphShape): number {
        const target = shape === "moon" ? MOON : SUN;
        const start = document.documentElement.classList.contains("dark") ? MOON : SUN;

        // Already there, or still going: either way there is no move to wait for.
        if (start === target || playing.current) return 0;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;

        playing.current = true;
        const began = performance.now();

        const step = (now: number) => {
          const at = Math.min(1, (now - began) / MORPH_MS);
          draw(start + (target - start) * at);
          if (at < 1) {
            frame.current = requestAnimationFrame(step);
            return;
          }
          // The last frame is the finished shape; the stylesheet gets it back
          // once the caller has turned the theme over.
          timers.current.push(
            window.setTimeout(() => {
              playing.current = false;
              rest();
            }, 0)
          );
        };

        frame.current = requestAnimationFrame(step);
        return MORPH_MS;
      },
    }),
    []
  );

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="theme-morph" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id={sunGradient}
          className="theme-morph-sun-fill"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" />
          <stop offset="100%" />
        </linearGradient>
        <linearGradient
          id={moonGradient}
          className="theme-morph-moon-fill"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" />
          <stop offset="100%" />
        </linearGradient>
      </defs>

      {/* The turn and the dip belong to both layers, so they are on one group. */}
      <g ref={body} className="theme-morph-body">
        {/* The sun's colours, and its rays, which are only ever on this layer. */}
        <g ref={warm} className="theme-morph-warm" fill={`url(#${sunGradient})`}>
          {RAYS.map((ray, index) => (
            <path
              key={index}
              ref={(element) => {
                rays.current[index] = element;
              }}
              d={ray.d}
            />
          ))}
          <path
            ref={(element) => {
              outlines.current[0].outline = element;
            }}
            d={SUN_PATH}
          />
        </g>

        {/* The moon's, which has no rays of its own. */}
        <g ref={cool} className="theme-morph-cool" fill={`url(#${moonGradient})`}>
          <path
            ref={(element) => {
              outlines.current[1].outline = element;
            }}
            d={MOON_PATH}
          />
        </g>
      </g>
    </svg>
  );
}
