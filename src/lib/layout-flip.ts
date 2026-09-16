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

import { navShape, updateNavFit } from "./nav-fit";

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
    shapes: "the nav's labels collapsed behind its icons, and spanned over one or two lines",
    // Two things decide this one: the pointer, and how many lines of icons
    // `src/lib/nav-fit.ts` found room for. A nav that has to move onto a second
    // line — or give up on hiding labels altogether — is a shape change like
    // any other.
    shape: () => (NAV_POINTER() ? navShape() : "spelled-out"),
    elements: () => select(".icon-nav .icon-nav-item"),
  },
  {
    shapes: "a header's brand and nav stacked, and set side by side",
    shape: () => (HEADER_ROW() ? "side-by-side" : "stacked"),
    elements: () => select(".flip-row > *"),
  },
];

/** Long enough to read as a move, short enough not to be in the way. */
const DURATION = 380;

/**
 * How far an element has to end up from where it started before the move is
 * worth animating, in px.
 *
 * A shape change is not always a re-arrangement: the rows are measured at
 * whatever width the window is, so a crossing can leave everything within a few
 * pixels of where it was. Easing that is motion with nothing to show for it —
 * and it is what made a window dragged along a threshold look like it was
 * re-animating on every pixel. Below this the new position is simply taken.
 */
const MIN_MOVE = 8;

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

/** How far something moved, as an offset back to where it was. */
interface Offset {
  dx: number;
  dy: number;
}

/**
 * How much of an inner row's movement is its own, rather than its container's.
 *
 * The nav lives inside the hero column, and both change shape at the same width.
 * The nav's cells are measured where they are on the page, so their displacement
 * already includes everything their container did — easing them by it would add
 * the container's own offset on top and send them out past their new place
 * before easing back. Easing them by the difference means the container's
 * transform carries them across the page while their own offset animates the
 * movement they made inside it, which together land exactly where they started.
 */
function carriedBy(inner: Group, outer: Group, before: Positions, after: Positions): Offset {
  const first = inner.elements()[0];
  if (!first) return { dx: 0, dy: 0 };

  const containers = outer.elements();
  const index = containers.findIndex((element) => element.contains(first));
  const from = index < 0 ? undefined : before[index];
  const to = index < 0 ? undefined : after[index];
  if (!from || !to) return { dx: 0, dy: 0 };

  return { dx: from.left - to.left, dy: from.top - to.top };
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
function ease(group: Group, before: Positions, after: Positions, carried: Offset = { dx: 0, dy: 0 }): void {
  const items = group.elements();
  const generation = ++run;

  // Every element of the row is cleared first, not just the ones about to move.
  // A run that is interrupted — drag a window across a line, then back — leaves
  // offsets behind on the elements it moved, and one of those that happens to be
  // in the same place this time would never be cleared again: it would keep the
  // old offset until the page was reloaded.
  for (const item of items) {
    item.style.transition = "none";
    item.style.transform = "";
  }

  const moved: HTMLElement[] = [];

  after.forEach((rect, index) => {
    const item = items[index];
    const from = before[index];
    if (!item || !from) return;
    // Two spaces, not four: an interior row's own movement inside the box its
    // container's transform is already carrying it in.
    const dx = from.left - rect.left - carried.dx;
    const dy = from.top - rect.top - carried.dy;
    if (Math.hypot(dx, dy) < MIN_MOVE) return;
    item.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push(item);
  });

  if (!moved.length) {
    // Nothing worth animating — but the labels were muted for the measurement,
    // and leaving the class on would keep them muted for good. The inline
    // `transition: none` goes with it. Only while this run is still the current
    // one: a newer run owns that class.
    if (generation === run) {
      for (const item of items) item.style.transition = "";
      document.documentElement.classList.remove(RUNNING);
    }
    return;
  }

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
    // The whole row again, so nothing a previous run touched is left behind.
    for (const item of items) {
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
        // Only the rows that crossed are eased. A row that sits inside another
        // crossed row is eased by what it did *within* that row, since the
        // container's own transform is already carrying it — see `carriedBy`.
        GROUPS.forEach((group, index) => {
          if (!crossed[index]) return;
          let carried: Offset = { dx: 0, dy: 0 };
          GROUPS.forEach((other, j) => {
            if (j === index || !crossed[j]) return;
            if (carried.dx || carried.dy) return;
            carried = carriedBy(group, other, snapshot[j] ?? [], after[j] ?? []);
          });
          ease(group, snapshot[index] ?? [], after[index], carried);
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
