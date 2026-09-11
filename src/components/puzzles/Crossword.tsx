"use client"

import { useEffect, useMemo, useState, Fragment } from "react";

export function Crossword({ puzzle }: {
  puzzle: {
    data: string
  }
}) {
  const words = useMemo(() => [...Array.from(puzzle.data.matchAll(/(\d+) (\d+) (across|down) (.+?) (.+)/g))].map(array => Array.from(array) as any)
    .map(([_, x, y, direction, word, clue]: [string, string, string, 'across' | 'down', string, string]) => ({ x: parseInt(x), y: parseInt(y), direction, word: word.toUpperCase(), clue })), [puzzle.data]);
  const starts = useMemo(() => words.map(word => ({ x: word.x, y: word.y })).filter((word, index, words) => words.findIndex(other => other.x == word.x && other.y == word.y) == index).toSorted((a, b) => a.y - b.y || a.x - b.x), [words]);
  const size = useMemo(() => {
    let size = { x: 0, y: 0 };
    for (const word of words) {
      let end = {
        'across': { x: word.x + word.word.length, y: word.y },
        'down': { x: word.x, y: word.y + word.word.length }
      }[word.direction];
      size.x = Math.max(size.x, end.x);
      size.y = Math.max(size.y, end.y);
    }
    return size
  }, [words])
  const letters = useMemo(() => [...Array(size.y)].flatMap((_, y) => [...Array(size.x)].map((_, x) => {
    let letter = words.flatMap(word => [...Array.from(word.word)].map((char, index) => ({
      char,
      position: {
        'across': { x: word.x + index, y: word.y },
        'down': { x: word.x, y: word.y + index }
      }[word.direction]
    })
    )
    ).find(({ position }) => position.x === x && position.y === y);
    if (letter) {
      letter = {
        char: letter.char,
        start: (() => {
          const index = starts.findIndex(other => other.x == x && other.y == y)
          if (index == -1) return null;
          return index
        })()
      } as any;
    }
    return letter;
  })), [size.x, size.y, starts, words]);

  // Setter-only state: the values are written but never read back.
  const [, setOuterSolution] = useState(null);
  const [, setSelectedWord] = useState<{
    x: number, y: number, word: string, direction: 'across' | 'down'
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [solution, setSolution] = useState(Object.fromEntries(letters.filter(letter => letter).map((index) => [index, null])));
  const [lastDirection, setLastDirection] = useState('across');
  const wordContains = (word: {
    x: number, y: number, word: string, direction: 'across' | 'down'
  }, position: { x: number, y: number }) => {
    const end = {
      'across': { x: word.x + word.word.length - 1, y: word.y },
      'down': { x: word.x, y: word.y + word.word.length - 1 }
    }[word.direction];
    return word.x <= position.x
      && position.x <= end.x
      && word.y <= position.y
      && position.y <= end.y
  }
  const onSelectionChange = () => {
    const position = (index: number) => ({ x: index % size.x, y: Math.floor(index / size.x) });
    if (selected === null) {
      setSelectedWord(
        selected
      )
    } else {
      const filtered = words.filter(word => wordContains(word, position(selected)))
      setSelectedWord(filtered.find(word => word.direction == lastDirection) || filtered[0])
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const result = (() => {
        if (event.key.length == 1 && event.key.match(/[a-zA-Z]/)) {
          return [{ type: 'write', char: event.key.toUpperCase() }, 'next'];
        }
        switch (event.key) {
          case 'ArrowLeft':
            return [{ type: 'keep' }, 'left'];
          case 'ArrowRight':
            return [{ type: 'keep' }, 'right'];
          case 'ArrowUp':
            return [{ type: 'keep' }, 'up'];

          case 'ArrowDown':
            return [{ type: 'keep' }, 'down'];
          case 'Backspace':
            return [{ type: 'clear' }, 'previous'];
          case 'Escape':
            setSelected(null);
            onSelectionChange();
            event.preventDefault();
            return null;
          default:
            return null;
        }
      })();
      if (result == null) {
        return;
      }
      event.preventDefault();
      const [next, movement] = result;
      (() => {
        const apply_move = (movement: string) => {
          if (selected === null) {
            return null;
          }
          if ({
            'left': selected % size.x == 0,
            'right': selected % size.x == size.x - 1,
            'up': selected < size.x,
            'down': selected >= size.x * (size.y - 1),
          }[movement]) {
            return null;
          }
          setLastDirection({
            'left': 'across',
            'right': 'across',
            'up': 'down',
            'down': 'down',
          }[movement]!);
          return ({
            'left': selected - 1,
            'right': selected + 1,
            'up': selected - size.x,
            'down': selected + size.x,
          })[movement];
        };
        const newSelected = (() => {
          if (selected === null) {
            return null;
          }

          switch (movement) {
            case 'next':
            case 'previous':
              const position = { x: selected % size.x, y: Math.floor(selected / size.x) };
              let word = words.find(word => wordContains(word, position) && lastDirection == word.direction);
              if (!word) {
                word = words.find(word => wordContains(word, position));
              }
              if (!word) {
                return null;
              }
              debugger
              return apply_move({
                'next': {
                  'across': 'right',
                  'down': 'down'
                }[word.direction],
                'previous': {
                  'across': 'left',
                  'down': 'up'
                }[word.direction]
              }[movement]);
            default:
              return apply_move(movement as any);
          }
        })();
        if (newSelected === null) {
          return null;
        }
        if (!letters[newSelected!]) {
          return null;
        }
        setSelected(newSelected!);
        onSelectionChange();
      })();
      switch ((next as any).type) {
        case 'keep':
          return;
        default:
          switch ((next as any).type) {
            case 'clear':
              setSolution({ ...solution, [selected as any]: null });
              break;
            case 'write':
              setSolution({ ...solution, [selected as any]: (next as any).char });
              break;
          }
          setOuterSolution(solution);
      }
    };
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  })
  return <>
    <div>
      <div className="flex justify-center w-full p-2 overflow-x-auto select-none">
        <div className="grid cursor-pointer" style={{ gridTemplateColumns: `repeat(${size.x}, auto)` }} >
          {letters
            .map((cell, index) => {
              switch (cell) {
                case null:
                case undefined:
                  return (<div className="bg-black" key={index}>
                    <button
                      className="size-full"
                      onClick={() => {
                        setSelected(index);
                        onSelectionChange();
                      }}
                    ></button>
                  </div>)
                default:
                  return <div
                    className={`${selected == index && "bg-yellow-200"} ${(() => {
                      const position = (index: number) => ({ x: index % size.x, y: Math.floor(index / size.x) });
                      if (selected === null) {
                        return false;
                      }
                      const filtered = words.filter(word => wordContains(word, position(selected)))
                      const find = filtered.find(word => word.direction == lastDirection) || filtered[0]
                      if (!find) {
                        return false;
                      }
                      return wordContains(find, position(index))
                    })() && selected != index && "bg-blue-200"} relative text-xl border border-black size-8`}
                    key={index}
                  >
                    <input
                      className="text-center bg-transparent size-full focus:outline-none caret-transparent cursor-pointer"
                      onMouseDown={() => {
                        setLastDirection(lastDirection == 'across' ? 'down' : 'across');
                      }}
                      onFocus={() => {
                        if (selected === null) {
                          setSelected(index)
                        } else if (selected === index) {
                          setSelected(null)
                        } else {
                          setSelected(index)
                        }
                        onSelectionChange()
                      }}
                      defaultValue={
                        solution[index] || ''
                      }
                    />
                    <div className="absolute text-[8px] leading-none opacity-50 inset-0.5 pointer-events-none">
                      {(() => {
                        if (!('start' in cell)) {
                          return null
                        }
                        if (cell?.start === null || cell?.start === undefined) {
                          return null
                        }
                        return (cell.start as number) + 1
                      })()}
                    </div>
                  </div>
              }
            })
          }
        </div>
      </div>
      <div className="flex justify-center">
        <button className="p-1 px-2 disabled:opacity-25 bg-black text-white rounded-xl" onClick={() => {
          if (JSON.stringify([...Array(size.x * size.y)].map((_, index) => Object.fromEntries(Object.entries(solution).filter(([, char]) => char).toSorted(([a], [b]) => parseInt(a) - parseInt(b)))[index.toString()])) == JSON.stringify(letters.map((letter) => {
            if (!letter) {
              return null
            }
            return letter.char
          }))) {
            alert('Congratulations! You have solved the crossword!')
          } else {
            alert('Sorry, your solution is incorrect.')
          }
        }} disabled={[...Array(size.x * size.y)].map((_, index) => Object.fromEntries(Object.entries(solution).filter(([, char]) => char).toSorted(([a], [b]) => parseInt(a) - parseInt(b)))[index.toString()]).filter(Boolean).length != letters.filter(Boolean).length}>
          Check
        </button>
      </div>
      <div className="flex gap-4 justify-center">
        {
          ['Across', 'Down'].map(direction => {
            return <div className="flex flex-col" key={direction}>
              <div className="font-bold">{direction}</div>
              <div className="grid grid-cols-[auto_auto] gap-x-2">
                {words.filter(word => word.direction == direction.toLowerCase()).map((word, index) => {
                  const position = (index: number) => ({ x: index % size.x, y: Math.floor(index / size.x) });
                  const filtered = words.filter(word => wordContains(word, position(selected!)))
                  const find = filtered.find(word => word.direction == lastDirection) || filtered[0]

                  return <Fragment key={index}>
                    <div className={`text-black/50`}>{starts.findIndex(start => start.x == word.x && start.y == word.y) + 1}</div>
                    <button className={`text-left ${find === word && selected != null && "before:bg-blue-200 before:absolute before:-inset-1 before:-z-10 relative before:transition before:rounded-lg before:blur-sm before:-left-6"}`} onClick={() => {
                      const index = word.x + word.y * size.x;
                      setSelected(index)
                      setLastDirection(word.direction)
                      onSelectionChange()
                    }}>{word.clue}</button>
                  </Fragment>
                })}
              </div>
            </div>
          })
        }
      </div>
    </div>
  </>
}
