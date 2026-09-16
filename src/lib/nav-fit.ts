/**
 * Spells the nav out when the icons cannot fit every label.
 *
 * On a laptop the row is a line of icon-sized cells with the labels collapsed
 * behind them, opening on hover. Nothing is reserved for a label up front, so a
 * long one opening pushes its neighbours sideways — and when the row has no room
 * left to give, the links it shoves past the edge leave the page's text column
 * and sit in the margin.
 *
 * So the room the row actually has is measured against the width the row would
 * take with every label open at once. Where that fits, the icons stay icons.
 * Where it does not, the row gives up on hiding labels and shows them all,
 * wrapped — one line if they fit on one, two if they need two — which is the
 * shape the nav already uses everywhere that cannot hover. Nothing is then
 * hidden and nothing can be pushed out.
 *
 * The class it sets is what the condensed rules in global.css are scoped to, so
 * with JavaScript off the nav keeps the shape it has always had.
 */

/** The breakpoint and the pointer the condensed rules are written for. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 48rem)";

/** Forces the spelled-out shape on a laptop. */
const WRAPPED = "nav-wrapped";

/** Opens every label for one frame, so the row's widest shape can be summed. */
const MEASURING = "nav-measuring";

let hoverQuery: MediaQueryList | null = null;

function navs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".icon-nav"));
}

/** The width the row would take with every label open. */
function openedWidth(nav: HTMLElement): number {
  const items = Array.from(nav.children) as HTMLElement[];
  const gap = Number.parseFloat(getComputedStyle(nav).columnGap) || 0;
  const cells = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0);
  return cells + gap * Math.max(items.length - 1, 0);
}

/**
 * How much width the row may take without leaving its container's content box.
 * In a row — the page headers put the brand beside the nav — that is what is
 * left after whatever else is in the row has taken its share.
 */
function roomFor(nav: HTMLElement): number {
  const parent = nav.parentElement;
  if (!parent) return 0;

  const style = getComputedStyle(parent);
  const box = parent.getBoundingClientRect();
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const content = box.width - padding;

  const isRow = style.display.includes("flex") && style.flexDirection.startsWith("row");
  if (!isRow) return content;

  const gap = Number.parseFloat(style.columnGap) || 0;
  const beside = Array.from(parent.children).filter((child) => child !== nav);
  const taken =
    beside.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * beside.length;
  return content - taken;
}

/**
 * Marks the nav spelled-out when it has to be. Runs whenever the layout may
 * have changed size — `src/lib/layout-flip.ts` calls it before it measures, so
 * one frame does the fitting and the easing in the right order.
 */
export function updateNavFit(): void {
  const root = document.documentElement;
  hoverQuery ??= window.matchMedia(HOVER_QUERY);

  const rows = navs();
  if (!rows.length || !hoverQuery.matches) {
    // Everywhere else the labels are shown already, wrapped.
    root.classList.remove(WRAPPED);
    return;
  }

  // Measured in the condensed shape on purpose: that shape's spacing is the
  // spacing the widest shape would have to fit into.
  root.classList.remove(WRAPPED);
  root.classList.add(MEASURING);
  const tooWide = rows.some((nav) => openedWidth(nav) > roomFor(nav));
  root.classList.remove(MEASURING);

  if (tooWide) root.classList.add(WRAPPED);
}

/** The shape the fit test decided on, for the flip to notice. */
export function navIsWrapped(): boolean {
  return document.documentElement.classList.contains(WRAPPED);
}
