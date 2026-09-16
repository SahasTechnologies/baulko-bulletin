/**
 * Eases a row across its breakpoint instead of letting it jump.
 *
 * Two places in the site are laid out one way on a laptop and another way
 * everywhere else, and both switch the instant the width crosses the line: the
 * nav, whose labels are either tucked behind its icons or spelled out, and a
 * header row, whose brand sits above its nav or beside it. Dragging a window
 * across either line therefore reads as the site being replaced rather than
 * resized — every element somewhere else, in one frame.
 *
 * So each crossing runs the standard FLIP trick: measure where every element
 * was, let the new shape apply, offset each one back to where it came from, and
 * let it ease home. Only positions are animated — the row still lays itself out
 * the way CSS says, and the helper is inert without JavaScript.
 *
 * An element is found by its index in the row, which is stable: the same
 * elements, in the same order, in both shapes.
 */

import { navIsWrapped, updateNavFit } from "./nav-fit";

/**
 * One row and the shapes it moves between. Each group has to stay in step with
 * the CSS that lays that row out — the CSS decides the layout, this only notices
 * when it has changed.
 */
interface Group {
  /** What the two shapes are, so the pairing with the CSS is checkable. */
  shapes: string;
  /** Which shape the row is in right now, as a token. */
  shape: () => string;
  /** The elements that move, in DOM order. */
  elements: () => HTMLElement[];
}

/** A media query, asked repeatedly, without making a list each time. */
function media(query: string): () => boolean {
  let list: MediaQueryList | null = null;
  return () => {
    list ??= window.matchMedia(query);
    return list.matches;
  };
}

// The hover branch of the nav rules in global.css. Only a pointer that can
// hover has a way to bring a hidden label back.
const NAV_POINTER = media("(hover: hover) and (pointer: fine) and (min-width: 48rem)");

// Tailwind's `lg`, which is where `lg:flex-row` takes effect on the page header,
// the admin header and the home page's hero row.
const HEADER_ROW = media("(min-width: 64rem)");

const GROUPS: Group[] = [
  {
    shapes: "the nav's labels collapsed behind its icons, and spelled out",
    // Two things decide this one: the pointer, and whether `src/lib/nav-fit.ts`
    // found room for every label at once. A row that has to spell its labels out
    // for want of room is a shape change like any other.
    shape: () => (NAV_POINTER() && !navIsWrapped() ? "icons" : "spelled-out"),
    elements: () => select(".icon-nav > .icon-nav-item"),
  },
  {
    shapes: "a header's brand and nav stacked, and set side by side",
    shape: () => (HEADER_ROW() ? "side-by-side" : "stacked"),
    elements: () => select(".flip-row > *"),
  },
];

/** Long enough to read as a move, short enough not to be in the way. */
const DURATION = 380;

/** The same overshoot the rest of the site's hover motion uses. */
const EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * The class the muting rule in global.css hangs off. It is set while a flip
 * runs so that a label's own transition cannot fire mid-measurement and turn
 * the positions being measured into a moving target — two motions at once would
 * also fight each other.
 */
const RUNNING = "layout-flip";

type Positions = DOMRect[];

let started = false;

function select(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

/** Where every element of one row sits right now, in DOM order. */
function measure(group: Group): Positions {
  return group.elements().map((item) => item.getBoundingClientRect());
}

/**
 * The flip currently being animated, so a stale cleanup timer cannot clear the
 * styles of a newer one — dragging a window across a line and back is enough to
 * overlap two runs.
 */
let run = 0;

/**
 * Elements are moved with a transform rather than by animating the layout: a
 * flex row cannot tween between two arrangements, but offsetting each item and
 * easing the offset back to zero looks the same and costs one composited layer
 * per element.
 */
function ease(group: Group, before: Positions, after: Positions): void {
  const items = group.elements();
  const moved: HTMLElement[] = [];

  after.forEach((rect, index) => {
    const item = items[index];
    const from = before[index];
    if (!item || !from) return;
    const dx = from.left - rect.left;
    const dy = from.top - rect.top;
    // Under a pixel is the same place as far as anyone can see.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    item.style.transition = "none";
    item.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push(item);
  });

  if (!moved.length) {
    // Nothing to animate — but the labels were muted for the measurement, and
    // leaving the class on would keep them muted for good.
    document.documentElement.classList.remove(RUNNING);
    return;
  }

  const generation = ++run;

  // Take the offset as the starting point before the browser paints it.
  void document.documentElement.offsetHeight;

  requestAnimationFrame(() => {
    if (generation !== run) return;
    for (const item of moved) {
      item.style.transition = `transform ${DURATION}ms ${EASING}`;
      item.style.transform = "";
    }
  });

  window.setTimeout(() => {
    if (generation !== run) return;
    for (const item of moved) {
      item.style.transition = "";
      item.style.transform = "";
    }
    document.documentElement.classList.remove(RUNNING);
  }, DURATION + 80);
}

/**
 * Starts watching. Safe to call from more than one component — a page can hold
 * both the public nav and the admin one — and a no-op when the reader has asked
 * for reduced motion: this is decoration, and the layout change works without
 * it. The fitting still runs under reduced motion; only the easing is skipped.
 */
export function initLayoutTransition(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The fit test decides the nav's shape, and it has to have run before the
  // first snapshot — the page arrives in whatever shape the room allows, with
  // nothing to ease from.
  updateNavFit();

  let shape = GROUPS.map((group) => group.shape());
  let snapshot = GROUPS.map(measure);
  let frame = 0;

  // Fits the nav first, so this frame measures and eases one shape of it rather
  // than acting on a width the fit test is about to change.
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      updateNavFit();
      const now = GROUPS.map((group) => group.shape());
      const crossed = now.map((next, index) => next !== shape[index]);
      if (!crossed.some(Boolean)) {
        // An ordinary resize: no row changed shape, so there is nothing to
        // animate — just keep the record of where things are up to date.
        snapshot = GROUPS.map(measure);
        return;
      }
      shape = now;

      // Muting the labels before measuring matters. Their own transition would
      // still be halfway through the previous shape, so the positions measured
      // here would be a moving target. Every row is measured before any of the
      // offsets are applied, so one flip is never measured through another's
      // transform.
      document.documentElement.classList.add(RUNNING);
      const after = GROUPS.map(measure);

      if (reduced) {
        document.documentElement.classList.remove(RUNNING);
      } else {
        // Only the rows that crossed are eased. An element of another row that
        // sits inside one of them — the nav lives inside both headers — is
        // carried along by its parent's transform, so easing it separately would
        // double its movement.
        GROUPS.forEach((group, index) => {
          if (crossed[index]) ease(group, snapshot[index] ?? [], after[index]);
        });
      }

      snapshot = after;
    });
  };

  window.addEventListener("resize", onResize);

  // The nav's labels are set in a webfont, so how wide the open row is is not
  // final until it has loaded — and on a slow connection that lands after the
  // first fit test has already run.
  document.fonts?.ready.then(onResize).catch(() => {});
}
