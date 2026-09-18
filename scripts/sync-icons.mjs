/**
 * Generates src/lib/icons.generated.ts — the inline SVG for every icon this
 * site uses.
 *
 * The site used to load ionicons' upgrade script from unpkg on every page. That
 * is three problems at once: the icons arrive after first paint (so the page
 * reflows around them), the script upgrades the custom elements *before* React
 * hydrates (so every icon logs a hydration-mismatch error), and a third-party
 * origin sits in the critical path of every page load. Inlining the icons
 * removes all three, and the icons are then just markup in the SSR output —
 * no runtime, no client script, nothing to upgrade late.
 *
 * This script is what keeps the inlined set honest: it reads the icon names out
 * of the source (the `name` on an icon tag, the `icon` key in the nav arrays,
 * literals inside a `name={…}` expression) and writes exactly those. Run it
 * after adding an icon:
 *
 *   node scripts/sync-icons.mjs
 *
 * The icon source is the `ionicons` package when it is installed (any version),
 * otherwise the same file from unpkg. A name that is not a real ionicon fails
 * the run rather than silently generating nothing — that is what stops the
 * scanner from picking up an unrelated `name="description"` and quietly
 * shipping a hole in the page.
 *
 * `--check` compares the two sets and exits non-zero on any drift, without
 * needing the icon source at all (no package, no network), because it never
 * looks at the SVG markup. That is what `npm run check` and the Vercel build
 * run: it turns "someone added an icon and forgot to regenerate" from an icon
 * that silently renders as nothing into a failed deploy.
 *
 * `IONICONS_EXTRA` covers icons that are only ever named at runtime, where no
 * amount of scanning can find them.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUTPUT = path.join(SRC, "lib", "icons.generated.ts");

/**
 * Not named in any component, so the scanner below cannot see them: these two
 * are read out of the generated file by name instead — `scripts/sync-theme-morph.mjs`
 * turns them into the geometry the theme toggle morphs between.
 */
const IONICONS_EXTRA = ["moon", "sunny"];

/* ------------------------------------------------------------------ sources */

async function iconSource() {
  for (const file of ["icons/index.mjs", "icons/index.js"]) {
    const full = path.join(ROOT, "node_modules", "ionicons", file);
    if (existsSync(full)) return { label: file, text: await readFile(full, "utf8") };
  }
  const url = "https://unpkg.com/ionicons/icons/index.js";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return { label: url, text: await res.text() };
}

/** `export const chevronBack = "data:image/svg+xml;utf8,<svg …</svg>"` → name → svg. */
function parseIcons(text) {
  const icons = new Map();
  const re = /export const ([A-Za-z0-9_]+) = "([^"]*)"/g;
  for (const [, name, value] of text.matchAll(re)) {
    const svg = value.replace(/^data:image\/svg\+xml;utf8,/, "").replace(/'/g, '"');
    icons.set(name, svg);
  }
  return icons;
}

/* -------------------------------------------------------------- source scan */

const SCAN_EXTENSIONS = [".astro", ".tsx", ".ts"];

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) files.push(full);
  }
  return files;
}

/**
 * Icon names the source asks for. Deliberately narrow: only `name` on an `Icon`
 * (or a leftover `ion-icon`) tag, `name:` in a createElement call, literals
 * inside a `name={…}` expression, and `icon: "…"` in the nav/link arrays. A
 * bare `name="x"` elsewhere is an input or a meta tag, not an icon.
 */
function scanSource(text) {
  const found = new Set();
  const add = (name) => {
    if (name) found.add(name);
  };

  for (const match of text.matchAll(/<(?:ion-icon|Icon)[\s\S]{0,200}?\bname=(?:"([^"]+)"|\{([^}]*)\})/g)) {
    if (match[1]) add(match[1]);
    if (match[2]) for (const literal of withoutComparisons(match[2]).matchAll(/"([^"]+)"/g)) add(literal[1]);
  }
  // The expression, not just a literal: several components pick the name with a
  // ternary (`name: dark ? "sunny" : "moon"`).
  for (const match of text.matchAll(/createElement\(\s*"ion-icon"\s*,\s*\{[^}]*?\bname:\s*([^,}]+)/g)) {
    for (const literal of withoutComparisons(match[1]).matchAll(/"([^"]+)"/g)) add(literal[1]);
  }
  for (const match of text.matchAll(/\bicon:\s*"([^"]+)"/g)) {
    add(match[1]);
  }
  return found;
}

/**
 * Drops comparison operands from an expression, so `kind === "pdf" ? …` yields
 * the branch values and not a phantom icon called `pdf`.
 */
function withoutComparisons(expression) {
  return expression.replace(/[=!]==?\s*"[^"]*"/g, "");
}

function toExportName(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/* ---------------------------------------------------------------- generating */

const requested = new Set(IONICONS_EXTRA);
for (const file of await sourceFiles(SRC)) {
  for (const name of scanSource(await readFile(file, "utf8"))) requested.add(name);
}

/** The icon names the generated file already carries. */
async function generatedNames() {
  if (!existsSync(OUTPUT)) return new Set();
  const text = await readFile(OUTPUT, "utf8");
  return new Set([...text.matchAll(/^  "([a-z0-9-]+)":/gm)].map((match) => match[1]));
}

if (process.argv.includes("--check")) {
  const generated = await generatedNames();
  const notGenerated = [...requested].filter((name) => !generated.has(name)).sort();
  const noLongerUsed = [...generated].filter((name) => !requested.has(name)).sort();
  if (notGenerated.length || noLongerUsed.length) {
    if (notGenerated.length) console.error(`[icons] asked for but not generated: ${notGenerated.join(", ")}`);
    if (noLongerUsed.length) console.error(`[icons] generated but no longer used: ${noLongerUsed.join(", ")}`);
    console.error("[icons] run `npm run icons` and commit src/lib/icons.generated.ts.");
    process.exit(1);
  }
  console.log(`[icons] ${requested.size} icons in step with src/`);
  process.exit(0);
}

const icons = parseIcons((await iconSource()).text);

const missing = [];
const resolved = [];
for (const name of [...requested].sort()) {
  const svg = icons.get(toExportName(name));
  if (!svg) missing.push(name);
  else resolved.push({ name, svg });
}

if (missing.length) {
  console.error(
    `[icons] no ionicon matches: ${missing.join(", ")}\n` +
      "Check the spelling, or add the name to IONICONS_EXTRA if it is only chosen at runtime."
  );
  process.exit(1);
}

const body = resolved
  .map(({ name, svg }) => `  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`)
  .join("\n");

await writeFile(
  OUTPUT,
  `/**\n` +
    ` * GENERATED by scripts/sync-icons.mjs — do not edit by hand.\n` +
    ` *\n` +
    ` * Inline SVG markup per icon name, so icons are part of the rendered HTML\n` +
    ` * instead of being upgraded by a third-party script after load. Regenerate\n` +
    ` * after adding one: \`node scripts/sync-icons.mjs\`.\n` +
    ` */\n` +
    `export const ICONS: Record<string, string> = {\n${body}\n};\n`,
  "utf8"
);

const bytes = resolved.reduce((total, icon) => total + icon.svg.length, 0);
console.log(`[icons] wrote ${resolved.length} icons (${(bytes / 1024).toFixed(1)} KB) to ${path.relative(ROOT, OUTPUT)}`);
