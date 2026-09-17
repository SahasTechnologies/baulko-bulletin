/**
 * What a publication date means, as a table.
 *
 * The whole feature rests on one claim: a date the editor types is a Sydney
 * calendar day and a time they type is Sydney wall-clock. That is easy to state
 * and easy to get wrong by an hour, so the cases below pin the boundaries —
 * both daylight-saving switches, and midnight, which is where a naive
 * `hour12: false` formatter renders "24:00" and no time input will take it.
 *
 * Every expected value here was read off a real `Intl` formatter rather than
 * worked out by hand; the UTC stamps are written out so a failure says which
 * side of a DST switch the reading landed on.
 *
 * Run with `npm test`. Node strips the types; the module has no imports.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineDateTime,
  isDateInput,
  isDue,
  isTimeInput,
  isTodayOrLater,
  isoToDateInput,
  isoToTimeInput,
  splitDateTime,
  sydneyToday,
} from "./publish-time.ts";

/* ------------------------------------------------------------ reading a stamp */

test("a timestamp reads as the Sydney day and time it falls on", () => {
  // 08:00 Sydney in September is AEST (+10), so 22:00Z the day before.
  assert.equal(isoToDateInput("2026-09-16T22:00:00.000Z"), "2026-09-17");
  assert.equal(isoToTimeInput("2026-09-16T22:00:00.000Z"), "08:00");
});

test("midnight reads as 00:00, never 24:00", () => {
  // The reason for `hourCycle: "h23"`. Summer and winter are checked separately
  // because the bug only shows up once the offset is +11.
  assert.equal(isoToTimeInput("2026-12-24T13:00:00.000Z"), "00:00");
  assert.equal(isoToDateInput("2026-12-24T13:00:00.000Z"), "2026-12-25");
  assert.equal(isoToTimeInput("2026-06-16T14:00:00.000Z"), "00:00");
  assert.equal(isoToDateInput("2026-06-16T14:00:00.000Z"), "2026-06-17");
});

test("daylight saving is read per day, not as a fixed offset", () => {
  // Autumn: DST ends on 2026-04-05 at 03:00 AEDT, which becomes 02:00 AEST.
  // 01:30 that morning is still +11, 03:30 is +10 — three hours of UTC apart
  // for two hours of wall clock.
  assert.equal(isoToTimeInput("2026-04-04T14:30:00.000Z"), "01:30");
  assert.equal(isoToTimeInput("2026-04-04T16:00:00.000Z"), "02:00");
  assert.equal(isoToTimeInput("2026-04-04T17:30:00.000Z"), "03:30");

  // Spring: DST starts on 2026-10-04 at 02:00 AEST, which becomes 03:00 AEDT.
  // 02:30 does not exist that morning; 01:30 is +10 and 03:30 is +11.
  assert.equal(isoToTimeInput("2026-10-03T15:30:00.000Z"), "01:30");
  assert.equal(isoToTimeInput("2026-10-03T16:30:00.000Z"), "03:30");
});

test("a missing or unparseable stamp reads as empty, not as Invalid Date", () => {
  for (const value of [null, undefined, "", "not a date"]) {
    assert.equal(isoToDateInput(value), "");
    assert.equal(isoToTimeInput(value), "");
  }
});

/* --------------------------------------------------------------- the two inputs */

test("dates are only accepted when the day exists", () => {
  assert.ok(isDateInput("2026-09-17"));
  assert.ok(isDateInput("2028-02-29"), "2028 is a leap year");
  // Well-formed but impossible. `new Date` rolls these over rather than
  // refusing them, so the format alone is not enough.
  assert.ok(!isDateInput("2026-02-30"));
  assert.ok(!isDateInput("2026-13-01"));
  assert.ok(!isDateInput("2027-02-29"));
  assert.ok(!isDateInput("17-09-2026"));
  assert.ok(!isDateInput("2026-9-17"));
  assert.ok(!isDateInput(""));
});

test("times are 24-hour HH:MM and nothing else", () => {
  assert.ok(isTimeInput("00:00"));
  assert.ok(isTimeInput("09:30"));
  assert.ok(isTimeInput("23:59"));
  assert.ok(!isTimeInput("24:00"));
  assert.ok(!isTimeInput("9:30"));
  assert.ok(!isTimeInput("09:60"));
  assert.ok(!isTimeInput("09:30:00"));
  assert.ok(!isTimeInput(""));
});

/* ------------------------------------------------------------ the future test */

test("today counts as schedulable, yesterday does not", () => {
  const now = new Date("2026-09-16T23:46:00.000Z"); // 2026-09-17 09:46 Sydney
  assert.equal(sydneyToday(now), "2026-09-17");

  assert.ok(isTodayOrLater("2026-09-17", now), "today is offered a time");
  assert.ok(isTodayOrLater("2026-09-18", now), "tomorrow is offered a time");
  assert.ok(isTodayOrLater("2027-01-01", now));
  assert.ok(!isTodayOrLater("2026-09-16", now), "yesterday is not");
  assert.ok(!isTodayOrLater("2025-12-31", now));
});

test("the day boundary is Sydney's, not the server's", () => {
  // 2026-09-16 23:46 UTC is already the 17th in Sydney. A server-side "today"
  // would say the 16th and offer a time box a day early.
  const lateUtc = new Date("2026-09-16T23:46:00.000Z");
  assert.equal(sydneyToday(lateUtc), "2026-09-17");
  assert.ok(!isTodayOrLater("2026-09-16", lateUtc));

  // And the reverse: 13:00 UTC on the 17th is 23:00 Sydney, still the 17th.
  const earlyUtc = new Date("2026-09-17T13:00:00.000Z");
  assert.equal(sydneyToday(earlyUtc), "2026-09-17");
  assert.ok(isTodayOrLater("2026-09-17", earlyUtc));
});

test("a date that is not a date is never schedulable", () => {
  const now = new Date("2026-09-16T23:46:00.000Z");
  assert.ok(!isTodayOrLater("", now));
  assert.ok(!isTodayOrLater("soon", now));
  assert.ok(!isTodayOrLater("2026-02-30", now));
});

/* --------------------------------------------------------- writing the stamp */

test("a date and time become one stamp, and midnight is the default", () => {
  assert.equal(combineDateTime("2026-09-17", "08:00"), "2026-09-17 08:00");
  assert.equal(combineDateTime("2026-09-17", "00:00"), "2026-09-17 00:00");
  // No time box was shown, or it was left blank: publish from the start of the day.
  assert.equal(combineDateTime("2026-09-17", ""), "2026-09-17 00:00");
  // A junk time falls back rather than reaching Postgres, which would take it.
  assert.equal(combineDateTime("2026-09-17", "25:00"), "2026-09-17 00:00");
  assert.equal(combineDateTime("not a date", "08:00"), "");
});

test("the stamp survives a round trip through the form", () => {
  // What the editor types, what Postgres stores, and what the form shows the
  // next time it opens all have to agree. Postgres is the thing that resolves
  // the offset, so each row pairs a typed stamp with the UTC instant it becomes
  // — both sides read off a real run, not derived — and the pair is checked in
  // both directions: typing it gives the stamp, and the stored moment reads
  // back as the same date and time.
  const pairs: [stamp: string, stored: string][] = [
    ["2026-09-17 08:00", "2026-09-16T22:00:00.000Z"], // AEST, +10
    ["2026-06-17 18:30", "2026-06-17T08:30:00.000Z"], // AEST, +10
    ["2026-12-25 00:00", "2026-12-24T13:00:00.000Z"], // AEDT, +11
    ["2026-10-04 03:30", "2026-10-03T16:30:00.000Z"], // the hour after the switch
    ["2026-10-04 01:30", "2026-10-03T15:30:00.000Z"], // and the hour before it
  ];

  for (const [stamp, stored] of pairs) {
    const [date, time] = stamp.split(" ");
    assert.equal(combineDateTime(date!, time!), stamp, `typing ${stamp}`);
    assert.deepEqual(splitDateTime(stored), { date, time }, `reading ${stored}`);
  }
});

test("splitDateTime reads back a stored timestamp", () => {
  assert.deepEqual(splitDateTime("2026-09-16T22:00:00.000Z"), { date: "2026-09-17", time: "08:00" });
  assert.deepEqual(splitDateTime("2026-12-24T13:00:00.000Z"), { date: "2026-12-25", time: "00:00" });
  assert.deepEqual(splitDateTime(null), { date: "", time: "" });
});

/* ------------------------------------------------------------------- is due */

test("a row is due once its moment has passed", () => {
  const now = new Date("2026-09-16T23:46:00.000Z"); // 2026-09-17 09:46 Sydney
  assert.ok(isDue("2026-09-16T22:00:00.000Z", now), "08:00 today has passed");
  assert.ok(!isDue("2026-09-17T04:00:00.000Z", now), "14:00 today has not");
  // A row with no readable date is shown rather than hidden: this is the
  // schedule's guard, and a broken value should not take content off the site.
  assert.ok(isDue(null, now));
  assert.ok(isDue("not a date", now));
});
