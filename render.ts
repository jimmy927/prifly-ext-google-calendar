/**
 * Events as Markdown a session reads: one line per event for a single
 * calendar, and the agenda across calendars grouped by day with each line
 * prefixed by its calendar's name (an event in several calendars once, with all their names).
 */

import type { CalendarEvent } from "./calendar-types";
import { addDays, clockPart, datePart, dayLabel } from "./dates";

const MAX_WHO = 6;

/** The clock span of a timed event on its first day: "17:50–19:15" (or "17:50" with no end). */
function clockSpan(event: CalendarEvent): string {
  const start = clockPart(event.start);
  const sameDay = datePart(event.end) === datePart(event.start);
  if (event.end === "") return start;
  return sameDay ? `${start}–${clockPart(event.end)}` : start;
}

/** The last day an all-day event covers (its end is the day after). */
function lastDay(event: CalendarEvent): string {
  const last = event.end === "" ? event.start : addDays(event.end, -1);
  if (last < event.start) return event.start;
  return last;
}

/** When an event is, with its date: "Tue 10 Nov 17:50–19:15", "Tue 10 Nov all day". */
export function whenText(event: CalendarEvent): string {
  const first = dayLabel(datePart(event.start));
  if (event.allDay) {
    const last = lastDay(event);
    return last === event.start ? `${first} all day` : `${first} – ${dayLabel(last)} all day`;
  }
  if (event.end !== "" && datePart(event.end) !== datePart(event.start)) {
    return `${first} ${clockPart(event.start)} – ${dayLabel(datePart(event.end))} ${clockPart(event.end)}`;
  }
  return `${first} ${clockSpan(event)}`;
}

function detail(event: CalendarEvent): string {
  const place = event.location === "" ? "" : ` (${event.location.replace(/\s+/g, " ")})`;
  const shown = event.who.slice(0, MAX_WHO).join(", ");
  const more = event.who.length > MAX_WHO ? ` +${event.who.length - MAX_WHO} more` : "";
  const who = event.who.length === 0 ? "" : ` — who: ${shown}${more}`;
  return `${event.title}${place}${who} — id: ${event.id}`;
}

/** One calendar's events, one line each. */
export function eventLine(event: CalendarEvent): string {
  return `- ${whenText(event)} — ${detail(event)}`;
}

/** An event with the calendar it is in, for the agenda. */
export type AgendaEntry = { calendar: string; event: CalendarEvent };

/** The last day an event covers: an all-day one's last day, a timed one's end day (not a midnight end). */
function lastDayOf(event: CalendarEvent): string {
  if (event.allDay) return lastDay(event);
  const first = datePart(event.start);
  const end = datePart(event.end);
  if (end <= first) return first;
  return clockPart(event.end) === "00:00" ? addDays(end, -1) : end;
}

/** The days of the range an event shows on: every day it covers, so one begun before the range too. */
function daysOf(event: CalendarEvent, from: string, to: string): string[] {
  const first = datePart(event.start);
  const last = lastDayOf(event);
  const out: string[] = [];
  for (let day = first < from ? from : first; day <= last && day <= to; day = addDays(day, 1)) {
    out.push(day);
  }
  return out;
}

/** What an entry says of its time on `day`: all day, the clock span, or how a longer event ends. */
function whenOn(event: CalendarEvent, day: string): string {
  if (event.allDay) return "all day";
  if (day === datePart(event.start)) return clockSpan(event);
  const ends = day === lastDayOf(event) && clockPart(event.end) !== "00:00";
  return ends ? `until ${clockPart(event.end)}` : "all day";
}

/** An event on one day with every calendar it is in, in the agenda's calendar order. */
type DayEntry = { calendars: string[]; event: CalendarEvent };

/** What makes entries one event: its iCalUID (else its id) and its start, so a series' instances stay apart. */
const sameEvent = (event: CalendarEvent): string => `${event.uid || event.id}|${event.start}`;

/** The entries of one day with an event that is in several calendars merged into one. */
function mergeCopies(entries: AgendaEntry[]): DayEntry[] {
  const merged = new Map<string, DayEntry>();
  for (const entry of entries) {
    const key = sameEvent(entry.event);
    const have = merged.get(key);
    if (have === undefined) merged.set(key, { calendars: [entry.calendar], event: entry.event });
    else if (!have.calendars.includes(entry.calendar)) have.calendars.push(entry.calendar);
  }
  return [...merged.values()];
}

/** The sort key within a day: all-day and continuing events first, then by the clock, then by calendar. */
const slot = (entry: DayEntry, day: string): string =>
  `${entry.event.allDay || day !== datePart(entry.event.start) ? "" : clockPart(entry.event.start)}|${entry.calendars[0]}`;

/** The agenda: a `## Tue 10 Nov` heading per day that has events, a line for each. */
export function agendaText(entries: AgendaEntry[], from: string, to: string): string {
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of entries) {
    for (const day of daysOf(entry.event, from, to))
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  const blocks: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const lines = mergeCopies(byDay.get(day) ?? [])
      .sort((a, b) => slot(a, day).localeCompare(slot(b, day)))
      .map(
        (entry) =>
          `- [${entry.calendars.join(", ")}] ${whenOn(entry.event, day)} ${detail(entry.event)}`,
      );
    blocks.push([`## ${dayLabel(day)}`, ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}
