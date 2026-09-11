import { createElement, useEffect, useRef, useState } from "react";

const SPIN_MS = 620;
// The icon swaps while the button is upside down; the theme lands just before it stops.
const ICON_SWAP_AT = 0.5;
const THEME_APPLY_AT = 0.72;

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  function applyTheme(next: boolean) {
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  }

  function toggle() {
    if (busyRef.current) return;
    const next = !document.documentElement.classList.contains("dark");

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof buttonRef.current?.animate !== "function") {
      applyTheme(next);
      return;
    }

    busyRef.current = true;
    const animation = buttonRef.current.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: SPIN_MS, easing: "cubic-bezier(.65,0,.35,1)" }
    );

    timersRef.current.push(
      window.setTimeout(() => setDark(next), SPIN_MS * ICON_SWAP_AT),
      window.setTimeout(() => applyTheme(next), SPIN_MS * THEME_APPLY_AT)
    );

    animation.finished.catch(() => {}).finally(() => {
      busyRef.current = false;
    });
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-toggle inline-flex items-center justify-center bg-transparent p-0 text-[1.45rem] leading-none"
    >
      {createElement("ion-icon", { name: dark ? "sunny" : "moon" })}
    </button>
  );
}
