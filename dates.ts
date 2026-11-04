/**
 * The date arithmetic the tools need, on plain `YYYY-MM-DD` days and on a
 * time zone's own clock. Google answers an event's times in the zone the
 * request names (`timeZone`), so the local date and time are read straight
 * from the text and no zone maths is needed to show them.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number): string => String(value).padStart(2, "0");

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export function isDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

function utcOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
}

function dayOf(ms: number): string {
  const at = new Date(ms);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

export function addDays(day: string, count: number): string {
  return dayOf(utcOf(day) + count * 86_400_000);
}

/** The Monday of the week `day` is in (weeks run Monday to Sunday). */
export function mondayOf(day: string): string {
  const weekday = new Date(utcOf(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** "Tue 10 Nov". */
export function dayLabel(day: string): string {
  const at = new Date(utcOf(day));
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** The days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = addDays(day, 1)) out.push(day);
  return out;
}

/** The reader's own zone, for when no calendar says which one to use. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** `zone` if it is a time zone this runtime knows, else the local one. */
export function knownZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return localZone();
  }
}

/** Today's date on `zone`'s clock. */
export function todayIn(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((each) => each.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(zone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(ms));
  const name = parts.find((each) => each.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** Midnight at the start of `day` on `zone`'s clock, as an RFC 3339 time with its offset. */
export function startOfDay(day: string, zone: string): string {
  const midnight = utcOf(day);
  const first = offsetMinutes(zone, midnight);
  const offset = offsetMinutes(zone, midnight - first * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  return `${day}T00:00:00${sign}${hours}:${pad(Math.abs(offset) % 60)}`;
}

/** The date part of an event time: `2026-11-10` of `2026-11-10T17:50:00+01:00` or of a plain date. */
export const datePart = (time: string): string => time.slice(0, 10);

/** The clock part, "17:50", of a time with a clock. */
export const clockPart = (time: string): string => time.slice(11, 16);
