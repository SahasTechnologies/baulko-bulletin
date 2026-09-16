/**
 * Decides how many lines the nav needs, so that a label opening stays inside
 * the page's text column.
 *
 * On a laptop the row is a line of icon-sized cells with the labels collapsed
 * behind them, opening on hover. Two labels can be open at once: the one
 * belonging to the page you are on stays out, and whichever link you are
 * pointing at opens. Nothing is reserved for them up front, so they widen the
 * row — and when the row has no slack left, the links they push along leave the
 * text column and sit in the margin.
 *
 * So the room the row has is measured against the width it would need with the
 * current page's label open and one more open beside it. Where that fits, one
 * line of icons is enough. Where it does not, the cells are put on the two lines
 * they are authored in — two lines of icons, each line with the room for its own
 * worst label — and where even that is not enough, the labels are shown outright,
 * wrapped, which is the shape the nav uses on anything that cannot hover.
 *
 * The classes it sets are what the condensed rules in global.css are scoped to,
 * so with JavaScript off the nav keeps the shape it has always had.
 */

/** The breakpoint and the pointer the condensed rules are written for. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 48rem)";

/** Puts the nav's two groups of cells on two lines. */
const TWO_ROWS = "nav-two-rows";

/** Gives up on hiding labels: shown, wrapped. */
const SPELLED = "nav-spelled";

/** Opens every label for one frame, so the cells can be measured. */
const MEASURING = "nav-measuring";

/** One link's cell: what it takes closed, and what its label adds. */
interface Cell {
  /** Width with the label collapsed. */
  closed: number;
  /** What the label adds when it opens, margin included. */
  extra: number;
  /** This is the page's own link, so its label is open whenever nothing is hovered. */
  active: boolean;
}

let pointer: MediaQueryList | null = null;

function navs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".icon-nav"));
}

function cellsOf(nav: HTMLElement): Cell[] {
  return Array.from(nav.querySelectorAll<HTMLElement>(".icon-nav-item")).map((item) => {
    const width = item.getBoundingClientRect().width;
    const label = item.querySelector<HTMLElement>(".icon-nav-label");
    if (!label) return { closed: width, extra: 0, active: false };

    // Measured with the label open, so the pair adds up to the cell's width:
    // what the collapsed cell is, and what opening the label puts back.
    const margin = Number.parseFloat(getComputedStyle(label).marginLeft) || 0;
    const extra = label.getBoundingClientRect().width + margin;
    const link = item.querySelector<HTMLElement>(".icon-nav-link");
    return {
      closed: Math.max(width - extra, 0),
      extra,
      active: link?.getAttribute("aria-current") === "page",
    };
  });
}

/**
 * The cells in each authored group. A nav without groups — the admin panel's —
 * is one group of everything, and so never needs the second line.
 */
function linesOf(nav: HTMLElement, cells: Cell[]): Cell[][] {
  const groups = Array.from(nav.querySelectorAll<HTMLElement>(":scope > .icon-nav-line"));
  if (!groups.length) return [cells];

  // Both lists are in the same DOM order, so the cells can be sliced by count.
  let taken = 0;
  return groups.map((group) => {
    const count = group.querySelectorAll(".icon-nav-item").length;
    const line = cells.slice(taken, taken + count);
    taken += count;
    return line;
  });
}

/**
 * Whether these cells can hold their own worst case: the page's label open —
 * wherever in the line it is — and the widest other label open beside it.
 */
function holds(cells: Cell[], gap: number, room: number): boolean {
  const closed = cells.reduce((sum, cell) => sum + cell.closed, 0);
  const gaps = gap * Math.max(cells.length - 1, 0);
  const active = cells.find((cell) => cell.active);
  const widest = cells.reduce((most, cell) => (cell.active ? most : Math.max(most, cell.extra)), 0);
  return closed + gaps + (active?.extra ?? 0) + widest <= room;
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
 * Marks the nav with the shape it needs. Runs whenever the layout may have
 * changed size — `src/lib/layout-flip.ts` calls it before it measures, so one
 * frame does the fitting and the easing in the right order.
 */
export function updateNavFit(): void {
  const root = document.documentElement;
  pointer ??= window.matchMedia(HOVER_QUERY);

  const rows = navs();
  if (!rows.length || !pointer.matches) {
    // Everywhere else the labels are shown already, wrapped.
    root.classList.remove(TWO_ROWS, SPELLED);
    return;
  }

  // Cleared before measuring, so the widths and the gap read are the ones the
  // icon shapes use — not whatever shape the nav happens to be in.
  root.classList.remove(TWO_ROWS, SPELLED);
  root.classList.add(MEASURING);
  const plans = rows.map((nav) => ({
    nav,
    gap: Number.parseFloat(getComputedStyle(nav).columnGap) || 0,
    lines: linesOf(nav, cellsOf(nav)),
  }));
  root.classList.remove(MEASURING);

  let twoRows = false;
  for (const plan of plans) {
    const room = roomFor(plan.nav);
    if (holds(plan.lines.flat(), plan.gap, room)) continue;
    if (plan.lines.length > 1 && plan.lines.every((line) => holds(line, plan.gap, room))) {
      twoRows = true;
      continue;
    }
    // Not even two lines can hold those two labels: show the labels.
    root.classList.add(SPELLED);
    return;
  }

  if (twoRows) root.classList.add(TWO_ROWS);
}

/** Which shape the fit test settled on, for the flip to notice a change of. */
export function navShape(): string {
  const classes = document.documentElement.classList;
  if (classes.contains(SPELLED)) return "spelled-out";
  return classes.contains(TWO_ROWS) ? "two-rows" : "one-row";
}
