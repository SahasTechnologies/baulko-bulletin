"use client"

import { useState, Fragment } from "react";
import { parsePuzzleData } from "@/lib/puzzle-data";
import { DataProblem } from "./DataProblem";

export function Unscramble({ puzzle }: {
  puzzle: {
    data: string
  }
}) {
  // The shared parser reports a line missing its answer instead of the old
  // destructuring leaving `unscrambled` undefined and comparing it forever.
  const parsed = parsePuzzleData("Unscramble", puzzle.data);
  if (!parsed.ok) return <DataProblem type="Unscramble" problems={parsed.problems} />;
  return <Playable lines={parsed.data.lines} />;
}

function Playable({ lines }: {
  lines: { scrambled: string; answer: string }[]
}) {
  return <div className="flex justify-center">
    <div className="grid grid-cols-[auto_auto_auto] gap-y-1 gap-x-4">
      {
        lines.map((line, index) => {
          function Line() {
            const scrambled = line.scrambled
            const unscrambled = line.answer
            const [value, setValue] = useState("")
            return <Fragment>
              <div className="font-mono">{(index + 1).toString().padStart(2, "0")}</div>
              <div className="text-right font-semibold">{scrambled}</div>
              <input type="text" className={`shadow rounded border px-2 dark:bg-neutral-900 dark:border-white/15 ${value == unscrambled ? "bg-green-200 border-green-600 text-green-900 dark:bg-green-900 dark:border-green-400 dark:text-green-100" : ""}`} onChange={e => { setValue(e.target.value) }} />
            </Fragment>
          }
          return <Line key={index} />
        })
      }
    </div>
  </div>
}
