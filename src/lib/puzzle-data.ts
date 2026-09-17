/**
 * The one parser for stored puzzle data.
 *
 * The stored format is compact text, one shape per puzzle type:
 *
 *   Crossword       one word per line: `x y across|down word clue`
 *   Cross-number    the same lines, with digits instead of letters
 *   Find-A-Word     the grid rows (letters, usually space-separated),
 *                   one blank line, then the hidden words, one per line
 *   Unscramble      one per line: `scrambled answer`
 *   Sudoku          nine lines of nine cells, each 1-9 or `.` when empty
 *   Cryptogram      two lines: the ciphered quote, then the real one
 *   Connections     four lines: `Category: word, word, word, word`
 *   Nonogram        the picture: rows of `#` filled and `.` empty
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

/**
 * Every type the readers understand, in the order the panel lists them.
 *
 * `Cross-number` shares the crossword's format and reader — the grid holds
 * digits where a crossword holds letters — so it costs nothing to offer, and
 * the two are kept apart as types because they are different puzzles to the
 * person solving them (and carry different clues).
 */
export type PuzzleTypeName =
  | "Crossword"
  | "Cross-number"
  | "Find-A-Word"
  | "Unscramble"
  | "Sudoku"
  | "Cryptogram"
  | "Connections"
  | "Nonogram";

export const PUZZLE_TYPES: readonly PuzzleTypeName[] = [
  "Crossword",
  "Cross-number",
  "Find-A-Word",
  "Unscramble",
  "Sudoku",
  "Cryptogram",
  "Connections",
  "Nonogram",
];

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

/** One word of a cryptogram, as the letters that have to be worked out. */
export interface CryptogramData {
  kind: "Cryptogram";
  /** The quote as it is printed, letter for letter, punctuation untouched. */
  cipher: string;
  /** The quote as it reads. Kept whole so the reader can mark and reveal. */
  plain: string;
  /** What each ciphered letter stands for, which is how the reader checks a guess. */
  key: Record<string, string>;
}

/** One category of a Connections puzzle: its name and the four words in it. */
export interface ConnectionsGroup {
  name: string;
  words: string[];
}

export interface ConnectionsData {
  kind: "Connections";
  groups: ConnectionsGroup[];
}

/** A nonogram: the picture, plus the runs of filled cells each line's clue states. */
export interface NonogramData {
  kind: "Nonogram";
  grid: boolean[][];
  rowClues: number[][];
  colClues: number[][];
}

/**
 * A sudoku as it is given: `null` is an empty cell the solver fills in.
 *
 * The solution is not stored. A completed grid that breaks no rule is a
 * solution, so the reader can check one without being told the answer — and a
 * puzzle cannot ship with its own answer sitting in the database next to it.
 */
export interface SudokuData {
  kind: "Sudoku";
  givens: (number | null)[][];
}

export type PuzzleData =
  | { kind: "Crossword"; entries: CrosswordEntry[] }
  | { kind: "Find-A-Word"; grid: string[][]; words: string[] }
  | { kind: "Unscramble"; lines: UnscrambleLine[] }
  | SudokuData
  | CryptogramData
  | ConnectionsData
  | NonogramData;

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

/* --------------------------------------------------------------------- sudoku */

/** A sudoku is nine lines of nine; anything else is a typo in the shape. */
const SUDOKU_SIZE = 9;

/** Cells that mean “nothing given here”, so a printed grid can be pasted in. */
const EMPTY_CELL = new Set([".", "_", "-", "0"]);

function parseSudoku(data: string): ParsedOne<SudokuData> {
  const problems: PuzzleDataProblem[] = [];
  const rows = linesOf(data).filter((line) => line.trim());

  if (rows.length !== SUDOKU_SIZE) {
    return [
      problem(
        0,
        `a sudoku is ${SUDOKU_SIZE} lines of ${SUDOKU_SIZE} cells, and this has ${rows.length} line${rows.length === 1 ? "" : "s"} in it.`
      ),
    ];
  }

  const givens: (number | null)[][] = [];
  rows.forEach((raw, index) => {
    // Spaces, commas and pipes are how a grid is written down, not cells, so
    // they come out before the row is counted.
    const cells = Array.from(raw.replace(/[\s|,]/g, ""));
    if (cells.length !== SUDOKU_SIZE) {
      problems.push(
        problem(
          index + 1,
          `this row has ${cells.length} cell${cells.length === 1 ? "" : "s"} in it, and a sudoku row is ${SUDOKU_SIZE}.`
        )
      );
      return;
    }
    const row: (number | null)[] = [];
    for (const cell of cells) {
      if (EMPTY_CELL.has(cell)) {
        row.push(null);
      } else if (/[1-9]/.test(cell)) {
        row.push(Number(cell));
      } else {
        problems.push(
          problem(
            index + 1,
            `“${clip(cell)}” is not a cell — a cell is 1-9, or a dot for an empty one.`
          )
        );
        return;
      }
    }
    givens.push(row);
  });

  if (problems.length) return problems;

  // The givens have to agree with each other before the puzzle can be solved:
  // a repeated digit in a row, a column or a box makes it unsolvable, and the
  // reader would only ever report every cell as wrong.
  const repeats: PuzzleDataProblem[] = [];
  for (let y = 0; y < SUDOKU_SIZE; y++) {
    for (let x = 0; x < SUDOKU_SIZE; x++) {
      const value = givens[y]![x];
      if (value === null) continue;
      for (let other = x + 1; other < SUDOKU_SIZE; other++) {
        if (givens[y]![other] === value) {
          repeats.push(problem(y + 1, `the ${value} in column ${x + 1} is repeated in column ${other + 1} of the same row.`));
          break;
        }
      }
      for (let other = y + 1; other < SUDOKU_SIZE; other++) {
        if (givens[other]![x] === value) {
          repeats.push(problem(other + 1, `the ${value} in row ${y + 1} is repeated in row ${other + 1} of the same column.`));
          break;
        }
      }
      const boxX = Math.floor(x / 3) * 3;
      const boxY = Math.floor(y / 3) * 3;
      for (let by = boxY; by < boxY + 3; by++) {
        for (let bx = boxX; bx < boxX + 3; bx++) {
          if ((bx === x && by === y) || bx < x || (bx === x && by < y)) continue;
          if (givens[by]![bx] === value) {
            repeats.push(
              problem(by + 1, `the ${value} in r${y + 1}c${x + 1} is repeated in the same 3×3 box at r${by + 1}c${bx + 1}.`)
            );
            break;
          }
        }
      }
    }
  }
  if (repeats.length) return repeats;

  if (!givens.flat().some((value) => value !== null)) {
    return [problem(0, "it has no numbers given in it at all — there is nothing to solve from.")];
  }
  return { kind: "Sudoku", givens };
}

/* ---------------------------------------------------------------- cryptogram */

const LETTER = /[A-Za-z]/;

function parseCryptogram(data: string): ParsedOne<CryptogramData> {
  const rows = linesOf(data).filter((line) => line.trim());
  if (rows.length !== 2) {
    return [
      problem(
        0,
        `a cryptogram is two lines — the ciphered quote, then the quote itself — and this has ${rows.length}.`
      ),
    ];
  }

  const cipher = rows[0]!.trim().toUpperCase();
  const plain = rows[1]!.trim().toUpperCase();
  const problems: PuzzleDataProblem[] = [];

  if (cipher.length !== plain.length) {
    return [
      problem(
        0,
        `the two lines are different lengths (${cipher.length} and ${plain.length}) — the ciphered quote must keep every space and mark of punctuation where the quote has it.`
      ),
    ];
  }

  const key: Record<string, string> = {};
  const taken = new Map<string, string>();
  for (let index = 0; index < plain.length; index++) {
    const source = plain[index]!;
    const coded = cipher[index]!;
    if (!LETTER.test(source)) {
      // A space or a mark of punctuation is not enciphered, so the two lines
      // have to carry the same one at the same place.
      if (coded !== source) {
        problems.push(
          problem(2, `“${clip(source)}” at position ${index + 1} of the quote is “${clip(coded)}” in the ciphered line — punctuation is not enciphered, so they have to match.`)
        );
      }
      continue;
    }
    if (!LETTER.test(coded)) {
      problems.push(problem(2, `position ${index + 1} is a letter in the quote but “${clip(coded)}” in the ciphered line.`));
      continue;
    }
    const already = key[coded];
    if (already && already !== source) {
      problems.push(
        problem(1, `“${coded}” stands for both “${already}” and “${source}” — one ciphered letter is always one letter of the quote.`)
      );
      continue;
    }
    const clash = taken.get(source);
    if (clash && clash !== coded) {
      problems.push(
        problem(1, `both “${clash}” and “${coded}” stand for “${source}” — a substitution gives every letter its own ciphered letter.`)
      );
      continue;
    }
    key[coded] = source;
    taken.set(source, coded);
  }

  if (problems.length) return problems;
  if (cipher === plain) {
    return [problem(0, "the ciphered line is the quote itself — nothing has been substituted.")];
  }
  return { kind: "Cryptogram", cipher, plain, key };
}

/* --------------------------------------------------------------- connections */

const CONNECTIONS_LINE = /^([^:]{1,60}):\s*(.+)$/;

function parseConnections(data: string): ParsedOne<ConnectionsData> {
  const rows = linesOf(data).filter((line) => line.trim());
  const problems: PuzzleDataProblem[] = [];
  const groups: ConnectionsGroup[] = [];
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const line = raw.trim();
    const match = line.match(CONNECTIONS_LINE);
    if (!match) {
      problems.push(problem(index + 1, `expected “Category: word, word, word, word”, but found “${clip(line)}”.`));
      return;
    }
    const name = match[1]!.trim();
    const words = match[2]!
      .split(/[,/]/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length !== 4) {
      problems.push(
        problem(index + 1, `“${clip(name)}” has ${words.length} word${words.length === 1 ? "" : "s"} in it, and every category has exactly four.`)
      );
      return;
    }
    for (const word of words) {
      const key = word.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        problems.push(
          problem(index + 1, `“${clip(word)}” is already in the category on line ${first + 1} — all sixteen words have to be different.`)
        );
        continue;
      }
      seen.set(key, index);
    }
    groups.push({ name, words });
  });

  if (problems.length) return problems;
  if (groups.length !== 4) {
    return [problem(0, `a Connections puzzle is four categories, and this has ${groups.length}.`)];
  }
  return { kind: "Connections", groups };
}

/* ------------------------------------------------------------------ nonogram */

/** Cells that mean “filled”, so a picture can be pasted in as well as typed. */
const FILLED_CELL = new Set(["#", "X", "1", "■", "█"]);
/** Cells that mean “empty”. A blank cell counts as empty too. */
const BLANK_CELL = new Set([".", "_", "-", "0", "·"]);
/** A picture wider or taller than this is a typo, and the clues stop being readable. */
const MAX_NONOGRAM = 40;

/** The runs of filled cells a line's clue states: `##.#` is `2 1`. */
function clueFor(line: boolean[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) run++;
    else if (run) {
      runs.push(run);
      run = 0;
    }
  }
  if (run) runs.push(run);
  return runs;
}

function parseNonogram(data: string): ParsedOne<NonogramData> {
  const rows = linesOf(data).filter((line) => line.trim());
  if (!rows.length) return [problem(0, "there are no lines in it.")];
  if (rows.length > MAX_NONOGRAM) {
    return [problem(0, `it is ${rows.length} rows tall — a picture here is at most ${MAX_NONOGRAM}.`)];
  }

  const problems: PuzzleDataProblem[] = [];
  const grid: boolean[][] = [];
  const width = Array.from(rows[0]!.replace(/[\s|,]/g, "")).length;
  if (width < 3 || width > MAX_NONOGRAM) {
    return [problem(1, `the first row is ${width} cells wide — a picture here is between 3 and ${MAX_NONOGRAM}.`)];
  }

  rows.forEach((raw, index) => {
    const cells = Array.from(raw.replace(/[\s|,]/g, ""));
    if (cells.length !== width) {
      problems.push(
        problem(index + 1, `this row is ${cells.length} cells wide, but the first row sets the width at ${width}.`)
      );
      return;
    }
    const row: boolean[] = [];
    for (const cell of cells) {
      if (FILLED_CELL.has(cell.toUpperCase())) row.push(true);
      else if (BLANK_CELL.has(cell)) row.push(false);
      else {
        problems.push(problem(index + 1, `“${clip(cell)}” is not a cell — a filled one is # and an empty one is a dot.`));
        return;
      }
    }
    grid.push(row);
  });

  if (problems.length) return problems;
  if (!grid.flat().some(Boolean)) {
    return [problem(0, "every cell is empty — there is no picture in it.")];
  }

  // Clues are derived rather than stored: the picture is the puzzle, and a
  // stored clue that disagreed with it would be a bug nobody could see.
  const columnCount = width;
  const colClues = Array.from({ length: columnCount }, (_, x) =>
    clueFor(grid.map((row) => row[x]!))
  );
  return { kind: "Nonogram", grid, rowClues: grid.map(clueFor), colClues };
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
  type: "Cross-number",
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
export function parsePuzzleData(
  type: "Sudoku",
  data: string
): { ok: true; data: SudokuData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(
  type: "Cryptogram",
  data: string
): { ok: true; data: CryptogramData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(
  type: "Connections",
  data: string
): { ok: true; data: ConnectionsData } | { ok: false; problems: PuzzleDataProblem[] };
export function parsePuzzleData(
  type: "Nonogram",
  data: string
): { ok: true; data: NonogramData } | { ok: false; problems: PuzzleDataProblem[] };
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
  // A cross-number is a crossword holding digits, so it is read by the
  // crossword's own parser and reader — the shape it comes back as is the
  // crossword's, which is what lets the one reader play both.
  const parsed =
    type === "Crossword" || type === "Cross-number"
      ? parseCrossword(data)
      : type === "Find-A-Word"
        ? parseFinder(data)
        : type === "Unscramble"
          ? parseUnscramble(data)
          : type === "Sudoku"
            ? parseSudoku(data)
            : type === "Cryptogram"
              ? parseCryptogram(data)
              : type === "Connections"
                ? parseConnections(data)
                : parseNonogram(data);
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
