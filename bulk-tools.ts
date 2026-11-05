/**
 * The bulk tools: `calendar_create_events` adds up to 50 events and
 * `calendar_delete_events` removes up to 50, each behind ONE confirm card
 * instead of one card per event. The whole request is checked before the
 * card (a wrong row is named by its number and no card is shown); on Confirm
 * the events are written one at a time with the plain events.insert and
 * events.delete calls. If one fails the rest are not attempted, and the answer
 * says exactly which were done, so the session never sends those again. A
 * write is never retried.
 */

import type { ConfirmSpec, ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import { addAgenda, deleteAgenda } from "./bulk-agenda";
import { checkEvents, eventBody, MAX_EVENTS, type NewEvent, rowText } from "./bulk-events";
import {
  CALENDAR_API,
  type CalendarClient,
  type CalendarFailure,
  type CalendarResult,
  failureText,
} from "./calendar";
import { type CalendarInfo, type EventDetail, findCalendar, isRecord, str } from "./calendar-types";
import { knownZone, localZone } from "./dates";
import { whenText } from "./render";
import { type Args, confirmFirst, schema, text, withCalendar } from "./tool-kit";

const events = (count: number): string => `${count} event${count === 1 ? "" : "s"}`;

/** The answer for a call that is wrong before any card: every problem, and that nothing was done. */
function refusal(problems: string[]): string {
  return [
    "Not done: nothing was changed and no card was shown. Fix these and call again:",
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");
}

/** The calendar a call names, or why it cannot be written to. */
function targetCalendar(all: CalendarInfo[], wanted: string): CalendarInfo | string {
  if (wanted === "") return "calendar is missing: give a calendar's id or name (see calendar_list)";
  const info = findCalendar(all, wanted);
  if (info === null) {
    return `calendar '${wanted}' is none of the reader's calendars (see calendar_list)`;
  }
  if (info.accessRole !== "owner" && info.accessRole !== "writer") {
    return `calendar '${info.name}' can only be read by the reader (${info.accessRole}), not changed`;
  }
  return info;
}

/** The zone events without their own use: the calendar's, else the primary one's. */
function zoneOf(all: CalendarInfo[], calendar: CalendarInfo): string {
  const primary = all.find((each) => each.primary)?.timeZone;
  return knownZone(calendar.timeZone || primary || localZone());
}

const eventsPath = (calendarId: string): string =>
  `/calendars/${encodeURIComponent(calendarId)}/events`;

/** How far a one-by-one write got: what each finished item added to its line, and the failure that stopped it. */
type Progress = { details: string[]; failure: CalendarFailure | null };

/** Runs `run` on each item in turn and stops at the first failure: nothing after it is attempted. */
async function oneByOne<T>(
  items: T[],
  run: (item: T) => Promise<CalendarResult<string>>,
): Promise<Progress> {
  const details: string[] = [];
  for (const item of items) {
    const got = await run(item);
    if (!got.ok) return { details, failure: got };
    details.push(got.value);
  }
  return { details, failure: null };
}

type Report = {
  past: "created" | "deleted";
  preposition: "in" | "from";
  calendar: string;
  /** One line for each item, in order, without its number. */
  lines: string[];
  progress: Progress;
};

/** What happened, item by item: all done, or exactly which were done, which failed and which were not tried. */
function reportText(report: Report): string {
  const { past, lines, progress } = report;
  const { details, failure } = progress;
  const line = (at: number, extra = ""): string => `${at + 1}. ${lines[at] ?? ""}${extra}`;
  const cap = past.charAt(0).toUpperCase() + past.slice(1);
  if (failure === null) {
    const head = `${cap} ${events(lines.length)} ${report.preposition} the calendar '${report.calendar}'.`;
    return [head, ...details.map((extra, at) => line(at, extra))].join("\n");
  }
  const at = details.length;
  const rest = lines.slice(at + 1).map((_, offset) => line(at + 1 + offset));
  const head =
    at === 0
      ? `Not done: row 1 failed and nothing was ${past}.`
      : `Stopped part-way: ${at} of ${events(lines.length)} ${at === 1 ? "was" : "were"} ${past}, then row ${at + 1} failed. Do not send the ${past} ones again.`;
  return [
    head,
    ...(at === 0 ? [] : [`${cap}:`, ...details.map((extra, row) => line(row, extra))]),
    `Failed: ${line(at)} — ${failureText(failure)}`,
    ...(rest.length === 0
      ? ["Not attempted: none."]
      : [`Not attempted (${rest.length}):`, ...rest]),
  ].join("\n");
}

// ---- calendar_create_events ----

type Plan = { calendar: CalendarInfo; zone: string; events: NewEvent[] };

function createCard(plan: Plan): ConfirmSpec {
  const { calendar, zone } = plan;
  const bodies = plan.events.map((event) => eventBody(event, zone));
  return {
    title: "Add events to a Google calendar",
    summary: `Add ${events(plan.events.length)} to your calendar '${calendar.name}'`,
    content: addAgenda(plan.events).content,
    details: `POST ${CALENDAR_API}${eventsPath(calendar.id)}, once for each of the ${events(bodies.length)}:\n\n${JSON.stringify(bodies, null, 2)}`,
  };
}

/** " — id new1 — https://…" of a created event, from Google's answer. */
function createdDetail(answer: string): string {
  let created: unknown = null;
  try {
    created = JSON.parse(answer);
  } catch {
    // Google's answer was not JSON: the event is made, only its id is unknown.
  }
  const each = isRecord(created) ? created : {};
  const id = str(each["id"]);
  const link = str(each["htmlLink"]);
  return `${id === "" ? "" : ` — id ${id}`}${link === "" ? "" : ` — ${link}`}`;
}

async function insertAll(client: CalendarClient, plan: Plan): Promise<string> {
  const path = eventsPath(plan.calendar.id);
  const progress = await oneByOne(plan.events, async (event) => {
    const got = await client.request("POST", path, eventBody(event, plan.zone));
    return got.ok ? { ok: true, value: createdDetail(got.value) } : got;
  });
  return reportText({
    past: "created",
    preposition: "in",
    calendar: plan.calendar.name,
    lines: plan.events.map((event) => rowText(event, plan.zone)),
    progress,
  });
}

async function createAnswer(api: ExtensionApi, client: CalendarClient, args: Args) {
  const all = await client.calendars();
  if (!all.ok) return failureText(all);
  const target = targetCalendar(all.value, text(args, "calendar"));
  const checked = checkEvents(args["events"]);
  if (typeof target === "string" || "errors" in checked) {
    return refusal([
      ...(typeof target === "string" ? [target] : []),
      ...("errors" in checked ? checked.errors : []),
    ]);
  }
  const plan = { calendar: target, zone: zoneOf(all.value, target), events: checked.events };
  const refused = await confirmFirst(api, createCard(plan), addAgenda(plan.events).events);
  return refused ?? (await insertAll(client, plan));
}

const EVENT_PROPERTIES = {
  summary: { type: "string", description: "The event's title." },
  start: {
    type: "string",
    description:
      "Timed event: the start, like 2026-11-10T17:50 (or with an offset, 2026-11-10T17:50:00+01:00).",
  },
  end: { type: "string", description: "Timed event: the end, in the same form; after the start." },
  timeZone: {
    type: "string",
    description: "Timed event: an IANA time zone like Europe/Stockholm. Default: the calendar's.",
  },
  date: { type: "string", description: "All-day event: its first day, like 2026-11-21." },
  end_date: {
    type: "string",
    description:
      "All-day event: its LAST day, included (the day the reader means), like 2026-11-23. Left out: a one-day event. Converted to Google's exclusive end (the day after) for you; do not add a day yourself.",
  },
  location: { type: "string", description: "Where." },
  description: { type: "string", description: "The event's notes." },
  recurrence: {
    type: "array",
    items: { type: "string" },
    description:
      "iCalendar lines such as RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261220 or EXDATE:20261129.",
  },
};

export function createEventsTool(getApi: () => ExtensionApi | null): ExtensionTool {
  return {
    name: "calendar_create_events",
    description: `Adds 1 to ${MAX_EVENTS} events to one calendar behind ONE confirm card (use this, not many calendar_api POSTs, for a plan with several events). \`calendar\` is a calendar's id or name from calendar_list, or primary. Each event has a \`summary\` and either \`start\` and \`end\` date-times (optional \`timeZone\`, default the calendar's) or an all-day \`date\` with an optional \`end_date\`, the INCLUSIVE last day the reader means (it is converted to Google's exclusive end for you); optional \`location\`, \`description\` and \`recurrence\` (RRULE/EXDATE lines). The whole list is checked first: any wrong row is named by its 1-based number, with no card and nothing written. The reader sees the events on one card as an agenda grouped by day. To change the list the reader writes in the card's feedback box, and you then call this tool again with the corrected list. On Confirm the events are inserted one at a time; the answer lists each with its title, when, id and htmlLink. If one fails, the rest are not attempted and the answer says which rows were created (with ids) and which were not: never send the created ones again. Cancelled answers "Not done: you cancelled".`,
    inputSchema: schema(
      {
        calendar: {
          type: "string",
          description: "A calendar's id or name (see calendar_list), or primary.",
        },
        events: {
          type: "array",
          minItems: 1,
          maxItems: MAX_EVENTS,
          items: {
            type: "object",
            properties: EVENT_PROPERTIES,
            required: ["summary"],
            additionalProperties: false,
          },
          description: `The events to add, 1 to ${MAX_EVENTS}.`,
        },
      },
      ["calendar", "events"],
    ),
    call: (args) =>
      withCalendar(getApi(), args, ({ api, client }) => createAnswer(api, client, args)),
  };
}

// ---- calendar_delete_events ----

/** The event ids of a call, or every problem with the list. */
function idsOf(given: unknown): { ids: string[] } | { errors: string[] } {
  if (!Array.isArray(given))
    return { errors: [`event_ids must be a list of 1 to ${MAX_EVENTS} ids`] };
  const errors: string[] = [];
  if (given.length === 0) errors.push(`the list is empty: give 1 to ${MAX_EVENTS} event ids`);
  if (given.length > MAX_EVENTS) {
    errors.push(`${given.length} ids is too many: at most ${MAX_EVENTS} at a time`);
  }
  const ids = given.map((id) => (typeof id === "string" ? id.trim() : ""));
  ids.forEach((id, at) => {
    if (id === "") errors.push(`row ${at + 1}: the id is missing or not text`);
    else if (ids.indexOf(id) !== at)
      errors.push(`row ${at + 1}: the same id as row ${ids.indexOf(id) + 1}`);
  });
  return errors.length > 0 ? { errors } : { ids };
}

type Found = { found: EventDetail[] } | { errors: string[] } | { failure: CalendarFailure };

/** Reads every event the call names: the ones that do not exist are all named, any other failure stops it. */
async function findAll(
  client: CalendarClient,
  calendar: CalendarInfo,
  ids: string[],
): Promise<Found> {
  const found: EventDetail[] = [];
  const errors: string[] = [];
  for (const [at, id] of ids.entries()) {
    const got = await client.event(calendar.id, id);
    const missing = !got.ok && got.kind === "http" && (got.status === 404 || got.status === 410);
    if (got.ok && got.value !== null) found.push(got.value);
    else if (got.ok || missing) {
      const why = got.ok ? "was already deleted" : `is not in the calendar '${calendar.name}'`;
      errors.push(`row ${at + 1}: the event '${id}' ${why}`);
    } else return { failure: got };
  }
  return errors.length > 0 ? { errors } : { found };
}

const SERIES_NOTE = { "": "", master: " (whole series)", occurrence: " (one date of a series)" };

/** A row on the delete card: "Tue 10 Nov 17:50–19:15 — Padel (whole series)". */
function deleteRow(detail: EventDetail): string {
  return `${whenText(detail.event)} — ${detail.event.title.replace(/\s+/g, " ")}${SERIES_NOTE[detail.series]}`;
}

function deleteCard(calendar: CalendarInfo, found: EventDetail[]): ConfirmSpec {
  const path = eventsPath(calendar.id);
  return {
    title: "Delete events from a Google calendar",
    summary: `Delete ${events(found.length)} from your calendar '${calendar.name}'`,
    content: deleteAgenda(found).content,
    details: found
      .map((detail) => `DELETE ${CALENDAR_API}${path}/${encodeURIComponent(detail.event.id)}`)
      .join("\n"),
  };
}

async function deleteAll(client: CalendarClient, calendar: CalendarInfo, found: EventDetail[]) {
  const path = eventsPath(calendar.id);
  const progress = await oneByOne(found, async (detail) => {
    const got = await client.request("DELETE", `${path}/${encodeURIComponent(detail.event.id)}`);
    return got.ok ? { ok: true, value: "" } : got;
  });
  return reportText({
    past: "deleted",
    preposition: "from",
    calendar: calendar.name,
    lines: found.map((detail) => `${deleteRow(detail)} — id ${detail.event.id}`),
    progress,
  });
}

async function deleteAnswer(api: ExtensionApi, client: CalendarClient, args: Args) {
  const all = await client.calendars();
  if (!all.ok) return failureText(all);
  const target = targetCalendar(all.value, text(args, "calendar"));
  const asked = idsOf(args["event_ids"]);
  if (typeof target === "string" || "errors" in asked) {
    return refusal([
      ...(typeof target === "string" ? [target] : []),
      ...("errors" in asked ? asked.errors : []),
    ]);
  }
  const read = await findAll(client, target, asked.ids);
  if ("failure" in read) return failureText(read.failure);
  if ("errors" in read) return refusal(read.errors);
  const refused = await confirmFirst(
    api,
    deleteCard(target, read.found),
    deleteAgenda(read.found).events,
  );
  return refused ?? (await deleteAll(client, target, read.found));
}

export function deleteEventsTool(getApi: () => ExtensionApi | null): ExtensionTool {
  return {
    name: "calendar_delete_events",
    description: `Deletes 1 to ${MAX_EVENTS} events from one calendar behind ONE confirm card (use this, not many calendar_api DELETEs). \`calendar\` is a calendar's id or name from calendar_list, or primary; \`event_ids\` are the ids calendar_events shows. Every event is read first: an unknown id is named by its 1-based number, with no card and nothing deleted. The card is an agenda grouped by day. A recurring event's id deletes the WHOLE SERIES, and its line says so. On Confirm the events are deleted one at a time; if one fails the rest are not attempted and the answer says which were deleted and which were not (do not send the deleted ones again). Cancelled answers "Not done: you cancelled".`,
    inputSchema: schema(
      {
        calendar: {
          type: "string",
          description: "A calendar's id or name (see calendar_list), or primary.",
        },
        event_ids: {
          type: "array",
          minItems: 1,
          maxItems: MAX_EVENTS,
          items: { type: "string" },
          description: `The ids of the events to delete, 1 to ${MAX_EVENTS}.`,
        },
      },
      ["calendar", "event_ids"],
    ),
    call: (args) =>
      withCalendar(getApi(), args, ({ api, client }) => deleteAnswer(api, client, args)),
  };
}
