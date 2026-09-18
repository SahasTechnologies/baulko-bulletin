import { useEffect, useRef, useState } from "react";

import ThemeMorph, { MORPH_MS, type ThemeMorphHandle } from "@/components/ui/ThemeMorph";

/**
 * How far into the move the page's own colours turn over.
 *
 * The icon is still travelling when the page becomes the thing it is moving
 * towards, which is what makes the two read as one gesture rather than as an
 * icon that finished and then a theme that changed. By this point the shape is
 * most of the way to the new theme's, so the stylesheet's version of it — which
 * is what takes over when the animation hands its styles back — is within a few
 * pixels of the one on screen.
 */
const THEME_AT = 0.72;

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const morphRef = useRef<ThemeMorphHandle>(null);
  const busyRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  function applyTheme(next: boolean) {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // The theme still applies for this page view when storage is blocked.
    }
    setDark(next);
  }

  function toggle() {
    if (busyRef.current) return;
    const next = !document.documentElement.classList.contains("dark");

    // The icon morphs towards the theme being switched to — the sun while it is
    // light, the moon once it is dark — and says how long that takes. No move
    // (a visitor who has asked for less motion, or a theme already there) means
    // the theme changes at once, exactly as CSS would have drawn it anyway.
    const duration = morphRef.current?.play(next ? "moon" : "sun") ?? 0;
    if (!duration) {
      applyTheme(next);
      return;
    }

    busyRef.current = true;

    timersRef.current.push(
      window.setTimeout(() => applyTheme(next), duration * THEME_AT),
      // A little past the move itself: the animation clears its own styles on
      // the frame after the last one, and a second click must not land in the
      // middle of that.
      window.setTimeout(() => {
        busyRef.current = false;
      }, duration + MORPH_MS * 0.2)
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-toggle inline-flex items-center justify-center bg-transparent p-0 text-[1.45rem] leading-none"
    >
      {/* A fixed square for the icon, so the morph — which changes the shape's
          width and height as it goes — cannot resize the button. */}
      <span className="inline-flex size-[1.15em] items-center justify-center">
        <ThemeMorph ref={morphRef} />
      </span>
    </button>
  );
}
