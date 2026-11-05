/**
 * The events of a bulk add (`calendar_create_events`): checking the list a
 * session sent, the request body Google gets for each, and how a row reads in
 * the answer.
 *
 * Every row is checked and every wrong one is named, by its 1-based number,
 * before any card is shown. An all-day event is given with its first `date` and
 * the inclusive last day `end_date` (the day the reader means); Google's own
 * end is the day after, which `eventBody` adds.
 */

import { isRecord, list } from "./calendar-types";
import { whenOf } from "./cards";
import { addDays, isDay, isZone } from "./dates";
import { recurrenceText } from "./recurrence";

/** How many events one call may add. */
export const MAX_EVENTS = 50;

type Common = {
  summary: string;
  location: string;
  description: string;
  /** RRULE, EXRULE, RDATE and EXDATE lines. */
  recurrence: string[];
  /** "" when none was given: the calendar's own zone then. */
  timeZone: string;
};

/** A new event: timed (RFC 3339 `start` and `end`, seconds filled in) or all-day (`date` to `lastDate`, both included). */
export type NewEvent = Common &
  (
    | { allDay: false; start: string; end: string }
    | { allDay: true; date: string; lastDate: string }
  );

/** The checked events, or every problem found. */
export type Checked = { events: NewEvent[] } | { errors: string[] };

const ROW_KEYS = [
  "summary",
  "start",
  "end",
  "timeZone",
  "date",
  "end_date",
  "location",
  "description",
  "recurrence",
];

const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const RECURRENCE_LINE = /^(RRULE|EXRULE|RDATE|EXDATE)[:;]/i;

type Problem = { error: string };
const isProblem = (value: unknown): value is Problem => isRecord(value) && "error" in value;

/** A date-time as `2026-11-10T17:50:00` (with its offset if it has one), or why not. */
function dateTimeOf(value: unknown, name: string): string | Problem {
  if (value === undefined) return { error: `${name} is missing` };
  const match = typeof value === "string" ? DATE_TIME.exec(value.trim()) : null;
  const [, day = "", hour = "", minute = "", second = "00", offset = ""] = match ?? [];
  const real = isDay(day) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
  if (match === null || !real) {
    return { error: `${name} ${JSON.stringify(value)} is not a date-time like 2026-11-10T17:50` };
  }
  return `${day}T${hour}:${minute}:${second}${offset}`;
}

/** An instant to compare two times of one event; a time without an offset is read in one common zone. */
const instant = (time: string): number => Date.parse(OFFSET.test(time) ? time : `${time}Z`);

/** The problems of a timed event's start and end. */
function timesProblems(start: string | Problem, end: string | Problem): string[] {
  const found = [start, end].flatMap((each) => (isProblem(each) ? [each.error] : []));
  if (isProblem(start) || isProblem(end)) return found;
  if (OFFSET.test(start) !== OFFSET.test(end)) {
    return ["start and end must both have a UTC offset, or both leave it out"];
  }
  return instant(end) > instant(start) ? [] : [`end ${end} is not after start ${start}`];
}

type When =
  | { allDay: false; start: string; end: string }
  | { allDay: true; date: string; lastDate: string };

function timedWhen(raw: Record<string, unknown>): When | string[] {
  const start = dateTimeOf(raw["start"], "start");
  const end = dateTimeOf(raw["end"], "end");
  const problems = timesProblems(start, end);
  if (problems.length > 0 || isProblem(start) || isProblem(end)) return problems;
  return { allDay: false, start, end };
}

function allDayWhen(raw: Record<string, unknown>): When | string[] {
  const date = raw["date"];
  const last = raw["end_date"] ?? date;
  if (typeof date !== "string" || !isDay(date)) {
    return [`date ${JSON.stringify(date)} is not a day like 2026-11-21`];
  }
  if (typeof last !== "string" || !isDay(last)) {
    return [`end_date ${JSON.stringify(last)} is not a day like 2026-11-21`];
  }
  return last < date
    ? [`end_date ${last} is before date ${date}`]
    : { allDay: true, date, lastDate: last };
}

/** The when of a row: timed or all-day, not both, not neither. */
function whenOfRow(raw: Record<string, unknown>): When | string[] {
  const timed = raw["start"] !== undefined || raw["end"] !== undefined;
  const allDay = raw["date"] !== undefined || raw["end_date"] !== undefined;
  if (timed && allDay) {
    return ["mixes timed fields (start, end) with all-day fields (date, end_date): use one kind"];
  }
  if (!timed && !allDay) return ["has no time: give start and end, or date for an all-day event"];
  return timed ? timedWhen(raw) : allDayWhen(raw);
}

function optionalText(raw: Record<string, unknown>, key: string, problems: string[]): string {
  const value = raw[key];
  if (value === undefined) return "";
  if (typeof value === "string") return value.trim();
  problems.push(`${key} must be text`);
  return "";
}

function recurrenceOf(raw: Record<string, unknown>, problems: string[]): string[] {
  if (raw["recurrence"] === undefined) return [];
  const lines = list(raw["recurrence"]);
  const wrong = lines.filter(
    (line) => typeof line !== "string" || !RECURRENCE_LINE.test(line.trim()),
  );
  if (!Array.isArray(raw["recurrence"]) || wrong.length > 0) {
    problems.push(
      "recurrence must be a list of lines that start with RRULE:, EXRULE:, RDATE: or EXDATE:",
    );
    return [];
  }
  return lines.map((line) => String(line).trim());
}

/** The parts of a row that are the same for a timed and an all-day event. */
function commonOf(raw: Record<string, unknown>): Common | string[] {
  const problems: string[] = [];
  const summary = optionalText(raw, "summary", problems).trim();
  if (summary === "" && raw["summary"] === undefined) problems.push("summary is missing");
  else if (summary === "") problems.push("summary is empty");
  const timeZone = optionalText(raw, "timeZone", problems).trim();
  if (timeZone !== "" && !isZone(timeZone))
    problems.push(`timeZone '${timeZone}' is not a time zone`);
  const common = {
    summary,
    location: optionalText(raw, "location", problems),
    description: optionalText(raw, "description", problems),
    recurrence: recurrenceOf(raw, problems),
    timeZone,
  };
  return problems.length > 0 ? problems : common;
}

/** One row a session sent: the event, or everything wrong with the row. */
function checkRow(raw: unknown): NewEvent | string[] {
  if (!isRecord(raw)) return ["is not an object with a summary and a time"];
  const unknown = Object.keys(raw)
    .filter((key) => !ROW_KEYS.includes(key))
    .map((key) => `unknown field '${key}' (the fields are ${ROW_KEYS.join(", ")})`);
  const common = commonOf(raw);
  const when = whenOfRow(raw);
  if (Array.isArray(common) || Array.isArray(when) || unknown.length > 0) {
    return [
      ...unknown,
      ...(Array.isArray(common) ? common : []),
      ...(Array.isArray(when) ? when : []),
    ];
  }
  return { ...common, ...when };
}

/** The rows' events, or the problems of the list and of each row ("row 3: …"). */
function collectRows(rows: (NewEvent | string[])[]): Checked {
  const errors: string[] = [];
  if (rows.length === 0) errors.push(`the list is empty: give 1 to ${MAX_EVENTS} events`);
  if (rows.length > MAX_EVENTS) {
    errors.push(`${rows.length} events is too many: at most ${MAX_EVENTS} at a time`);
  }
  const events: NewEvent[] = [];
  rows.forEach((row, at) => {
    if (Array.isArray(row)) errors.push(...row.map((problem) => `row ${at + 1}: ${problem}`));
    else events.push(row);
  });
  return errors.length > 0 ? { errors } : { events };
}

/** The `events` argument of a call, checked row by row. */
export function checkEvents(given: unknown): Checked {
  if (!Array.isArray(given)) {
    return { errors: [`events must be a list of 1 to ${MAX_EVENTS} events`] };
  }
  return collectRows(given.map(checkRow));
}

/** The request body for `events.insert`: Google's end of an all-day event is the day after its last day. */
export function eventBody(event: NewEvent, zone: string): Record<string, unknown> {
  const extras = {
    ...(event.location === "" ? {} : { location: event.location }),
    ...(event.description === "" ? {} : { description: event.description }),
    ...(event.recurrence.length === 0 ? {} : { recurrence: event.recurrence }),
  };
  if (event.allDay) {
    return {
      summary: event.summary,
      start: { date: event.date },
      end: { date: addDays(event.lastDate, 1) },
      ...extras,
    };
  }
  const timeZone = event.timeZone === "" ? zone : event.timeZone;
  return {
    summary: event.summary,
    start: { dateTime: event.start, timeZone },
    end: { dateTime: event.end, timeZone },
    ...extras,
  };
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A row of the answer:"Tue 10 Nov 17:50–19:15 — Padel (Bromma Padel) — every Sunday". */
export function rowText(event: NewEvent, zone: string): string {
  const when = whenOf(eventBody(event, zone));
  const place = event.location === "" ? "" : ` (${oneLine(event.location)})`;
  const repeats = recurrenceText(event.recurrence);
  return `${when} — ${oneLine(event.summary)}${place}${repeats === "" ? "" : ` — ${repeats}`}`;
}
