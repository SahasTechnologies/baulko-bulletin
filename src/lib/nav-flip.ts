/**
 * Eases the nav across its breakpoint instead of letting it jump.
 *
 * The nav has two shapes — labels tucked behind the icons on a hover-capable
 * laptop, labels spelled out everywhere else — and a media query decides which
 * one is in use, so CSS swaps them the instant the width crosses the line.
 * Dragging a window narrow, or turning a tablet, therefore reads as the site
 * being replaced rather than resized.
 *
 * So the crossing runs the standard FLIP trick: measure where every link was,
 * let the new shape apply, offset each link back to where it came from, and let
 * it ease home. Only positions are animated — the row still lays itself out the
 * way CSS says, and the helper is inert without JavaScript.
 *
 * A link is found by its index within its row, which is stable: the links are
 * the same links in the same order in both shapes.
 */

/**
 * The breakpoint the two shapes meet at. It has to stay in step with the media
 * query in `global.css` — that rule decides the layout, this one only notices
 * when it has changed.
 */
const NAV_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 48rem)";

/** Long enough to read as a move, short enough not to be in the way. */
const DURATION = 380;

/** The same overshoot the rest of the site's hover motion uses. */
const EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

type Positions = DOMRect[][];

let started = false;

function navRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".icon-nav"));
}

function itemsIn(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>(":scope > .icon-nav-item"));
}

/** Where every link sits right now, per row, in DOM order. */
function measure(): Positions {
  return navRows().map((row) => itemsIn(row).map((item) => item.getBoundingClientRect()));
}

/**
 * Links are moved with a transform rather than by animating the layout: a flex
 * row cannot tween between two arrangements, but offsetting each item and
 * easing the offset back to zero looks the same and costs one composited layer
 * per link.
 */
function ease(before: Positions, after: Positions): void {
  const rows = navRows().map(itemsIn);
  const moved: HTMLElement[] = [];

  rows.forEach((items, row) => {
    items.forEach((item, index) => {
      const from = before[row]?.[index];
      const to = after[row]?.[index];
      if (!from || !to) return;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      // Under a pixel is the same place as far as anyone can see.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      item.style.transition = "none";
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(item);
    });
  });

  if (!moved.length) return;

  // Take the offset as the starting point before the browser paints it.
  void document.documentElement.offsetHeight;

  requestAnimationFrame(() => {
    for (const item of moved) {
      item.style.transition = `transform ${DURATION}ms ${EASING}`;
      item.style.transform = "";
    }
  });

  window.setTimeout(() => {
    for (const item of moved) {
      item.style.transition = "";
      item.style.transform = "";
    }
    document.documentElement.classList.remove("nav-flip");
  }, DURATION + 80);
}

/**
 * Starts watching. Safe to call from more than one component — a page can hold
 * both the public nav and the admin one — and a no-op when the reader has asked
 * for reduced motion: this is decoration, and the layout change works without
 * it.
 */
export function initNavTransition(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const query = window.matchMedia(NAV_QUERY);
  let wide = query.matches;
  let snapshot = measure();
  let frame = 0;

  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const nowWide = query.matches;
      if (nowWide === wide) {
        // An ordinary resize: the nav is in the same shape, so there is nothing
        // to animate — just keep the record of where things are up to date.
        snapshot = measure();
        return;
      }
      wide = nowWide;

      // Muting the labels before measuring matters. Their own transition would
      // still be halfway through the previous shape, so the positions measured
      // here would be a moving target — and the two animations would fight.
      document.documentElement.classList.add("nav-flip");
      const after = measure();
      ease(snapshot, after);
      snapshot = after;
    });
  };

  window.addEventListener("resize", onResize);
}
