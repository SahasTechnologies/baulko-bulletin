/**
 * The one parser for stored puzzle data.
 *
 * The stored format is compact text, one shape per puzzle type:
 *
 *   Crossword       one word per line: `x y across|down word clue`
 *   Find-A-Word     the grid rows (letters, usually space-separated),
 *                   one blank line, then the hidden words, one per line
 *   Unscramble      one per line: `scrambled answer`
 *
 * Every consumer parses through here. The public readers used to split the
 * text and index straight into it, so a missing blank line or a short grid
 * row threw inside the browser and left the puzzle page broken below its
 * title; now they get either a structured puzzle or the problems to report.
 * The admin panel validates a save against the exact same code, so anything
 * that passes validation is data every reader can play.
 *
 * Parsing is deliberately stricter than the readers were: a line the old
 * readers skipped or mis-read (a scrambled line with two answers, a blank
 * line inside a word list, which made the old reader drop every word after
 * it) is a problem here, because it was data being quietly lost. The one
 * deliberate tolerance is cosmetic — grids and Find-A-Word words are
 * uppercased at parse time, since that is how the reader plays them and
 * stored data has appeared in both cases over the years.
 */

export type PuzzleTypeName = "Crossword" | "Find-A-Word" | "Unscramble";

export const PUZZLE_TYPES: readonly PuzzleTypeName[] = ["Crossword", "Find-A-Word", "Unscramble"];

export function isPuzzleTypeName(value: string): value is PuzzleTypeName {
  return (PUZZLE_TYPES as readonly string[]).includes(value);
}

export interface CrosswordEntry {
  x: number;
  y: number;
  direction: "across" | "down";
  word: string;
  clue: string;
}

export interface UnscrambleLine {
  scrambled: string;
  answer: string;
}

export type PuzzleData =
  | { kind: "Crossword"; entries: CrosswordEntry[] }
  | { kind: "Find-A-Word"; grid: string[][]; words: string[] }
  | { kind: "Unscramble"; lines: UnscrambleLine[] };

export type CrosswordData = Extract<PuzzleData, { kind: "Crossword" }>;
export type FinderData = Extract<PuzzleData, { kind: "Find-A-Word" }>;
export type UnscrambleData = Extract<PuzzleData, { kind: "Unscramble" }>;

/** One thing wrong with a stored puzzle. `line` counts raw lines from 1; 0 means the whole text. */
export interface PuzzleDataProblem {
  line: number;
  message: string;
}

export type ParsedPuzzleData =
  | { ok: true; data: PuzzleData }
  | { ok: false; problems: PuzzleDataProblem[] };

/**
 * What one type's parser hands back: the puzzle, tagged with its own `kind`, or
 * the problems that stopped it.
 *
 * The tag is not decoration. Two of the three shapes are lists — crossword
 * entries and unscramble lines — so a parser returning a bare array on success
 * was indistinguishable from one returning problems, and `parsePuzzleData`
 * read every valid crossword and every valid unscramble as a failure. With the
 * tag, "an array means problems" holds for all three.
 */
export type ParsedOne<T> = T | PuzzleDataProblem[];

/** No printed puzzle comes near this; a coordinate beyond it is a typo, and the reader would otherwise try to lay out a grid that big. */
const MAX_EXTENT = 1000;

function problem(line: number, message: string): PuzzleDataProblem {
  return { line, message };
}

function linesOf(data: string): string[] {
  return data.split(/\r?\n/);
}

/** Problem messages quote the offending line, clipped so a pasted novel stays one line. */
function clip(line: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/* ------------------------------------------------------------------ crossword */

const CROSSWORD_LINE = /^(\d+)\s+(\d+)\s+(across|down)\s+(\S+)\s+(.+)$/i;

function parseCrossword(data: string): ParsedOne<CrosswordData> {
  const problems: PuzzleDataProblem[] = [];
  const entries: CrosswordEntry[] = [];
  linesOf(data).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = line.match(CROSSWORD_LINE);
    if (!match) {
      problems.push(
        problem(index + 1, `expected “column row across|down word clue”, but found “${clip(line)}”.`)
      );
      return;
    }
    const word = match[4].toUpperCase();
    const direction = match[3].toLowerCase() as "across" | "down";
    const x = Number(match[1]);
    const y = Number(match[2]);
    const reach = direction === "across" ? x + word.length : y + word.length;
    if (reach > MAX_EXTENT) {
      problems.push(
        problem(
          index + 1,
          `the word “${word}” would run to ${direction === "across" ? "column" : "row"} ${reach - 1}, far off any grid — check the column and row numbers.`
        )
      );
      return;
    }
    entries.push({ x, y, direction, word, clue: match[5].trim() });
  });
  if (problems.length) return problems;
  if (!entries.length) return [problem(0, "there are no words in it — every line is blank.")];
  return { kind: "Crossword", entries };
}

/* ---------------------------------------------------------------- find-a-word */

function parseFinder(data: string): ParsedOne<FinderData> {
  const problems: PuzzleDataProblem[] = [];
  const lines = linesOf(data);

  const first = lines.findIndex((line) => line.trim());
  if (first === -1) return [problem(0, "there are no lines in it.")];

  // The grid runs from the first non-blank line to the first blank one; the
  // words start at the first non-blank line after that. Extra blank lines
  // around the two halves are tolerated, but one *inside* the word list is
  // an error: the old reader split on the first double newline, so every
  // word below it was silently dropped.
  let gridEnd = first;
  while (gridEnd < lines.length && lines[gridEnd]!.trim()) gridEnd++;

  const blankAt = gridEnd < lines.length ? gridEnd : -1;
  let wordsStart = gridEnd;
  while (wordsStart < lines.length && !lines[wordsStart]!.trim()) wordsStart++;

  if (blankAt === -1) {
    return [
      problem(
        gridEnd + 1,
        "the letter grid must be followed by one blank line, then the words to find — there is no blank line here."
      ),
    ];
  }
  if (wordsStart >= lines.length) {
    return [problem(blankAt + 1, "the word list below the blank line is empty.")];
  }

  const grid: string[][] = [];
  const width = Array.from(lines[first]!.replace(/[^A-Za-z]/g, "").toUpperCase()).length;
  for (let index = first; index < gridEnd; index++) {
    const letters = Array.from(lines[index]!.replace(/[^A-Za-z]/g, "").toUpperCase());
    if (!letters.length) {
      problems.push(problem(index + 1, "this grid row has no letters in it."));
      continue;
    }

    // A cell that is not A–Z is reported as itself rather than as a row that
    // came out too narrow. Three stored grids are short only because a few of
    // their letters are Greek — Ε Ι Ν Κ Ο Ρ Α Τ Η Μ Β are the same shapes as
    // their Latin twins — so the row looks full width on screen while the
    // parser sees ten letters where the first row set fourteen. "This grid row
    // is 10 letters wide, but the first row sets the width at 14" is true and
    // useless: the editor is looking at a row that appears to be 14 wide.
    // Naming the characters is the part they can act on.
    const foreign = [
      ...new Set(lines[index]!.trim().split(/\s+/).filter((cell) => /[^A-Za-z]/.test(cell))),
    ];
    if (foreign.length) {
      const shown = foreign.slice(0, 4).map((cell) => `“${clip(cell)}”`).join(", ");
      problems.push(
        problem(
          index + 1,
          foreign.length === 1
            ? `${shown} is not an A–Z letter — it only looks like one, so a word crossing it can never be matched.`
            : `${shown} are not A–Z letters — they only look like them, so a word crossing them can never be matched.`
        )
      );
      continue;
    }

    if (letters.length !== width) {
      problems.push(
        problem(
          index + 1,
          `this grid row is ${letters.length} letters wide, but the first row sets the width at ${width}.`
        )
      );
    }
    grid.push(letters);
  }

  // Blank lines are only a problem when something follows them; trailing
  // ones are ordinary whitespace at the end of the text.
  let lastWordLine = wordsStart;
  for (let index = wordsStart; index < lines.length; index++) {
    if (lines[index]!.trim()) lastWordLine = index;
  }

  const words: string[] = [];
  for (let index = wordsStart; index <= lastWordLine; index++) {
    const line = lines[index]!.trim();
    if (!line) {
      problems.push(
        problem(
          index + 1,
          "this blank line splits the word list — everything below it was being dropped. The list must be one block of words."
        )
      );
      continue;
    }
    if (/\s/.test(line)) {
      const tokens = line.split(/\s+/);
      // Spaced-out single letters below the blank line are the signature of
      // a second grid block — usually a missing blank line between the
      // grid and the words, or an extra one inside the grid.
      if (tokens.every((token) => token.length === 1)) {
        problems.push(
          problem(
            index + 1,
            `“${clip(line)}” is spaced single letters — it looks like part of the letter grid, but the grid ended at line ${gridEnd}. The grid must be one block, then one blank line, then the words.`
          )
        );
      } else {
        problems.push(problem(index + 1, `the word “${clip(line)}” contains a space — one word per line.`));
      }
      continue;
    }
    words.push(line.replace(/\s+/g, "").toUpperCase());
  }

  if (problems.length) return problems;
  if (!words.length) return [problem(blankAt + 1, "the word list below the blank line is empty.")];
  return { kind: "Find-A-Word", grid, words };
}

/* ----------------------------------------------------------------- unscramble */

function parseUnscramble(data: string): ParsedOne<UnscrambleData> {
  const problems: PuzzleDataProblem[] = [];
  const lines: UnscrambleLine[] = [];
  linesOf(data).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      problems.push(problem(index + 1, `expected “scrambled answer”, but found “${clip(line)}”.`));
      return;
    }
    if (tokens.length > 2) {
      problems.push(
        problem(
          index + 1,
          `has ${tokens.length - 1} words after “${tokens[0]}” — a line is exactly “scrambled answer”, and an answer containing a space can never be typed to match.`
        )
      );
      return;
    }
    lines.push({ scrambled: tokens[0]!, answer: tokens[1]! });
  });
  if (problems.length) return problems;
  if (!lines.length) return [problem(0, "there are no lines in it.")];
  return { kind: "Unscramble", lines };
}

/* -------------------------------------------------------------------- parsing */

/**
 * Parses a stored value into the shape its type promises, or reports what is
 * wrong with it. Never throws: the readers render the problems instead.
 *
 * The overloads are what let a reader that names its own type — `Crossword`
 * does, so it can render a crossword — get that type's shape back without a
 * second check. A caller holding the type as a plain string (the admin's
 * validator does) falls through to the union and narrows on `kind` itself.
 */
export function parsePuzzleData(
  type: "Crossword",
  data: string
): { ok: true; data: CrosswordData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(
  type: "Find-A-Word",
  data: string
): { ok: true; data: FinderData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(
  type: "Unscramble",
  data: string
): { ok: true; data: UnscrambleData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(type: string, data: string): ParsedPuzzleData;
export function parsePuzzleData(type: string, data: string): ParsedPuzzleData {
  if (!isPuzzleTypeName(type)) {
    return {
      ok: false,
      problems: [problem(0, `its type “${type}” is not one the readers understand.`)],
    };
  }
  if (!data.trim()) {
    return { ok: false, problems: [problem(0, "there is no puzzle data yet.")] };
  }
  const parsed =
    type === "Crossword"
      ? parseCrossword(data)
      : type === "Find-A-Word"
        ? parseFinder(data)
        : parseUnscramble(data);
  // An array is always problems: each parser returns its puzzle as a tagged
  // object, which is what makes this test mean the same thing for all three.
  if (Array.isArray(parsed)) return { ok: false, problems: parsed };
  return { ok: true, data: parsed };
}

/**
 * Problems as one human-readable sentence, for a flash message: `line 4: …`.
 * Long lists are capped — the first few tell the editor what is wrong, and
 * the rest would only make the message a paragraph.
 */
export function formatPuzzleProblems(problems: PuzzleDataProblem[], max = 5): string {
  const shown = problems
    .slice(0, max)
    .map(({ line, message }) => (line > 0 ? `line ${line}: ${message}` : message));
  if (problems.length > max) shown.push(`(+ ${problems.length - max} more)`);
  return shown.join(" ");
}
