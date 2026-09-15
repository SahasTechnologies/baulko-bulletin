import { createElement, useEffect, useRef, useState } from "react";

const SPIN_MS = 620;
// The icon swaps while the button is upside down; the theme lands just before it stops.
const ICON_SWAP_AT = 0.5;
const THEME_APPLY_AT = 0.72;

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
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
    const icon = iconRef.current;
    if (prefersReduced || !icon || typeof icon.animate !== "function") {
      applyTheme(next);
      return;
    }

    busyRef.current = true;

    // The spin belongs to the icon, not the button. The button's own transform is
    // owned by CSS (`:hover` tilts and grows it), and a Web Animations transform
    // on that same element takes precedence while it runs — so when it finished,
    // the hover state slammed into place. That was the "rotate, then suddenly
    // grow" jump. Spinning a child leaves the button's transform alone, and the
    // last keyframe eases the icon back to its resting size so nothing snaps.
    const animation = icon.animate(
      [
        { transform: "rotate(0deg) scale(1)", easing: "cubic-bezier(.55,0,.35,1)", offset: 0 },
        { transform: "rotate(300deg) scale(1.09)", easing: "cubic-bezier(.22,.9,.3,1)", offset: 0.78 },
        { transform: "rotate(360deg) scale(1)", offset: 1 },
      ],
      { duration: SPIN_MS, fill: "none" }
    );

    timersRef.current.push(
      window.setTimeout(() => setDark(next), SPIN_MS * ICON_SWAP_AT),
      window.setTimeout(() => applyTheme(next), SPIN_MS * THEME_APPLY_AT)
    );

    animation.finished
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
      });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-toggle inline-flex items-center justify-center bg-transparent p-0 text-[1.45rem] leading-none"
    >
      {/* A fixed square for the icon, so swapping moon for sun cannot resize the button mid-spin. */}
      <span ref={iconRef} className="inline-flex size-[1.15em] items-center justify-center">
        {createElement("ion-icon", { name: dark ? "sunny" : "moon" })}
      </span>
    </button>
  );
}
