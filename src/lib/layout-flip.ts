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

  const dx = from.left - to.left;
  const dy = from.top - to.top;

  // Only a container that is itself being eased carries the row inside it.
  // `ease` leaves anything under MIN_MOVE exactly where the layout put it, and
  // subtracting a move that never happens would leave the inner cells short of
  // their place by the same amount — a small, permanent offset, which is what
  // this whole file exists to avoid.
  if (Math.hypot(dx, dy) < MIN_MOVE) return { dx: 0, dy: 0 };

  return { dx, dy };
}

/** Where every element of one row sits right now, in DOM order. */
function measure(group: Group): Positions {
  return group.elements().map((item) => item.getBoundingClientRect());
}

/**
 * Drops any inline transition or offset a row is still carrying, so the next
 * measurement reads the layout rather than an animation halfway through it.
 * Nothing paints between this and the new offsets being applied — both happen
 * in the same task — so clearing a row that is still moving is invisible.
 */
function clear(group: Group): void {
  for (const item of group.elements()) {
    item.style.transition = "none";
    item.style.transform = "";
  }
}

/**
 * Hands a row back to the stylesheet once the motion is over: the offsets are
 * gone and the inline `transition: none` the clearing pass left behind goes
 * with them, so nothing here outlives the flip.
 */
function settle(group: Group): void {
  for (const item of group.elements()) {
    item.style.transition = "";
    item.style.transform = "";
  }
}

/**
 * The flip currently being animated, so a stale cleanup timer cannot clear the
 * styles of a newer one — dragging a window across a line and back is enough to
 * overlap two runs.
 *
 * It counts *crossings*, not rows. Bumping it inside `ease` instead would make
 * the second row of a crossing cancel the first: the nav sits inside the home
 * page's hero row, so crossing the laptop breakpoint changes both shapes in the
 * same frame, and the nav's own animation was being superseded by the hero's
 * before it ever started — leaving every icon parked at its starting offset
 * with `transition: none` and nothing left to bring it home.
 */
let run = 0;

/** Whether the last crossing is still easing. Read by the snapshot, which must never be taken mid-flight. */
let inFlight = false;

/**
 * Elements are moved with a transform rather than by animating the layout: a
 * flex row cannot tween between two arrangements, but offsetting each item and
 * easing the offset back to zero looks the same and costs one composited layer
 * per element.
 *
 * `generation` belongs to the crossing that asked for this, so every row of one
 * crossing animates and only a newer crossing supersedes them. Returns whether
 * anything was worth animating.
 */
function ease(
  group: Group,
  before: Positions,
  after: Positions,
  generation: number,
  carried: Offset = { dx: 0, dy: 0 }
): boolean {
  const items = group.elements();

  // Every element of the row is cleared first, not just the ones about to move.
  // A run that is interrupted — drag a window across a line, then back — leaves
  // offsets behind on the elements it moved, and one of those that happens to be
  // in the same place this time would never be cleared again: it would keep the
  // old offset until the page was reloaded.
  clear(group);

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

  if (!moved.length) return false;

  // Take the offset as the starting point before the browser paints it.
  void document.documentElement.offsetHeight;

  requestAnimationFrame(() => {
    if (generation !== run) return;
    for (const item of moved) {
      item.style.transition = `transform ${DURATION}ms ${EASING}`;
      item.style.transform = "";
    }
  });

  return true;
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
        // animate — just keep the record of where things are up to date. Not
        // while a flip is still running, though: the rects would be of the
        // animation rather than of the layout, and `carried` is read off them.
        if (!inFlight) snapshot = GROUPS.map(measure);
        return;
      }
      shape = now;

      // Muting the labels before measuring matters. Their own transition would
      // still be halfway through the previous shape, so the positions measured
      // here would be a moving target.
      document.documentElement.classList.add(RUNNING);

      // A crossing can arrive while the previous one is still easing. Clearing
      // first means `after` is the new layout and not the old animation, which
      // is what `carried` is derived from — an offset computed against a
      // half-eased container would be wrong by exactly that much, and stay
      // wrong once the motion stopped. Every row is measured before any of the
      // new offsets are applied, so one flip is never measured through
      // another's transform.
      for (const group of GROUPS) clear(group);
      const after = GROUPS.map(measure);

      // One generation for the whole crossing: every row that changed shape in
      // this frame has to ease, and only a newer crossing may supersede them.
      const generation = ++run;

      let moving = false;
      if (!reduced) {
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
          if (ease(group, snapshot[index] ?? [], after[index], generation, carried)) {
            moving = true;
          }
        });
      }

      if (moving) {
        inFlight = true;
        // One cleanup for the whole crossing, after the longest of the rows has
        // eased: every row is handed back to the stylesheet, and the snapshot is
        // re-taken then, because a measurement taken while a row is still moving
        // is a measurement of the animation.
        window.setTimeout(() => {
          if (generation !== run) return;
          for (const group of GROUPS) settle(group);
          document.documentElement.classList.remove(RUNNING);
          inFlight = false;
          snapshot = GROUPS.map(measure);
        }, DURATION + 80);
      } else {
        // Nothing worth animating — but the labels were muted for the
        // measurement and every row was cleared for it, and leaving either in
        // place would keep the labels muted for good. A previous crossing's
        // cleanup timer is no longer the current one, so this is also where
        // `inFlight` gets cleared for that case.
        for (const group of GROUPS) settle(group);
        document.documentElement.classList.remove(RUNNING);
        inFlight = false;
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
