/**
 * The parser's contract, as a table.
 *
 * `src/lib/puzzle-data.ts` is the one place stored puzzle text is interpreted:
 * three public readers and the admin's validator all run through it, and every
 * case below is one it has to agree with itself about. Two of them are
 * regressions that shipped broken — a valid crossword and a valid unscramble
 * were both reported as problems, because a parser returning a list on success
 * is indistinguishable from one returning a list of problems.
 *
 * Run with `npm test`. Node strips the types; there is no test framework here
 * on purpose, since the module has no imports and needs none.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUZZLE_TYPES,
  formatPuzzleProblems,
  parsePuzzleData,
  type PuzzleDataProblem,
} from "./puzzle-data.ts";

/** Parses and insists the value was refused, returning what was wrong with it. */
function problemsOf(type: string, data: string): PuzzleDataProblem[] {
  const parsed = parsePuzzleData(type, data);
  if (parsed.ok) throw new Error(`expected ${type} to be refused, but it parsed`);
  return parsed.problems;
}

/** The problems as one line, for assertions that care about the wording. */
function complaint(type: string, data: string): string {
  return formatPuzzleProblems(problemsOf(type, data));
}

/* ------------------------------------------------------------------ crossword */

test("crossword: a line becomes an entry, with the word uppercased", () => {
  const parsed = parsePuzzleData("Crossword", "3 0 across hello  A greeting");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.entries, [
    { x: 3, y: 0, direction: "across", word: "HELLO", clue: "A greeting" },
  ]);
});

test("crossword: direction is case-insensitive, blank lines are skipped", () => {
  const parsed = parsePuzzleData("Crossword", "\n1 2 Down Mouse  A rodent\n\n");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.entries, [
    { x: 1, y: 2, direction: "down", word: "MOUSE", clue: "A rodent" },
  ]);
});

test("crossword: a line that does not fit the shape names its line number", () => {
  const message = complaint("Crossword", "0 0 across CAT A pet\nthis is not a clue line");
  assert.match(message, /^line 2:/);
  assert.match(message, /column row across\|down word clue/);
});

test("crossword: a coordinate that would run off any grid is refused", () => {
  const message = complaint("Crossword", `0 0 across ${"A".repeat(1200)} A long word`);
  assert.match(message, /far off any grid/);
});

test("crossword: text with nothing in it is refused", () => {
  // `parseCrossword` has a branch of its own for "every line is blank", but it
  // is unreachable through here: whitespace-only text is turned away by the
  // shared guard before the type's parser is called, which is the message an
  // editor actually sees.
  assert.match(complaint("Crossword", "\n\n   \n"), /no puzzle data yet/);
});

/* ---------------------------------------------------------------- find-a-word */

const GRID = "C A T\nD O G";

test("find-a-word: the grid and the word list come back separated", () => {
  const parsed = parsePuzzleData("Find-A-Word", `${GRID}\n\nCAT\nDOG`);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.grid, [
    ["C", "A", "T"],
    ["D", "O", "G"],
  ]);
  assert.deepEqual(parsed.data.words, ["CAT", "DOG"]);
});

test("find-a-word: letters are uppercased, trailing blank lines are just whitespace", () => {
  const parsed = parsePuzzleData("Find-A-Word", "c a t\nd o g\n\ncat\ndog\n\n");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.grid, [
    ["C", "A", "T"],
    ["D", "O", "G"],
  ]);
  assert.deepEqual(parsed.data.words, ["CAT", "DOG"]);
});

test("find-a-word: a missing blank line is refused rather than swallowing the words", () => {
  const message = complaint("Find-A-Word", `${GRID}\nCAT\nDOG`);
  assert.match(message, /must be followed by one blank line/);
});

test("find-a-word: a row that is not as wide as the first is refused", () => {
  const message = complaint("Find-A-Word", `C A T\nD O G\nB I\n\nCAT\nDOG`);
  assert.match(message, /^line 3:/);
  assert.match(message, /is 2 letters wide, but the first row sets the width at 3/);
});

test("find-a-word: a character that only looks like a letter is named, not counted as a gap", () => {
  // Greek capital iota where a Latin I was meant — the same width on screen,
  // one letter short once the non-A–Z characters are dropped.
  const message = complaint("Find-A-Word", `C A T\nD O G\nB Ι R\n\nCAT\nDOG`);
  assert.match(message, /^line 3:/);
  assert.match(message, /“Ι” is not an A–Z letter/);
  assert.doesNotMatch(message, /letters wide/);
});

test("find-a-word: a blank line inside the word list is refused", () => {
  const message = complaint("Find-A-Word", `${GRID}\n\nCAT\n\nDOG`);
  assert.match(message, /^line 5:/);
  assert.match(message, /splits the word list/);
});

test("find-a-word: a second block of letters below the blank line is called out", () => {
  const message = complaint("Find-A-Word", `${GRID}\n\nCAT\nD O G`);
  assert.match(message, /spaced single letters/);
});

test("find-a-word: a word with a space in it is refused", () => {
  const message = complaint("Find-A-Word", `${GRID}\n\nCAT\nBIG DOG`);
  assert.match(message, /contains a space — one word per line/);
});

test("find-a-word: a blank line with nothing under it leaves no words", () => {
  assert.match(complaint("Find-A-Word", `${GRID}\n\n`), /word list below the blank line is empty/);
});

/* ----------------------------------------------------------------- unscramble */

test("unscramble: a line becomes a scrambled/answer pair", () => {
  const parsed = parsePuzzleData("Unscramble", "tac cat\n\ndog god");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.lines, [
    { scrambled: "tac", answer: "cat" },
    { scrambled: "dog", answer: "god" },
  ]);
});

test("unscramble: a line with only one word is refused", () => {
  const message = complaint("Unscramble", "tac cat\ncat");
  assert.match(message, /^line 2:/);
  assert.match(message, /scrambled answer/);
});

test("unscramble: a line with more than two words is refused", () => {
  // An answer containing a space can never be typed to match, so it is a
  // problem rather than something to compare against.
  const message = complaint("Unscramble", "tac a cat");
  assert.match(message, /2 words after “tac”/);
});

/* -------------------------------------------------------------------- generic */

test("an unknown type is refused by name", () => {
  assert.match(complaint("Word Search", "anything"), /not one the readers understand/);
});

test("empty data is refused with a message an editor can act on", () => {
  // Every type, not one of them: the blank case is turned away before the
  // dispatch, so a type that has been added without a parser would otherwise
  // only fail on the first real save.
  for (const type of PUZZLE_TYPES) {
    assert.match(complaint(type, ""), /no puzzle data yet/, type);
  }
  // A NULL column arrives as "" through the data layer, so this is also the
  // path a puzzle with no stored data takes.
  assert.match(complaint("Find-A-Word", "   \n  "), /no puzzle data yet/);
});

/* ------------------------------------------------------------------- sudoku */

const SUDOKU = [
  "53..7....",
  "6..195...",
  ".98....6.",
  "8...6...3",
  "4..8.3..1",
  "7...2...6",
  ".6....28.",
  "...419..5",
  "....8..79",
].join("\n");

test("sudoku: nine lines of nine become numbers, with dots left empty", () => {
  const parsed = parsePuzzleData("Sudoku", SUDOKU);
  assert.ok(parsed.ok);
  assert.equal(parsed.data.givens.length, 9);
  assert.deepEqual(parsed.data.givens[0], [5, 3, null, null, 7, null, null, null, null]);
  assert.equal(parsed.data.givens[8]![8], 9);
});

test("sudoku: spaces and pipes between cells are just how it was written down", () => {
  const spaced = SUDOKU.split("\n")
    .map((row) => Array.from(row).join(" "))
    .join("\n");
  const parsed = parsePuzzleData("Sudoku", spaced);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.givens[1], [6, null, null, 1, 9, 5, null, null, null]);
});

test("sudoku: the wrong number of rows or cells is named", () => {
  assert.match(complaint("Sudoku", "123\n456"), /9 lines of 9 cells/);
  const short = SUDOKU.split("\n").map((row, index) => (index === 4 ? row.slice(0, 8) : row));
  assert.match(complaint("Sudoku", short.join("\n")), /^line 5:.*8 cells/);
});

test("sudoku: a cell that is not a digit is refused by name", () => {
  const broken = SUDOKU.split("\n");
  broken[0] = "53..7..a.";
  assert.match(complaint("Sudoku", broken.join("\n")), /“a” is not a cell/);
});

test("sudoku: givens that repeat a digit in a row, column or box are refused", () => {
  const rows = SUDOKU.split("\n");
  // The 5 at the start of row 1 repeated further along it.
  rows[0] = "535.7....";
  assert.match(complaint("Sudoku", rows.join("\n")), /same row/);

  const column = SUDOKU.split("\n");
  // Row 3 already opens with 6 in column 1; the given 6 in row 1 is lifted.
  column[0] = "53..7....";
  column[1] = "5..195...";
  assert.match(complaint("Sudoku", column.join("\n")), /same column/);

  const box = ["123......", "456......", "78......."];
  assert.match(complaint("Sudoku", box.join("\n")), /9 lines of 9 cells|same 3×3 box/);
});

/* --------------------------------------------------------------- cryptogram */

const CRYPTOGRAM = ["XUUG XU BG KBZY", "MEET ME AT DAWN"].join("\n");

test("cryptogram: the two lines become the quote and what each letter stands for", () => {
  const parsed = parsePuzzleData("Cryptogram", CRYPTOGRAM);
  assert.ok(parsed.ok);
  assert.equal(parsed.data.cipher, "XUUG XU BG KBZY");
  assert.equal(parsed.data.plain, "MEET ME AT DAWN");
  assert.equal(parsed.data.key.X, "M");
  assert.equal(parsed.data.key.U, "E");
  assert.equal(parsed.data.key.G, "T");
});

test("cryptogram: the two lines have to be the same length", () => {
  assert.match(complaint("Cryptogram", "XUUG XU BG KBZ\nMEET ME AT DAWN"), /different lengths/);
});

test("cryptogram: punctuation is not enciphered, so it has to line up", () => {
  assert.match(complaint("Cryptogram", "XUUG,XU BG KBZY\nMEET ME AT DAWN"), /punctuation is not enciphered/);
});

test("cryptogram: one letter cannot stand for two, or two for one", () => {
  assert.match(complaint("Cryptogram", "XUUX XU BG KBZY\nMEET ME AT DAWN"), /stands for both/);
  assert.match(complaint("Cryptogram", "XUUG XU BG KBZY\nMEEM ME AT DAWN"), /stand for “M”/);
});

test("cryptogram: a quote that has not been enciphered at all is refused", () => {
  assert.match(complaint("Cryptogram", "MEET ME AT DAWN\nMEET ME AT DAWN"), /nothing has been substituted/);
});

test("cryptogram: anything other than two lines is refused", () => {
  assert.match(complaint("Cryptogram", "XUUG XU BG KBZY"), /two lines/);
  assert.match(complaint("Cryptogram", "XUUG XU BG KBZY\nMEET ME AT DAWN\nEXTRA"), /two lines/);
});

/* --------------------------------------------------------------- connections */

const CONNECTIONS = [
  "Things with wings: plane, bird, bee, angel",
  "Capital cities: Paris, Lima, Rome, Cairo",
  "Noble gases: neon, argon, xenon, radon",
  "Chess terms: fork, pin, mate, check",
].join("\n");

test("connections: four lines become four categories of four words", () => {
  const parsed = parsePuzzleData("Connections", CONNECTIONS);
  assert.ok(parsed.ok);
  assert.equal(parsed.data.groups.length, 4);
  assert.deepEqual(parsed.data.groups[0], {
    name: "Things with wings",
    words: ["plane", "bird", "bee", "angel"],
  });
  assert.equal(parsed.data.groups[3]!.words[3], "check");
});

test("connections: a category that is not four words is counted", () => {
  assert.match(
    complaint("Connections", CONNECTIONS.replace("bee, angel", "bee")),
    /has 3 words in it/,
  );
});

test("connections: a word used twice names the line it was already on", () => {
  assert.match(
    complaint("Connections", CONNECTIONS.replace("angel", "bird")),
    /“bird” is already in the category on line 1/,
  );
});

test("connections: a line with no category, or fewer than four of them, is refused", () => {
  assert.match(complaint("Connections", CONNECTIONS.replace("Capital cities: ", "")), /Category: word, word, word, word/);
  assert.match(complaint("Connections", CONNECTIONS.split("\n").slice(0, 3).join("\n")), /four categories, and this has 3/);
});

/* ----------------------------------------------------------------- nonogram */

test("nonogram: the picture comes back with the clues worked out from it", () => {
  const parsed = parsePuzzleData("Nonogram", "..#..\n.###.\n#####\n.###.\n..#..");
  assert.ok(parsed.ok);
  assert.equal(parsed.data.grid.length, 5);
  assert.deepEqual(parsed.data.rowClues, [[1], [3], [5], [3], [1]]);
  assert.deepEqual(parsed.data.colClues, [[1], [3], [5], [3], [1]]);
  // Two runs in one line are two numbers, in order.
  const runs = parsePuzzleData("Nonogram", "##.##\n##.##\n##.##");
  assert.ok(runs.ok);
  assert.deepEqual(runs.data.rowClues[0], [2, 2]);
});

test("nonogram: ragged rows and unknown cells are named", () => {
  assert.match(complaint("Nonogram", "###\n##\n###"), /^line 2:.*2 cells wide/);
  assert.match(complaint("Nonogram", "###\n#?#\n###"), /“?” is not a cell/);
});

test("nonogram: an empty picture is refused", () => {
  assert.match(complaint("Nonogram", "...\n...\n..."), /no picture in it/);
});

/* ------------------------------------------------------------- cross-number */

test("cross-number: the crossword format, with digits for answers", () => {
  const parsed = parsePuzzleData("Cross-number", "0 0 across 1234 A number, in a grid");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.entries, [
    { x: 0, y: 0, direction: "across", word: "1234", clue: "A number, in a grid" },
  ]);
});

test("cross-number: a bad line is reported exactly as a crossword's would be", () => {
  assert.match(complaint("Cross-number", "nonsense"), /^line 1:.*column row across\|down word clue/);
});

test("nothing in this file's inputs throws — they are all reported", () => {
  const hostile = [
    "",
    "\n",
    "\n\n\n",
    "\r\n",
    "   ",
    "\t\t",
    "0 0",
    "0 0 across",
    "-1 -2 across X clue",
    "999999999999 0 across X clue",
    "0 0 across X",
    "\u0000",
    "Ünïcödé wörds\n\nÜnïcödé",
  ];
  for (const type of [...PUZZLE_TYPES, "Nonsense", "crossword"]) {
    for (const data of hostile) {
      const parsed = parsePuzzleData(type, data);
      // Either outcome is fine; throwing is not. The readers render the
      // problems, so a throw would blank the page below the title.
      assert.equal(typeof parsed.ok, "boolean", `${type} / ${JSON.stringify(data)}`);
    }
  }
});

/* ------------------------------------------------------------ problem wording */

test("problems are rendered as “line N: message”, or bare when the line is 0", () => {
  assert.equal(
    formatPuzzleProblems([
      { line: 4, message: "something" },
      { line: 0, message: "the whole text" },
    ]),
    "line 4: something the whole text"
  );
});

test("a long list of problems is capped so the flash message stays readable", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ line: i + 1, message: "x" }));
  assert.equal(formatPuzzleProblems(many, 3), "line 1: x line 2: x line 3: x (+ 5 more)");
});
