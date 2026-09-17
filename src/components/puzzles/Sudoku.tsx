"use client";

/**
 * The sudoku reader.
 *
 * A sudoku ships without its solution — the parser keeps only the numbers that
 * are given — so "solved" here means what it means on paper: every cell filled
 * and no rule broken. That is the whole check, and it is why the reader can
 * highlight clashes as they are typed: a digit repeated in a row, a column or a
 * box is wrong whoever typed it, and waiting until the end to say so would send
 * the solver back to the beginning to find it.
 *
 * The grid owns the keyboard while a cell is selected: digits write, backspace
 * clears, the arrow keys move. A pad sits under it for a touchscreen, where
 * there is no keyboard to type on.
 */

import { useMemo, useRef, useState } from "react";
import { parsePuzzleData } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function Sudoku({ puzzle }: { puzzle: { data: string } }) {
  const parsed = useMemo(() => parsePuzzleData("Sudoku", puzzle.data), [puzzle.data]);
  if (!parsed.ok) return <DataProblem type="Sudoku" problems={parsed.problems} />;
  return <Playable givens={parsed.data.givens} />;
}

/** The one size a sudoku comes in. */
const SIZE = 9;

/**
 * Every cell that repeats a digit within its row, column or 3×3 box, keyed
 * `x,y`.
 *
 * Both ends of a clash are marked, not just the second one: the given number
 * and the guess are equally part of the problem, and marking one of them is how
 * a solver ends up staring at the wrong cell.
 */
function clashesIn(values: (number | null)[][]): Set<string> {
  const clashes = new Set<string>();
  const mark = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    clashes.add(`${a.x},${a.y}`);
    clashes.add(`${b.x},${b.y}`);
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value = values[y]![x];
      if (value === null) continue;
      for (let other = 0; other < SIZE; other++) {
        if (other !== x && values[y]![other] === value) mark({ x, y }, { x: other, y });
        if (other !== y && values[other]![x] === value) mark({ x, y }, { x, y: other });
      }
      const boxX = Math.floor(x / 3) * 3;
      const boxY = Math.floor(y / 3) * 3;
      for (let by = boxY; by < boxY + 3; by++) {
        for (let bx = boxX; bx < boxX + 3; bx++) {
          if ((bx !== x || by !== y) && values[by]![bx] === value) mark({ x, y }, { x: bx, y: by });
        }
      }
    }
  }
  return clashes;
}

function Playable({ givens }: { givens: (number | null)[][] }) {
  const [values, setValues] = useState<(number | null)[][]>(() => givens.map((row) => [...row]));
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const clashes = useMemo(() => clashesIn(values), [values]);
  const placed = values.flat().filter((value) => value !== null).length;
  const solved = placed === SIZE * SIZE && clashes.size === 0;

  const isGiven = (x: number, y: number) => givens[y]![x] !== null;

  function write(x: number, y: number, value: number | null) {
    if (isGiven(x, y)) return;
    setValues((current) => {
      const next = current.map((row) => [...row]);
      next[y]![x] = value;
      return next;
    });
  }

  /**
   * A pad press: writes the digit and puts the keyboard back on the grid.
   *
   * The pad sits outside the grid, so tapping it moves the focus to the button
   * and the grid stops hearing the keyboard — the next digit typed, or an arrow
   * key, then does nothing at all until the grid is clicked again. Handing the
   * focus back is what keeps a mouse or touchscreen and the keyboard usable in
   * the same sitting.
   */
  function tap(value: number | null) {
    if (!selected) return;
    write(selected.x, selected.y, value);
    gridRef.current?.focus();
  }

  function move(dx: number, dy: number) {
    if (!selected) return;
    const x = Math.min(SIZE - 1, Math.max(0, selected.x + dx));
    const y = Math.min(SIZE - 1, Math.max(0, selected.y + dy));
    setSelected({ x, y });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!selected) return;
    const { x, y } = selected;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      write(x, y, Number(event.key));
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      write(x, y, null);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const movement = step[event.key];
    if (movement) {
      event.preventDefault();
      move(movement[0], movement[1]);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={gridRef}
        role="grid"
        aria-label="Sudoku grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="grid touch-manipulation select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-black/30 dark:focus-visible:ring-white/30"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 2.25rem)` }}
      >
        {values.map((row, y) =>
          row.map((value, x) => {
            const given = isGiven(x, y);
            const isSelected = selected?.x === x && selected?.y === y;
            const clash = clashes.has(`${x},${y}`);
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                aria-label={`Row ${y + 1} column ${x + 1}${value === null ? ", empty" : `, ${value}`}`}
                onClick={() => {
                  setSelected({ x, y });
                  gridRef.current?.focus();
                }}
                className={[
                  "flex size-9 items-center justify-center border border-black/20 text-lg transition-colors dark:border-white/20",
                  // The 3×3 boxes are drawn with a heavier edge, the way a
                  // printed grid sets them apart.
                  x % 3 === 0 ? "border-l-2 border-l-black/60 dark:border-l-white/60" : "",
                  x === SIZE - 1 ? "border-r-2 border-r-black/60 dark:border-r-white/60" : "",
                  y % 3 === 0 ? "border-t-2 border-t-black/60 dark:border-t-white/60" : "",
                  y === SIZE - 1 ? "border-b-2 border-b-black/60 dark:border-b-white/60" : "",
                  given ? "font-bold" : "font-medium text-orange-700 dark:text-orange-300",
                  isSelected ? "bg-yellow-200 dark:bg-yellow-500/30" : "",
                  clash ? "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {value ?? ""}
              </button>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            key={digit}
            type="button"
            className="size-9 rounded-full border border-black/20 text-lg transition-transform hover:scale-110 dark:border-white/20"
            onClick={() => tap(digit)}
            disabled={!selected}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="rounded-full border border-black/20 px-4 py-1.5 text-sm transition-transform hover:scale-105 disabled:opacity-40 dark:border-white/20"
          onClick={() => tap(null)}
          disabled={!selected}
        >
          Clear
        </button>
      </div>

      <p className="text-sm opacity-70" role="status">
        {solved ? (
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            Solved — every row, column and box holds 1 to 9.
          </span>
        ) : (
          <>
            {placed} of {SIZE * SIZE} cells filled.
            {clashes.size > 0 && (
              // Counted as cells, not as pairs of them: one digit can break the
              // rules twice at once (repeated along its row and down its
              // column), and halving the marked cells then announces "1.5
              // clashes" — which is a number no solver can act on.
              <span className="ml-2 text-red-700 dark:text-red-400">
                {clashes.size === 1 ? "One cell clashes" : `${clashes.size} cells clash`}.
              </span>
            )}
          </>
        )}
      </p>
      <p className="text-sm opacity-60">
        Click a square, then type a digit (arrow keys move, backspace clears). Numbers in orange are
        yours; the bold ones were given.
      </p>
    </div>
  );
}
