/**
 * A recurrence as the reader would say it. `recurrenceText(["RRULE:FREQ=WEEKLY;BYDAY=SU"])`
 * is "every Sunday"; a rule this does not read (a day of the month, an
 * ordinal weekday, anything unusual) is shown as written, so the card never
 * says something the rule does not.
 */

import { dayLabel, isDay } from "./dates";

const DAY_NAMES: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const DAY_FULL: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

/** How each frequency reads on its own, and its unit for "every 2 weeks". */
const FREQUENCIES: Record<string, { alone: string; unit: string }> = {
  DAILY: { alone: "daily", unit: "day" },
  WEEKLY: { alone: "weekly", unit: "week" },
  MONTHLY: { alone: "monthly", unit: "month" },
  YEARLY: { alone: "yearly", unit: "year" },
};

const KNOWN_PARTS = ["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"];

/** The `KEY=value` parts of a rule line, or null when it is not made of such parts. */
function ruleParts(line: string): Record<string, string> | null {
  const parts: Record<string, string> = {};
  for (const piece of line.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = piece.split("=");
    if (key === undefined || value === undefined || value === "") return null;
    parts[key.toUpperCase()] = value;
  }
  return parts;
}

/** The day, `YYYY-MM-DD`, that "20261220" or "20261220T000000Z" starts with; "" when it is not a date. */
function dayOfBasic(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  const day = match === null ? "" : `${match[1]}-${match[2]}-${match[3]}`;
  return isDay(day) ? day : "";
}

/** "20 Dec": a day without its weekday, as the card says when a rule ends. */
const shortDay = (day: string): string => dayLabel(day).slice(4);

/** How the rule ends: ", 10 times", ", until 20 Dec", "" for never; null for a value it cannot read. */
function endText(parts: Record<string, string>): string | null {
  let text = "";
  if (parts["COUNT"] !== undefined) {
    const count = Number(parts["COUNT"]);
    if (!Number.isInteger(count) || count < 1) return null;
    text += count === 1 ? ", once" : `, ${count} times`;
  }
  if (parts["UNTIL"] !== undefined) {
    const day = dayOfBasic(parts["UNTIL"]);
    if (day === "") return null;
    text += `, until ${shortDay(day)}`;
  }
  return text;
}

/** "Mon, Wed and Fri": the short day names of a list, the last joined with "and". */
function dayList(days: string[]): string {
  const names = days.map((day) => DAY_NAMES[day] ?? day);
  const last = names.pop();
  return names.length === 0 ? (last ?? "") : `${names.join(", ")} and ${last}`;
}

/** "every other Sunday", "every 3 weeks on Mon, Wed", "Mon, Wed and Fri": a weekly rule with days; null when they are not plain weekdays. */
function weekdaysText(days: string[], interval: number): string | null {
  if (days.some((day) => DAY_NAMES[day] === undefined)) return null;
  const [only] = days;
  if (days.length === 1 && only !== undefined) {
    const name = DAY_FULL[only] ?? only;
    if (interval === 1) return `every ${name}`;
    return interval === 2 ? `every other ${name}` : `every ${interval} weeks on ${name}`;
  }
  if (interval === 1) return dayList(days);
  const short = days.map((day) => DAY_NAMES[day]).join(", ");
  return interval === 2 ? `every other ${short}` : `every ${interval} weeks on ${short}`;
}

/** The frequency and interval alone: "weekly", "every other day", "every 3 months". */
function everyText(frequency: { alone: string; unit: string }, interval: number): string {
  if (interval === 1) return frequency.alone;
  return interval === 2 ? `every other ${frequency.unit}` : `every ${interval} ${frequency.unit}s`;
}

/** One RRULE line in words, or null when any part of it is beyond what this reads. */
function ruleText(line: string): string | null {
  const parts = ruleParts(line);
  if (parts === null || Object.keys(parts).some((key) => !KNOWN_PARTS.includes(key))) return null;
  const frequency = FREQUENCIES[parts["FREQ"] ?? ""];
  const interval = parts["INTERVAL"] === undefined ? 1 : Number(parts["INTERVAL"]);
  if (frequency === undefined || !Number.isInteger(interval) || interval < 1) return null;
  const byDay = parts["BYDAY"];
  if (byDay !== undefined && parts["FREQ"] !== "WEEKLY") return null;
  const every =
    byDay === undefined ? everyText(frequency, interval) : weekdaysText(byDay.split(","), interval);
  const end = endText(parts);
  return every === null || end === null ? null : `${every}${end}`;
}

/** An EXDATE line as "except 24 Dec, 25 Dec"; null when a date in it is not a plain date. */
function exceptText(line: string): string | null {
  const values = line.slice(line.indexOf(":") + 1).split(",");
  const days = values.map(dayOfBasic);
  return days.includes("") ? null : `except ${days.map(shortDay).join(", ")}`;
}

function lineText(line: string): string {
  const upper = line.toUpperCase();
  if (upper.startsWith("RRULE:")) return ruleText(line) ?? line;
  if (upper.startsWith("EXDATE") && line.includes(":")) return exceptText(line) ?? line;
  return line;
}

/** The recurrence lines of an event in words, "" for none: "every Sunday, until 20 Dec". */
export function recurrenceText(lines: string[]): string {
  return lines.map(lineText).join(", ");
}
