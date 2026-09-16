"use client";

import { useMemo, useState } from "react";

import type { ExtraCard, PostCard, StoryCard } from "@/types/content";
import { searchItems } from "@/lib/search";
import Byline from "./Byline";
import CoverImage from "./CoverImage";
import DateComponent, { formatDate } from "./DateComponent";
import Icon from "./Icon";

/**
 * Either listing's card, with the author only the extras carry. Typing the
 * shared part rather than the union keeps the author optional instead of
 * needing a branch to prove it is there.
 */
type Item = StoryCard & { author_name?: string | null };

interface Props {
  /** Newest first, as the listing pages select them. */
  items: PostCard[] | ExtraCard[];
  kind: "issue" | "extra";
}

/**
 * A listing page's grid with a search box over it.
 *
 * The filtering runs in the browser over the cards already on the page: a
 * listing is a few dozen titles, dates and summaries, so there is nothing worth
 * asking the server for, results appear as you type, and the page keeps working
 * with the JavaScript switched off. The cards themselves are rendered here —
 * rather than left to the server with the island hiding and showing them —
 * because the ordering changes with the query, and the server's first paint and
 * the hydrated page have to agree on it.
 */
export default function SearchableCards({ items, kind }: Props) {
  const [query, setQuery] = useState("");
  const issue = kind === "issue";
  const noun = issue ? "issue" : "extra";
  const plural = issue ? "issues" : "extras";

  const results = useMemo(
    () =>
      searchItems(items as Item[], query, (item) => [
        item.title,
        item.excerpt,
        item.slug,
        // The date is matched as it is written, so "June" and "2025" both work.
        formatDate(item.date),
        item.author_name,
      ]),
    [items, query]
  );

  return (
    <>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          {/* Both adornments are flex boxes as tall as the field, with the
              glyph centred inside, so the magnifier and the × sit on the field's
              own centre line instead of on a text baseline. */}
          <span className="pointer-events-none absolute inset-y-0 left-2 flex w-10 items-center justify-center opacity-50">
            <Icon name="search" />
          </span>
          <label className="sr-only" htmlFor={`search-${noun}`}>
            Search {plural}
          </label>
          <input
            id={`search-${noun}`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${plural} by name, description or date…`}
            autoComplete="off"
            /* `appearance-none` suppresses the browser's own clear button, which
               otherwise sits beside the one below it — two ×s, in Safari and in
               Chrome alike. */
            className="w-full appearance-none rounded-full border border-black/15 bg-white py-3 pl-12 pr-12 text-lg focus:outline-none focus:ring-2 focus:ring-black/30 dark:border-white/15 dark:bg-neutral-900 dark:focus:ring-white/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="group absolute inset-y-0 right-2 flex w-10 items-center justify-center opacity-60 transition hover:opacity-100"
            >
              <Icon name="close-circle" className="transition group-hover:scale-110" />
            </button>
          )}
        </div>

        {query && (
          <p className="text-lg opacity-70" role="status">
            {/* The noun follows the listing's size, not the match's: "1 of 23
                issues", not "1 of 23 issue". */}
            {results.length === 0
              ? `No ${plural} match`
              : `${results.length} of ${items.length} ${items.length === 1 ? noun : plural}`}
          </p>
        )}
      </div>

      {results.length === 0 ? (
        <p className="text-xl opacity-70">
          Nothing matches “{query.trim()}”. Titles, descriptions and dates are all searched — try
          fewer letters.
        </p>
      ) : (
        <div className="mb-32 grid grid-cols-1 gap-y-20 md:grid-cols-2 md:gap-x-16">
          {results.map((item) => {
            const href = `/${issue ? "posts" : "extras"}/${item.slug}`;
            return (
              <article key={item.id}>
                <a className="group mb-5 block" href={href}>
                  <CoverImage src={item.cover_image_url} alt={item.cover_image_alt} />
                </a>
                <h3
                  className={`mb-3 text-3xl font-bold leading-snug${issue ? " tracking-tighter" : ""}`}
                >
                  <a href={href} className="hover:underline">
                    {item.title}
                  </a>
                </h3>
                <div className="mb-2 text-lg opacity-70">
                  <DateComponent dateString={item.date} />
                </div>
                {!issue && <Byline name={item.author_name?.trim() || "Anonymous"} />}
                {item.excerpt && <p className="mt-3 text-lg leading-relaxed">{item.excerpt}</p>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
