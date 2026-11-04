/**
 * The whole Calendar API, for what the curated tools do not cover:
 * `calendar_api` makes any call below calendar/v3 with the reader's
 * connection (a GET at once, anything else only after the reader confirms the
 * request on a card), and `calendar_api_docs` reads Google's own reference to
 * find the call to make.
 */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import { CALENDAR_API, failureText } from "./calendar";
import { isRecord } from "./calendar-types";
import { describeWrite } from "./cards";
import { DISCOVERY_URL, docsText } from "./discovery";
import { type Args, confirmFirst, schema, text, withCalendar } from "./tool-kit";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_ANSWER = 30_000;

export type ApiToolsOptions = {
  /** Fetches the discovery document; replaced in tests. */
  fetch?: (url: string) => Promise<Response>;
};

/**
 * The path below calendar/v3, from what a session wrote: relative to it, or
 * the full URL of the Calendar API. Null for anything else: another host, a
 * `..`, a second `://`, a query or fragment in the path (the query goes in
 * `query`), an encoded dot, slash or backslash.
 */
export function calendarPath(given: string): string | null {
  let path = given.trim();
  if (path.startsWith(`${CALENDAR_API}/`)) path = path.slice(CALENDAR_API.length + 1);
  const outside = ["://", "..", "?", "#", "\\", "//", "%2e", "%2f", "%5c"].some((each) =>
    path.toLowerCase().includes(each),
  );
  const relative = path.replace(/^\//, "");
  if (outside || relative === "" || /\s/.test(relative)) return null;
  return `/${relative}`;
}

/** The query as URL parameters: each value a string, number or boolean, or a list of them. */
function queryString(query: unknown): string {
  if (!isRecord(query)) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (["string", "number", "boolean"].includes(typeof each)) params.append(key, String(each));
    }
  }
  const out = params.toString();
  return out === "" ? "" : `?${out}`;
}

function answerText(method: string, answer: string): string {
  if (answer.trim() === "") {
    return method === "GET" ? "Google Calendar answered with no content." : "Done.";
  }
  return answer.length > MAX_ANSWER
    ? `${answer.slice(0, MAX_ANSWER)}\n… (cut at ${MAX_ANSWER} characters: ask for less with \`fields\` or \`maxResults\`)`
    : answer;
}

async function callApi(getApi: () => ExtensionApi | null, args: Args): Promise<string> {
  const method = (text(args, "method") || "GET").toUpperCase();
  if (!METHODS.includes(method)) return `method must be one of ${METHODS.join(", ")}.`;
  const path = calendarPath(text(args, "path"));
  if (path === null) {
    return "path must be a path below calendar/v3, like /users/me/calendarList or /calendars/primary/events, or the full https://www.googleapis.com/calendar/v3/… URL, with the query in `query`.";
  }
  const target = `${path}${queryString(args["query"])}`;
  const body = args["body"];
  return await withCalendar(getApi(), args, async ({ api, client }) => {
    if (method !== "GET") {
      const shown = body === undefined ? "" : `\n\n${JSON.stringify(body, null, 2)}`;
      const sentence = await describeWrite(client, method, path, body);
      const refused = await confirmFirst(api, {
        title: "Google Calendar change",
        summary: sentence ?? `${method} ${target}`,
        details: `${method} ${CALENDAR_API}${target}${shown}`,
      });
      if (refused !== null) return refused;
    }
    const got = await client.request(method, target, method === "GET" ? undefined : body);
    return got.ok ? answerText(method, got.value) : failureText(got);
  });
}

export function apiTool(getApi: () => ExtensionApi | null): ExtensionTool {
  return {
    name: "calendar_api",
    description:
      "Calls any Google Calendar v3 REST method with the reader's account, for what the other calendar_ tools do not do (creating, changing and deleting events, quickAdd, free/busy, settings, single events…). See calendar_api_docs for the methods. `path` is relative to calendar/v3 (or the full https://www.googleapis.com/calendar/v3/… URL); nothing else is accepted. A GET runs at once; POST, PUT, PATCH and DELETE show the reader a plain-language confirm card first (for an event: what is created, updated or deleted, in which calendar) and run only on Confirm. Answers Google's JSON.",
    inputSchema: schema(
      {
        method: { type: "string", description: "GET (default), POST, PUT, PATCH or DELETE." },
        path: {
          type: "string",
          description:
            "Relative to calendar/v3, e.g. /calendars/primary/events or /calendars/{calendarId}/events/{eventId}.",
        },
        query: {
          type: "object",
          description: "Query parameters; a list repeats the parameter.",
          additionalProperties: true,
        },
        body: { type: "object", description: "The JSON request body.", additionalProperties: true },
      },
      ["path"],
    ),
    call: (args) => callApi(getApi, args),
  };
}

export function apiDocsTool(options: ApiToolsOptions): ExtensionTool {
  const fetchDocs = options.fetch ?? ((url: string) => fetch(url));
  let cached: unknown = null;
  const load = async (): Promise<unknown> => {
    if (cached !== null) return cached;
    const answer = await fetchDocs(DISCOVERY_URL);
    if (!answer.ok)
      throw new Error(`Google Calendar's discovery document answered ${answer.status}.`);
    cached = (await answer.json()) as unknown;
    return cached;
  };
  return {
    name: "calendar_api_docs",
    description:
      "Google Calendar's own API reference (v3), read from its discovery document. Without `method`: every method with its HTTP verb and path (relative to calendar/v3, as calendar_api takes it). With `method` (an id like `calendar.events.insert` or a part of one, like `freebusy`): the matching methods' parameters and request and response fields. Read-only. Read it before an unfamiliar calendar_api write.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "A method id or part of one; left out, the list." },
      },
      additionalProperties: false,
    },
    async call(args) {
      try {
        return docsText(await load(), text(args, "method"));
      } catch (error) {
        return `Could not read Google Calendar's API reference: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
