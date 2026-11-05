import { afterEach, expect, test } from "bun:test";
import { recurrenceText } from "../recurrence";
import { CANCELLED, NO_CONFIRM } from "../tool-kit";
import { FOOTBALL, PRIMARY, SCHOOL } from "./fake-calendar";
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
  location: "Bromma Padel",
  start: "2026-11-10T17:50",
  end: "2026-11-10T19:15",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
};
const CUP = { summary: "Cup", date: "2026-11-21", end_date: "2026-11-22" };
const LUNCH = { summary: "Lunch", date: "2026-11-23" };
const THREE = [PADEL, CUP, LUNCH];

const create = (w: ReturnType<typeof started>, events: unknown, calendar = "Jimmy") =>
  w.call("calendar_create_events", { calendar, events });

const stored = (w: ReturnType<typeof started>, calendar = PRIMARY) =>
  w.calendar.events.get(calendar) ?? [];

// ---- refusals ----

test("a wrong list is refused with every wrong row numbered, before any card or write", async () => {
  const w = started();
  const answer = await create(w, [
    { summary: "Fine", date: "2026-11-21" },
    { start: "2026-11-10T10:00", end: "2026-11-10T11:00" },
    { summary: "Mixed", start: "2026-11-10T10:00", end: "2026-11-10T11:00", date: "2026-11-10" },
    { summary: "Bad date", start: "2026-13-40T10:00", end: "2026-11-10T11:00" },
    { summary: "Backwards", start: "2026-11-10T11:00", end: "2026-11-10T10:00" },
    { summary: "No end", start: "2026-11-10T11:00" },
    { summary: "Reversed days", date: "2026-11-23", end_date: "2026-11-21" },
    { summary: "Typo", date: "2026-11-21", endDate: "2026-11-22" },
    { summary: "Zone", start: "2026-11-10T10:00", end: "2026-11-10T11:00", timeZone: "Mars/Base" },
    { summary: "Rule", date: "2026-11-21", recurrence: ["FREQ=DAILY"] },
    "not an object",
  ]);
  expect(answer).toStartWith("Not done:");
  expect(answer).toContain("row 2: summary is missing");
  expect(answer).toContain("row 3: mixes timed fields");
  expect(answer).toContain("row 4: start");
  expect(answer).toContain("row 5: end 2026-11-10T10:00:00 is not after start 2026-11-10T11:00:00");
  expect(answer).toContain("row 6: end is missing");
  expect(answer).toContain("row 7: end_date 2026-11-21 is before date 2026-11-23");
  expect(answer).toContain("row 8: unknown field 'endDate'");
  expect(answer).toContain("row 9: timeZone 'Mars/Base' is not a time zone");
  expect(answer).toContain("row 10: recurrence must be a list");
  expect(answer).toContain("row 11: is not an object");
  expect(answer).not.toContain("row 1:");
  expect(w.confirms).toEqual([]);
  expect(w.writes()).toEqual([]);
});

test("an unknown or read-only calendar, an empty list and too many events are refused with the rows", async () => {
  const w = started();
  const unknown = await create(w, [LUNCH, { summary: "" }], "Nowhere");
  expect(unknown).toContain("calendar 'Nowhere' is none of the reader's calendars");
  expect(unknown).toContain("row 2: summary is empty");
  expect(await create(w, [LUNCH], SCHOOL)).toContain("can only be read by the reader (reader)");
  expect(await create(w, [])).toContain("the list is empty");
  expect(await create(w, "soon")).toContain("events must be a list");
  const many = Array.from({ length: 51 }, (_, at) => ({ summary: `E${at}`, date: "2026-11-21" }));
  expect(await create(w, many)).toContain("51 events is too many: at most 50 at a time");
  expect(w.confirms).toEqual([]);
  expect(w.writes()).toEqual([]);
});

// ---- the card ----

test("one card says it in words first, shows an agenda grouped by day, and shows the requests", async () => {
  const w = started();
  await create(w, THREE);
  expect(w.confirms.length).toBe(1);
  expect(w.confirms[0]?.writesBefore).toBe(0);
  const spec = w.confirms[0]?.spec;
  expect(spec?.summary).toBe("Add 3 events to your calendar 'Jimmy'");
  expect(spec?.content).toBe(
    [
      "Tue 10 Nov",
      "    17:50–19:15   Padel, Bromma Padel · repeats every Sunday",
      "",
      "Sat 21 – Sun 22 Nov",
      "    All day       Cup",
      "",
      "Mon 23 Nov",
      "    All day       Lunch",
    ].join("\n"),
  );
  expect(spec).not.toHaveProperty("events");
  expect(spec?.details).toContain(
    `POST https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events`,
  );
  expect(spec?.details).toContain('"end": {\n      "date": "2026-11-23"\n    }');
  expect(spec?.details).toContain('"timeZone": "Europe/Stockholm"');
});

test("a calendar can be named by id, by a part of its name, or primary", async () => {
  const w = started();
  await create(w, [LUNCH], "fotboll");
  await create(w, [LUNCH], FOOTBALL);
  await create(w, [LUNCH], "primary");
  expect(w.confirms.map((each) => each.spec.summary)).toEqual([
    "Add 1 event to your calendar 'Fotboll P12'",
    "Add 1 event to your calendar 'Fotboll P12'",
    "Add 1 event to your calendar 'Jimmy'",
  ]);
});

test("a recurrence reads in plain words, and anything else stays as written", () => {
  const words = (...lines: string[]) => recurrenceText(lines);
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=SU")).toBe("every Sunday");
  expect(words("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU")).toBe("every other Sunday");
  expect(words("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toBe("every other Mon, Wed");
  expect(words("RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=TU")).toBe("every 3 weeks on Tuesday");
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("Mon, Wed and Fri");
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Mon and Wed");
  expect(words("RRULE:FREQ=WEEKLY")).toBe("weekly");
  expect(words("RRULE:FREQ=DAILY")).toBe("daily");
  expect(words("RRULE:FREQ=DAILY;INTERVAL=2")).toBe("every other day");
  expect(words("RRULE:FREQ=MONTHLY")).toBe("monthly");
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261220")).toBe("every Sunday, until 20 Dec");
  expect(words("RRULE:FREQ=DAILY;UNTIL=20261220T000000Z")).toBe("daily, until 20 Dec");
  expect(words("RRULE:FREQ=DAILY;COUNT=6")).toBe("daily, 6 times");
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=SU", "EXDATE;VALUE=DATE:20261129,20261206")).toBe(
    "every Sunday, except 29 Nov, 6 Dec",
  );
  expect(words("RRULE:FREQ=MONTHLY;BYMONTHDAY=13")).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=13");
  expect(words("RRULE:FREQ=MONTHLY;BYDAY=1MO")).toBe("RRULE:FREQ=MONTHLY;BYDAY=1MO");
  expect(words("RRULE:FREQ=WEEKLY;BYDAY=XX")).toBe("RRULE:FREQ=WEEKLY;BYDAY=XX");
  expect(words("RRULE:FREQ=DAILY;UNTIL=soon")).toBe("RRULE:FREQ=DAILY;UNTIL=soon");
  expect(words("RDATE:20261101")).toBe("RDATE:20261101");
});

test("the agenda groups several events on one day, sorts by start and writes a multi-day event over two months", async () => {
  const w = started();
  await create(w, [
    {
      summary: "Late",
      start: "2026-11-08T20:00",
      end: "2026-11-08T21:00",
      location: "  Hall\n 2 ",
    },
    { summary: "Early", start: "2026-11-08T07:30", end: "2026-11-08T08:00" },
    { summary: "Trip", date: "2026-11-30", end_date: "2026-12-02" },
    { summary: "Night", start: "2026-11-08T22:00", end: "2026-11-09T01:00" },
    { summary: "Fika", date: "2026-11-08" },
  ]);
  expect(w.confirms[0]?.spec.content).toBe(
    [
      "Sun 8 Nov",
      "    All day                   Fika",
      "    07:30–08:00               Early",
      "    20:00–21:00               Late, Hall 2",
      "    22:00 – Mon 9 Nov 01:00   Night",
      "",
      "Mon 30 Nov – Wed 2 Dec",
      "    All day                   Trip",
    ].join("\n"),
  );
});

test("a prifly with the agenda card also gets the events, with the exact shape, and none without it", async () => {
  const w = started({ events: true });
  await create(w, [
    PADEL,
    { summary: "Football cup", date: "2026-11-21", end_date: "2026-11-22" },
    { summary: "Run", start: "2026-11-10T06:30", end: "2026-11-10T07:15" },
  ]);
  const spec = w.confirms[0]?.spec as { events?: unknown; content?: string } | undefined;
  expect(spec?.events).toEqual({
    action: "add",
    days: [
      {
        day: "Tue 10 Nov",
        events: [
          { time: "06:30–07:15", title: "Run" },
          { time: "17:50–19:15", title: "Padel", where: "Bromma Padel", repeats: "Every Sunday" },
        ],
      },
      { day: "Sat 21 – Sun 22 Nov", events: [{ time: "All day", title: "Football cup" }] },
    ],
  });
  expect(spec?.content).toContain("Tue 10 Nov\n    06:30–07:15   Run\n");
  const plain = started();
  await create(plain, [PADEL]);
  expect(plain.confirms[0]?.spec).not.toHaveProperty("events");
});

// ---- confirm ----

test("Confirm inserts the events one at a time and lists each with its id and link", async () => {
  const w = started();
  const answer = await create(w, THREE);
  expect(w.writes().map((each) => `${each.method} ${new URL(each.url).pathname}`)).toEqual(
    Array(3).fill(`POST /calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events`),
  );
  expect(answer).toBe(
    [
      "Created 3 events in the calendar 'Jimmy'.",
      "1. Tue 10 Nov 17:50–19:15 — Padel (Bromma Padel) — every Sunday — id new1 — https://calendar.example/event?eid=new1",
      "2. Sat 21 Nov – Sun 22 Nov all day — Cup — id new2 — https://calendar.example/event?eid=new2",
      "3. Mon 23 Nov all day — Lunch — id new3 — https://calendar.example/event?eid=new3",
    ].join("\n"),
  );
  const [padel, cup] = stored(w).slice(-3);
  expect(padel?.["start"]).toEqual({
    dateTime: "2026-11-10T17:50:00",
    timeZone: "Europe/Stockholm",
  });
  expect(padel?.["recurrence"]).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU"]);
  expect(cup?.["start"]).toEqual({ date: "2026-11-21" });
  expect(cup?.["end"]).toEqual({ date: "2026-11-23" });
});

test("an event's own time zone is kept", async () => {
  const w = started();
  await create(w, [
    {
      summary: "Call",
      start: "2026-11-10T09:00",
      end: "2026-11-10T10:00",
      timeZone: "America/New_York",
    },
  ]);
  expect(stored(w).at(-1)?.["start"]).toEqual({
    dateTime: "2026-11-10T09:00:00",
    timeZone: "America/New_York",
  });
});

test("Cancel writes nothing and answers the cancelled text", async () => {
  const w = started({ confirm: false });
  expect(await create(w, THREE)).toBe(CANCELLED);
  expect(CANCELLED).toBe("Not done: you cancelled");
  expect(w.confirms.length).toBe(1);
  expect(w.writes()).toEqual([]);
});

test("without a confirm card no event is created", async () => {
  const w = started();
  delete w.fake.api.confirm;
  expect(await create(w, THREE)).toBe(NO_CONFIRM);
  expect(w.writes()).toEqual([]);
});

// ---- failing part-way ----

test("when the 3rd insert fails the answer names what was created, what failed and what was not tried", async () => {
  const w = started();
  w.calendar.failInsertAt.n = 3;
  const rows = ["A", "B", "C", "D", "E"].map((summary) => ({ summary, date: "2026-11-21" }));
  const answer = await create(w, rows);
  expect(answer).toBe(
    [
      "Stopped part-way: 2 of 5 events were created, then row 3 failed. Do not send the created ones again.",
      "Created:",
      "1. Sat 21 Nov all day — A — id new1 — https://calendar.example/event?eid=new1",
      "2. Sat 21 Nov all day — B — id new2 — https://calendar.example/event?eid=new2",
      'Failed: 3. Sat 21 Nov all day — C — Google Calendar answered 500 for jimmy@example.com: {"error":{"code":500,"message":"Backend Error"}}',
      "Not attempted (2):",
      "4. Sat 21 Nov all day — D",
      "5. Sat 21 Nov all day — E",
    ].join("\n"),
  );
  expect(w.writes().length).toBe(3);
  expect(stored(w).map((each) => each["summary"])).toContain("B");
  expect(stored(w).map((each) => each["summary"])).not.toContain("C");
});

test("when the first insert fails nothing was created, and a failed write is not sent again", async () => {
  const w = started();
  w.calendar.failInsertAt.n = 1;
  const answer = await create(w, [LUNCH, CUP]);
  expect(answer).toStartWith("Not done: row 1 failed and nothing was created.");
  expect(answer).toContain("Not attempted (1):\n2. ");
  expect(w.writes().length).toBe(1);
});

// ---- calendar_delete_events ----

const remove = (w: ReturnType<typeof started>, ids: unknown, calendar = "Jimmy") =>
  w.call("calendar_delete_events", { calendar, event_ids: ids });

test("an unknown or already deleted id is refused with its row number, before any card", async () => {
  const w = started();
  const answer = await remove(w, ["padel1", "nope", "dentist1", "ghost"]);
  expect(answer).toStartWith("Not done:");
  expect(answer).toContain("row 2: the event 'nope' is not in the calendar 'Jimmy'");
  expect(answer).toContain("row 4: the event 'ghost' is not in the calendar 'Jimmy'");
  expect(answer).not.toContain("row 1:");
  stored(w).push({ id: "gone2", summary: "Gone", status: "cancelled" });
  expect(await remove(w, ["gone2"])).toContain("row 1: the event 'gone2' was already deleted");
  expect(await remove(w, ["gone1"], SCHOOL)).toContain("can only be read by the reader");
  expect(await remove(w, [])).toContain("the list is empty");
  expect(await remove(w, ["padel1", "padel1"])).toContain("row 2: the same id as row 1");
  expect(await remove(w, "padel1")).toContain("event_ids must be a list");
  expect(w.confirms).toEqual([]);
  expect(w.writes()).toEqual([]);
});

test("one card lists the events and says a recurring event goes as a whole series", async () => {
  const w = started();
  stored(w).push({
    id: "series1",
    summary: "Yoga",
    recurrence: ["RRULE:FREQ=WEEKLY"],
    start: { dateTime: "2026-11-12T07:00:00+01:00" },
    end: { dateTime: "2026-11-12T08:00:00+01:00" },
  });
  const answer = await remove(w, ["padel1", "series1", "dentist1"]);
  expect(w.confirms.length).toBe(1);
  expect(w.confirms[0]?.writesBefore).toBe(0);
  const spec = w.confirms[0]?.spec;
  expect(spec?.summary).toBe("Delete 3 events from your calendar 'Jimmy'");
  expect(spec?.content).toBe(
    [
      "Tue 10 Nov",
      "    17:50–19:15   Padel, Bromma Padel",
      "",
      "Wed 11 Nov",
      "    08:30–09:00   Dentist",
      "",
      "Thu 12 Nov",
      "    07:00–08:00   Yoga · weekly: the whole series goes",
    ].join("\n"),
  );
  expect(spec).not.toHaveProperty("events");
  expect(spec?.details).toContain(
    `DELETE https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events/series1`,
  );
  expect(answer).toBe(
    [
      "Deleted 3 events from the calendar 'Jimmy'.",
      "1. Tue 10 Nov 17:50–19:15 — Padel — id padel1",
      "2. Thu 12 Nov 07:00–08:00 — Yoga (whole series) — id series1",
      "3. Wed 11 Nov 08:30–09:00 — Dentist — id dentist1",
    ].join("\n"),
  );
  expect(w.writes().map((each) => each.method)).toEqual(["DELETE", "DELETE", "DELETE"]);
  expect(stored(w).map((each) => each["id"])).toEqual(["late1"]);
});

test("on a prifly with the agenda card the delete card carries the events, with series only on a recurring one", async () => {
  const w = started({ events: true });
  stored(w).push({
    id: "series1",
    summary: "Yoga",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
    start: { dateTime: "2026-11-12T07:00:00+01:00" },
    end: { dateTime: "2026-11-12T08:00:00+01:00" },
  });
  await remove(w, ["dentist1", "series1"]);
  const spec = w.confirms[0]?.spec as { events?: unknown; content?: string } | undefined;
  expect(spec?.events).toEqual({
    action: "delete",
    days: [
      { day: "Wed 11 Nov", events: [{ time: "08:30–09:00", title: "Dentist" }] },
      {
        day: "Thu 12 Nov",
        events: [{ time: "07:00–08:00", title: "Yoga", repeats: "Every Thursday", series: true }],
      },
    ],
  });
  expect(spec?.content).toContain("Yoga · every Thursday: the whole series goes");
});

test("a cancelled delete card deletes nothing", async () => {
  const w = started({ confirm: false });
  expect(await remove(w, ["padel1"])).toBe(CANCELLED);
  expect(w.writes()).toEqual([]);
  expect(stored(w).length).toBe(3);
});

test("when a delete fails part-way the answer names what was deleted, what failed and what was not tried", async () => {
  const w = started();
  w.calendar.failDelete.add("dentist1");
  const answer = await remove(w, ["padel1", "dentist1", "late1"]);
  expect(answer).toBe(
    [
      "Stopped part-way: 1 of 3 events was deleted, then row 2 failed. Do not send the deleted ones again.",
      "Deleted:",
      "1. Tue 10 Nov 17:50–19:15 — Padel — id padel1",
      "Failed: 2. Wed 11 Nov 08:30–09:00 — Dentist — id dentist1 — Google Calendar answered 500 for jimmy@example.com: backend error",
      "Not attempted (1):",
      "3. Fri 18 Dec 18:00–22:00 — Julbord — id late1",
    ].join("\n"),
  );
  expect(stored(w).map((each) => each["id"])).toEqual(["dentist1", "late1"]);
});
