/**
 * What the confirm card of a bulk tool shows: an agenda grouped by day. The
 * same events are given twice, as the plain text `content` (for a prifly
 * without the "confirm-events" feature) and as the structured `events` of
 * that feature:
 *
 *     Sun 8 Nov
 *         17:50–19:15   Padel, Bromma Padel · repeats every Sunday
 *
 *     Sat 21 – Sun 22 Nov
 *         All day       Football cup
 */

import type { NewEvent } from "./bulk-events";
import type { EventDetail } from "./calendar-types";
import { clockPart, datePart, dayLabel } from "./dates";
import { recurrenceText } from "./recurrence";
import { lastDay } from "./render";

/** The card's `events` part (prifly's "confirm-events" feature; extension-api does not type it yet). */
export type ConfirmEvents = {
  action: "add" | "delete";
  days: {
    day: string;
    events: {
      time: string;
      title: string;
      where?: string;
      repeats?: string;
      series?: boolean;
    }[];
  }[];
};

/** One event as the agenda needs it. */
type Item = {
  /** The first day, `YYYY-MM-DD`, and the last (the same for a one-day event). */
  first: string;
  last: string;
  allDay: boolean;
  /** "17:50–19:15", or "All day". */
  time: string;
  title: string;
  where: string;
  /** The recurrence in words, "" for none. */
  repeats: string;
  series: boolean;
};

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const ALL_DAY = "All day";

/** "17:50–19:15", "17:50" with no end, "22:00 – Tue 11 Nov 01:00" when it ends on another day. */
function timeSpan(start: string, end: string): string {
  const from = clockPart(start);
  if (end === "") return from;
  if (datePart(end) === datePart(start)) return `${from}–${clockPart(end)}`;
  return `${from} – ${dayLabel(datePart(end))} ${clockPart(end)}`;
}

function itemOfNew(event: NewEvent): Item {
  const common = {
    title: oneLine(event.summary),
    where: oneLine(event.location),
    repeats: recurrenceText(event.recurrence),
    series: false,
  };
  if (event.allDay) {
    return { ...common, first: event.date, last: event.lastDate, allDay: true, time: ALL_DAY };
  }
  const first = datePart(event.start);
  return { ...common, first, last: first, allDay: false, time: timeSpan(event.start, event.end) };
}

function itemOfFound({ event, series, recurrence }: EventDetail): Item {
  const first = datePart(event.start);
  const common = {
    title: oneLine(event.title),
    where: oneLine(event.location),
    repeats: series === "master" ? recurrenceText(recurrence) : "",
    series: series === "master",
  };
  if (event.allDay) {
    return { ...common, first, last: lastDay(event), allDay: true, time: ALL_DAY };
  }
  return { ...common, first, last: first, allDay: false, time: timeSpan(event.start, event.end) };
}

/** "Sun 8 Nov"; for several days "Sat 21 – Sun 22 Nov" (the month once when it is the same). */
function heading(item: Item): string {
  if (item.last === item.first) return dayLabel(item.first);
  const from = dayLabel(item.first);
  const sameMonth = item.first.slice(0, 7) === item.last.slice(0, 7);
  return `${sameMonth ? from.slice(0, -4) : from} – ${dayLabel(item.last)}`;
}

/** By first day; within it all-day events (longer first) before timed ones, then by the clock and title. */
function order(a: Item, b: Item): number {
  const rank = (item: Item): number => {
    if (!item.allDay) return 2;
    return item.last > item.first ? 0 : 1;
  };
  return (
    a.first.localeCompare(b.first) ||
    rank(a) - rank(b) ||
    a.time.localeCompare(b.time) ||
    a.title.localeCompare(b.title)
  );
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The events under one day line each, in start order. */
function grouped(items: Item[]): Map<string, Item[]> {
  const days = new Map<string, Item[]>();
  for (const item of [...items].sort(order)) {
    const key = heading(item);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  return days;
}

/** What follows the title: " · repeats every Sunday", or on a delete " · every Sunday: the whole series goes". */
function moreOf(item: Item, deleting: boolean): string {
  if (deleting && item.series) {
    return item.repeats === ""
      ? " · the whole series goes"
      : ` · ${item.repeats}: the whole series goes`;
  }
  return item.repeats === "" ? "" : ` · repeats ${item.repeats}`;
}

function lineOf(item: Item, width: number, deleting: boolean): string {
  const place = item.where === "" ? "" : `, ${item.where}`;
  return `    ${item.time.padEnd(width)}   ${item.title}${place}${moreOf(item, deleting)}`;
}

function eventOf(item: Item, deleting: boolean): ConfirmEvents["days"][number]["events"][number] {
  return {
    time: item.time,
    title: item.title,
    ...(item.where === "" ? {} : { where: item.where }),
    ...(item.repeats === "" ? {} : { repeats: capital(item.repeats) }),
    ...(deleting && item.series ? { series: true } : {}),
  };
}

/** The card's plain-text agenda and its structured `events`. */
export type Agenda = { content: string; events: ConfirmEvents };

function agenda(items: Item[], action: ConfirmEvents["action"]): Agenda {
  const deleting = action === "delete";
  const days = [...grouped(items)];
  const width = Math.max(0, ...items.map((item) => item.time.length));
  return {
    content: days
      .map(([day, each]) => [day, ...each.map((item) => lineOf(item, width, deleting))].join("\n"))
      .join("\n\n"),
    events: {
      action,
      days: days.map(([day, each]) => ({
        day,
        events: each.map((item) => eventOf(item, deleting)),
      })),
    },
  };
}

/** The agenda of events to add. */
export const addAgenda = (events: NewEvent[]): Agenda => agenda(events.map(itemOfNew), "add");

/** The agenda of events to delete: a recurring event's id goes with its whole series. */
export const deleteAgenda = (found: EventDetail[]): Agenda =>
  agenda(found.map(itemOfFound), "delete");
