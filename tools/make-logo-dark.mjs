/**
 * Build the dark-mode logo from the light one, and set the light one's cut-out.
 *
 * The mark is drawn for a white page: a black outline and black interior
 * shapes around orange fill and a green leaf, with the background left
 * transparent. On the dark page that black disappears into the background, so
 * this writes a second file — `public/bulletin-dark.png` — in which:
 *
 *   - black (and every neutral from black up to white) is ramped to a dark
 *     orange, so the outline and the shapes inside it stay readable without
 *     shouting off a near-black page — except inside the leaf, where the line
 *     down its middle becomes a dark green instead. An orange line in a green
 *     leaf reads as a mistake; a green one reads as a vein;
 *   - the artwork's own orange — a mid, saturated orange that is close in
 *     brightness to the dark page — becomes a brighter, lighter one;
 *   - the cut-outs the drawing means as white are white here too, because
 *     `--light` has already painted them in the light file, which this reads.
 *     The gaps that are the insides of the drawing's strokes — the two legs,
 *     and nothing else — are left transparent in both files, so each theme
 *     shows its own page through them rather than a white blob.
 *
 * It stays a recolour rather than a redraw: the drawing, its shading and its
 * soft edges are all the light file's, which remains the source of truth.
 *
 * Usage:
 *   node tools/make-logo-dark.mjs                     # write public/bulletin-dark.png
 *   node tools/make-logo-dark.mjs --cutout-min 20     # how wide a gap counts as a shape
 *   node tools/make-logo-dark.mjs --light             # paint the light logo's cut-out
 *   node tools/make-logo-dark.mjs --out other.png     # somewhere else
 *   node tools/make-logo-dark.mjs --color '#A9451A'   # what the black becomes
 *   node tools/make-logo-dark.mjs --orange '#FF9C4A'  # what the orange becomes
 *   node tools/make-logo-dark.mjs --vein '#33691E'    # the line inside the leaf
 *   node tools/make-logo-dark.mjs --check             # is the committed file this one?
 *
 * Re-run it after replacing public/bulletin.png.
 *
 * `--light` is the one edit the light file needs rather than inherits: the
 * drawing leaves its biggest cut-out transparent, and the design wants it
 * white — the same white the dark file gets — while the drawing's small line
 * gaps stay holes. It writes that file in place, changes nothing else, and is
 * idempotent, so it is safe to run on a file it has already painted. `npm run
 * logo:light` does this; `--check` on its own verifies the dark file.
 *
 * `--check` writes nothing and compares instead: the colours the file actually
 * holds against the colours this run would paint, pixel for pixel. It exists
 * because the failure it catches is invisible in a diff — a dark logo left over
 * from an earlier palette is a perfectly valid PNG that only shows the wrong
 * outline once it is on a dark page — and because `npm run check` runs on every
 * deploy, so a stale file is caught before it ships rather than after.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
/** Compare the output against the file on disk instead of writing it. */
const CHECK = args.includes("--check");

// sharp is not a declared dependency: Astro's image pipeline installs it, and
// adding it to package.json would rewrite half the lockfile for one script.
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  // In check mode a missing decoder is a check that cannot be made, not a
  // failed one: `npm run check` runs on every deploy, and a build machine
  // without sharp must not start rejecting deploys over a logo file.
  if (CHECK) {
    console.warn("! skipping the dark-logo check: sharp is not installed (npm i -D sharp)");
    process.exit(0);
  }
  console.error(
    "This script needs sharp, which normally comes with Astro. Install it with:\n  npm i -D sharp"
  );
  process.exit(1);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

/** Paint the light file's own cut-out and stop there: no recolouring. */
const LIGHT = args.includes("--light");

const SOURCE = argValue("--source", "public/bulletin.png");
const OUTPUT = argValue("--out", LIGHT ? "public/bulletin.png" : "public/bulletin-dark.png");
/**
 * What black becomes: a deep, muted orange.
 *
 * It is the outline — the thing separating one shape from the next — so it has
 * to read against a near-black page. #C2410C was the first answer and it sat
 * too bright and too loud against the fill; this keeps the hue and pulls the
 * saturation and the brightness both back, which is what stops the mark looking
 * lit from inside at tile size. Still the darker of the two oranges once this
 * has run, and still clear of the page: against the dark page's 0.003 this is
 * about 3.4:1, over the 3:1 a graphic needs.
 */
const OUTLINE_ORANGE = argValue("--color", "#A9451A");
/**
 * What the artwork's own orange becomes. The #E08040 it is drawn in is close to
 * the dark page in brightness, so it is replaced with a brighter one — and one
 * clearly darker than the outline above, or the drawing loses its edge.
 */
const FILL_ORANGE = argValue("--orange", "#FF9C4A");
/**
 * What the line down the leaf becomes, in place of the orange above.
 *
 * Only the leaf's own line: a pixel counts as vein when the artwork's green
 * flanks it on both sides within VEIN_REACH. That is the vein and not the
 * leaf's outline, which has green on one side and the page on the other.
 */
const VEIN_GREEN = argValue("--vein", "#33691E");

/** Alpha at or below this is treated as "not part of the artwork". */
const ALPHA_CUTOFF = 128;
/**
 * How far the white fill reaches past the cut-out itself. The edge of a cut-out
 * is anti-aliased — those pixels are part artwork, part hole — so the fill has
 * to cover them or a dark rim is left behind. Over-filling is harmless: the
 * fill is composited *under* the artwork.
 */
const FILL_MARGIN = 2;
/**
 * How wide a cut-out has to be, in pixels, to count as one of the drawing's own
 * white shapes rather than the inside of a stroke.
 *
 * The drawing has two kinds of enclosed transparency and they want opposite
 * treatment. The mark's own white — the cut-out through the body, the fly's two
 * round shapes and the small pieces with them — is a shape, and white in both
 * files. The gaps left inside a stroke — the fly's two legs, which are lines
 * drawn thin — are holes the page should show through, and filling them is what
 * turns a leg into a white blob.
 *
 * Width is what separates them, measured as how deep the gap goes — how many
 * pixels you can walk into it from its edge before you run out of gap. The six
 * gaps inside the fly measure 21, 17, 10, 8, 3 and 2, and the cut-out through
 * the body 60, so 12px across (an inset of 6) sits neatly between the drawing's
 * shapes and the two legs, with room on both sides of it.
 */
const CUTOUT_MIN_WIDTH = Number(argValue("--cutout-min", "12"));
/** The inset that width means for the flood below: half of it, rounded up. */
const MIN_INSET = Math.ceil((CUTOUT_MIN_WIDTH - 1) / 2);
/**
 * How wide a run of black has to be, in pixels, to be too wide to be a line the
 * drawing made. The leaf's line measures between 9 and 37px across and the black
 * under the leaf's blade 54px, so the line has room on either side of it.
 */
const VEIN_MAX_WIDTH = 44;
/** Below this saturation a pixel counts as neutral, i.e. black-and-white art. */
const NEUTRAL_SATURATION = 40;
/** At or above this value a neutral pixel is already white and is left as it is. */
const WHITE_CUTOFF = 245;

function hexToRgb(hex) {
  const value = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`This wants a 6-digit hex, got "${hex}"`);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Marks the cut-outs the drawing is meant to show as white.
 *
 * A flood fill from every transparent border pixel walks the page around the
 * mark; the transparent pixels it never reaches are enclosed by the artwork.
 * Those are then grouped into the blobs they form — they are not one region,
 * and the cut-out through the body of the mark, the fly's shapes and the gaps
 * inside its legs are separate blobs — and a blob is marked only if the gap it
 * leaves is wide enough to be a shape rather than the inside of a stroke.
 *
 * A scan-line walk would be wrong here: the outline is not a rectangle, and a
 * hole can be reached around a thin stroke, so this floods properly.
 */
function whiteCutouts(data, width, height, channels, minInset) {
  const transparent = (x, y) => data[(y * width + x) * channels + 3] <= ALPHA_CUTOFF;
  const background = new Uint8Array(width * height);
  const stack = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (background[index] || !transparent(x, y)) return;
    background[index] = 1;
    stack.push(index);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const mask = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const areas = [];
  /** How many of those gaps turned out to be shapes rather than line gaps. */
  let white = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (background[start] || seen[start] || !transparent(x, y)) continue;

      const cells = [start];
      const queue = [start];
      seen[start] = 1;
      while (queue.length) {
        const index = queue.pop();
        const bx = index % width;
        const by = (index - bx) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || background[next] || !transparent(nx, ny)) continue;
          seen[next] = 1;
          cells.push(next);
          queue.push(next);
        }
      }

      // How deep the gap goes: walk in from every pixel on its edge at once and
      // see how far the walk gets before it runs out of gap. A line's inside is
      // shallow however long the line is; a shape's inside is not.
      const inBlob = new Set(cells);
      const depth = new Map();
      let frontier = [];
      for (const i of cells) {
        const edge =
          !inBlob.has(i + 1) || !inBlob.has(i - 1) || !inBlob.has(i + width) || !inBlob.has(i - width);
        if (edge) {
          depth.set(i, 0);
          frontier.push(i);
        }
      }
      let inset = 0;
      while (frontier.length) {
        const next = [];
        for (const i of frontier) {
          const x = i % width;
          const y = (i - x) / width;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            const k = ny * width + nx;
            if (!inBlob.has(k) || depth.has(k)) continue;
            depth.set(k, (depth.get(i) ?? 0) + 1);
            inset = Math.max(inset, depth.get(k));
            next.push(k);
          }
        }
        frontier = next;
      }

      areas.push(cells.length);
      if (inset >= minInset) {
        for (const index of cells) mask[index] = 1;
        white++;
      }
    }
  }

  return { mask, areas, white };
}

/**
 * Marks the line drawn down the leaf: the black the green closes around.
 *
 * A run of neutral pixels counts as the line when the green runs right up to
 * it on both sides — along the row, or along the column — and the run is no
 * wider than a drawn line. Both halves matter. The green is what tells the
 * leaf's line apart from the outline around it, which is the very same black but
 * has green on one side only and the page on the other; and the width is what
 * tells it apart from the leaf's base, which is also black closed around by
 * green, wide open below the blade (54px against the line's 37px).
 *
 * A run rather than a distance, so a line wider in the middle than at its ends
 * is followed all the way along, and either axis will do, so a line drawn on the
 * diagonal is found by whichever of the two crosses it.
 */
function leafLine(data, width, height, channels, maxWidth) {
  const classAt = (index) => {
    const at = index * channels;
    if (data[at + 3] <= ALPHA_CUTOFF) return "clear";
    const r = data[at];
    const g = data[at + 1];
    const b = data[at + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < NEUTRAL_SATURATION) return "neutral";
    return g > r && g >= b ? "green" : "other";
  };

  const mask = new Uint8Array(width * height);

  /** Walks one row (or one column) at a time, `index(a, b)` giving a pixel in it. */
  const scan = (outer, inner, index) => {
    for (let a = 0; a < outer; a++) {
      let runStart = -1;
      let greenBefore = false;
      for (let b = 0; b < inner; b++) {
        const kind = classAt(index(a, b));
        if (kind === "neutral") {
          if (runStart < 0) {
            runStart = b;
            greenBefore = b > 0 && classAt(index(a, b - 1)) === "green";
          }
          continue;
        }
        if (kind === "green" && greenBefore && b - runStart <= maxWidth) {
          for (let k = runStart; k < b; k++) mask[index(a, k)] = 1;
        }
        runStart = -1;
      }
    }
  };

  scan(height, width, (y, x) => y * width + x);
  scan(width, height, (x, y) => y * width + x);
  return mask;
}

/** Grows a mask by `radius` pixels, so the fill also covers the anti-aliased edge. */
function dilate(mask, width, height, radius) {
  if (radius <= 0) return mask;
  let current = mask;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (
          current[index] ||
          (x > 0 && current[index - 1]) ||
          (x < width - 1 && current[index + 1]) ||
          (y > 0 && current[index - width]) ||
          (y < height - 1 && current[index + width])
        ) {
          next[index] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

const [orangeR, orangeG, orangeB] = hexToRgb(OUTLINE_ORANGE);
const [fillR, fillG, fillB] = hexToRgb(FILL_ORANGE);
const [veinR, veinG, veinB] = hexToRgb(VEIN_GREEN);

const source = await sharp(resolve(SOURCE)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = source.info;
const pixels = source.data;

const { mask: cutouts, areas, white } = whiteCutouts(pixels, width, height, channels, MIN_INSET);
const fill = dilate(cutouts, width, height, FILL_MARGIN);
/** Only the dark file recolours, so only it has a vein to find. */
const vein = LIGHT ? null : leafLine(pixels, width, height, channels, VEIN_MAX_WIDTH);

let filled = 0;
let recoloured = 0;
let filledOrange = 0;
let veined = 0;

for (let index = 0; index < width * height; index++) {
  const offset = index * channels;
  let [r, g, b, a] = [
    pixels[offset],
    pixels[offset + 1],
    pixels[offset + 2],
    pixels[offset + 3],
  ];

  // 1. Inside a cut-out, lay the artwork over white and make it opaque. The
  //    blend is what keeps the edge antialiased: a half-covered pixel of black
  //    outline becomes the mid tone between the outline and the white behind it.
  if (fill[index]) {
    const alpha = a / 255;
    r = Math.round(r * alpha + 255 * (1 - alpha));
    g = Math.round(g * alpha + 255 * (1 - alpha));
    b = Math.round(b * alpha + 255 * (1 - alpha));
    a = 255;
    filled++;
  }

  // 2. The line drawn down the leaf. It is neutral like the outline, so the
  //    ramp below would paint it the outline's orange; green flanks it on both
  //    sides, which is true of nothing else in the drawing. This has to come
  //    before the ramp, since a vein pixel is a neutral pixel.
  // 3. Ramp the rest of the neutral pixels: black becomes the outline's orange,
  //    white stays white, and everything between moves smoothly along that line,
  //    so the anti-aliased edges of the outline are recoloured rather than
  //    stepped. Fully transparent pixels are left alone as well: they only
  //    carry a leftover colour from the CMYK original.
  // 4. The artwork's own orange, replaced. Only warm pixels are touched — red
  //    through to yellow, which is the orange it is drawn in — so the green of
  //    the leaf keeps its colour. The original orange is all but flat, so
  //    swapping it wholesale leaves the drawing intact and puts no dark rim
  //    between the fill and the outline.
  //
  //    --light stops after step 1: the light file keeps the palette it was
  //    drawn in, and only its cut-out is painted.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (!LIGHT && vein[index]) {
    r = veinR;
    g = veinG;
    b = veinB;
    veined++;
  } else if (!LIGHT && a > 0 && max - min < NEUTRAL_SATURATION && max < WHITE_CUTOFF) {
    const t = max / 255; // 0 at black, 1 at white
    r = Math.round(orangeR + (255 - orangeR) * t);
    g = Math.round(orangeG + (255 - orangeG) * t);
    b = Math.round(orangeB + (255 - orangeB) * t);
    recoloured++;
  } else if (!LIGHT && a > 0 && r >= g && g >= b && max - min >= NEUTRAL_SATURATION) {
    r = fillR;
    g = fillG;
    b = fillB;
    filledOrange++;
  }

  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

/**
 * Relative luminance, sRGB.
 *
 * Worth computing rather than eyeballing: the whole point of the second orange
 * is that it is *darker* than the first, and "darker" is this number, not the
 * hex value's brightness. The outline's 0.13 against the fill's 0.47 is what
 * keeps the mark legible on a near-black page, and it is also what the vein is
 * matched to, so line and outline carry the same weight.
 */
function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const hex = ([r, g, b]) =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const outlineLuminance = luminance(hexToRgb(OUTLINE_ORANGE));
const fillLuminance = luminance(hexToRgb(FILL_ORANGE));
const veinLuminance = luminance(hexToRgb(VEIN_GREEN));

/** Encodes these pixels the way the file on disk was encoded, and decodes the result. */
async function roundTrip() {
  const encoded = await sharp(pixels, { raw: { width, height, channels } })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decoded.data;
}

/**
 * Compares the file that is committed with what this run would write.
 *
 * Both sides are decoded before they are compared, and the expected side is
 * decoded *after* a round trip through the same encoder. Comparing against the
 * pixels in hand instead would flag the encoder's own quantisation — a palette
 * PNG moves a few near-white pixels by a couple of levels, which is invisible
 * and would make this check fail on a file that is perfectly correct.
 */
async function check() {
  const committed = await sharp(resolve(OUTPUT)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const problems = [];

  if (committed.info.width !== width || committed.info.height !== height) {
    problems.push(
      `it is ${committed.info.width}x${committed.info.height}, and the light logo is ${width}x${height}`
    );
  } else {
    const them = committed.data;
    const mine = await roundTrip();
    const pixelsPerRow = width * 4;
    const counts = new Map();
    let differing = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * pixelsPerRow + x * 4;
        // A fully transparent pixel has no colour: it is not painted at all,
        // and the encoder is free to point every one of them at a single
        // palette entry. The light file's leftover teal lives in those pixels
        // and nothing renders them.
        if (them[at + 3] === 0 && mine[at + 3] === 0) continue;
        if (
          Math.abs(them[at] - mine[at]) <= 2 &&
          Math.abs(them[at + 1] - mine[at + 1]) <= 2 &&
          Math.abs(them[at + 2] - mine[at + 2]) <= 2 &&
          Math.abs(them[at + 3] - mine[at + 3]) <= 2
        ) {
          continue;
        }
        differing++;
        // What the file holds instead, which is what names the stale palette:
        // an older run painted the black outline a pale orange, and that shows
        // up here as "it has #FFD9B3 where this writes #A9451A".
        const key = `${hex(them.subarray(at, at + 3))}|${hex(mine.subarray(at, at + 3))}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    if (differing) {
      const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const [found, wanted] = worst[0].split("|");
      problems.push(
        `${differing} of ${width * height} pixels differ — it has ${found} where this writes ${wanted}`
      );
    }
  }

  if (problems.length) {
    console.error(
      `✗ ${OUTPUT} is not the ${LIGHT ? "light" : "dark"} logo this script makes:\n` +
        problems.map((line) => `      ${line}`).join("\n") +
        `\n      Run \`npm run logo:${LIGHT ? "light" : "dark"}\` (it writes the file), then\n` +
        `      rebuild anything that serves a copy of it.\n`
    );
    process.exit(1);
  }
  console.log(
    LIGHT
      ? `✓ ${OUTPUT} is the light logo this script paints: the mark's own cut-outs ` +
        `are white, and the ${areas.length} gap(s) left inside its strokes are holes ` +
        `for the page to show through.`
      : `✓ ${OUTPUT} matches this script: the outline is ${OUTLINE_ORANGE} ` +
        `(luminance ${outlineLuminance.toFixed(2)}), the darker of the two oranges — ` +
        `the fill is ${FILL_ORANGE} (${fillLuminance.toFixed(2)}) and the vein inside ` +
        `the leaf ${VEIN_GREEN} (${veinLuminance.toFixed(2)}), close enough to it to ` +
        `read as the same hand.`
  );
}

if (CHECK) {
  await check();
} else {
  const output = await sharp(pixels, { raw: { width, height, channels } })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(resolve(OUTPUT), output);

  const size = (bytes) => `${Math.round(bytes / 1024)}KB`;
  console.log(
    `logo  ${SOURCE} → ${OUTPUT} (${width}x${height})\n` +
      `      ${filled} px of cut-out painted white — of the ${areas.length} enclosed gaps ` +
      `(${[...areas].sort((a, b) => b - a).join(", ") || "none"} px²), the ${white} wider ` +
      `than ${CUTOUT_MIN_WIDTH}px are white and the rest stay holes\n` +
      (LIGHT
        ? `      the light file's palette is left exactly as it was drawn\n`
        : `      ${recoloured} neutral px ramped to ${OUTLINE_ORANGE}, ` +
          `${veined} of them the vein inside the leaf, repainted ${VEIN_GREEN}\n` +
          `      ${filledOrange} warm px replaced with ${FILL_ORANGE}\n` +
          `      outline luminance ${outlineLuminance.toFixed(2)}, vein ${veinLuminance.toFixed(2)}, ` +
          `fill ${fillLuminance.toFixed(2)} — the outline is the darker orange\n`) +
      `      ${size(readFileSync(resolve(SOURCE)).length)} → ${size(output.length)}`
  );
}
