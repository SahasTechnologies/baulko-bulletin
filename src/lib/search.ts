/**
 * Fuzzy matching for the listing pages.
 *
 * Two kinds of hit, in this order, because that is the order a reader expects:
 * a literal run of the query — "culture" in "East Asian Culture" — and then the
 * query's characters in order with gaps between them, which is what catches a
 * half-remembered word or a dropped letter ("scfi" finds "Sci-Fi").
 *
 * Every whitespace-separated word of the query has to land somewhere, so
 * "nature 2025" means the 2025 Nature issue rather than everything mentioning
 * either word — and each word may land in a different field, since the title,
 * the description, the author and the date are all searched.
 */

/** Score one term against one haystack, or -1 when it never appears. */
function scoreTerm(term: string, haystack: string): number {
  if (!term) return 0;

  const at = haystack.indexOf(term);
  if (at >= 0) {
    // A literal run scores far above a scattered one, and being at a word
    // boundary and near the front both help — so "nature" ranks "Nature I"
    // above the same word buried in a description.
    const boundary = at === 0 || !/[a-z0-9]/.test(haystack[at - 1]);
    return 100 + (boundary ? 60 : 0) - Math.min(at, 40);
  }

  let score = 0;
  let cursor = 0;
  let run = 0;
  let first = -1;
  let last = 0;
  for (const character of term) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return -1;
    if (first < 0) first = found;
    last = found;
    // Consecutive characters are worth more than scattered ones and distance
    // costs, which is what keeps "scfi" out of a paragraph that merely happens
    // to contain an s, a c, an f and an i in that order.
    run = found === cursor ? run + 1 : 0;
    score += 4 + run * 3 - Math.min(found - cursor, 10);
    cursor = found + 1;
  }

  // The letters also have to be near each other: at most twice the term's own
  // length, with a dozen characters of slack for short words. Without that, a
  // fuzzy hit stops meaning anything — a description is a whole paragraph and
  // most short words can be spelled out of one, and "nature" happily spells
  // itself out of "n+29: East Asian Culture".
  const span = last - first + 1;
  if (span > Math.max(term.length * 2, 12)) return -1;

  return score;
}

/**
 * One entry's score for a whole query, or -1 when it should not be shown at
 * all. Zero means "there was no query", which matches everything.
 */
export function fuzzyScore(query: string, fields: (string | null | undefined)[]): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;

  const haystacks = fields
    .filter((field): field is string => Boolean(field))
    .map((field) => field.toLowerCase());

  let total = 0;
  for (const term of terms) {
    let best = -1;
    for (const haystack of haystacks) {
      const score = scoreTerm(term, haystack);
      if (score > best) best = score;
    }
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

/**
 * The entries a query should show, best match first. An empty query keeps the
 * order it was given — listings arrive newest first, which is what a reader
 * expects to see before they have typed anything.
 */
export function searchItems<T>(
  items: T[],
  query: string,
  fieldsOf: (item: T) => (string | null | undefined)[]
): T[] {
  if (!query.trim()) return items;

  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, fieldsOf(item)) }))
    .filter((entry) => entry.score >= 0)
    // Ties keep the original order, which is why the index is carried rather
    // than relying on the sort being stable.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
