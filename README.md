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
| `tool-kit.ts` | Arguments, the connection, and the confirm card every write waits for |
| `status.ts` | The status line |
| `sign-in.ts` | The scopes, and `calendar_sign_in` |
| `connection.ts` | Picks the connection; the texts for no connection, an ended grant and an HTTP error |
| `calendar.ts`, `calendar-types.ts` | The REST client over `api.connections.fetch`, and tolerant parsers of its answers |
| `prompt.md` | The rules added to every session |
| `test/` | `fake-api.ts` (the template's fake `api`, with `confirm` and `status`), `fake-calendar.ts` (an in-memory Google Calendar with paging) and the tests |

## License and contributing

Source-available under the Functional Source License 1.1 with an Apache 2.0 future license (`LICENSE.md`): use it, change it and fix it freely, but not to offer a competing product. Each version becomes Apache 2.0 two years after its release.

Pull requests are welcome. Before one can be merged, its author signs the contributor agreement (`CLA.md`), which assigns the copyright in the contribution to The Startup Factory AB; the CLA bot asks for it on the pull request.
