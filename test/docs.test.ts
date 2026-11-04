import { expect, test } from "bun:test";
import { apiDocsTool } from "../api-tools";
import { DISCOVERY_URL, docsText } from "../discovery";

/** A small slice of Calendar's discovery document, shaped as the real one is. */
const DOCUMENT = {
  resources: {
    calendarList: {
      methods: {
        list: {
          id: "calendar.calendarList.list",
          httpMethod: "GET",
          path: "users/me/calendarList",
          description: "Returns the calendars on the user's calendar list.",
          parameters: {
            showHidden: { location: "query", type: "boolean", description: "Hidden ones too." },
          },
          response: { $ref: "CalendarList" },
        },
      },
    },
    events: {
      methods: {
        insert: {
          id: "calendar.events.insert",
          httpMethod: "POST",
          path: "calendars/{calendarId}/events",
          description: "Creates an event.",
          parameters: { calendarId: { location: "path", type: "string", required: true } },
          request: { $ref: "Event" },
          response: { $ref: "Event" },
        },
      },
    },
  },
  schemas: {
    CalendarList: {
      properties: { items: { type: "array", items: { $ref: "CalendarListEntry" } } },
    },
    CalendarListEntry: { properties: { summary: { type: "string" } } },
    Event: {
      properties: {
        summary: { type: "string", description: "Title of the event." },
        start: { $ref: "EventDateTime" },
      },
    },
    EventDateTime: { properties: { dateTime: { type: "string", format: "date-time" } } },
  },
};

test("without a method the docs list every method with its path below calendar/v3", () => {
  expect(docsText(DOCUMENT, "")).toBe(
    [
      "Google Calendar API methods (paths are relative to calendar/v3, as calendar_api takes them):",
      "calendar.calendarList.list | GET /users/me/calendarList",
      "calendar.events.insert | POST /calendars/{calendarId}/events",
    ].join("\n"),
  );
});

test("a method shows its parameters and its request and response fields", () => {
  const insert = docsText(DOCUMENT, "events.insert");
  expect(insert).toContain("## calendar.events.insert\nPOST /calendars/{calendarId}/events");
  expect(insert).toContain("- calendarId (string, in the path, required)");
  expect(insert).toContain("Request body: Event");
  expect(insert).toContain("  summary: string — Title of the event.");
  expect(insert).toContain("  start: EventDateTime\n    dateTime: string (date-time)");
  const list = docsText(DOCUMENT, "calendar.calendarList.list");
  expect(list).toContain("- showHidden (boolean, query): Hidden ones too.");
  expect(list).not.toContain("events.insert");
  expect(docsText(DOCUMENT, "freebusy")).toContain("No Google Calendar API method matches");
});

test("calendar_api_docs reads the discovery document once and says when it cannot", async () => {
  expect(DISCOVERY_URL).toBe("https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest");
  const asked: string[] = [];
  const tool = apiDocsTool({
    fetch: async (url) => {
      asked.push(url);
      return Response.json(DOCUMENT);
    },
  });
  const ctx = {} as Parameters<typeof tool.call>[1];
  expect(await tool.call({ method: "insert" }, ctx)).toContain(
    "POST /calendars/{calendarId}/events",
  );
  expect(await tool.call({}, ctx)).toContain(
    "calendar.calendarList.list | GET /users/me/calendarList",
  );
  expect(asked).toEqual([DISCOVERY_URL]);
  const broken = apiDocsTool({ fetch: async () => new Response("down", { status: 503 }) });
  expect(await broken.call({}, ctx)).toBe(
    "Could not read Google Calendar's API reference: Google Calendar's discovery document answered 503.",
  );
});
