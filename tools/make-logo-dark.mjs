/**
 * Build the dark-mode logo from the light one.
 *
 * The mark is drawn for a white page: a black outline and black interior
 * shapes around orange fill, with the background left transparent. On the dark
 * page that black disappears into the background, so this writes a second file
 * — `public/bulletin-dark.png` — in which:
 *
 *   - black (and every neutral from black up to white) is ramped to a light
 *     orange, so the outline and the shapes inside it stay readable;
 *   - the artwork's own orange — a mid, saturated orange that is close in
 *     brightness to the dark page — becomes a brighter, lighter one;
 *   - transparent pixels *enclosed* by the artwork become white, so the
 *     cut-outs in the mark read as white rather than as holes you see the page
 *     through. "Enclosed" is found by flooding the transparent background
 *     inwards from the border: whatever the flood does not reach is inside.
 *
 * It stays a recolour rather than a redraw: the drawing, its shading and its
 * soft edges are all the light file's, which remains the source of truth.
 *
 * Usage:
 *   node tools/make-logo-dark.mjs                     # write public/bulletin-dark.png
 *   node tools/make-logo-dark.mjs --out other.png     # somewhere else
 *   node tools/make-logo-dark.mjs --color '#FFD9B3'   # what the black becomes
 *   node tools/make-logo-dark.mjs --orange '#FF9C4A'  # what the orange becomes
 *
 * Re-run it after replacing public/bulletin.png.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// sharp is not a declared dependency: Astro's image pipeline installs it, and
// adding it to package.json would rewrite half the lockfile for one script.
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "This script needs sharp, which normally comes with Astro. Install it with:\n  npm i -D sharp"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const SOURCE = argValue("--source", "public/bulletin.png");
const OUTPUT = argValue("--out", "public/bulletin-dark.png");
/**
 * What black becomes. A pale, warm orange, because on a near-black page the
 * outline is often the only thing separating one shape from the next.
 */
const LIGHT_ORANGE = argValue("--color", "#FFD9B3");
/**
 * What the artwork's own orange becomes. The #E08040 it is drawn in is close to
 * the dark page in brightness, so it is replaced with a brighter one — and one
 * clearly darker than the outline above, or the drawing loses its edge.
 */
const FILL_ORANGE = argValue("--orange", "#FF9C4A");

/** Alpha at or below this is treated as "not part of the artwork". */
const ALPHA_CUTOFF = 128;
/**
 * How far the white fill reaches past the hole itself. The edge of a cut-out is
 * anti-aliased — those pixels are part artwork, part hole — so the fill has to
 * cover them or a dark rim is left behind. Over-filling is harmless: the fill is
 * composited *under* the artwork.
 */
const FILL_MARGIN = 2;
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
 * Marks the transparent pixels the artwork encloses.
 *
 * A flood fill from every transparent border pixel walks the background; the
 * transparent pixels it never reaches are inside the artwork. A scan-line walk
 * would be wrong here — the outline is not a rectangle, and a hole can be
 * reached around a thin stroke — so this floods properly.
 */
function enclosedMask(data, width, height, channels) {
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

  const enclosed = new Uint8Array(width * height);
  for (let index = 0; index < enclosed.length; index++) {
    const x = index % width;
    const y = (index - x) / width;
    if (!background[index] && transparent(x, y)) enclosed[index] = 1;
  }
  return enclosed;
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

const [orangeR, orangeG, orangeB] = hexToRgb(LIGHT_ORANGE);
const [fillR, fillG, fillB] = hexToRgb(FILL_ORANGE);

const source = await sharp(resolve(SOURCE)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = source.info;
const pixels = source.data;

const enclosed = enclosedMask(pixels, width, height, channels);
const fill = dilate(enclosed, width, height, FILL_MARGIN);

let filled = 0;
let recoloured = 0;
let filledOrange = 0;

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

  // 2. Ramp the neutral pixels: black becomes the light orange, white stays
  //    white, and everything between moves smoothly along that line, so the
  //    anti-aliased edges of the outline are recoloured rather than stepped.
  //    The fully transparent pixels outside the artwork are left alone too:
  //    they only carry a leftover colour from the CMYK original.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (a > 0 && max - min < NEUTRAL_SATURATION && max < WHITE_CUTOFF) {
    const t = max / 255; // 0 at black, 1 at white
    r = Math.round(orangeR + (255 - orangeR) * t);
    g = Math.round(orangeG + (255 - orangeG) * t);
    b = Math.round(orangeB + (255 - orangeB) * t);
    recoloured++;
  }

  // 3. The artwork's own orange, replaced. Only warm pixels are touched — red
  //    through to yellow, which is the orange and the bee's stripes — so the
  //    green of the leaf keeps the colour it was drawn in. The original orange
  //    is all but flat, so swapping it wholesale leaves the drawing intact and
  //    puts no dark rim between the fill and the outline.
  else if (a > 0 && r >= g && g >= b && max - min >= NEUTRAL_SATURATION) {
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

const output = await sharp(pixels, { raw: { width, height, channels } })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();
writeFileSync(resolve(OUTPUT), output);

const size = (bytes) => `${Math.round(bytes / 1024)}KB`;
console.log(
  `logo  ${SOURCE} → ${OUTPUT} (${width}x${height})\n` +
    `      ${filled} px of enclosed transparency filled white, ` +
    `${recoloured} neutral px ramped to ${LIGHT_ORANGE}, ` +
    `${filledOrange} warm px replaced with ${FILL_ORANGE}\n` +
    `      ${size(readFileSync(resolve(SOURCE)).length)} → ${size(output.length)}`
);
