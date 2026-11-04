import { afterEach, expect, test } from "bun:test";
import { calendarPath } from "../api-tools";
import { CANCELLED, NO_CONFIRM } from "../tool-kit";
import { FOOTBALL, PRIMARY } from "./fake-calendar";
import { world } from "./world";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

function started(options: Parameters<typeof world>[0] = {}) {
  const w = world(options);
  stop = w.stop;
  return w;
}

const PADEL = {
  summary: "Padel",
  start: { dateTime: "2026-11-10T17:50:00+01:00" },
  end: { dateTime: "2026-11-10T19:15:00+01:00" },
};

/** Every kind of write, with arguments that make it write. */
const WRITES: [string, Record<string, unknown>][] = [
  ["insert", { method: "POST", path: "/calendars/primary/events", body: PADEL }],
  [
    "update",
    { method: "PATCH", path: "/calendars/primary/events/padel1", body: { location: "X" } },
  ],
  ["replace", { method: "PUT", path: "/calendars/primary/events/padel1", body: PADEL }],
  ["delete", { method: "DELETE", path: "/calendars/primary/events/padel1" }],
];

for (const [label, args] of WRITES) {
  test(`${label}: shows a card before any write request, then writes`, async () => {
    const w = started();
    const answer = await w.call("calendar_api", args);
    expect(w.confirms.length).toBe(1);
    expect(w.confirms[0]?.writesBefore).toBe(0);
    expect(w.writes().length).toBe(1);
    expect(answer).not.toBe(CANCELLED);
  });

  test(`${label}: a cancelled card changes nothing`, async () => {
    const w = started({ confirm: false });
    const before = structuredClone([...w.calendar.events.entries()]);
    expect(await w.call("calendar_api", args)).toBe(CANCELLED);
    expect(CANCELLED).toBe("Not done: you cancelled");
    expect(w.confirms.length).toBe(1);
    expect(w.writes()).toEqual([]);
    expect([...w.calendar.events.entries()]).toEqual(before);
  });
}

test("without api.confirm (an older prifly) no write is made", async () => {
  const w = started();
  delete w.fake.api.confirm;
  for (const [, args] of WRITES) expect(await w.call("calendar_api", args)).toBe(NO_CONFIRM);
  expect(w.writes()).toEqual([]);
});

test("an insert's card says what is created, when and where, and shows the request", async () => {
  const w = started();
  const answer = await w.call("calendar_api", WRITES[0]?.[1] ?? {});
  const spec = w.confirms[0]?.spec;
  expect(spec?.summary).toBe("Create event 'Padel' on Tue 10 Nov 17:50–19:15 in calendar 'Jimmy'");
  expect(spec?.details).toContain(
    "POST https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  expect(spec?.details).toContain(JSON.stringify(PADEL, null, 2));
  expect(JSON.parse(answer)["id"]).toBe("new1");
  expect(w.calendar.events.get(PRIMARY)?.at(-1)?.["summary"]).toBe("Padel");
});

test("an all-day insert says all day, in a calendar named from the list", async () => {
  const w = started();
  await w.call("calendar_api", {
    method: "POST",
    path: `/calendars/${encodeURIComponent(FOOTBALL)}/events`,
    body: { summary: "Cup", start: { date: "2026-11-21" }, end: { date: "2026-11-22" } },
  });
  expect(w.confirms[0]?.spec.summary).toBe(
    "Create event 'Cup' on Sat 21 Nov all day in calendar 'Fotboll P12'",
  );
});

test("an update names the event: the body's title, else the one on the calendar", async () => {
  const w = started();
  await w.call("calendar_api", {
    method: "PATCH",
    path: "/calendars/primary/events/padel1",
    body: {
      start: { dateTime: "2026-11-10T18:00:00+01:00" },
      end: { dateTime: "2026-11-10T19:30:00+01:00" },
    },
  });
  expect(w.confirms[0]?.spec.summary).toBe(
    "Update event 'Padel' in calendar 'Jimmy' to Tue 10 Nov 18:00–19:30",
  );
  expect(w.calendar.events.get(PRIMARY)?.[0]?.["start"]).toEqual({
    dateTime: "2026-11-10T18:00:00+01:00",
  });
  await w.call("calendar_api", {
    method: "PUT",
    path: "/calendars/primary/events/padel1",
    body: { ...PADEL, summary: "Padel dubbel" },
  });
  expect(w.confirms[1]?.spec.summary).toBe(
    "Update event 'Padel dubbel' in calendar 'Jimmy' to Tue 10 Nov 17:50–19:15",
  );
});

test("a delete names the event first, from the calendar, and falls back to its id", async () => {
  const w = started();
  await w.call("calendar_api", { method: "DELETE", path: `/calendars/${FOOTBALL}/events/match1` });
  expect(w.confirms[0]?.spec.summary).toBe("Delete event 'Match' from calendar 'Fotboll P12'");
  expect(w.calendar.events.get(FOOTBALL)?.map((each) => each["id"])).toEqual(["train1"]);
  const gone = await w.call("calendar_api", {
    method: "DELETE",
    path: "/calendars/primary/events/nope",
  });
  expect(w.confirms[1]?.spec.summary).toBe("Delete event 'nope' from calendar 'Jimmy'");
  expect(gone).toContain("Google Calendar answered 404");
});

test("another write gets a generic summary, and the card always shows method, URL and body", async () => {
  const w = started();
  await w.call("calendar_api", {
    method: "POST",
    path: "calendars/primary/events/quickAdd",
    query: { text: "Lunch tomorrow" },
    body: { note: 1 },
  });
  const spec = w.confirms[0]?.spec;
  expect(spec?.summary).toBe("POST /calendars/primary/events/quickAdd?text=Lunch+tomorrow");
  expect(spec?.details).toBe(
    'POST https://www.googleapis.com/calendar/v3/calendars/primary/events/quickAdd?text=Lunch+tomorrow\n\n{\n  "note": 1\n}',
  );
});

test("a GET runs at once, relative or as the full URL, without a card", async () => {
  const w = started();
  const relative = JSON.parse(
    await w.call("calendar_api", { path: "/calendars/primary/events/padel1" }),
  );
  expect(relative["summary"]).toBe("Padel");
  const full = JSON.parse(
    await w.call("calendar_api", {
      method: "get",
      path: "https://www.googleapis.com/calendar/v3/calendars/primary/events/dentist1",
    }),
  );
  expect(full["summary"]).toBe("Dentist");
  expect(w.confirms).toEqual([]);
});

const REFUSED = [
  "https://evil.example.com/calendar/v3/users/me/calendarList",
  "https://www.googleapis.com/gmail/v1/users/me/profile",
  "http://www.googleapis.com/calendar/v3/users/me/calendarList",
  "https://www.googleapis.com/calendar/v3.evil.com/x",
  "../gmail/v1/users/me/profile",
  "/calendars/primary/../../x",
  "/calendars/%2e%2e/events",
  "calendars/primary/events?maxResults=1",
  "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
  "calendars/primary/events/https://evil.example.com",
  "calendars/primary/events#x",
  "//evil.example.com/x",
  "",
  "/",
];

test("calendar_api refuses anything that is not the Calendar API, before any card or request", async () => {
  const w = started();
  await Bun.sleep(5);
  const sent = w.connections.requests.length;
  for (const path of REFUSED) {
    for (const method of ["GET", "DELETE"]) {
      expect(await w.call("calendar_api", { method, path })).toStartWith(
        "path must be a path below calendar/v3",
      );
    }
  }
  expect(w.confirms).toEqual([]);
  expect(w.connections.requests.length).toBe(sent);
});

test("calendarPath accepts a relative path or the full Calendar URL, and nothing else", () => {
  expect(calendarPath("users/me/calendarList")).toBe("/users/me/calendarList");
  expect(calendarPath("/calendars/a%40b.com/events/x")).toBe("/calendars/a%40b.com/events/x");
  expect(calendarPath("https://www.googleapis.com/calendar/v3/colors")).toBe("/colors");
  expect(calendarPath("https://www.googleapis.com/calendar/v3")).toBeNull();
  for (const path of REFUSED) expect(calendarPath(path)).toBeNull();
});

test("calendar_api answers a bad method and a grant without the scope plainly", async () => {
  const w = started();
  expect(await w.call("calendar_api", { method: "TRACE", path: "/colors" })).toContain(
    "method must be",
  );
  w.calendar.noScope.on = true;
  expect(await w.call("calendar_api", { path: "/users/me/calendarList" })).toContain(
    "run calendar_sign_in",
  );
});
