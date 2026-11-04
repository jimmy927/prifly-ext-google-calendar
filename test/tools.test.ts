import { afterEach, expect, setSystemTime, test } from "bun:test";
import { FOOTBALL, SCHOOL } from "./fake-calendar";
import { world } from "./world";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  setSystemTime();
});

function started(options: Parameters<typeof world>[0] = {}) {
  const w = world(options);
  stop = w.stop;
  return w;
}

const WEEK = { from: "2026-11-09", to: "2026-11-15" };

test("calendar_list lists every calendar over its pages, subscribed ones too, hidden ones not", async () => {
  const w = started();
  expect(await w.call("calendar_list", {})).toBe(
    [
      "jimmy@example.com | Jimmy (primary) | owner | #9fe1e7",
      `${SCHOOL} | Klass 4B (Infomentor) | reader | #f83a22`,
      `${FOOTBALL} | Fotboll P12 | writer | #16a765`,
      "broken@group.calendar.google.com | Trasig | reader | #000000",
    ].join("\n"),
  );
  const urls = w.calendar.calendarLists;
  expect(urls.some((url) => url.searchParams.get("pageToken") === "2")).toBe(true);
  expect(urls.every((url) => url.searchParams.get("showHidden") === null)).toBe(true);
  expect(w.confirms).toEqual([]);
});

test("calendar_events renders timed events with place and who, and the id of each", async () => {
  const w = started();
  expect(await w.call("calendar_events", WEEK)).toBe(
    [
      "Events in 'Jimmy', 2026-11-09 to 2026-11-15 (Europe/Stockholm):",
      "- Tue 10 Nov 17:50–19:15 — Padel (Bromma Padel) — who: Ada, bob@example.com — id: padel1",
      "- Wed 11 Nov 08:30–09:00 — Dentist — id: dentist1",
    ].join("\n"),
  );
});

test("calendar_events tells all-day events from timed ones, and follows nextPageToken", async () => {
  const w = started();
  w.calendar.pageSize.value = 1;
  const answer = await w.call("calendar_events", { calendar: SCHOOL, ...WEEK });
  expect(answer).toBe(
    [
      "Events in 'Klass 4B (Infomentor)', 2026-11-09 to 2026-11-15 (Europe/Stockholm):",
      "- Tue 10 Nov 18:00–19:00 — Föräldramöte — id: parents1",
      "- Wed 11 Nov all day — Studiedag — id: study1",
      "- Thu 12 Nov – Sat 14 Nov all day — Temavecka — id: theme1",
    ].join("\n"),
  );
  const asked = w.calendar.eventLists.map((url) => url.searchParams.get("pageToken"));
  expect(asked).toEqual([null, "1", "2", "3"]);
  const first = w.calendar.eventLists[0];
  expect(first?.searchParams.get("singleEvents")).toBe("true");
  expect(first?.searchParams.get("orderBy")).toBe("startTime");
  expect(first?.searchParams.get("timeMin")).toBe("2026-11-09T00:00:00+01:00");
  expect(first?.searchParams.get("timeMax")).toBe("2026-11-16T00:00:00+01:00");
});

test("calendar_events takes a calendar by its name, and a text filter", async () => {
  const w = started();
  const answer = await w.call("calendar_events", { calendar: "fotboll", query: "match", ...WEEK });
  expect(answer).toContain("Events in 'Fotboll P12'");
  expect(answer).toContain("- Sat 14 Nov 10:00–12:00 — Match (Kristineberg IP) — id: match1");
  expect(answer).not.toContain("Träning");
  expect(w.calendar.eventLists[0]?.searchParams.get("q")).toBe("match");
});

test("calendar_events defaults to the next 14 days of the primary calendar", async () => {
  setSystemTime(new Date("2026-11-05T12:00:00Z"));
  const w = started();
  const answer = await w.call("calendar_events", {});
  const url = w.calendar.eventLists[0];
  expect(url?.pathname).toBe("/calendar/v3/calendars/jimmy%40example.com/events");
  expect(url?.searchParams.get("timeMin")).toBe("2026-11-05T00:00:00+01:00");
  expect(url?.searchParams.get("timeMax")).toBe("2026-11-19T00:00:00+01:00");
  expect(answer).toContain("2026-11-05 to 2026-11-18");
  expect(answer).toContain("Padel");
  expect(answer).not.toContain("Julbord");
});

test("calendar_events says so when there are none, and when the dates are wrong", async () => {
  const w = started();
  expect(await w.call("calendar_events", { from: "2026-01-05", to: "2026-01-06" })).toBe(
    "Events in 'Jimmy', 2026-01-05 to 2026-01-06 (Europe/Stockholm):\nNo events.",
  );
  expect(await w.call("calendar_events", { from: "next week" })).toContain("must be dates");
  expect(await w.call("calendar_events", { from: "2026-11-10", to: "2026-11-09" })).toContain(
    "is after to",
  );
});

test("calendar_events stops at a sane number of pages and says there were more", async () => {
  const w = started();
  w.calendar.pageSize.value = 1;
  const many = Array.from({ length: 7 }, (_, index) => ({
    id: `many${index}`,
    summary: `Pass ${index}`,
    start: { dateTime: `2026-11-1${index}T10:00:00+01:00` },
    end: { dateTime: `2026-11-1${index}T11:00:00+01:00` },
  }));
  w.calendar.events.get(FOOTBALL)?.splice(0, 2, ...many);
  const answer = await w.call("calendar_events", {
    calendar: FOOTBALL,
    from: "2026-11-10",
    to: "2026-11-19",
  });
  expect(answer.match(/id: many/g)?.length).toBe(4);
  expect(answer).toContain("There are more events than were read");
});

test("a grant without the calendar scope answers with the way to fix it", async () => {
  const w = started();
  w.calendar.noScope.on = true;
  const answer = await w.call("calendar_events", WEEK);
  expect(answer).toContain("Google Calendar answered 403");
  expect(answer).toContain("run calendar_sign_in");
});

test("calendar_agenda groups every calendar's week by day, each line led by its calendar", async () => {
  setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const w = started();
  expect(await w.call("calendar_agenda", {})).toBe(
    [
      "Agenda Mon 9 Nov – Sun 15 Nov (2026-11-09 to 2026-11-15, Europe/Stockholm):",
      [
        "## Tue 10 Nov",
        "- [Fotboll P12] 16:00–17:00 Träning — id: train1",
        "- [Jimmy] 17:50–19:15 Padel (Bromma Padel) — who: Ada, bob@example.com — id: padel1",
        "- [Klass 4B (Infomentor)] 18:00–19:00 Föräldramöte — id: parents1",
      ].join("\n"),
      [
        "## Wed 11 Nov",
        "- [Klass 4B (Infomentor)] all day Studiedag — id: study1",
        "- [Jimmy] 08:30–09:00 Dentist — id: dentist1",
      ].join("\n"),
      "## Thu 12 Nov\n- [Klass 4B (Infomentor)] all day Temavecka — id: theme1",
      "## Fri 13 Nov\n- [Klass 4B (Infomentor)] all day Temavecka — id: theme1",
      [
        "## Sat 14 Nov",
        "- [Klass 4B (Infomentor)] all day Temavecka — id: theme1",
        "- [Fotboll P12] 10:00–12:00 Match (Kristineberg IP) — id: match1",
      ].join("\n"),
    ].join("\n\n"),
  );
});

test("calendar_agenda takes chosen calendars by id or name, and names what matched nothing", async () => {
  const w = started();
  const answer = await w.call("calendar_agenda", {
    calendars: [SCHOOL, "jimmy", "Nope"],
    ...WEEK,
  });
  expect(answer).toContain("[Jimmy] 17:50–19:15 Padel");
  expect(answer).toContain("[Klass 4B (Infomentor)] all day Studiedag");
  expect(answer).not.toContain("Fotboll");
  expect(answer).toEndWith("No calendar matches: Nope.");
  expect(await w.call("calendar_agenda", { calendars: ["Nope"], ...WEEK })).toBe(
    "No calendar matches: Nope.",
  );
});

test("calendar_agenda skips a calendar it cannot read and says which", async () => {
  const w = started();
  w.calendar.forbidden.add(FOOTBALL);
  const answer = await w.call("calendar_agenda", WEEK);
  expect(answer).toContain("[Jimmy] 17:50–19:15 Padel");
  expect(answer).not.toContain("Träning");
  expect(answer).toEndWith("Could not read: Fotboll P12.");
});

test("calendar_agenda says when nothing is on, and when no calendar could be read", async () => {
  const w = started();
  expect(await w.call("calendar_agenda", { from: "2026-01-05", to: "2026-01-11" })).toEndWith(
    "No events.",
  );
  w.calendar.noScope.on = true;
  expect(await w.call("calendar_agenda", WEEK)).toContain("run calendar_sign_in");
});
