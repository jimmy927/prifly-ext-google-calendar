/**
 * A fake Google Calendar for the tests: an in-memory set of calendars and
 * events behind a `FakeProvider`, answering the REST calls the extension
 * makes: calendarList and events list with paging, and event get, insert,
 * update and delete. The calendars are the reader's own, a school calendar
 * subscribed from Infomentor and a football team's.
 */

import type { FakeProvider } from "./fake-api";

type Json = Record<string, unknown>;

export const SELF = "jimmy@example.com";

export const PRIMARY = "jimmy@example.com";
export const SCHOOL = "infomentor4b@import.calendar.google.com";
export const FOOTBALL = "football@group.calendar.google.com";
export const BROKEN = "broken@group.calendar.google.com";

const timed = (start: string, end: string) => ({
  start: { dateTime: start, timeZone: "Europe/Stockholm" },
  end: { dateTime: end, timeZone: "Europe/Stockholm" },
});

const allDay = (start: string, end: string) => ({ start: { date: start }, end: { date: end } });

/** The calendars as calendarList returns them, in order: four of them, so pages of two take two requests. */
const CALENDARS: Json[] = [
  {
    id: PRIMARY,
    summary: "jimmy@example.com",
    summaryOverride: "Jimmy",
    primary: true,
    accessRole: "owner",
    backgroundColor: "#9fe1e7",
    timeZone: "Europe/Stockholm",
  },
  {
    id: SCHOOL,
    summary: "Klass 4B (Infomentor)",
    accessRole: "reader",
    backgroundColor: "#f83a22",
    timeZone: "Europe/Stockholm",
  },
  {
    id: FOOTBALL,
    summary: "Fotboll P12",
    accessRole: "writer",
    backgroundColor: "#16a765",
    timeZone: "Europe/Stockholm",
  },
  {
    id: BROKEN,
    summary: "Trasig",
    accessRole: "reader",
    backgroundColor: "#000000",
    timeZone: "Europe/Stockholm",
  },
];

/** A calendar the list shows only with `showHidden=true`. */
const HIDDEN: Json = {
  id: "hidden@group.calendar.google.com",
  summary: "Gömd",
  hidden: true,
  accessRole: "reader",
  backgroundColor: "#ffffff",
  timeZone: "Europe/Stockholm",
};

function startEvents(): Map<string, Json[]> {
  return new Map<string, Json[]>([
    [
      PRIMARY,
      [
        {
          id: "padel1",
          summary: "Padel",
          location: "Bromma Padel",
          attendees: [
            { displayName: "Ada", email: "ada@example.com" },
            { email: "bob@example.com" },
          ],
          ...timed("2026-11-10T17:50:00+01:00", "2026-11-10T19:15:00+01:00"),
        },
        {
          id: "dentist1",
          summary: "Dentist",
          ...timed("2026-11-11T08:30:00+01:00", "2026-11-11T09:00:00+01:00"),
        },
        {
          id: "late1",
          summary: "Julbord",
          ...timed("2026-12-18T18:00:00+01:00", "2026-12-18T22:00:00+01:00"),
        },
      ],
    ],
    [
      SCHOOL,
      [
        { id: "study1", summary: "Studiedag", ...allDay("2026-11-11", "2026-11-12") },
        {
          id: "parents1",
          summary: "Föräldramöte",
          ...timed("2026-11-10T18:00:00+01:00", "2026-11-10T19:00:00+01:00"),
        },
        { id: "theme1", summary: "Temavecka", ...allDay("2026-11-12", "2026-11-15") },
        {
          id: "gone1",
          summary: "Inställd",
          status: "cancelled",
          ...allDay("2026-11-13", "2026-11-14"),
        },
      ],
    ],
    [
      FOOTBALL,
      [
        {
          id: "train1",
          summary: "Träning",
          ...timed("2026-11-10T16:00:00+01:00", "2026-11-10T17:00:00+01:00"),
        },
        {
          id: "match1",
          summary: "Match",
          location: "Kristineberg IP",
          ...timed("2026-11-14T10:00:00+01:00", "2026-11-14T12:00:00+01:00"),
        },
      ],
    ],
    [BROKEN, []],
  ]);
}

export type FakeCalendar = {
  provider: FakeProvider;
  events: Map<string, Json[]>;
  /** Every events list request's URL, in order. */
  eventLists: URL[];
  /** Every calendarList request's URL, in order. */
  calendarLists: URL[];
  /** How many items a page of either list holds (default 2). */
  pageSize: { value: number };
  /** The calendar ids whose events answer 403, as a calendar the reader cannot read does. */
  forbidden: Set<string>;
  /** While set, every call answers 403 as a grant without the scope does. */
  noScope: { on: boolean };
  /** The insert (counted from 1, over the whole test) that answers 500; 0 for none. */
  failInsertAt: { n: number };
  /** The ids of events whose delete answers 500. */
  failDelete: Set<string>;
};

const instant = (value: Json | undefined): number =>
  Date.parse(String(value?.["dateTime"] ?? `${String(value?.["date"])}T00:00:00+01:00`));

function page(items: Json[], url: URL, size: number): Response {
  const at = Number(url.searchParams.get("pageToken") ?? "0");
  const rest = at + size < items.length;
  return Response.json({
    items: items.slice(at, at + size),
    ...(rest ? { nextPageToken: String(at + size) } : {}),
  });
}

function listEvents(all: Json[], url: URL, size: number): Response {
  const min = Date.parse(url.searchParams.get("timeMin") ?? "");
  const max = Date.parse(url.searchParams.get("timeMax") ?? "");
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const inRange = all
    .filter((each) => instant(each["end"] as Json) > min && instant(each["start"] as Json) < max)
    .filter((each) => String(each["summary"]).toLowerCase().includes(q))
    .sort((a, b) => instant(a["start"] as Json) - instant(b["start"] as Json));
  return page(inRange, url, size);
}

export function fakeCalendar(): FakeCalendar {
  const events = startEvents();
  const eventLists: URL[] = [];
  const calendarLists: URL[] = [];
  const pageSize = { value: 2 };
  const forbidden = new Set<string>();
  const noScope = { on: false };
  const failInsertAt = { n: 0 };
  const failDelete = new Set<string>();
  let created = 0;
  let inserts = 0;

  const provider: FakeProvider = async (request) => {
    const url = new URL(request.url);
    const prefix = "/calendar/v3";
    if (url.host !== "www.googleapis.com" || !url.pathname.startsWith(`${prefix}/`)) {
      return new Response("not the calendar api", { status: 404 });
    }
    if (noScope.on) {
      return new Response(
        JSON.stringify({
          error: { code: 403, message: "Request had insufficient authentication scopes." },
        }),
        { status: 403 },
      );
    }
    const parts = url.pathname
      .slice(prefix.length)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    if (parts.join("/") === "users/me/calendarList" && request.method === "GET") {
      calendarLists.push(url);
      const shown =
        url.searchParams.get("showHidden") === "true" ? [...CALENDARS, HIDDEN] : CALENDARS;
      return page(shown, url, pageSize.value);
    }
    if (parts[0] !== "calendars" || parts[2] !== "events")
      return new Response("no", { status: 404 });
    return await onEvents(request, url, parts);
  };

  /** Everything below calendars/{id}/events: list, insert, and one event's get, update and delete. */
  const onEvents = async (request: Request, url: URL, parts: string[]): Promise<Response> => {
    const calendar = parts[1] === "primary" ? PRIMARY : (parts[1] ?? "");
    const stored = events.get(calendar);
    if (stored === undefined) return new Response("no calendar", { status: 404 });
    if (forbidden.has(calendar)) return new Response("forbidden", { status: 403 });
    if (parts.length === 3 && request.method === "GET") {
      eventLists.push(url);
      return listEvents(stored, url, pageSize.value);
    }
    if (parts.length === 3 && request.method === "POST") return await onInsert(request, stored);
    return await onEvent(request, stored, parts[3] ?? "");
  };

  /** An insert: the body stored under a new id and link, unless this is the insert that fails. */
  const onInsert = async (request: Request, stored: Json[]): Promise<Response> => {
    const body = (await request.json()) as Json;
    if (++inserts === failInsertAt.n) {
      return Response.json({ error: { code: 500, message: "Backend Error" } }, { status: 500 });
    }
    const id = `new${++created}`;
    const event = { ...body, id, htmlLink: `https://calendar.example/event?eid=${id}` };
    stored.push(event);
    return Response.json(event);
  };

  /** One event: get, delete, and update (PUT and PATCH alike, merging the body in). */
  const onEvent = async (request: Request, stored: Json[], id: string): Promise<Response> => {
    const found = stored.find((each) => each["id"] === id);
    if (found === undefined) return new Response("no event", { status: 404 });
    if (request.method === "GET") return Response.json(found);
    if (request.method === "DELETE") {
      if (failDelete.has(id)) return new Response("backend error", { status: 500 });
      stored.splice(stored.indexOf(found), 1);
      return new Response(null, { status: 204 });
    }
    Object.assign(found, (await request.json()) as Json);
    return Response.json(found);
  };

  return {
    provider,
    events,
    eventLists,
    calendarLists,
    pageSize,
    forbidden,
    noScope,
    failInsertAt,
    failDelete,
  };
}
