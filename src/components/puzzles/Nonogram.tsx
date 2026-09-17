"use client";

/**
 * The nonogram (picross) reader.
 *
 * The stored data is the picture itself; the numbers around the edge are
 * derived from it when it is parsed. That leaves nothing to get out of step —
 * a clue that disagreed with the picture would be a puzzle nobody could solve —
 * and it means the panel only has to be shown the drawing.
 *
 * The picture is drawn by dragging, which is how these are actually solved:
 * a row of five is one gesture, not five clicks. Marking a cell as known-empty
 * is the other half of the technique, so a drag that starts on a filled cell
 * clears instead of filling, and a right-click toggles the × mark.
 *
 * Checking is on demand and marks what is wrong rather than refusing the move:
 * the solution is in the browser either way, but showing it unasked is not a
 * puzzle.
 */

import { Fragment, useMemo, useRef, useState } from "react";
import { parsePuzzleData } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function Nonogram({ puzzle }: { puzzle: { data: string } }) {
  const parsed = useMemo(() => parsePuzzleData("Nonogram", puzzle.data), [puzzle.data]);
  if (!parsed.ok) return <DataProblem type="Nonogram" problems={parsed.problems} />;
  return <Playable grid={parsed.data.grid} rowClues={parsed.data.rowClues} colClues={parsed.data.colClues} />;
}

/** What a drag is doing, decided by the cell it started on. */
type Paint = "fill" | "clear";

const CELL = "1.6rem";

function Playable({ grid, rowClues, colClues }: { grid: boolean[][]; rowClues: number[][]; colClues: number[][] }) {
  const [filled, setFilled] = useState<boolean[][]>(() => grid.map((row) => row.map(() => false)));
  const [marked, setMarked] = useState<boolean[][]>(() => grid.map((row) => row.map(() => false)));
  const [wrong, setWrong] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const painting = useRef<Paint | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const height = grid.length;
  const width = grid[0]!.length;
  const painted = filled.flat().filter(Boolean).length;
  const solved = useMemo(
    () => filled.every((row, y) => row.every((cell, x) => cell === grid[y]![x])),
    [filled, grid]
  );

  function paint(x: number, y: number, mode: Paint) {
    setFilled((current) => {
      const wanted = mode === "fill";
      if (current[y]![x] === wanted) return current;
      const next = current.map((row) => [...row]);
      next[y]![x] = wanted;
      return next;
    });
    setMarked((current) => {
      if (!current[y]![x]) return current;
      const next = current.map((row) => [...row]);
      next[y]![x] = false;
      return next;
    });
    setWrong((current) => {
      if (!current.size) return current;
      const next = new Set(current);
      next.delete(`${x},${y}`);
      return next;
    });
  }

  function toggleMark(x: number, y: number) {
    setMarked((current) => {
      const next = current.map((row) => [...row]);
      next[y]![x] = !next[y]![x];
      return next;
    });
    setFilled((current) => {
      if (!current[y]![x]) return current;
      const next = current.map((row) => [...row]);
      next[y]![x] = false;
      return next;
    });
  }

  /** The cell under a pointer, for a drag that runs across cells. */
  function cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const x = element?.dataset?.cellX;
    const y = element?.dataset?.cellY;
    if (x === undefined || y === undefined) return null;
    return { x: Number(x), y: Number(y) };
  }

  // Typed to the element rather than to a div: the cells are buttons (so they
  // can be reached by keyboard), and a pointer event from one of them is not a
  // pointer event from the grid's wrapper.
  function startPaint(event: React.PointerEvent<HTMLElement>, x: number, y: number) {
    if (solved) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const mode: Paint = filled[y]![x] ? "clear" : "fill";
    painting.current = mode;
    paint(x, y, mode);
  }

  function continuePaint(event: React.PointerEvent<HTMLElement>) {
    const mode = painting.current;
    if (!mode) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell) paint(cell.x, cell.y, mode);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div ref={frameRef} className="max-w-full overflow-x-auto p-1">
        <div
          className="select-none touch-none"
          onPointerMove={continuePaint}
          onPointerUp={() => (painting.current = null)}
          onPointerCancel={() => (painting.current = null)}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            display: "grid",
            gridTemplateColumns: `auto repeat(${width}, ${CELL})`,
            gridAutoRows: CELL,
          }}
        >
          {/* The column clues sit above the picture, stacked so their last
              number touches the column it belongs to. */}
          <div />
          {colClues.map((clue, x) => (
            <div key={`col-${x}`} className="flex flex-col items-center justify-end pb-1 text-xs leading-tight">
              {clue.length ? clue.map((run, index) => <span key={index}>{run}</span>) : <span className="opacity-30">0</span>}
            </div>
          ))}

          {grid.map((row, y) => (
            // The clue and its row of cells are one grid row, so they share a
            // keyed fragment: two children per map step, one key between them.
            <Fragment key={`row-${y}`}>
              <div className="flex items-center justify-end gap-1 pr-2 text-xs">
                {rowClues[y]!.length ? (
                  rowClues[y]!.map((run, index) => <span key={index}>{run}</span>)
                ) : (
                  <span className="opacity-30">0</span>
                )}
              </div>
              {row.map((_, x) => {
                const isWrong = wrong.has(`${x},${y}`);
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    data-cell-x={x}
                    data-cell-y={y}
                    aria-label={`Row ${y + 1} column ${x + 1}`}
                    onPointerDown={(event) => startPaint(event, x, y)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!solved) toggleMark(x, y);
                    }}
                    className={[
                      "border border-black/15 transition-colors dark:border-white/15",
                      filled[y]![x] ? "bg-neutral-900 dark:bg-white" : "bg-white hover:bg-black/5 dark:bg-neutral-900 dark:hover:bg-white/10",
                      isWrong ? "bg-red-400 dark:bg-red-600" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {!filled[y]![x] && marked[y]![x] && <span className="text-[10px] opacity-50">✕</span>}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-1.5 text-sm transition-transform hover:scale-105 dark:border-white/20"
          onClick={() => {
            const bad = new Set<string>();
            filled.forEach((row, y) =>
              row.forEach((cell, x) => {
                if (cell !== grid[y]![x]) bad.add(`${x},${y}`);
              })
            );
            setWrong(bad);
            setMessage(
              bad.size === 0
                ? "That is the picture — solved."
                : `${bad.size} cell${bad.size === 1 ? "" : "s"} in the wrong place (shown in red).`
            );
          }}
        >
          Check
        </button>
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-1.5 text-sm transition-transform hover:scale-105 dark:border-white/20"
          onClick={() => {
            setFilled(grid.map((row) => [...row]));
            setMarked(grid.map((row) => row.map(() => false)));
            setWrong(new Set());
            setMessage("That is the picture — solved.");
          }}
        >
          Show the picture
        </button>
      </div>

      <p className="text-sm opacity-70" role="status">
        {solved ? (
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            Solved — every clue is satisfied.
          </span>
        ) : (
          <>
            {painted} of {height * width} cells filled.
            {message && <span className="ml-2">{message}</span>}
          </>
        )}
      </p>

      <p className="max-w-2xl text-center text-sm opacity-60">
        Drag across the squares to fill them; a drag from a filled square rubs out. Right-click a
        square to mark it as one you know is empty. Every run of filled squares is one of the numbers
        beside its row or above its column, in order.
      </p>
    </div>
  );
}
