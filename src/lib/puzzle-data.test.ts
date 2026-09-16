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
import { formatPuzzleProblems, parsePuzzleData, type PuzzleDataProblem } from "./puzzle-data.ts";

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
  assert.match(complaint("Crossword", ""), /no puzzle data yet/);
  // A NULL column arrives as "" through the data layer, so this is also the
  // path a puzzle with no stored data takes.
  assert.match(complaint("Find-A-Word", "   \n  "), /no puzzle data yet/);
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
  for (const type of ["Crossword", "Find-A-Word", "Unscramble", "Nonsense"]) {
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
