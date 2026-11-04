/**
 * What Google Calendar's REST answers look like, as far as the extension
 * reads them, and tolerant parsers for them: unknown fields are ignored and a
 * missing optional field becomes "" or [].
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type CalendarInfo = {
  id: string;
  /** The name the reader sees: their own rename (`summaryOverride`) if any, else the calendar's. */
  name: string;
  primary: boolean;
  /** `owner`, `writer`, `reader` or `freeBusyReader`. */
  accessRole: string;
  /** The calendar's background colour, like `#9fe1e7`. */
  color: string;
  timeZone: string;
};

export function parseCalendar(value: unknown): CalendarInfo {
  const each = isRecord(value) ? value : {};
  return {
    id: str(each["id"]),
    name: str(each["summaryOverride"]) || str(each["summary"]) || str(each["id"]),
    primary: each["primary"] === true,
    accessRole: str(each["accessRole"]),
    color: str(each["backgroundColor"]),
    timeZone: str(each["timeZone"]),
  };
}

export type CalendarEvent = {
  id: string;
  title: string;
  location: string;
  /** The start: `2026-11-10T17:50:00+01:00`, or just `2026-11-10` for an all-day event. */
  start: string;
  /** The end, in the same form; for an all-day event the day after its last day. */
  end: string;
  allDay: boolean;
  /** The attendees' names (else their addresses). */
  who: string[];
};

function timeOf(value: unknown): { time: string; allDay: boolean } {
  const each = isRecord(value) ? value : {};
  const dateTime = str(each["dateTime"]);
  return dateTime === ""
    ? { time: str(each["date"]), allDay: true }
    : { time: dateTime, allDay: false };
}

/** An event, or null for one that was cancelled (a deleted instance of a series). */
export function parseEvent(value: unknown): CalendarEvent | null {
  const each = isRecord(value) ? value : {};
  if (str(each["status"]) === "cancelled") return null;
  const start = timeOf(each["start"]);
  const who = list(each["attendees"]).map((one) => {
    const attendee = isRecord(one) ? one : {};
    return str(attendee["displayName"]) || str(attendee["email"]);
  });
  return {
    id: str(each["id"]),
    title: str(each["summary"]) || "(no title)",
    location: str(each["location"]),
    start: start.time,
    end: timeOf(each["end"]).time,
    allDay: start.allDay,
    who: who.filter((name) => name !== ""),
  };
}
