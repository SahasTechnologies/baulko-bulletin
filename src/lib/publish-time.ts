/**
 * When a piece of content is due, in the timezone the site is written in.
 *
 * Every date on this site is pinned to `Australia/Sydney` — `DateComponent`,
 * the puzzles listing and the admin's own date field all format in it — so a
 * date the editor types means a Sydney calendar day, and a time they type means
 * Sydney wall-clock. Storing that moment is the database's job (see the
 * `AT TIME ZONE 'Australia/Sydney'` cast in `admin-db`), because only Postgres
 * resolves AEST against AEDT for the specific day; anything computed here would
 * be an hour wrong for half the year.
 *
 * What this module does is the reading half: turn a stored timestamp back into
 * the two form values, decide whether a date is still in the future, and hand
 * both to the panel and the validator.
 *
 * It has no imports on purpose. `npm test` runs these files through Node's type
 * stripping with no bundler behind it, so anything importing an alias or a
 * package would not resolve; keeping the arithmetic self-contained is what lets
 * it be tested at all.
 */

export const SYDNEY_TIME_ZONE = "Australia/Sydney";

/** `YYYY-MM-DD`, what `<input type="date">` reads and writes. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 24-hour `HH:MM`, what `<input type="time">` reads and writes. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: SYDNEY_TIME_ZONE,
});

// `hourCycle: "h23"` rather than `hour12: false`. The latter is a documented
// trap: several engines render midnight as "24:00" under it, and no browser
// will accept that back into a time input.
const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: SYDNEY_TIME_ZONE,
});

export function isDateInput(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  // A well-formed but impossible day — 2026-02-30 — parses as March. Comparing
  // the round trip is what rejects it.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTimeInput(value: string): boolean {
  return TIME_RE.test(value);
}

/** A stored timestamp as the Sydney calendar day it falls on. */
export function isoToDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return dayFormatter.format(parsed);
}

/** The same timestamp as the Sydney clock time, for prefilling the time box. */
export function isoToTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return clockFormatter.format(parsed);
}

/** Today, as a Sydney calendar day. */
export function sydneyToday(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

/**
 * Whether the time box is worth showing for this day.
 *
 * Today counts, not just tomorrow onwards. A date-only save publishes at
 * midnight, so a row dated today is live already and there is nothing to
 * schedule — but "we announce it at 3pm today" is a real thing to want, and it
 * is only reachable if the box appears for today too. For a past date there is
 * nothing left to decide, so the box stays away.
 *
 * `YYYY-MM-DD` compares correctly as a string, which is the whole reason the
 * format is worth insisting on.
 */
export function isTodayOrLater(date: string, now: Date = new Date()): boolean {
  if (!isDateInput(date)) return false;
  return date >= sydneyToday(now);
}

/**
 * The two form values as the single stamp `admin-db` hands to Postgres.
 *
 * A missing time means midnight, and midnight means Sydney midnight — so a
 * date-only save publishes from the start of the day the editor picked, rather
 * than from 10am, which is what storing it as UTC midnight used to amount to.
 */
export function combineDateTime(date: string, time: string): string {
  const day = isDateInput(date) ? date : "";
  if (!day) return "";
  return `${day} ${isTimeInput(time) ? time : "00:00"}`;
}

/** The inverse of `combineDateTime`, for prefilling the editor. */
export function splitDateTime(value: string | null | undefined): { date: string; time: string } {
  return { date: isoToDateInput(value), time: isoToTimeInput(value) };
}

/** Whether the stored moment has arrived. Only for messages, not for gating. */
export function isDue(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value) return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() <= now.getTime();
}
