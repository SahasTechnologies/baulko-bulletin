"use client"

import { useEffect, useMemo, useState, Fragment, useRef } from "react";

export function Unscramble({ puzzle }: {
  puzzle: {
    data: string
  }
}) {
  return <div className="flex justify-center">
    <div className="grid grid-cols-[auto_auto_auto] gap-y-1 gap-x-4">
      {
        puzzle.data.split("\n").map((line, index) => {
          function Line() {
            const [scrambled, unscrambled] = line.split(" ")
            const [value, setValue] = useState("")
            return <Fragment>
              <div className="font-mono">{(index + 1).toString().padStart(2, "0")}</div>
              <div className="text-right font-semibold">{scrambled}</div>
              <input type="text" className={`shadow rounded border px-2 ${value == unscrambled ? "bg-green-200 border-green-600 text-green-900" : ""}`} onChange={e => { setValue(e.target.value) }} />
            </Fragment>
          }
          return <Line key={index} />
        })
      }
    </div>
  </div>
}
