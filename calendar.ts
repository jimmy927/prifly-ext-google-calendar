/**
 * A small Google Calendar REST client over `api.connections.fetch`: prifly
 * adds the token, so none is kept here. Every method answers a value or a
 * typed failure (the grant ended, or Google answered an error status) and
 * never throws for those. `request` with a method other than GET is only
 * called by `calendar_api` after the reader confirmed.
 */

import type { ExtensionConnectionsApi } from "@prifly/extension-api";
import {
  type CalendarEvent,
  type CalendarInfo,
  isRecord,
  list,
  parseCalendar,
  parseEvent,
  str,
} from "./calendar-types";
import { httpText, signInText } from "./connection";

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarFailure =
  | { ok: false; kind: "sign-in"; account: string }
  | { ok: false; kind: "http"; account: string; status: number; body: string };

export type CalendarResult<T> = { ok: true; value: T } | CalendarFailure;

/** The tool text for a failure. */
export function failureText(failure: CalendarFailure): string {
  return failure.kind === "sign-in"
    ? signInText(failure.account)
    : httpText(failure.status, failure.account, failure.body);
}

/** What `events` asks for: a time range, an optional text filter and the zone times come back in. */
export type EventsQuery = {
  /** RFC 3339 times with an offset: events ending after `timeMin` and starting before `timeMax`. */
  timeMin: string;
  timeMax: string;
  q?: string;
  timeZone: string;
};

export type EventsFound = {
  events: CalendarEvent[];
  /** Whether there were more pages than the client follows. */
  truncated: boolean;
};

export type CalendarClient = {
  /** The reader's calendar list, subscribed and imported calendars included, every page. */
  calendars(): Promise<CalendarResult<CalendarInfo[]>>;
  /** The events of one calendar in a range, recurring ones expanded, in start order. */
  events(calendarId: string, query: EventsQuery): Promise<CalendarResult<EventsFound>>;
  /** One event's title, for a card; "" when it cannot be read. */
  eventTitle(calendarId: string, eventId: string): Promise<string>;
  /** Any call below calendar/v3: `path` starts with "/" and may carry a query. Answers the body as text. */
  request(method: string, path: string, body?: unknown): Promise<CalendarResult<string>>;
};

export type CalendarClientOptions = {
  connections: ExtensionConnectionsApi;
  connection: string;
  account: string;
  /** Waits `ms`; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_STATUSES = [429, 503];
const MAX_WAIT_SECONDS = 30;
const PAGE_SIZE = 250;
/** Pages of events followed for one calendar: 4 × 250 events is more than anyone reads. */
export const MAX_EVENT_PAGES = 4;
const MAX_CALENDAR_PAGES = 10;

function retryWait(response: Response): number {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_WAIT_SECONDS) : 1;
}

export function calendarClient(options: CalendarClientOptions): CalendarClient {
  const { connections, connection, account } = options;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  async function send(url: string, init?: RequestInit): Promise<CalendarResult<Response>> {
    for (let attempt = 0; ; attempt++) {
      // A Request carries its method and body, whatever `fetch` does with its options.
      const answer = await connections.fetch(connection, new Request(url, init));
      if ("needsSignIn" in answer) return { ok: false, kind: "sign-in", account };
      // Only a read is sent again: a write that Google applied before answering 503 must not repeat.
      const isRead = (init?.method ?? "GET") === "GET";
      if (RETRY_STATUSES.includes(answer.status) && attempt === 0 && isRead) {
        await answer.text();
        await sleep(retryWait(answer) * 1000);
        continue;
      }
      if (answer.ok) return { ok: true, value: answer };
      const body = await answer.text();
      return { ok: false, kind: "http", account, status: answer.status, body };
    }
  }

  async function json(path: string): Promise<CalendarResult<Record<string, unknown>>> {
    const sent = await send(`${CALENDAR_API}${path}`);
    if (!sent.ok) return sent;
    const text = await sent.value.text();
    try {
      const value: unknown = text === "" ? {} : JSON.parse(text);
      return { ok: true, value: isRecord(value) ? value : {} };
    } catch {
      return { ok: false, kind: "http", account, status: sent.value.status, body: text };
    }
  }

  /** Every page of a list call, up to `maxPages`; `read` takes the page's items out of its answer. */
  async function pages<T>(
    path: string,
    params: URLSearchParams,
    maxPages: number,
    read: (item: unknown) => T | null,
  ): Promise<CalendarResult<{ items: T[]; truncated: boolean }>> {
    const items: T[] = [];
    let token = "";
    for (let page = 0; page < maxPages; page++) {
      const next = new URLSearchParams(params);
      if (token !== "") next.set("pageToken", token);
      const got = await json(`${path}?${next}`);
      if (!got.ok) return got;
      items.push(...list(got.value["items"]).flatMap((item) => read(item) ?? []));
      token = str(got.value["nextPageToken"]);
      if (token === "") return { ok: true, value: { items, truncated: false } };
    }
    return { ok: true, value: { items, truncated: true } };
  }

  return {
    async calendars() {
      const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
      const got = await pages("/users/me/calendarList", params, MAX_CALENDAR_PAGES, parseCalendar);
      return got.ok ? { ok: true, value: got.value.items } : got;
    },

    async events(calendarId, query) {
      const params = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: query.timeMin,
        timeMax: query.timeMax,
        timeZone: query.timeZone,
        maxResults: String(PAGE_SIZE),
      });
      if (query.q !== undefined && query.q !== "") params.set("q", query.q);
      const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
      const got = await pages(path, params, MAX_EVENT_PAGES, parseEvent);
      return got.ok
        ? { ok: true, value: { events: got.value.items, truncated: got.value.truncated } }
        : got;
    },

    async eventTitle(calendarId, eventId) {
      const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      const got = await json(path);
      return got.ok ? str(got.value["summary"]) : "";
    },

    async request(method, path, payload) {
      const init: RequestInit =
        payload === undefined
          ? { method }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            };
      const sent = await send(`${CALENDAR_API}${path}`, init);
      return sent.ok ? { ok: true, value: await sent.value.text() } : sent;
    },
  };
}
