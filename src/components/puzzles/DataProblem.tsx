"use client";

/**
 * What a puzzle reader renders instead of itself when the stored data does
 * not match the format its type promises.
 *
 * Every reader gets the same treatment: `parsePuzzleData` returns problems
 * rather than throwing, and the reader either plays or hands its problems
 * here. This box mirrors the amber "can't be played here yet" panel the
 * puzzle page draws for an unknown type, so a puzzle that cannot render has
 * one look wherever the reason is.
 */

import type { PuzzleDataProblem } from "@/lib/puzzle-data";

export function DataProblem({
  type,
  problems,
}: {
  type: string;
  problems: PuzzleDataProblem[];
}) {
  return (
    <div className="max-w-2xl rounded-2xl border border-amber-500/40 bg-amber-500/10 px-6 py-5">
      <p className="mb-1 font-semibold">This puzzle’s stored data is malformed.</p>
      <p className="opacity-80">
        It is saved as {type}, but the text does not fit that format:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm opacity-90">
        {problems.map(({ line, message }, index) => (
          <li key={index}>
            {line > 0 ? (
              <>
                line {line}: {message}
              </>
            ) : (
              message
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm opacity-60">
        Fix it in the admin panel’s puzzle editor — the builder or its raw-data view can
        rewrite it so it plays.
      </p>
    </div>
  );
}
