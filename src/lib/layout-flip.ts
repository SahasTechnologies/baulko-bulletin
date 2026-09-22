/**
 * Eases the page across a breakpoint instead of letting it jump.
 *
 * Every page here is laid out one way on a laptop and another way everywhere
 * else, and each of those switches takes effect the instant its width crosses
 * the line: the nav's cells re-wrap onto a different number of lines, a header's
 * brand moves from above its nav to beside it, a grid of cards gives up a
 * column, a footer's two columns become one — and everything below any of those
 * moves up or down by whatever room the change gave back. Arrived at by dragging
 * a window along the edge, that reads as the site being replaced rather than
 * resized: every element somewhere else, in one frame.
 *
 * So each crossing runs the standard FLIP trick over the whole page: read where
 * every element was, let the new shape apply, offset each one back to where it
 * came from, and let it ease home. Only positions are animated — the page still
 * lays itself out exactly the way CSS says, and none of this runs without
 * JavaScript.
 *
 * What a crossing is, and what moves, is found rather than listed:
 *
 *   - the width crossing any `min-width`/`max-width` the page's own CSS switches
 *     on, read out of the stylesheets rather than assumed, so a breakpoint added
 *     later is covered without touching this file;
 *   - a row changing shape while the page is still: the children of a box that
 *     arranges them itself — a flex row, a grid — gathered into lines by which
 *     of their boxes overlap vertically. Three lines down to two, or stacked to
 *     side by side, is a shape change whatever caused it.
 *
 * A page that does not want something moved can say so: `data-flip="off"`, and
 * an island that has not hydrated yet is left alone until it has, so that no
 * inline style lands on markup React has not taken over.
 */

/** An element's move, as the offset it has to be held back by, in px. */
interface Offset {
  dx: number;
  dy: number;
}

/** An element the flip may move: anything with a box of its own. */
type Box = HTMLElement | SVGElement;

/** One box and the children it arranges, by position in `items`. */
interface Row {
  kids: number[];
  /** The line each of those children sat on when it was last read. */
  lines: number[];
}

/** Long enough to read as a move, short enough not to be in the way. */
const DURATION = 380;

/** The same overshoot the rest of the site's hover motion uses. */
const EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * How far an element has to end up from where it started before the move is
 * worth animating, in px.
 *
 * A crossing is not always a re-arrangement: rows are read at whatever width the
 * window is, so a crossing can leave most of the page within a few pixels of
 * where it was, and easing that is motion with nothing to show for it. Below this
 * the new position is simply taken. It is also the slack an element inside a
 * moving box is allowed: one carried along by a parent that is itself being eased
 * needs no offset of its own unless it also moved within that parent.
 */
const MIN_MOVE = 8;

/** How much two boxes have to overlap vertically to count as one line, in px. */
const LINE = 2;

/**
 * The class the muting rule in global.css hangs off. It is set while a flip runs,
 * so that a nav label's own transition cannot fire mid-measurement and turn the
 * positions being read into a moving target — two motions at once would also
 * fight each other.
 */
const RUNNING = "layout-flip";

/** Where the page has motion of its own and does not want this one. */
const OFF = '[data-flip="off"]';

/**
 * An island that has not hydrated yet, and so is still React's to own.
 *
 * `astro-island` carries an `ssr` marker until it has hydrated. An inline style
 * written into one before that is a style React never rendered, and it says so —
 * "a tree hydrated but some attributes ... didn't match", which it does not patch
 * up. So the elements inside are left where they land until the marker comes
 * off, which is a frame or two into the page's life; the boxes around them are
 * eased as usual, and the reading is taken again when it does.
 */
const PENDING = "astro-island[ssr]";

/**
 * The widths a page can change shape at, as written in the page's own CSS:
 * `(min-width: 48rem)`, `(max-width: 48rem)`, and the `(width >= 48rem)` form
 * newer Tailwind emits. Matching both spellings matters, or a stylesheet that
 * switched to the range syntax would contribute nothing here.
 */
const SWITCH = /\(\s*(?:min-width\s*:\s*|max-width\s*:\s*|width\s*[<>]=?\s*)([\d.]+)(px|rem|em)\s*\)/g;

let started = false;

/** Every box on the page the flip may move, in document order. */
let items: Box[] = [];
/** Where each of them is in `items`, for reading a parent's place. */
let index = new Map<Box, number>();
/** The boxes that arrange children of their own, with the lines they were on. */
let rows: Row[] = [];
/** Boxes whose own CSS would animate a property a flip writes. */
let tuned: Box[] = [];
/** The widths the page's CSS switches at, and which side of each we are on. */
let limits: number[] = [];
let lists: MediaQueryList[] = [];
let sides: boolean[] = [];

/**
 * Where the elements were, and where they are: four numbers each — x, y, width,
 * height, in viewport coordinates. `was` is the last frame's reading and so the
 * "before" of any move, `is` is the one being taken now, and the two are swapped
 * rather than reallocated, so a drag makes no garbage. `bare` is the layout with
 * every offset taken off, which is only needed for a crossing that arrives while
 * a flip is still running.
 */
let was = new Float64Array(0);
let is = new Float64Array(0);
let bare = new Float64Array(0);

/** Scratch for one row's line numbers, so reading them allocates nothing. */
let lines: number[] = [];

/** The elements carrying an offset, by position in `items`. */
let carried = new Map<number, Box>();
/** The elements whose own transitions were muted for the flip that is running. */
let muted = new Set<Box>();
/** Where each element being eased goes, so its children can subtract it. */
let placements = new Map<number, Offset>();

/** The flip being animated, so a stale cleanup cannot clear a newer one's styles. */
let run = 0;
/** Whether the last crossing is still easing. */
let inFlight = false;

/**
 * Whether an element is a box the flip can move.
 *
 * An inline-level box only has a place of its own when the box around it
 * arranges its children — a flex row, a grid. Inside a paragraph it is a word in
 * a line of text, and a word may not glide out of its sentence while the rest of
 * the sentence is set again in one frame.
 */
function isBox(element: Element, parent: Element | null): element is Box {
  if (!(element instanceof HTMLElement || element.tagName === "svg")) return false;

  const display = getComputedStyle(element).display;
  if (display === "none" || display === "contents") return false;
  if (display !== "inline" && !display.startsWith("inline-")) return true;

  return !!parent && /flex|grid/.test(getComputedStyle(parent).display);
}

/** Whether an element's own CSS has motion of its own to be held still. */
function hasTime(duration: string): boolean {
  return duration.split(",").some((part) => Number.parseFloat(part) > 0);
}

/** Where every element is right now, in viewport coordinates. */
function measure(into: Float64Array): void {
  for (let at = 0; at < items.length; at++) {
    const rect = items[at].getBoundingClientRect();
    const slot = at * 4;
    into[slot] = rect.left;
    into[slot + 1] = rect.top;
    into[slot + 2] = rect.width;
    into[slot + 3] = rect.height;
  }
}

/**
 * Reads each row's lines out of a reading, and reports whether any row has
 * changed shape since it was last read.
 *
 * Only meaningful while the page is still. Mid-flight the children are wherever
 * the easing has carried them, and the lines they read as there are a shape the
 * page has never been in.
 */
function readLines(from: Float64Array): boolean {
  let changed = false;

  for (const row of rows) {
    lines.length = 0;
    let line = 0;
    let top = 0;
    let bottom = 0;

    row.kids.forEach((kid, position) => {
      const slot = kid * 4;
      const kidTop = from[slot + 1];
      const kidBottom = kidTop + from[slot + 3];

      if (position === 0) {
        top = kidTop;
        bottom = kidBottom;
      } else if (Math.min(bottom, kidBottom) - Math.max(top, kidTop) >= LINE) {
        // Overlapping the line so far: another child of it, however different
        // its height — a tall logo and a short heading share a line.
        top = Math.min(top, kidTop);
        bottom = Math.max(bottom, kidBottom);
      } else {
        line++;
        top = kidTop;
        bottom = kidBottom;
      }
      lines.push(line);
    });

    if (!row.lines.length) {
      row.lines = lines.slice();
      continue;
    }

    if (row.lines.length !== lines.length || row.lines.some((had, at) => had !== lines[at])) {
      changed = true;
      row.lines = lines.slice();
    }
  }

  return changed;
}

/**
 * The widths the page's own CSS switches at, in px.
 *
 * Read out of the stylesheets rather than listed here, because the list is not
 * this file's to keep: it is every width the page lays itself out by, which is
 * where a layout can change shape. A stylesheet from another origin cannot be
 * read — the browser will not hand over its rules — so those are skipped, and the
 * row test above still catches whatever they change.
 */
function switches(): number[] {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const found = new Set<number>();

  const scan = (text: string) => {
    for (const [, value, unit] of text.matchAll(SWITCH)) {
      const size = Math.round(Number.parseFloat(value) * (unit === "px" ? 1 : rem));
      if (size > 0) found.add(size);
    }
  };

  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) scan(rule.conditionText);
      // Media rules nest, and Tailwind keeps them inside `@layer` and `@supports`
      // blocks, so anything that holds rules is walked too.
      const inside = (rule as Partial<CSSGroupingRule>).cssRules;
      if (inside) walk(inside);
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Another origin's stylesheet: its rules are not readable from here.
    }
  }

  return [...found].sort((a, b) => a - b);
}

/**
 * Reads the page: which boxes exist, which of them arrange children, and which
 * widths its CSS switches at. Run at the start, and again whenever the page's own
 * tree changes — islands fill themselves in after the first run.
 */
function read(): void {
  const boxes: Box[] = [];
  index = new Map();
  tuned = [];

  for (const element of document.body?.querySelectorAll("*") ?? []) {
    if (element.closest(OFF) || element.closest(PENDING)) continue;
    if (!isBox(element, element.parentElement)) continue;
    const style = getComputedStyle(element);
    index.set(element, boxes.length);
    boxes.push(element);
    if (hasTime(style.transitionDuration)) tuned.push(element);
  }

  items = boxes;

  // The children of each box, which is not the same as its DOM children: a
  // wrapper with `display: contents` — how the nav's two lines are authored —
  // has no box of its own, so its children are laid out by whatever holds it.
  const kids: number[][] = boxes.map(() => []);
  boxes.forEach((box, at) => {
    for (let up = box.parentElement; up; up = up.parentElement) {
      const parent = index.get(up);
      if (parent === undefined) continue;
      kids[parent].push(at);
      return;
    }
  });

  rows = [];
  boxes.forEach((box, at) => {
    if (kids[at].length < 2) return;
    // Only a box that arranges its children itself can move them between lines;
    // a block that stacks them keeps the same lines however narrow it gets.
    if (!/flex|grid/.test(getComputedStyle(box).display)) return;
    rows.push({ kids: kids[at], lines: [] });
  });

  limits = switches();
  // The queries decide which side of each width the window is on, which is a
  // question the browser answers and `innerWidth` only approximates: whether the
  // scrollbar is part of the viewport is the browser's business, not ours.
  lists = limits.map((limit) => window.matchMedia(`(min-width: ${limit}px)`));
  sides = lists.map((list) => list.matches);

  was = new Float64Array(items.length * 4);
  is = new Float64Array(items.length * 4);
  bare = new Float64Array(items.length * 4);

  measure(was);
  readLines(was);
}

/** Takes the elements' offsets off and gives their transitions back. */
function settle(): void {
  for (const element of carried.values()) {
    element.style.transition = "";
    element.style.transform = "";
  }
  for (const element of muted) element.style.transition = "";

  carried.clear();
  muted.clear();
  placements.clear();
  document.documentElement.classList.remove(RUNNING);
  inFlight = false;

  // The page has arrived, so this reading is the next move's starting point.
  measure(was);
  readLines(was);
}

/**
 * Whether a mutation changed the page's boxes — an element added or taken away,
 * or an island that had been left alone finishing its hydration.
 */
function grew(record: MutationRecord): boolean {
  if (record.type === "attributes") {
    // The `ssr` marker coming off is the only attribute watched, and it means
    // the elements inside that island are the flip's to move from now on.
    return record.target instanceof Element && !record.target.matches(PENDING);
  }
  for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) return true;
  for (const node of record.removedNodes) if (node.nodeType === Node.ELEMENT_NODE) return true;
  return false;
}

export function initLayoutTransition(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  read();

  const swap = () => {
    const spare = was;
    was = is;
    is = spare;
  };

  const step = () => {
    let crossed = false;
    lists.forEach((list, at) => {
      if (list.matches !== sides[at]) crossed = true;
    });
    if (crossed) lists.forEach((list, at) => (sides[at] = list.matches));

    // With the new layout, and with whatever offset a flip still running is
    // carrying: read here rather than at the previous frame's end, so that a
    // crossing which arrives mid-flight starts from where the elements look.
    measure(is);

    // Rows are read only while the page is still, for the reason above: their
    // children are mid-move, and the lines they read as there are nothing the
    // page has ever looked like. A change made while a flip runs is picked up by
    // the reading that flip takes when it settles.
    const relaid = inFlight ? false : readLines(is);

    if (!crossed && !relaid) {
      swap();
      return;
    }

    document.documentElement.classList.add(RUNNING);

    // An element whose own CSS has a transition would animate the writes the flip
    // is about to make — and, worse, would start its move from wherever that
    // transition had got to rather than from where it was. Held still for the
    // length of the flip, and given back at the end of it.
    for (const element of tuned) {
      element.style.transition = "none";
      muted.add(element);
    }

    // Mid-flight, the elements still carrying an offset are already on their way
    // somewhere, and the reading above is where they look now — which is where
    // this move has to start from, rather than where the last one did. Their
    // offsets are what stands in the way, so those come off, and the layout
    // underneath is read again with them clear.
    const flying = new Set(carried.keys());
    let to = is;

    if (flying.size) {
      for (const element of carried.values()) {
        element.style.transition = "none";
        element.style.transform = "";
      }
      measure(bare);
      to = bare;
    }

    carried.clear();
    placements.clear();

    let easing = false;

    if (!reduced) {
      const room = window.innerHeight;

      items.forEach((element, at) => {
        const slot = at * 4;
        const source = flying.has(at) ? is : was;
        const dx = source[slot] - to[slot];
        const dy = source[slot + 1] - to[slot + 1];

        // Nothing to ease, or nowhere anyone is looking: an element more than a
        // screen off the viewport is a layer nobody sees, and by the time it is
        // scrolled to it will have settled anyway.
        if (!to[slot + 2] && !to[slot + 3]) return;
        if (Math.hypot(dx, dy) < MIN_MOVE) return;
        if (to[slot + 1] + to[slot + 3] < -room || to[slot + 1] > room * 2) return;

        // An offset is a move *within* whatever contains it. An ancestor that is
        // itself being eased is already carrying this element along, and easing
        // both by their full displacement would add the two together and send it
        // out past its place before easing back.
        let carrier: Offset | undefined;
        for (let up = element.parentElement; up && !carrier; up = up.parentElement) {
          const parent = index.get(up);
          if (parent === undefined) continue;
          carrier = placements.get(parent);
        }

        const own = { dx: dx - (carrier?.dx ?? 0), dy: dy - (carrier?.dy ?? 0) };
        if (Math.hypot(own.dx, own.dy) < MIN_MOVE) return;

        element.style.transition = "none";
        element.style.transform = `translate(${own.dx}px, ${own.dy}px)`;
        carried.set(at, element);
        placements.set(at, { dx, dy });
        easing = true;
      });
    }

    if (!easing) {
      // Nothing worth animating — but the labels were muted and the offsets were
      // cleared for the reading, and leaving either in place would leave the page
      // in a shape nobody asked for.
      settle();
      return;
    }

    // Take the offsets as the starting point before the browser paints them.
    void document.documentElement.offsetHeight;

    inFlight = true;
    const generation = ++run;

    requestAnimationFrame(() => {
      if (generation !== run) return;
      for (const element of carried.values()) {
        element.style.transition = `transform ${DURATION}ms ${EASING}`;
        element.style.transform = "";
      }
    });

    // One cleanup for the whole crossing, after the longest of the moves has
    // eased: every element is handed back to the stylesheet, and the reading is
    // taken again then, because a reading taken while a page is still moving is a
    // reading of the animation.
    window.setTimeout(() => {
      if (generation !== run) return;
      settle();
    }, DURATION + 80);
  };

  // One reading per frame, however many resize events the browser sends: a
  // window dragged across a threshold can deliver several, and each one would
  // otherwise read the whole page again for the same layout.
  let waiting = 0;
  const onResize = () => {
    cancelAnimationFrame(waiting);
    waiting = requestAnimationFrame(step);
  };

  window.addEventListener("resize", onResize);

  // The page's own webfont and its images both land after the first reading, and
  // both move what is below them when they do: the nav's labels are set in the
  // webfont, so the row they wrap into is not its final shape until it has
  // loaded. Either arrival is a layout change worth a reading.
  document.fonts?.ready.then(step).catch(() => {});
  window.addEventListener("load", step);

  // A page's islands fill themselves in after this runs, and the panel rewrites
  // its own lists as they are searched and paged. The elements underneath are
  // what the flip moves, so the list is taken again when the tree changes — and
  // again when an island takes its `ssr` marker off, since its contents were left
  // out of the list until then. The reading goes with it: the tree has just
  // changed, so this frame is the page arriving rather than anything to ease.
  let pending = false;
  new MutationObserver((records) => {
    if (pending) return;
    // Only a change of elements can move anything. A reader that rewrites the
    // text of a cell as it is played changes no boxes, and walking the page for
    // that would be work at the speed of the reader's own clicks.
    if (!records.some(grew)) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      read();
    });
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["ssr"],
  });
}
