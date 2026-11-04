/**
 * Every MCP tool the extension serves, as `mcp__prifly__calendar_*`, and the
 * ones that only read: the reader's calendars, one calendar's events and the
 * agenda across calendars. Reads run at once; `calendar_api` (`api-tools.ts`)
 * waits for the reader's confirm before it changes anything. A failure comes
 * back as text, not as a throw.
 */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import { type ApiToolsOptions, apiDocsTool, apiTool } from "./api-tools";
import { type CalendarClient, failureText } from "./calendar";
import type { CalendarInfo } from "./calendar-types";
import {
  addDays,
  dayLabel,
  isDay,
  knownZone,
  localZone,
  mondayOf,
  startOfDay,
  todayIn,
} from "./dates";
import { type AgendaEntry, agendaText, eventLine } from "./render";
import { signInTool } from "./sign-in";
import { type Args, schema, strings, text, withCalendar } from "./tool-kit";

/** How many calendars are read at the same time for the agenda. */
const AGENDA_PARALLEL = 5;

const CUT_NOTE =
  "There are more events than were read (the earliest are shown): narrow the dates or add a `query`.";

function calendarLine(each: CalendarInfo): string {
  return `${each.id} | ${each.name}${each.primary ? " (primary)" : ""} | ${each.accessRole} | ${each.color}`;
}

function listTool(getApi: () => ExtensionApi | null): ExtensionTool {
  return {
    name: "calendar_list",
    description:
      "Lists the reader's calendars, the subscribed and imported ones too (a school's Infomentor calendar, holidays…), one per line: id | name | access role | colour. Hidden calendars are left out. Use an id with calendar_events. Read-only.",
    inputSchema: schema({}, []),
    call: (args) =>
      withCalendar(getApi(), args, async ({ client }) => {
        const got = await client.calendars();
        if (!got.ok) return failureText(got);
        return got.value.length === 0 ? "No calendars." : got.value.map(calendarLine).join("\n");
      }),
  };
}

/** The calendar a session meant: by id, `primary`, or its name (exactly, else a part of it). */
export function findCalendar(all: CalendarInfo[], wanted: string): CalendarInfo | null {
  const asked = wanted.trim().toLowerCase();
  if (asked === "primary") return all.find((each) => each.primary) ?? null;
  return (
    all.find((each) => each.id.toLowerCase() === asked) ??
    all.find((each) => each.name.toLowerCase() === asked) ??
    all.find((each) => each.name.toLowerCase().includes(asked)) ??
    null
  );
}

type Range = { from: string; to: string };

/** The `from` and `to` days of a call, each defaulted; a text answer when they are not dates. */
function rangeOf(args: Args, defaultTo: (from: string) => string, today: string) {
  const from = text(args, "from") || today;
  const to = text(args, "to") || defaultTo(from);
  if (!isDay(from) || !isDay(to)) return "from and to must be dates written like 2026-11-10.";
  if (from > to) return `from (${from}) is after to (${to}).`;
  return { from, to } satisfies Range;
}

const timeRange = (range: Range, zone: string) => ({
  timeMin: startOfDay(range.from, zone),
  timeMax: startOfDay(addDays(range.to, 1), zone),
});

function eventsTool(getApi: () => ExtensionApi | null, now: () => Date): ExtensionTool {
  return {
    name: "calendar_events",
    description:
      "Lists the events of one calendar in a date range, recurring events expanded, in start order: date, time or all day, title, location, who is invited and each event's id. Default: the next 14 days of the primary calendar. Read-only. To find a calendar's id, use calendar_list.",
    inputSchema: schema(
      {
        calendar: {
          type: "string",
          description: "A calendar's id from calendar_list (or its name). Default: primary.",
        },
        from: { type: "string", description: "First day, like 2026-11-10. Default: today." },
        to: {
          type: "string",
          description: "Last day, included. Default: 13 days after `from` (14 days).",
        },
        query: { type: "string", description: "Only events whose text matches this." },
      },
      [],
    ),
    call: (args) => withCalendar(getApi(), args, ({ client }) => eventsAnswer(client, args, now())),
  };
}

/** One calendar's events in the range, as the tool answers them. */
async function eventsAnswer(client: CalendarClient, args: Args, now: Date): Promise<string> {
  const all = await client.calendars();
  if (!all.ok) return failureText(all);
  const wanted = text(args, "calendar") || "primary";
  const info = findCalendar(all.value, wanted);
  const own = info?.timeZone || all.value.find((each) => each.primary)?.timeZone;
  const zone = knownZone(own || localZone());
  const range = rangeOf(args, (from) => addDays(from, 13), todayIn(zone, now));
  if (typeof range === "string") return range;
  const found = await client.events(info?.id ?? wanted, {
    ...timeRange(range, zone),
    q: text(args, "query"),
    timeZone: zone,
  });
  if (!found.ok) return failureText(found);
  const head = `Events in '${info?.name ?? wanted}', ${range.from} to ${range.to} (${zone}):`;
  if (found.value.events.length === 0) return `${head}\nNo events.`;
  const lines = found.value.events.map(eventLine);
  return [head, ...lines, ...(found.value.truncated ? [CUT_NOTE] : [])].join("\n");
}

/** The calendars the agenda covers, and what was asked for that no calendar matches. */
function chosenCalendars(all: CalendarInfo[], wanted: string[]) {
  if (wanted.length === 0) return { chosen: all, unknown: [] as string[] };
  const chosen: CalendarInfo[] = [];
  const unknown: string[] = [];
  for (const each of wanted) {
    const found = findCalendar(all, each);
    if (found === null) unknown.push(each);
    else if (!chosen.includes(found)) chosen.push(found);
  }
  return { chosen, unknown };
}

type Fetched = { calendar: CalendarInfo; got: Awaited<ReturnType<CalendarClient["events"]>> };

/** Every calendar's events, a few calendars at a time. */
async function fetchAll(
  client: CalendarClient,
  calendars: CalendarInfo[],
  query: Parameters<CalendarClient["events"]>[1],
): Promise<Fetched[]> {
  const out: Fetched[] = [];
  for (let at = 0; at < calendars.length; at += AGENDA_PARALLEL) {
    const chunk = calendars.slice(at, at + AGENDA_PARALLEL);
    out.push(
      ...(await Promise.all(
        chunk.map(async (calendar) => ({ calendar, got: await client.events(calendar.id, query) })),
      )),
    );
  }
  return out;
}

function agendaTool(getApi: () => ExtensionApi | null, now: () => Date): ExtensionTool {
  return {
    name: "calendar_agenda",
    description:
      "The agenda across the reader's calendars (the family's week): events of all calendars, or of the chosen ones, grouped by day, each line starting with its calendar's name. Default: this week, Monday to Sunday, in the primary calendar's time zone. A calendar that cannot be read is skipped and named. Read-only.",
    inputSchema: schema(
      {
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Calendar ids or names to include. Default: every calendar.",
        },
        from: { type: "string", description: "First day, like 2026-11-09. Default: this Monday." },
        to: {
          type: "string",
          description: "Last day, included. Default: the Sunday of that week.",
        },
      },
      [],
    ),
    call: (args) => withCalendar(getApi(), args, ({ client }) => agendaAnswer(client, args, now())),
  };
}

/** The agenda of the calendars asked for in the range, as the tool answers it. */
async function agendaAnswer(client: CalendarClient, args: Args, now: Date): Promise<string> {
  const all = await client.calendars();
  if (!all.ok) return failureText(all);
  const zone = knownZone(all.value.find((each) => each.primary)?.timeZone || localZone());
  const range = rangeOf(args, (from) => addDays(mondayOf(from), 6), mondayOf(todayIn(zone, now)));
  if (typeof range === "string") return range;
  const { chosen, unknown } = chosenCalendars(all.value, strings(args, "calendars"));
  if (chosen.length === 0) return `No calendar matches: ${unknown.join(", ")}.`;
  const fetched = await fetchAll(client, chosen, { ...timeRange(range, zone), timeZone: zone });
  const failed = fetched.flatMap((each) => (each.got.ok ? [] : [each]));
  const first = failed[0]?.got;
  if (failed.length === fetched.length && first !== undefined && !first.ok) {
    return failureText(first);
  }
  const read = fetched.flatMap(({ calendar, got }) => (got.ok ? [{ calendar, ...got.value }] : []));
  const entries: AgendaEntry[] = read.flatMap(({ calendar, events }) =>
    events.map((event) => ({ calendar: calendar.name, event })),
  );
  const body = agendaText(entries, range.from, range.to);
  const head = `Agenda ${dayLabel(range.from)} – ${dayLabel(range.to)} (${range.from} to ${range.to}, ${zone}):`;
  const notes = [
    ...(read.some((each) => each.truncated) ? [CUT_NOTE] : []),
    ...(failed.length > 0
      ? [`Could not read: ${failed.map((each) => each.calendar.name).join(", ")}.`]
      : []),
    ...(unknown.length > 0 ? [`No calendar matches: ${unknown.join(", ")}.`] : []),
  ];
  return [head, body === "" ? "No events." : body, ...notes].join("\n\n");
}

export type ToolsOptions = ApiToolsOptions & {
  /** Called after `calendar_sign_in`, to read the status line again. */
  onSignedIn?: () => void;
  /** The current time; replaced in tests. */
  now?: () => Date;
};

export function calendarTools(
  getApi: () => ExtensionApi | null,
  options: ToolsOptions = {},
): ExtensionTool[] {
  const now = options.now ?? (() => new Date());
  return [
    listTool(getApi),
    eventsTool(getApi, now),
    agendaTool(getApi, now),
    apiTool(getApi),
    apiDocsTool(options),
    signInTool(getApi, options.onSignedIn),
  ];
}
