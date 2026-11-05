/**
 * The plain-language sentence on the confirm card of a `calendar_api` write:
 * "Create event 'X' on Tue 10 Nov 17:50–19:15 in calendar 'Jimmy'" for an
 * insert, "Update event 'X' …" for a PUT or PATCH and "Delete event 'X' from
 * calendar 'Jimmy'" for a DELETE. Calendar names come from the calendar list
 * and an event's title from its own GET, with the id as the last resort. Any
 * other write has no sentence here (null) and the card says "METHOD path".
 */

import type { CalendarClient } from "./calendar";
import { isRecord, parseEvent, str } from "./calendar-types";
import { datePart, isDay } from "./dates";
import { whenText } from "./render";

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The name the reader knows a calendar by; `primary` and ids the list does not hold stay as given. */
async function calendarName(client: CalendarClient, id: string): Promise<string> {
  const got = await client.calendars();
  if (!got.ok) return id;
  const found = got.value.find((each) => each.id === id || (id === "primary" && each.primary));
  return found?.name ?? id;
}

/** "Tue 10 Nov 17:50–19:15" from a request body's start and end; "" when it has none. */
export function whenOf(body: unknown): string {
  const each = isRecord(body) ? body : {};
  const event = parseEvent({ start: each["start"], end: each["end"] });
  if (event === null || !isDay(datePart(event.start))) return "";
  return whenText(event);
}

/** The sentence for a write, or null when it is not about one event. */
export async function describeWrite(
  client: CalendarClient,
  method: string,
  path: string,
  body: unknown,
): Promise<string | null> {
  const parts = path
    .split("/")
    .filter((each) => each !== "")
    .map(decoded);
  const [first, calendarId, third, eventId] = parts;
  if (first !== "calendars" || calendarId === undefined || third !== "events") return null;
  const sent = isRecord(body) ? str(body["summary"]) : "";
  if (parts.length === 3 && method === "POST") {
    const when = whenOf(body);
    const name = await calendarName(client, calendarId);
    return `Create event '${sent || "(no title)"}'${when === "" ? "" : ` on ${when}`} in calendar '${name}'`;
  }
  if (parts.length !== 4 || eventId === undefined) return null;
  if (method !== "PUT" && method !== "PATCH" && method !== "DELETE") return null;
  const title = sent || (await client.eventTitle(calendarId, eventId)) || eventId;
  const name = await calendarName(client, calendarId);
  if (method === "DELETE") return `Delete event '${title}' from calendar '${name}'`;
  const when = whenOf(body);
  return `Update event '${title}' in calendar '${name}'${when === "" ? "" : ` to ${when}`}`;
}
