"use client";

/**
 * Builders for every puzzle type, so a puzzle can be typed in as words, clues
 * and pictures rather than as the compact text the public readers parse.
 *
 * The stored format is unchanged — this component only writes it:
 *
 *   Crossword       one word per line: `x y across|down word clue`
 *   Cross-number    the same lines, with digits instead of letters
 *   Find-A-Word     the grid rows, a blank line, then the hidden words
 *   Unscramble      one per line: `scrambled answer`
 *   Sudoku          nine lines of nine cells, `1`-`9` or `.` when empty
 *   Cryptogram      the ciphered quote, then the quote
 *   Connections     `Category: word, word, word, word`, four times
 *   Nonogram        the picture: rows of `#` filled and `.` empty
 *
 * A type whose fields are all free text — sudoku, nonogram — gets a textarea
 * with a preview of what it parses to, because that is honest about the shape
 * and there is nothing to gain from nine rows of nine inputs. A cryptogram's
 * cipher is the one thing an editor should not have to work out by hand, so it
 * is scrambled for them and stays editable afterwards.
 *
 * Parsing and validation go through `lib/puzzle-data` — the exact code the
 * public readers use — so a value the builder accepts is a value every
 * reader can play. The panel below the fields re-checks the value that will
 * be saved on every change; while it lists problems, the form's submit
 * button is held disabled, so malformed data cannot be saved from here.
 * (A "raw data" view stays available, and it validates too — the point is
 * that the text, wherever it is edited, has to fit the format before the
 * save goes through.)
 *
 * The builder tracks the puzzle-type select in the surrounding form, because
 * switching type has to switch which builder is on screen (and which shape
 * gets serialised).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { parsePuzzleData, type PuzzleDataProblem } from "@/lib/puzzle-data";

const TYPES = [
  "Crossword",
  "Cross-number",
  "Find-A-Word",
  "Unscramble",
  "Sudoku",
  "Cryptogram",
  "Connections",
  "Nonogram",
] as const;
type PuzzleType = (typeof TYPES)[number];

interface CrosswordRow {
  x: string;
  y: string;
  direction: "across" | "down";
  word: string;
  clue: string;
}
interface ScrambleRow {
  scrambled: string;
  answer: string;
}
interface Finder {
  grid: string;
  words: string;
}
/** A grid typed as text: one line per row, cells separated or not. */
interface Grid {
  grid: string;
}
interface Cryptogram {
  /** The quote as it reads. */
  quote: string;
  /** The quote enciphered — generated from the quote above, then editable. */
  cipher: string;
}
interface ConnectionsRow {
  name: string;
  /** The four words as typed, comma-separated. */
  words: string;
}

interface Store {
  /** Shared by Crossword and Cross-number: one format, so one set of rows. */
  Crossword: CrosswordRow[];
  "Find-A-Word": Finder;
  Unscramble: ScrambleRow[];
  Sudoku: Grid;
  Cryptogram: Cryptogram;
  Connections: ConnectionsRow[];
  Nonogram: Grid;
}

const inputClass =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/15 dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/30 dark:focus:ring-white/30";
const smallButtonClass =
  "rounded-full border border-black/20 px-4 py-1.5 text-sm transition-transform hover:scale-105 dark:border-white/20";
const rowButtonClass = "px-2 text-lg opacity-60 transition hover:opacity-100";

function isPuzzleType(value: string): value is PuzzleType {
  return (TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ parsing */

/**
 * Reads a stored value back into builder state, or null when it is not in the
 * expected shape. This is the lenient direction: editing an existing puzzle
 * must be possible even when its data no longer parses, so unreadable values
 * fall through to the raw editor rather than being rejected here. Validation
 * of what will be *saved* is separate, and strict.
 */
function parseInto(
  store: Store,
  type: PuzzleType,
  data: string
): { store: Store } | { error: string } {
  if (!data.trim()) return { store };
  if (type === "Crossword") {
    const rows: CrosswordRow[] = [];
    for (const raw of data.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const match = line.match(/^(\d+)\s+(\d+)\s+(across|down)\s+(\S+)\s+(.+)$/i);
      if (!match) return { error: "one or more lines do not fit “column row across|down word clue”." };
      rows.push({
        x: match[1]!,
        y: match[2]!,
        direction: match[3]!.toLowerCase() as "across" | "down",
        word: match[4]!,
        clue: match[5]!.trim(),
      });
    }
    return { store: { ...store, Crossword: rows.length ? rows : store.Crossword } };
  }
  if (type === "Find-A-Word") {
    const parts = data.split("\n\n");
    if (parts.length < 2) return { error: "the grid and the word list must be separated by one blank line." };
    const [grid, ...rest] = parts;
    return { store: { ...store, "Find-A-Word": { grid: grid!.trim(), words: rest.join("\n\n").trim() } } };
  }
  if (type === "Sudoku" || type === "Nonogram") {
    // Both are just a block of text: keeping the lines verbatim is the whole
    // of reading them back, so a partly-typed grid still opens in the builder.
    const grid = data.split("\n").filter((line) => line.trim()).join("\n");
    return { store: { ...store, [type]: { grid } } };
  }
  if (type === "Cryptogram") {
    const lines = data.split("\n").filter((line) => line.trim());
    if (lines.length !== 2) return { error: "a cryptogram is two lines: the ciphered quote, then the quote." };
    return { store: { ...store, Cryptogram: { cipher: lines[0]!.trim(), quote: lines[1]!.trim() } } };
  }
  if (type === "Connections") {
    const rows: ConnectionsRow[] = [];
    for (const raw of data.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const match = line.match(/^([^:]{1,60}):\s*(.+)$/);
      if (!match) return { error: "one or more lines do not fit “Category: word, word, word, word”." };
      rows.push({ name: match[1]!.trim(), words: match[2]!.trim() });
    }
    return { store: { ...store, Connections: rows.length ? rows : store.Connections } };
  }
  const rows: ScrambleRow[] = [];
  for (const raw of data.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [scrambled, answer] = line.split(/\s+/);
    if (!scrambled || !answer) return { error: "one or more lines do not fit “scrambled answer”." };
    rows.push({ scrambled, answer });
  }
  return { store: { ...store, Unscramble: rows.length ? rows : store.Unscramble } };
}

function emptyStore(): Store {
  return {
    Crossword: [{ x: "0", y: "0", direction: "across", word: "", clue: "" }],
    "Find-A-Word": { grid: "", words: "" },
    Unscramble: [{ scrambled: "", answer: "" }],
    Sudoku: { grid: "" },
    Cryptogram: { quote: "", cipher: "" },
    Connections: Array.from({ length: 4 }, () => ({ name: "", words: "" })),
    Nonogram: { grid: "" },
  };
}

/** Reads a stored value back into builder state, or null when it is not in the expected shape. */
function parseIntoOrNull(store: Store, type: PuzzleType, data: string): Store | null {
  const result = parseInto(store, type, data);
  return "store" in result ? result.store : null;
}

/* -------------------------------------------------------------- serialising */

/**
 * A sudoku as rows of cells. Spaces, commas and pipes are how a grid is written
 * down rather than cells, so they come out; a digit is kept as it was typed and
 * an empty cell becomes a dot, since anything else is the parser's to judge.
 */
function serializeSudoku(grid: Grid): string {
  return grid.grid
    .split("\n")
    .map((line) => line.replace(/[\s|,]/g, ""))
    .filter(Boolean)
    .map((line) =>
      Array.from(line)
        .map((cell) => (cell === "0" || cell === "_" || cell === "-" ? "." : cell))
        .join("")
    )
    .join("\n");
}

/** Nonogram keeps the filled cells as `#` and the empty ones as a dot. */
const NONOGRAM_FILLED = new Set(["#", "X", "1", "■", "█"]);
const NONOGRAM_EMPTY = new Set([".", "_", "-", "0", "·"]);

function serializeNonogram(grid: Grid): string {
  return grid.grid
    .split("\n")
    .map((line) => line.replace(/[\s|,]/g, ""))
    .filter(Boolean)
    .map((line) =>
      Array.from(line)
        // Anything the editor typed that is neither a filled nor an empty
        // square is left as it is, for the parser to complain about. Turning it
        // into a dot here would save a picture quietly different from the one
        // on screen, which is the one thing a preview must not do.
        .map((cell) => (NONOGRAM_FILLED.has(cell.toUpperCase()) ? "#" : NONOGRAM_EMPTY.has(cell) ? "." : cell))
        .join("")
    )
    .join("\n");
}

function serializeCryptogram(value: Cryptogram): string {
  const cipher = value.cipher.trim().toUpperCase();
  const quote = value.quote.trim().toUpperCase();
  return quote ? `${cipher}\n${quote}` : "";
}

function serializeConnections(rows: ConnectionsRow[]): string {
  return rows
    .map((row) => ({
      name: row.name.trim(),
      words: row.words
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean),
    }))
    .filter((row) => row.name && row.words.length)
    .map((row) => `${row.name}: ${row.words.join(", ")}`)
    .join("\n");
}

/**
 * Enciphers a quote with a fresh substitution, so an editor never has to write
 * a cipher by hand — and so the cipher that ships is a real one.
 *
 * Each letter stands for the *next* letter in a randomly ordered alphabet,
 * wrapping at the end. That is one 26-letter cycle, and a cycle of more than one
 * letter never comes back to where it started, so no letter ever stands for
 * itself — which is the point: a self-mapping letter hands the solver a letter
 * of the quote for free. (Swapping letters that had landed on themselves looks
 * like it fixes them, but a swap between two such letters can leave both in
 * place; walking the shuffled alphabet cannot.)
 */
function scramble(quote: string): string {
  const order = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  const mapping = new Map(
    order.map((letter, index) => [letter, order[(index + 1) % order.length]!])
  );
  return quote
    .toUpperCase()
    .split("")
    .map((char) => mapping.get(char) ?? char)
    .join("");
}

function serializeCrossword(rows: CrosswordRow[]): string {
  return rows
    .map((row) => ({
      ...row,
      x: row.x.trim(),
      y: row.y.trim(),
      word: row.word.trim().replace(/\s+/g, ""),
      clue: row.clue.trim().replace(/\s+/g, " "),
    }))
    .filter((row) => row.word && row.clue && row.x !== "" && row.y !== "")
    .map((row) => `${Number(row.x)} ${Number(row.y)} ${row.direction} ${row.word} ${row.clue}`)
    .join("\n");
}

/** The grid is stored as single letters separated by spaces, so a pasted block is spread out. */
function normalizeGrid(grid: string): string {
  return grid
    .split("\n")
    .map((line) => line.replace(/[^A-Za-z]/g, "").toUpperCase().split("").join(" "))
    .filter((line) => line.trim())
    .join("\n");
}

function serializeFinder(finder: Finder): string {
  const grid = normalizeGrid(finder.grid);
  const words = finder.words
    .split("\n")
    .map((word) => word.trim().replace(/\s+/g, "").toUpperCase())
    .filter(Boolean)
    .join("\n");
  return `${grid}\n\n${words}`;
}

/** The public reader compares the typed answer to the stored one exactly, so it stays lower case and unspaced. */
function serializeUnscramble(rows: ScrambleRow[]): string {
  return rows
    .map((row) => ({
      scrambled: row.scrambled.trim().replace(/\s+/g, "").toLowerCase(),
      answer: row.answer.trim().replace(/\s+/g, "").toLowerCase(),
    }))
    .filter((row) => row.scrambled && row.answer)
    .map((row) => `${row.scrambled} ${row.answer}`)
    .join("\n");
}

/* ------------------------------------------------------------------- editor */

export default function PuzzleDataEditor({
  name,
  initial,
  initialType,
}: {
  name: string;
  initial: string;
  initialType: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<PuzzleType>(isPuzzleType(initialType) ? initialType : "Crossword");
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  const [raw, setRaw] = useState(initial);
  const [warning, setWarning] = useState("");

  const [store, setStore] = useState<Store>(() => {
    const parsed = parseIntoOrNull(emptyStore(), isPuzzleType(initialType) ? initialType : "Crossword", initial);
    if (!parsed) {
      // Unreadable stored value: keep it verbatim and let the raw editor deal with it.
      return emptyStore();
    }
    return parsed;
  });
  const [startInRaw] = useState(
    () => Boolean(initial.trim()) && !parseIntoOrNull(emptyStore(), isPuzzleType(initialType) ? initialType : "Crossword", initial)
  );

  useEffect(() => {
    if (startInRaw) setMode("raw");
  }, [startInRaw]);

  // Follow the puzzle-type select in the surrounding form.
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    const select = form?.querySelector<HTMLSelectElement>('select[name="type"]');
    if (!select) return;
    const onForm = () => {
      if (isPuzzleType(select.value)) setType(select.value);
    };
    onForm();
    select.addEventListener("change", onForm);
    return () => select.removeEventListener("change", onForm);
  }, []);

  const value = useMemo(() => {
    if (mode === "raw") return raw;
    if (type === "Crossword" || type === "Cross-number") return serializeCrossword(store.Crossword);
    if (type === "Find-A-Word") return serializeFinder(store["Find-A-Word"]);
    if (type === "Unscramble") return serializeUnscramble(store.Unscramble);
    if (type === "Sudoku") return serializeSudoku(store.Sudoku);
    if (type === "Cryptogram") return serializeCryptogram(store.Cryptogram);
    if (type === "Connections") return serializeConnections(store.Connections);
    return serializeNonogram(store.Nonogram);
  }, [mode, raw, store, type]);

  /**
   * What the readers will make of the value as it stands. Deliberately run on
   * every render — it is a few kilobytes of text at most — so the problem
   * panel tracks each keystroke in the raw view and each field in the
   * builder.
   */
  const problems: PuzzleDataProblem[] = useMemo(() => {
    const parsed = parsePuzzleData(type, value);
    return parsed.ok ? [] : parsed.problems;
  }, [type, value]);

  // Malformed data must not be savable from this form: while problems are
  // listed, the form's submit button is held disabled. The server re-checks
  // with the same parser, so the button is a courtesy to the editor, not the
  // guarantee.
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submit) return;
    if (problems.length) {
      submit.disabled = true;
      submit.title = "Fix the puzzle problems below before saving.";
    } else {
      submit.disabled = false;
      submit.title = "";
    }
    // Enabled again on unmount if the editor ever leaves the DOM mid-edit.
    return () => {
      submit.disabled = false;
      submit.title = "";
    };
  }, [problems]);

  function toRaw() {
    setRaw(value);
    setMode("raw");
    setWarning("");
  }

  function toBuilder() {
    const parsed = parseIntoOrNull(store, type, raw);
    if (!parsed) {
      setWarning("That text does not match the format for this puzzle type, so it can only be edited as raw data.");
      return;
    }
    setStore(parsed);
    setWarning("");
    setMode("builder");
  }

  const updateStore = (next: Partial<Store>) => setStore((current) => ({ ...current, ...next }));

  /* --- Crossword --- */
  const crosswordRows = store.Crossword;
  const setCrossword = (rows: CrosswordRow[]) => updateStore({ Crossword: rows });

  const crosswordPreview = useMemo(() => {
    const placed: { char: string; x: number; y: number }[] = [];
    let width = 0;
    let height = 0;
    for (const row of crosswordRows) {
      const word = row.word.trim().replace(/\s+/g, "").toUpperCase();
      const x = Number(row.x);
      const y = Number(row.y);
      if (!word || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      for (let i = 0; i < word.length; i++) {
        const px = row.direction === "across" ? x + i : x;
        const py = row.direction === "down" ? y + i : y;
        placed.push({ char: word[i]!, x: px, y: py });
        width = Math.max(width, px + 1);
        height = Math.max(height, py + 1);
      }
    }
    return { placed, width, height };
  }, [crosswordRows]);

  const finder = store["Find-A-Word"];
  const gridRows = normalizeGrid(finder.grid).split("\n").filter(Boolean);
  const gridWidths = [...new Set(gridRows.map((row) => row.split(" ").length))];

  const scrambleRows = store.Unscramble;

  const renderProblem = ({ line, message }: PuzzleDataProblem) => (
    <li key={`${line}-${message}`}>
      {line > 0 ? (
        <>
          line {line}: {message}
        </>
      ) : (
        message
      )}
    </li>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <input type="hidden" name={name} value={value} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${smallButtonClass} ${mode === "builder" ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : ""}`}
          onClick={() => (mode === "raw" ? toBuilder() : undefined)}
        >
          Builder
        </button>
        <button
          type="button"
          className={`${smallButtonClass} ${mode === "raw" ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : ""}`}
          onClick={() => (mode === "builder" ? toRaw() : undefined)}
        >
          Raw data
        </button>
        <span className="text-sm opacity-60">
          Editing as <strong>{type}</strong> — change the puzzle type above to switch builder.
        </span>
      </div>

      {warning && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm" role="alert">
          {warning}
        </p>
      )}

      {mode === "raw" ? (
        <div>
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={14}
            spellCheck={false}
            className={`${inputClass} font-mono text-sm`}
          />
          <p className="mt-1 text-sm opacity-60">
            This is exactly what gets saved. Switch back to the builder to edit it as fields.
          </p>
        </div>
      ) : type === "Crossword" || type === "Cross-number" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {crosswordRows.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-[4rem_4rem_7rem_1fr_2fr_2rem] items-center gap-2 rounded-xl border border-black/10 p-3 dark:border-white/15"
              >
                <label className="flex flex-col text-xs opacity-70">
                  Column
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={row.x}
                    onChange={(event) => {
                      const rows = [...crosswordRows];
                      rows[index] = { ...row, x: event.target.value.replace(/\D/g, "") };
                      setCrossword(rows);
                    }}
                  />
                </label>
                <label className="flex flex-col text-xs opacity-70">
                  Row
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={row.y}
                    onChange={(event) => {
                      const rows = [...crosswordRows];
                      rows[index] = { ...row, y: event.target.value.replace(/\D/g, "") };
                      setCrossword(rows);
                    }}
                  />
                </label>
                <label className="flex flex-col text-xs opacity-70">
                  Direction
                  <select
                    className={inputClass}
                    value={row.direction}
                    onChange={(event) => {
                      const rows = [...crosswordRows];
                      rows[index] = { ...row, direction: event.target.value as "across" | "down" };
                      setCrossword(rows);
                    }}
                  >
                    <option value="across">across</option>
                    <option value="down">down</option>
                  </select>
                </label>
                <label className="flex flex-col text-xs opacity-70">
                  Answer
                  <input
                    className={inputClass}
                    value={row.word}
                    placeholder="aliens"
                    onChange={(event) => {
                      const rows = [...crosswordRows];
                      rows[index] = { ...row, word: event.target.value };
                      setCrossword(rows);
                    }}
                  />
                </label>
                <label className="flex flex-col text-xs opacity-70">
                  Clue
                  <input
                    className={inputClass}
                    value={row.clue}
                    placeholder="non human beings who travel in advanced technology"
                    onChange={(event) => {
                      const rows = [...crosswordRows];
                      rows[index] = { ...row, clue: event.target.value };
                      setCrossword(rows);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={`${rowButtonClass} justify-self-end`}
                  title="Remove this word"
                  onClick={() => setCrossword(crosswordRows.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className={smallButtonClass}
            onClick={() =>
              setCrossword([...crosswordRows, { x: "0", y: "0", direction: "across", word: "", clue: "" }])
            }
          >
            + Add a word
          </button>

          {crosswordPreview.placed.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Layout preview</p>
              <div className="overflow-x-auto rounded-xl bg-black/5 p-3 dark:bg-white/5">
                <div
                  className="grid gap-px"
                  style={{ gridTemplateColumns: `repeat(${crosswordPreview.width}, 1.5rem)` }}
                >
                  {Array.from({ length: crosswordPreview.height }).map((_, y) =>
                    Array.from({ length: crosswordPreview.width }).map((__, x) => {
                      const cell = crosswordPreview.placed.find((p) => p.x === x && p.y === y);
                      return (
                        <div
                          key={`${x}-${y}`}
                          className={`flex size-6 items-center justify-center text-xs font-bold ${
                            cell ? "bg-white text-black dark:bg-neutral-800 dark:text-white" : "bg-transparent"
                          }`}
                        >
                          {cell?.char || ""}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <p className="mt-1 text-sm opacity-60">
                Empty squares are the black gaps the reader sees. Column and row count from 0.
              </p>
            </div>
          )}
        </div>
      ) : type === "Sudoku" ? (
        <GridBuilder
          grid={store.Sudoku.grid}
          onChange={(grid) => updateStore({ Sudoku: { grid } })}
          label="Grid"
          rows={10}
          placeholder={"53..7....\n6..195...\n.98....6.\n…"}
          hint="One line per row, nine rows of nine. Digits 1-9 are the numbers given; a dot is a cell the solver fills in. Rows may be written with or without spaces."
        />
      ) : type === "Cryptogram" ? (
        <CryptogramBuilder
          value={store.Cryptogram}
          onChange={(next) => updateStore({ Cryptogram: next })}
        />
      ) : type === "Connections" ? (
        <ConnectionsBuilder
          rows={store.Connections}
          onChange={(rows) => updateStore({ Connections: rows })}
        />
      ) : type === "Nonogram" ? (
        <GridBuilder
          grid={store.Nonogram.grid}
          onChange={(grid) => updateStore({ Nonogram: { grid } })}
          label="Picture"
          rows={12}
          placeholder={"..##..##..\n.#..#..#..\n…"}
          hint="One line per row. # is a filled square and a dot is an empty one — the numbers around the picture are worked out from it, so this is the whole puzzle. Spaces between cells are optional."
          filled="#"
        />
      ) : type === "Find-A-Word" ? (
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:w-3/5">
            <label className="mb-1 block text-sm font-medium">Grid</label>
            <textarea
              value={finder.grid}
              onChange={(event) => updateStore({ "Find-A-Word": { ...finder, grid: event.target.value } })}
              rows={14}
              spellCheck={false}
              placeholder={"ZECPVPDBPO JES PMLQKIC\nENOLCYCONAYZROLVDOPA\n…"}
              className={`${inputClass} font-mono text-sm`}
            />
            <p className="mt-1 text-sm opacity-60">
              Paste or type one row per line, letters with or without spaces — they are spread out for
              you. Every row should be the same length.
            </p>
            {gridRows.length > 0 && (
              <p className="mt-1 text-sm">
                {gridRows.length} rows × {gridRows[0]!.split(" ").length} columns
                {gridWidths.length > 1 && (
                  <span className="ml-2 text-amber-700 dark:text-amber-400" role="alert">
                    rows are {gridWidths.join(" and ")} wide — they should match
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="md:w-2/5">
            <label className="mb-1 block text-sm font-medium">Words to find (one per line)</label>
            <textarea
              value={finder.words}
              onChange={(event) => updateStore({ "Find-A-Word": { ...finder, words: event.target.value } })}
              rows={14}
              spellCheck={false}
              placeholder={"BEACH\nBIOME\n…"}
              className={`${inputClass} font-mono text-sm`}
            />
            <p className="mt-1 text-sm opacity-60">
              They are uppercased to match the grid. Each one must actually appear in the grid.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {scrambleRows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_1fr_2rem] items-center gap-3 rounded-xl border border-black/10 p-3 dark:border-white/15"
            >
              <label className="flex flex-col text-xs opacity-70">
                Scrambled
                <input
                  className={inputClass}
                  value={row.scrambled}
                  placeholder="selpevriesyl"
                  onChange={(event) => {
                    const rows = [...scrambleRows];
                    rows[index] = { ...row, scrambled: event.target.value };
                    updateStore({ Unscramble: rows });
                  }}
                />
              </label>
              <label className="flex flex-col text-xs opacity-70">
                Answer
                <input
                  className={inputClass}
                  value={row.answer}
                  placeholder="elvispresley"
                  onChange={(event) => {
                    const rows = [...scrambleRows];
                    rows[index] = { ...row, answer: event.target.value };
                    updateStore({ Unscramble: rows });
                  }}
                />
              </label>
              <button
                type="button"
                className={`${rowButtonClass} justify-self-end`}
                title="Remove this line"
                onClick={() => updateStore({ Unscramble: scrambleRows.filter((_, i) => i !== index) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={smallButtonClass}
            onClick={() => updateStore({ Unscramble: [...scrambleRows, { scrambled: "", answer: "" }] })}
          >
            + Add a line
          </button>
          <p className="text-sm opacity-60">
            Answers are compared in lower case with spaces removed, so “Elvis Presley” becomes
            <code className="mx-1">elvispresley</code> when saved.
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3" role="alert">
          <p className="mb-1 text-sm font-semibold">
            The readers cannot play this yet — fix it before saving:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">{problems.map(renderProblem)}</ul>
        </div>
      )}

      <details className="rounded-xl border border-black/10 p-3 text-sm dark:border-white/15">
        <summary className="cursor-pointer font-medium">What will be saved</summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs opacity-80">
          {value || "(nothing yet)"}
        </pre>
      </details>
    </div>
  );
}

/* ------------------------------------------------------- grid-shaped builders */

/**
 * A puzzle that is one picture written out as rows: a sudoku's given numbers, a
 * nonogram's filled squares. The picture is drawn underneath as cells as they
 * are typed, because a grid that has come out a column short looks exactly like
 * a grid that has not until it is drawn.
 */
function GridBuilder({
  grid,
  onChange,
  label,
  rows,
  placeholder,
  hint,
  filled = "",
}: {
  grid: string;
  onChange: (grid: string) => void;
  label: string;
  rows: number;
  placeholder: string;
  hint: string;
  /**
   * The character the preview draws as a filled square, for a picture whose
   * cells are only filled or empty. Left out for a grid of digits, whose cells
   * have something to say and are drawn as the text they hold.
   */
  filled?: string;
}) {
  const lines = grid
    .split("\n")
    .map((line) => line.replace(/[\s|,]/g, ""))
    .filter(Boolean);
  const widths = [...new Set(lines.map((line) => line.length))];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-sm font-medium">{label}</label>
        <textarea
          value={grid}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
          className={`${inputClass} font-mono text-sm`}
        />
        <p className="mt-1 text-sm opacity-60">{hint}</p>
      </div>

      {lines.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Preview</p>
          <div className="overflow-x-auto rounded-xl bg-black/5 p-3 dark:bg-white/5">
            <div className="flex flex-col gap-px">
              {lines.map((line, y) => (
                <div key={y} className="flex gap-px">
                  {Array.from(line).map((cell, x) => (
                    <div
                      key={x}
                      className={`flex size-5 items-center justify-center text-xs font-bold ${
                        filled && cell === filled
                          ? "bg-neutral-900 text-white dark:bg-white dark:text-black"
                          : "bg-white text-black dark:bg-neutral-800 dark:text-white"
                      }`}
                    >
                      {filled ? "" : cell === "." ? "" : cell}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm">
            {lines.length} rows × {lines[0]!.length} columns
            {widths.length > 1 && (
              <span className="ml-2 text-amber-700 dark:text-amber-400" role="alert">
                rows are {widths.join(" and ")} wide — they should match
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- cryptogram */

function CryptogramBuilder({
  value,
  onChange,
}: {
  value: Cryptogram;
  onChange: (value: Cryptogram) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-sm font-medium">Quote</label>
        <textarea
          value={value.quote}
          onChange={(event) => onChange({ ...value, quote: event.target.value })}
          rows={3}
          spellCheck={false}
          placeholder="What we know is a drop, what we do not know is an ocean."
          className={inputClass}
        />
        <p className="mt-1 text-sm opacity-60">
          The quote as it reads. It is uppercased when saved.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Ciphered quote</label>
        <textarea
          value={value.cipher}
          onChange={(event) => onChange({ ...value, cipher: event.target.value })}
          rows={3}
          spellCheck={false}
          className={`${inputClass} font-mono text-sm`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={smallButtonClass}
            onClick={() => onChange({ ...value, cipher: scramble(value.quote) })}
            disabled={!value.quote.trim()}
          >
            Scramble the quote
          </button>
          <span className="text-sm opacity-60">
            A fresh substitution, with no letter standing for itself. Edit it by hand
            afterwards if you want a particular letter to give the game away.
          </span>
        </div>
        <p className="mt-1 text-sm opacity-60">
          It has to keep every space and mark of punctuation where the quote has it — the
          panel says so below if the two have drifted apart.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- connections */

function ConnectionsBuilder({
  rows,
  onChange,
}: {
  rows: ConnectionsRow[];
  onChange: (rows: ConnectionsRow[]) => void;
}) {
  const words = rows.flatMap((row) => row.words.split(",").map((word) => word.trim()).filter(Boolean));

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid grid-cols-[10rem_1fr_2rem] items-end gap-3 rounded-xl border border-black/10 p-3 dark:border-white/15"
        >
          <label className="flex flex-col text-xs opacity-70">
            Category
            <input
              className={inputClass}
              value={row.name}
              placeholder="Things with wings"
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, name: event.target.value };
                onChange(next);
              }}
            />
          </label>
          <label className="flex flex-col text-xs opacity-70">
            Words (four, comma-separated)
            <input
              className={inputClass}
              value={row.words}
              placeholder="plane, bird, bee, angel"
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, words: event.target.value };
                onChange(next);
              }}
            />
          </label>
          <button
            type="button"
            className={`${rowButtonClass} justify-self-end`}
            title="Remove this category"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className={smallButtonClass}
        onClick={() => onChange([...rows, { name: "", words: "" }])}
      >
        + Add a category
      </button>
      <p className="text-sm opacity-60">
        {rows.length} of 4 categories · {words.length} of 16 words. The game is won by finding
        groups of four, so every word has to be used exactly once and no two categories may share
        one.
      </p>
    </div>
  );
}
