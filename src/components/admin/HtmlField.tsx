"use client";

/**
 * The panel's HTML field: an Edit tab that colours the source, and a Preview
 * tab that renders it.
 *
 * Colouring a textarea is not something a `<textarea>` can do — it holds a
 * string, not markup — so the field is two layers: a transparent `<textarea>`
 * that owns the value, the caret and the scrolling, sitting exactly on top of a
 * `<pre>` holding the same text as coloured spans. Both layers carry the same
 * `.html-code` metrics, because the moment they disagree about the font, the
 * leading or the padding, the caret drifts away from the word underneath it.
 *
 * The area grows with the text up to a ceiling and then scrolls inside itself,
 * so a long body does not push the Save button a screenful away. Past that
 * ceiling the two layers have to be kept in step by hand: the `<pre>` is offset
 * by the textarea's own scroll position as it scrolls, since a `pre` has no
 * scrollbar of its own to follow.
 *
 * Preview is the real thing rather than an approximation: the site renders
 * stored HTML with `set:html`, so this renders it the same way, inside the same
 * prose styles an article body uses.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import Icon from "@/components/ui/Icon";
import { tokenizeHtml, type HtmlTokenKind } from "@/lib/html-highlight";

/**
 * The most the field will grow to before it scrolls instead, in lines of its own
 * text. Around a screenful: enough that ordinary body copy is readable without
 * scrolling, and short enough that the Save button below it stays reachable.
 */
const MAX_VISIBLE_ROWS = 30;

interface Props {
  name: string;
  /** The id the uploader inserts a picture into, so it must match the field. */
  fieldId: string;
  initial: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}

/** Maps a token kind to its colour class (see `global.css`). */
const TOKEN_CLASS: Record<HtmlTokenKind, string | undefined> = {
  text: undefined,
  comment: "html-comment",
  tag: "html-tag",
  attr: "html-attr",
  value: "html-value",
  punct: "html-punct",
};

export default function HtmlField({
  name,
  fieldId,
  initial,
  rows = 10,
  required = false,
  maxLength,
  placeholder,
}: Props) {
  const [value, setValue] = useState(initial);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const tokens = useMemo(() => tokenizeHtml(value), [value]);

  /**
   * Offsets the coloured layer by however far the textarea has been scrolled,
   * so the words stay under the caret. Both layers are the same box, so this is
   * the whole of the sync a `pre` needs to look scrolled.
   */
  const syncScroll = useCallback(() => {
    const element = textareaRef.current;
    const highlight = highlightRef.current;
    if (!element || !highlight) return;
    highlight.style.transform = `translateY(${-element.scrollTop}px)`;
  }, []);

  /**
   * Fits the field to its text, up to `MAX_VISIBLE_ROWS`. `rows` is a floor
   * rather than the size: the minimum is computed from the line height so it
   * holds whatever the theme's font does. Past the ceiling the field stops
   * growing and scrolls, which is when the sync above starts to matter.
   */
  const grow = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    const styles = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const ceiling = Math.max(lineHeight * MAX_VISIBLE_ROWS + padding, lineHeight * rows + padding);
    element.style.height = "auto";
    const wanted = Math.max(element.scrollHeight, lineHeight * rows + padding);
    element.style.height = `${Math.min(wanted, ceiling)}px`;
    element.style.overflowY = wanted > ceiling + 1 ? "auto" : "hidden";
    syncScroll();
  }, [rows, syncScroll]);

  useLayoutEffect(grow, [grow, value]);

  // A hidden element has no height to measure, so the field is re-fitted when
  // the editor comes back into view.
  useEffect(() => {
    if (tab === "edit") grow();
  }, [tab, grow]);

  // Wrapping changes with the width, which changes how many lines the text is.
  useEffect(() => {
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [grow]);

  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label="HTML source"
        className="flex w-fit items-center gap-1 rounded-full border border-black/15 p-1 text-sm dark:border-white/15"
      >
        {(
          [
            { key: "edit", label: "Edit", icon: "create-outline" },
            { key: "preview", label: "Preview", icon: "eye-outline" },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={tab === option.key}
            onClick={() => setTab(option.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 transition ${
              tab === option.key
                ? "bg-black font-semibold text-white dark:bg-white dark:text-black"
                : "opacity-70 hover:opacity-100"
            }`}
          >
            <Icon name={option.icon} />
            {option.label}
          </button>
        ))}
      </div>

      {/* Both panes stay mounted: the textarea is the field, so it has to be in
          the form whatever tab is showing. */}
      <div className={tab === "edit" ? "" : "hidden"}>
        <div className="relative overflow-hidden rounded-xl border border-black/15 bg-white focus-within:ring-2 focus-within:ring-black/30 dark:border-white/15 dark:bg-neutral-900 dark:focus-within:ring-white/30">
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className="html-code pointer-events-none absolute inset-0 overflow-hidden"
          >
            {tokens.map((token, index) => (
              <span key={index} className={TOKEN_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {/* A trailing newline joins the last line in a `pre`, which would
                leave the colours a line short of the textarea.
                Only when there is a line above it, though: an HTML parser
                drops the first newline inside a `<pre>`, so on an empty field
                this was the *first* child, the browser discarded it, and React
                found one text node fewer than it had rendered — a hydration
                mismatch that regenerated this subtree on every page load. */}
            {tokens.length > 0 && "\n"}
          </pre>
          <textarea
            ref={textareaRef}
            id={fieldId}
            name={name}
            required={required}
            maxLength={maxLength}
            placeholder={placeholder}
            value={value}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
            onScroll={syncScroll}
            onKeyDown={(event) => {
              // Tab belongs to the source, not to the form: it indents rather
              // than jumping focus out of a field someone is halfway through.
              if (event.key !== "Tab") return;
              event.preventDefault();
              const element = event.currentTarget;
              element.setRangeText("  ", element.selectionStart, element.selectionEnd, "end");
              setValue(element.value);
            }}
            className="html-code relative block w-full resize-none bg-transparent text-transparent caret-black outline-none placeholder:text-black/40 dark:caret-white dark:placeholder:text-white/40"
          />
        </div>
      </div>

      <div className={tab === "preview" ? "" : "hidden"}>
        {value.trim() ? (
          <div className="max-h-[40rem] overflow-auto rounded-xl border border-black/15 bg-white px-6 py-4 dark:border-white/15 dark:bg-neutral-950">
            {/* The same render the public pages do — `set:html` of stored copy.
                The panel is behind one shared password, and the HTML in here is
                written by the people using it. */}
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-black/15 px-6 py-10 text-center opacity-60 dark:border-white/15">
            Nothing to preview yet — write some HTML in the Edit tab.
          </p>
        )}
      </div>
    </div>
  );
}
