"use client";

/**
 * The cryptogram reader.
 *
 * The quote is printed with every letter swapped for another, and the solver
 * writes the real letters back in. Guesses are held per *ciphered* letter
 * rather than per box — that is the whole of the puzzle: one letter stands for
 * one letter throughout, so filling in the first E fills in every E. Two
 * ciphered letters guessed as the same letter are marked, since a substitution
 * cannot do that.
 *
 * Checking marks the boxes rather than refusing the guess: a cryptogram is
 * solved by trying letters and reading the result, and a reader that argued
 * with every keystroke would take the fun out of it.
 */

import { useMemo, useRef, useState } from "react";
import { parsePuzzleData } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function Cryptogram({ puzzle }: { puzzle: { data: string } }) {
  const parsed = useMemo(() => parsePuzzleData("Cryptogram", puzzle.data), [puzzle.data]);
  if (!parsed.ok) return <DataProblem type="Cryptogram" problems={parsed.problems} />;
  return <Playable cipher={parsed.data.cipher} plain={parsed.data.plain} answer={parsed.data.key} />;
}

const LETTER = /[A-Za-z]/;

/** The quote cut into words, so the boxes can wrap like printed text. */
function wordsOf(cipher: string): string[] {
  return cipher.split(/\s+/).filter(Boolean);
}

function Playable({ cipher, plain, answer }: { cipher: string; plain: string; answer: Record<string, string> }) {
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const letters = useMemo(() => [...new Set(cipher.replace(/[^A-Za-z]/g, "").toUpperCase())].sort(), [cipher]);
  const words = useMemo(() => wordsOf(cipher), [cipher]);

  /** Letters of the alphabet guessed onto two different ciphered letters — impossible, so it is shown. */
  const duplicated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const letter of letters) {
      const guess = guesses[letter];
      if (guess) seen.set(guess, (seen.get(guess) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([letter]) => letter));
  }, [guesses, letters]);

  const solved = letters.every((letter) => guesses[letter] === answer[letter]);

  function setGuess(letter: string, value: string) {
    setChecked(false);
    setGuesses((current) => {
      const next = { ...current };
      if (value) next[letter] = value;
      else delete next[letter];
      return next;
    });
  }

  /** Moves the caret to the next box in reading order, so a word can be typed straight through. */
  function focusAfter(letter: string) {
    const boxes = Array.from(frameRef.current?.querySelectorAll<HTMLInputElement>("input[data-cipher]") ?? []);
    const index = boxes.findIndex((box) => box.dataset.cipher === letter);
    boxes[index + 1]?.focus();
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        ref={frameRef}
        className="flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-3 font-mono leading-none"
      >
        {words.map((word, wordIndex) => (
          <div key={wordIndex} className="flex items-end gap-[2px]">
            {Array.from(word).map((char, charIndex) => {
              const letter = char.toUpperCase();
              if (!LETTER.test(char)) {
                // Punctuation is not enciphered, so it stays where the quote
                // put it — and it is a real clue, which is why the parser
                // refuses a cipher whose punctuation does not line up.
                return (
                  <span key={charIndex} className="pb-[6px] text-xl opacity-60">
                    {char}
                  </span>
                );
              }
              const guess = guesses[letter] ?? "";
              const correct = guess && guess === answer[letter];
              const wrong = checked && guess && !correct;
              return (
                <div key={charIndex} className="flex flex-col items-center gap-1">
                  <span className="text-sm opacity-50">{letter}</span>
                  <input
                    data-cipher={letter}
                    value={guess}
                    disabled={revealed}
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Letter ${letter}`}
                    onChange={(event) => {
                      const typed = event.target.value.replace(/[^A-Za-z]/g, "").slice(-1).toUpperCase();
                      setGuess(letter, typed);
                      if (typed) focusAfter(letter);
                    }}
                    className={[
                      "size-6 rounded border text-center text-base uppercase caret-transparent outline-none",
                      "dark:bg-neutral-900",
                      correct ? "border-emerald-600 bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50" : "border-black/25 dark:border-white/25",
                      wrong ? "border-red-600 bg-red-200 text-red-950 dark:bg-red-900 dark:text-red-50" : "",
                      duplicated.has(guess) ? "border-red-600" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-1.5 text-sm transition-transform hover:scale-105 dark:border-white/20"
          onClick={() => setChecked(true)}
          disabled={revealed || !Object.keys(guesses).length}
        >
          Check
        </button>
        <button
          type="button"
          className="rounded-full border border-black/20 px-5 py-1.5 text-sm transition-transform hover:scale-105 dark:border-white/20"
          onClick={() => {
            setGuesses({ ...answer });
            setRevealed(true);
            setChecked(false);
          }}
          disabled={revealed}
        >
          Reveal the quote
        </button>
      </div>

      <p className="text-sm opacity-70" role="status">
        {solved ? (
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            Solved — the quote reads “{plain.slice(0, 60)}
            {plain.length > 60 ? "…" : ""}”.
          </span>
        ) : (
          <>
            {Object.keys(guesses).length} of {letters.length} letters guessed.
            {duplicated.size > 0 && (
              <span className="ml-2 text-red-700 dark:text-red-400">
                Two ciphered letters cannot both stand for {[...duplicated].join(" or ")}.
              </span>
            )}
          </>
        )}
      </p>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-sm opacity-70">
        {letters.map((letter) => (
          <span key={letter}>
            {letter} → {guesses[letter] || "·"}
          </span>
        ))}
      </div>

      <p className="max-w-2xl text-center text-sm opacity-60">
        Every letter stands for one other letter, all the way through — typos and all. Fill in a box
        and every copy of that letter fills in with it.
      </p>
    </div>
  );
}
