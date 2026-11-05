# prifly-ext-google-calendar

A prifly extension that gives every Claude session tools to list your
calendars, read their events and see the family's week, and to create, change
and delete events, through your Google account. Reading runs at once. Every
change to a calendar first shows you a confirm card in plain words ("Create
event 'Padel' on Tue 10 Nov 17:50–19:15 in calendar 'Jimmy'") with the exact
request under it, and only happens when you confirm. Cancel, and the tool
answers "Not done: you cancelled" and nothing is written.

There is no UI besides that: no launcher, no chips. Settings → Extensions
shows one status line, read at start and every 15 minutes: "Connected as
ada@example.com · 4 calendars", or what is wrong with the sign-in.

## What it needs

A prifly with `api.confirm` and `api.status` (extension API v0.6.0; on an
older prifly every write answers that it cannot ask, and nothing is written),
and a Google connection in prifly's Vault → Connections with these scopes:

- `https://www.googleapis.com/auth/calendar.readonly` (read the calendar list and events)
- `https://www.googleapis.com/auth/calendar.events` (create, change and delete events)

Both were checked against Google's Calendar API reference: `calendarList.list`
takes `calendar.readonly` (`calendar.events` alone is not enough for it),
`events.list` takes either, and `events.insert` takes `calendar.events`. A
connection that lacks one makes a tool answer 403 with the way to fix it, and
`calendar_sign_in` (ask any session to sign in to Google Calendar) asks you to
approve the scopes once.

Your own Google client works. Its Google project must have the Google Calendar
API enabled and be In production, otherwise Google ends the grant every 7 days
and you sign in again.

prifly holds the token and adds it to each request, so the extension never
keeps one.

## The tools

Each takes an optional `account` (the Google account's email, when several are
connected). Without it the extension uses the `account` setting, else the first
connected Google account.

Reads, at once:

| Tool | What it does |
|---|---|
| `calendar_list` | Every calendar, the subscribed and imported ones (a school's Infomentor calendar) too, hidden ones not: `id \| name \| access role \| colour` |
| `calendar_events` `{ calendar, from, to, query }` | One calendar's events (`calendar` is an id or a name, default `primary`) from `from` to `to` (`YYYY-MM-DD`, default the next 14 days), recurring events expanded, in start order: date, time or all day, title, place, who and the id of each. `query` filters by text. Up to four pages of 250 events are read |
| `calendar_agenda` `{ calendars, from, to }` | The events of every calendar, or of `calendars` (ids or names), grouped by day, each line led by its calendar's name (an event in several calendars once, with every name); default this week, Monday to Sunday, in the primary calendar's time zone. A calendar that cannot be read is skipped and named |
| `calendar_api_docs` `{ method }` | Google's Calendar v3 reference, from its discovery document: every method, or one method's parameters and request and response fields |

Changes, after a confirm card:

| Tool | What it does |
|---|---|
| `calendar_api` `{ method, path, query, body }` | Any Calendar v3 call. `path` is relative to `https://www.googleapis.com/calendar/v3/` or that full URL; anything else (another host, `..`, a query in the path) is refused. A GET runs at once; POST, PUT, PATCH and DELETE show a card first. For events the card says "Create event 'X' on … in calendar 'Y'", "Update event 'X' …" or "Delete event 'X' from calendar 'Y'" (calendar names from your calendar list, the event's title read from the calendar when the request has none); other writes say "METHOD path". The details always show the method, the full URL and the JSON body |

For several events at once use the bulk tools: one card instead of one per
event, and `calendar_api` POST and DELETE stay for a single event or what they
do not cover. Show one card at a time: the changing tools are never called in
parallel.

| Tool | What it does |
|---|---|
| `calendar_create_events` `{ calendar, events }` | Adds 1–50 events to one calendar (`calendar` is an id or a name from the calendar list, or `primary`). Each event has `summary` and either `start` and `end` (like `2026-11-10T17:50`, or with an offset; optional `timeZone`, default the calendar's) or an all-day `date` with an optional `end_date`, the **inclusive** last day (it is sent to Google as the exclusive end, the day after); optional `location`, `description` and `recurrence` (RRULE/EXDATE lines). The whole list is checked first: an unknown or read-only calendar, an empty or longer-than-50 list, a missing summary, timed and all-day fields mixed, a bad date, an end not after the start, or an unknown field is refused as "Not done:" naming every wrong row by its 1-based number, and no card is shown |
| `calendar_delete_events` `{ calendar, event_ids }` | Deletes 1–50 events from one calendar. Each id is read first; an unknown or already deleted id is refused with its row number, no card. A recurring event's id deletes the whole series, and its row says "whole series" |

The one card says "Add 10 events to the calendar 'Jimmy (Privat)'" (or "Delete 3
events from the calendar 'X'"), then lists the rows: date, time range or "all
day", title, place and the recurrence in words ("weekly on Sundays", "daily",
"every 2 weeks on Mon, Wed", "monthly", "until 20 Dec", "10 times"; a rule it
does not read stays as written), with the requests under Details. On Confirm
the events are written one at a time, with `events.insert` and `events.delete`
(there is no batch call), and the answer lists each with its id and link. If
one fails the rest are not attempted, and the answer says which were done (with
ids), which failed (with Google's error) and which were not tried, so the
session does not send the done ones again. A write is never retried.

Where prifly has the editable confirm card (`confirm-edit`), the create card
shows the rows as text the reader can change, one event per line:

```
2026-11-10 17:50-19:15 | Padel | where: Bromma Padel | repeat: RRULE:FREQ=WEEKLY;BYDAY=TU
2026-11-21 all day | Cup
2026-11-21..2026-11-23 all day | Weekend away | note: Pack the bags
2026-11-10T22:00 -> 2026-11-11T01:00 | Late shift | zone: Europe/Stockholm
```

The time comes first, then the title, then in any order `where:`, `note:`,
`repeat:` (one per recurrence line) and `zone:`. `\|`, `\\` and `\n` write a
pipe, a backslash and a line break inside a text; empty lines and lines
starting with `#` are ignored, and deleting a line leaves that event out. The
edited text is checked as strictly as the session's list; if it does not parse,
nothing is created and the answer is "Not done:" with the row errors (a row is
the Nth event line). When the reader changed the list the answer says so and
gives the final list. Without that feature the plain card is shown. Cancel
answers "Not done: you cancelled". prifly's own feedback note on a card is
added to the tool's answer by prifly itself; the extension API gives an
extension no note of its own to return.

`calendar_sign_in` `{ account }` opens your browser to sign in: again for the
account in use, or a new one with `account: "new"`.

When the grant has ended, a tool answers "The Google Calendar grant for …
ended: sign in again in prifly's Vault → Connections." With no Google account
connected it says to connect one. The rules every session gets about these
tools are in `prompt.md`.

## Settings

- `account`: the email of the account to use; empty means the first one.

## Checks

`bun test`, `bun run typecheck` and `bun run check` (biome: 500 lines per
file, 120 per function, cognitive complexity 15, no `any`, no `!`).

| File | What it is |
|---|---|
| `prifly-extension.json` | The manifest: the Google connection, its setting and `prompt.md` |
| `index.ts` | `activate(api)` registers the tools and starts the status line |
| `tools.ts` | `calendar_list`, `calendar_events`, `calendar_agenda` and the tool list |
| `render.ts`, `dates.ts` | Events as Markdown, and the day and time zone arithmetic |
| `api-tools.ts`, `cards.ts`, `discovery.ts` | `calendar_api` and its allow-list, the card sentences, and `calendar_api_docs` over the discovery document |
| `bulk-tools.ts`, `bulk-events.ts`, `recurrence.ts` | `calendar_create_events` and `calendar_delete_events`: the list check, the card rows, the editable line format, writing one by one, and a recurrence in words |
| `tool-kit.ts` | Arguments, the connection, and the confirm card every write waits for (the editable one too) |
| `status.ts` | The status line |
| `sign-in.ts` | The scopes, and `calendar_sign_in` |
| `connection.ts` | Picks the connection; the texts for no connection, an ended grant and an HTTP error |
| `calendar.ts`, `calendar-types.ts` | The REST client over `api.connections.fetch`, and tolerant parsers of its answers |
| `prompt.md` | The rules added to every session |
| `test/` | `fake-api.ts` (the template's fake `api`, with `confirm` and `status`), `fake-calendar.ts` (an in-memory Google Calendar with paging) and the tests |

## License and contributing

Source-available under the Functional Source License 1.1 with an Apache 2.0 future license (`LICENSE.md`): use it, change it and fix it freely, but not to offer a competing product. Each version becomes Apache 2.0 two years after its release.

Pull requests are welcome. Before one can be merged, its author signs the contributor agreement (`CLA.md`), which assigns the copyright in the contribution to The Startup Factory AB; the CLA bot asks for it on the pull request.
