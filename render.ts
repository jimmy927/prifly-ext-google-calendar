/**
 * Events as Markdown a session reads: one line per event for a single
 * calendar, and the agenda across calendars grouped by day with each line
 * prefixed by its calendar's name.
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

/** The days of the range an event shows on: every day of an all-day one, else its first. */
function daysOf(event: CalendarEvent, from: string, to: string): string[] {
  const first = datePart(event.start);
  const last = event.allDay ? lastDay(event) : first;
  const out: string[] = [];
  for (let day = first; day <= last && out.length < 62; day = addDays(day, 1)) {
    if (day >= from && day <= to) out.push(day);
  }
  return out;
}

/** The sort key within a day: all-day events first, then by the clock, then by calendar. */
const slot = (entry: AgendaEntry): string =>
  `${entry.event.allDay ? "" : clockPart(entry.event.start)}|${entry.calendar}`;

/** The agenda: a `## Tue 10 Nov` heading per day that has events, a line for each. */
export function agendaText(entries: AgendaEntry[], from: string, to: string): string {
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of entries) {
    for (const day of daysOf(entry.event, from, to))
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  const blocks: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const lines = (byDay.get(day) ?? [])
      .sort((a, b) => slot(a).localeCompare(slot(b)))
      .map((entry) => {
        const when = entry.event.allDay ? "all day" : clockSpan(entry.event);
        return `- [${entry.calendar}] ${when} ${detail(entry.event)}`;
      });
    blocks.push([`## ${dayLabel(day)}`, ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}
