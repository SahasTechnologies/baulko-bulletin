"use client";

/**
 * The Connections reader: sixteen words, four categories of four, and no clue
 * about which is which.
 *
 * The tiles are laid out by a hash of the word rather than by `Math.random`,
 * because this reader is server-rendered first: a random order would differ
 * between the HTML and the first client render, which React reports as a
 * hydration mismatch and then rebuilds the grid to fix. Hashing the words is
 * just as arbitrary to look at, and the same on both sides. Shuffle is a
 * different seed, so it is a real shuffle and still a deliberate one.
 *
 * Four wrong guesses ends it, which is what the printed puzzle does; the
 * categories are then shown rather than left as a puzzle that cannot be won.
 */

import { useMemo, useState } from "react";
import { parsePuzzleData, type ConnectionsGroup } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function Connections({ puzzle }: { puzzle: { data: string } }) {
  const parsed = useMemo(() => parsePuzzleData("Connections", puzzle.data), [puzzle.data]);
  if (!parsed.ok) return <DataProblem type="Connections" problems={parsed.problems} />;
  return <Playable groups={parsed.data.groups} />;
}

/** A wrong guess allowed before the puzzle is given up, as printed. */
const MAX_MISTAKES = 4;

/** One colour per category, in the order the groups are stored. */
const GROUP_CLASSES = [
  "bg-amber-200 text-amber-950 dark:bg-amber-500/80 dark:text-amber-950",
  "bg-emerald-200 text-emerald-950 dark:bg-emerald-500/80 dark:text-emerald-950",
  "bg-sky-200 text-sky-950 dark:bg-sky-500/80 dark:text-sky-950",
  "bg-fuchsia-200 text-fuchsia-950 dark:bg-fuchsia-500/80 dark:text-fuchsia-950",
];

/** FNV-1a, so a word always lands in the same place for a given seed. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function Playable({ groups }: { groups: ConnectionsGroup[] }) {
  const [seed, setSeed] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [solved, setSolved] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [message, setMessage] = useState("");
  const [givenUp, setGivenUp] = useState(false);

  /** Which category a word belongs to — only ever used to answer a guess. */
  const owner = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group, index) => group.words.forEach((word) => map.set(word.toLowerCase(), index)));
    return map;
  }, [groups]);

  const order = useMemo(() => {
    const words = groups.flatMap((group) => group.words);
    return words
      .map((word) => ({ word, rank: hash(`${word.toLowerCase()}#${seed}`) }))
      .sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word))
      .map((entry) => entry.word);
  }, [groups, seed]);

  const finished = givenUp || solved.length === groups.length;

  function toggle(word: string) {
    if (finished) return;
    setMessage("");
    setSelected((current) =>
      current.includes(word)
        ? current.filter((entry) => entry !== word)
        : current.length === 4
          ? current
          : [...current, word]
    );
  }

  function submit() {
    if (selected.length !== 4 || finished) return;
    const guess = selected.map((word) => owner.get(word.toLowerCase()));
    const group = guess[0];
    if (group !== undefined && guess.every((entry) => entry === group)) {
      const next = [...solved, group];
      setSolved(next);
      setSelected([]);
      setMessage(
        next.length === groups.length
          ? "That is all four — solved."
          : `Right: ${groups[group]!.name}.`
      );
      return;
    }

    const remaining = MAX_MISTAKES - mistakes - 1;
    setMistakes((count) => count + 1);
    setSelected([]);
    if (remaining <= 0) {
      setGivenUp(true);
      setSolved(groups.map((_, index) => index));
      setMessage("Out of guesses — the categories are shown.");
    } else {
      setMessage(remaining === 1 ? "Not it. One guess left." : `Not it. ${remaining} guesses left.`);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="grid w-full max-w-2xl grid-cols-4 gap-2">
        {order.map((word) => {
          const group = owner.get(word.toLowerCase());
          const isSolved = group !== undefined && solved.includes(group);
          const isSelected = selected.includes(word);
          return (
            <button
              key={word}
              type="button"
              aria-pressed={isSelected}
              disabled={isSolved || finished}
              onClick={() => toggle(word)}
              className={[
                "flex min-h-16 items-center justify-center rounded-lg border px-2 py-3 text-center text-sm font-semibold uppercase tracking-wide transition",
                isSolved && group !== undefined ? GROUP_CLASSES[group % GROUP_CLASSES.length] : "",
                !isSolved && isSelected ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "",
                !isSolved && !isSelected ? "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10" : "",
                !isSolved && finished ? "opacity-60" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {word}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="rounded-full bg-black px-6 py-2 font-bold text-white transition-transform hover:scale-105 disabled:opacity-40 dark:bg-white dark:text-black"
          onClick={submit}
          disabled={selected.length !== 4 || finished}
        >
          Submit
        </button>
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-2 text-sm transition-transform hover:scale-105 disabled:opacity-40 dark:border-white/20"
          onClick={() => setSelected([])}
          disabled={!selected.length}
        >
          Deselect all
        </button>
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-2 text-sm transition-transform hover:scale-105 dark:border-white/20"
          onClick={() => {
            setSeed((current) => current + 1);
            setSelected([]);
          }}
        >
          Shuffle
        </button>
      </div>

      <div className="flex items-center gap-2 text-sm" role="status">
        <span className="opacity-60">Mistakes</span>
        {Array.from({ length: MAX_MISTAKES }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`size-2.5 rounded-full ${
              index < mistakes ? "bg-red-600 dark:bg-red-400" : "bg-black/20 dark:bg-white/25"
            }`}
          />
        ))}
        <span className="opacity-60">
          {mistakes} of {MAX_MISTAKES} used
        </span>
      </div>

      {message && <p className="text-sm font-medium">{message}</p>}

      {solved.length > 0 && (
        <div className="flex w-full max-w-2xl flex-col gap-2">
          {solved.map((index) => {
            const group = groups[index]!;
            return (
              <div
                key={index}
                className={`rounded-lg px-4 py-2 text-sm ${GROUP_CLASSES[index % GROUP_CLASSES.length]}`}
              >
                <span className="font-bold uppercase tracking-wide">{group.name}</span>
                <span className="ml-3 opacity-80">{group.words.join(", ")}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="max-w-2xl text-center text-sm opacity-60">
        Pick four words that belong together, then submit. Every word is used exactly once.
      </p>
    </div>
  );
}
