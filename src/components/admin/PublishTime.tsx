"use client";

/**
 * The publication time, shown only while there is still a time to choose.
 *
 * The date field beside this is an ordinary `<input type="date">` that the
 * server renders and the browser submits on its own — this island watches it
 * rather than replacing it, so the panel still works as a plain form if the
 * script never arrives, and the date keeps the native picker.
 *
 * The box appears for a date of today or later and disappears for a past one,
 * because a past date has nothing left to schedule. Today is included on
 * purpose: a date-only save publishes at midnight, so a row dated today is
 * already live, but "we announce it at 3pm today" is a real thing to want.
 *
 * The server passes `today` and `initialDate` in, so the first client render
 * matches the HTML it was hydrated from and React has nothing to complain
 * about. An effect then re-reads the day from the browser's own clock, which
 * only matters for a tab left open across midnight.
 */

import { useEffect, useState } from "react";

import { combineDateTime, isoToTimeInput, isTodayOrLater, sydneyToday, SYDNEY_TIME_ZONE } from "@/lib/publish-time";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-09-18 08:00` → `18 Sep 2026, 08:00`. Done on the string rather than
 * through `Date`, because turning a Sydney wall clock reading back into an
 * instant is the one thing that needs the offset, and the reading is already
 * exactly what the editor needs to see.
 */
function readable(stamp: string): string {
  const [date, time] = stamp.split(" ");
  if (!date || !time) return stamp;
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(day)} ${name} ${year}, ${time}` : stamp;
}

export default function PublishTime({
  dateFieldId,
  initialDate,
  initialTime,
  today,
  name = "time",
}: {
  /** Id of the date input this follows, so it can be watched. */
  dateFieldId: string;
  initialDate: string;
  initialTime: string;
  /** The server's idea of today in Sydney, so the first render is stable. */
  today: string;
  name?: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime || "00:00");
  const [day, setDay] = useState(today);

  // Follow the date field. `input` fires on every keystroke of the native
  // picker, `change` when a day is actually settled on; both are cheap.
  useEffect(() => {
    const field = document.getElementById(dateFieldId) as HTMLInputElement | null;
    if (!field) return;
    const sync = () => setDate(field.value);
    sync();
    field.addEventListener("input", sync);
    field.addEventListener("change", sync);
    return () => {
      field.removeEventListener("input", sync);
      field.removeEventListener("change", sync);
    };
  }, [dateFieldId]);

  // Only ever moves a page that has been open since before midnight.
  useEffect(() => {
    setDay(sydneyToday());
  }, []);

  // The day is handed to the comparison as midday UTC, which is the same
  // Sydney date whichever side of the daylight-saving switch it lands on —
  // `isTodayOrLater` reads its `now` in Sydney, and midday UTC is 22:00 or
  // 23:00 there, never the neighbouring day.
  if (!isTodayOrLater(date, new Date(`${day}T12:00:00.000Z`))) return null;

  const stamp = combineDateTime(date, time);
  const now = `${day} ${isoToTimeInput(new Date().toISOString())}`;
  const pending = stamp > now;

  return (
    <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/15 dark:bg-white/[0.04]">
      <label className="flex flex-col text-sm" htmlFor={`${dateFieldId}-time`}>
        <span className="mb-1 font-medium">
          Publish time <span className="opacity-60">({SYDNEY_TIME_ZONE.replace("Australia/", "")})</span>
        </span>
        <input
          id={`${dateFieldId}-time`}
          type="time"
          name={name}
          value={time}
          step={60}
          onChange={(event) => setTime(event.target.value)}
          className="w-40 rounded-xl border border-black/15 bg-white px-3 py-2 text-base dark:border-white/15 dark:bg-neutral-900"
        />
      </label>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        {pending ? (
          <>
            Stays off the site until <strong>{readable(stamp)}</strong>. Its page returns a 404 and it
            is absent from every listing until then.
          </>
        ) : (
          <>
            That moment has passed, so this publishes as soon as you save. Set a later time to keep it
            hidden.
          </>
        )}
      </p>
    </div>
  );
}
