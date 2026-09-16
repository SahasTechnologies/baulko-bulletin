"use client"

import { useState } from "react";
import { parsePuzzleData } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function FindAWord({ puzzle }: {
  puzzle: {
    data: string
  }
}) {
  // The grid and the word list come from the shared parser, which reports a
  // missing blank line, ragged rows or a swallowed separator instead of
  // throwing the way `split('\n\n')[1]` did on the raw text.
  const parsed = parsePuzzleData("Find-A-Word", puzzle.data);
  if (!parsed.ok) return <DataProblem type="Find-A-Word" problems={parsed.problems} />;
  return <Playable grid={parsed.data.grid} wordList={parsed.data.words} />;
}

function Playable({ grid, wordList }: {
  grid: string[][]
  wordList: string[]
}) {
  const [words, setWords] = useState(wordList.map(word => ({ word, positions: [] as { x: number, y: number }[] })))
  const width = grid[0].length
  const [start, setStart] = useState<number | null>(null)
  // Two cell indices are on one line when they share a row, a column, or a
  // diagonal. The coordinates are local rather than reassigned into `a` and
  // `b`: the parameters are indices, and the old version overwrote them with
  // points, which only type-checked because both were `any`.
  const isInline = (a: number, b: number) => {
    const first = { x: a % width, y: Math.floor(a / width) }
    const second = { x: b % width, y: Math.floor(b / width) }
    return (
      first.x == second.x ||
      first.y == second.y ||
      Math.abs(first.x - second.x) == Math.abs(first.y - second.y)
    )
  }

  return <div>
    <div className="flex justify-center">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}>
        {
          grid.flat().map((letter, index) => {
            const disabled = start !== null && !isInline(start, index)
            let done = words.map((word: any, index: number) => [word, index]).find(([{ positions }]: any) => positions.length && positions.some(({ x, y }: any) => x + y * width == index))
            return <button
              key={index}
              className={`aspect-square flex justify-center items-center font-bold size-8 hover:scale-110 transition-all rounded-full active:scale-100 active:bg-blue-200 dark:active:bg-blue-800 opacity-100 ${start !== null && start == index ? 'bg-blue-400 dark:bg-blue-600' : 'hover:bg-slate-200 dark:hover:bg-white/10'} ${disabled ? 'text-slate-300 dark:text-neutral-600' : ''} hover:text-black dark:hover:text-white`}
              style={done && done[0].positions.length && start === null ? { color: `hsl(${done[1] / words.length}turn 100% 30%)` } : {}}
              onClick={() => {
                if (start === index) {
                  setStart(null)
                } else {
                  if (start !== null && !disabled) {
                    const startCoords = { x: start % width, y: Math.floor(start / width) }
                    const endCoords = { x: index % width, y: Math.floor(index / width) }
                    const sign = { x: Math.sign(endCoords.x - startCoords.x), y: Math.sign(endCoords.y - startCoords.y) }
                    let word = ''
                    let positions = []
                    for (let current = startCoords; current.x != endCoords.x + sign.x || current.y != endCoords.y + sign.y; current = { x: current.x + sign.x, y: current.y + sign.y }) {
                      word += grid[current.y][current.x]
                      positions.push(current)
                    }

                    if (words.some((other: any) => other.word == word) || words.some((other: any) => other.word == Array.from(word).toReversed().join(''))) {
                      const next = words.map((w: any) => w.word == word || w.word == Array.from(word).toReversed().join('') ? { ...w, positions } : w)
                      if (next.every(({ positions }: any) => positions.length)) {
                        alert('Congratulations! You found all the words!')
                      }
                      setWords(next)
                    }
                    setStart(null)
                  } else {
                    setStart(index)
                  }
                }
              }}
            >
              <div>
                {letter}
              </div>
            </button>
          })
        }
      </div>
    </div>
    <div className="flex justify-center">
      <div className="grid grid-cols-3 gap-x-4">
        {words.map(({ word, positions }: any, index: number) => <div key={index} className={`${positions.length ? 'line-through opacity-50' : ''}`} style={positions.length ? { color: `hsl(${index / words.length}turn 100% 40%)` } : {}}>
          {word}
        </div>)}
      </div>
    </div>
  </div >
}
