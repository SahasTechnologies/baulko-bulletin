import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="fixed top-4 right-4 z-50 size-11 rounded-full border border-black/10 bg-white/80 text-black shadow-sm backdrop-blur transition hover:scale-110 dark:border-white/15 dark:bg-neutral-900/80 dark:text-white"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="mx-auto size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v1.5M12 19.5V21M4.5 12H3M21 12h-1.5M6.2 6.2l-1-1M18.8 18.8l-1-1M6.2 17.8l-1 1M18.8 5.2l-1 1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="mx-auto size-5" fill="currentColor">
          <path d="M21 14.3A8.5 8.5 0 1 1 9.7 3 7 7 0 0 0 21 14.3z" />
        </svg>
      )}
    </button>
  );
}
