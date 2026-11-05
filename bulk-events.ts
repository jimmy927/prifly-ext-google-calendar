/**
 * The events of a bulk add (`calendar_create_events`): checking the list a
 * session sent, the request body Google gets for each, how a row reads on the
 * confirm card, and the one-line-per-event text the reader edits there.
 *
 * Every row is checked and every wrong one is named, by its 1-based number,
 * before any card is shown. An all-day event is given with its first `date` and
 * the inclusive last day `end_date` (the day the reader means); Google's own
 * end is the day after, which `eventBody` adds.
 *
 * The editable text has one event per line, fields separated by `|`:
 *
 *     2026-11-10 17:50-19:15 | Padel | where: Bromma Padel | repeat: RRULE:FREQ=WEEKLY;BYDAY=TU
 *     2026-11-21 all day | Cup
 *     2026-11-21..2026-11-23 all day | Weekend away | note: Pack the bags
 *     2026-11-10T22:00 -> 2026-11-11T01:00 | Late shift | zone: Europe/Stockholm
 *
 * The time comes first, the title second; then, in any order, `where:`,
 * `note:`, `repeat:` (once for each recurrence line) and `zone:`. A `|` or a
 * backslash in a text is written `\|` and `\\`, a line break `\n`; lines that
 * are empty or start with `#` are ignored.
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
export function checkRow(raw: unknown): NewEvent | string[] {
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
export function collectRows(rows: (NewEvent | string[])[]): Checked {
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

/** A row on the plain card: "Tue 10 Nov 17:50–19:15 — Padel (Bromma Padel) — weekly on Sundays". */
export function rowText(event: NewEvent, zone: string): string {
  const when = whenOf(eventBody(event, zone));
  const place = event.location === "" ? "" : ` (${oneLine(event.location)})`;
  const repeats = recurrenceText(event.recurrence);
  return `${when} — ${oneLine(event.summary)}${place}${repeats === "" ? "" : ` — ${repeats}`}`;
}

/** The rows as a numbered list. */
export function numberedRows(events: NewEvent[], zone: string): string[] {
  return events.map((event, at) => `${at + 1}. ${rowText(event, zone)}`);
}

const escaped = (text: string): string => text.replace(/[\\|]/g, "\\$&").replace(/\r?\n/g, "\\n");

const unescaped = (text: string): string =>
  text.replace(/\\([\\|n])/g, (_, char: string) => (char === "n" ? "\n" : char));

const SAME_DAY_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00$/;

function whenField(event: NewEvent): string {
  if (event.allDay) {
    return event.lastDate === event.date
      ? `${event.date} all day`
      : `${event.date}..${event.lastDate} all day`;
  }
  const from = SAME_DAY_CLOCK.exec(event.start);
  const to = SAME_DAY_CLOCK.exec(event.end);
  if (from !== null && to !== null && from[1] === to[1]) return `${from[1]} ${from[2]}-${to[2]}`;
  return `${event.start} -> ${event.end}`;
}

/** One event as a line of the editable text. */
export function editLine(event: NewEvent): string {
  return [
    whenField(event),
    escaped(event.summary),
    ...(event.location === "" ? [] : [`where: ${escaped(event.location)}`]),
    ...(event.description === "" ? [] : [`note: ${escaped(event.description)}`]),
    ...event.recurrence.map((line) => `repeat: ${escaped(line)}`),
    ...(event.timeZone === "" ? [] : [`zone: ${event.timeZone}`]),
  ].join(" | ");
}

const EDIT_HELP =
  "# One event per line: time | title | where: … | note: … | repeat: RRULE:… | zone: …  (time: 2026-11-10 17:50-19:15, 2026-11-21 all day, 2026-11-21..2026-11-23 all day or 2026-11-10T22:00 -> 2026-11-11T01:00). Delete a line to leave that event out.";

/** The events as the text the reader edits on the card. */
export function editText(events: NewEvent[]): string {
  return [EDIT_HELP, ...events.map(editLine)].join("\n");
}

/** A line split at its `|` fields, a backslash keeping the next character in the field. */
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  for (let at = 0; at < line.length; at++) {
    const char = line.charAt(at);
    if (char === "\\") {
      field += char + line.charAt(at + 1);
      at++;
    } else if (char === "|") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  return [...fields, field].map((each) => each.trim());
}

const ALL_DAY_FIELD = /^(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?\s+all day$/i;
const SAME_DAY_FIELD = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/;

/** The row fields a time field stands for, or why it cannot be read. */
function whenFields(field: string): Record<string, string> | string {
  const allDay = ALL_DAY_FIELD.exec(field);
  if (allDay !== null) return { date: allDay[1] ?? "", end_date: allDay[2] ?? allDay[1] ?? "" };
  const same = SAME_DAY_FIELD.exec(field);
  if (same !== null) return { start: `${same[1]}T${same[2]}`, end: `${same[1]}T${same[3]}` };
  const [start, end, ...more] = field.split(/\s*->\s*/);
  if (start !== undefined && end !== undefined && more.length === 0) return { start, end };
  return `cannot read the time '${field}' (like 2026-11-10 17:50-19:15, 2026-11-21 all day or 2026-11-10T22:00 -> 2026-11-11T01:00)`;
}

const OPTION_FIELDS: Record<string, string> = {
  where: "location",
  note: "description",
  zone: "timeZone",
};

/** The row an edited line stands for, or why the line cannot be read. */
function parseLine(line: string): Record<string, unknown> | string {
  const [when = "", title = "", ...options] = splitFields(line).filter(
    (field, at) => at < 2 || field !== "",
  );
  const times = whenFields(when);
  if (typeof times === "string") return times;
  const row: Record<string, unknown> = { ...times, summary: unescaped(title) };
  const repeats: string[] = [];
  for (const option of options) {
    const match = /^(where|note|repeat|zone):\s*([\s\S]*)$/.exec(option);
    if (match === null)
      return `cannot read '${option}' (after the title: where:, note:, repeat: or zone:)`;
    const value = unescaped(match[2] ?? "");
    if (match[1] === "repeat") repeats.push(value);
    else row[OPTION_FIELDS[match[1] ?? ""] ?? ""] = value;
  }
  return repeats.length === 0 ? row : { ...row, recurrence: repeats };
}

/** The events of an edited text, checked as strictly as the session's list: its problems name the row (the Nth event line). */
export function parseEditText(text: string): Checked {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return collectRows(
    lines.map((line) => {
      const row = parseLine(line);
      return typeof row === "string" ? [row] : checkRow(row);
    }),
  );
}
