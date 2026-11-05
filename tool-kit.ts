/**
 * What every Calendar tool shares: reading its arguments, the `account`
 * argument, picking the connection, and the card every write waits for. A
 * write that is not confirmed changes nothing and says so.
 */

import type { ConfirmSpec, ExtensionApi } from "@prifly/extension-api";
import type { ConfirmEvents } from "./bulk-agenda";
import { type CalendarClient, calendarClient } from "./calendar";
import { NO_CONNECTION, pickConnection } from "./connection";

export type Args = Record<string, unknown>;

export const CANCELLED = "Not done: you cancelled";

export const NO_CONFIRM =
  "Not done: this prifly cannot show a confirm card, and Google Calendar is never changed without one. Update prifly.";

const ACCOUNT_PROPERTY = {
  type: "string",
  description:
    "The Google account's email, when several are connected. Left out: the Google Calendar setting's account, else the first connected one.",
};

/** A string argument, trimmed; "" when missing. */
export function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/** A list argument: an array of strings, or one string split on commas. */
export function strings(args: Args, key: string): string[] {
  const value = args[key];
  const all = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return all
    .filter((each): each is string => typeof each === "string")
    .map((each) => each.trim())
    .filter((each) => each !== "");
}

export function schema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...properties, account: ACCOUNT_PROPERTY },
    required,
    additionalProperties: false,
  };
}

export type Session = { api: ExtensionApi; client: CalendarClient; account: string };

/** Runs `run` with a client for the right account, or answers why there is none. */
export async function withCalendar(
  api: ExtensionApi | null,
  args: Args,
  run: (session: Session) => Promise<string>,
): Promise<string> {
  const given = text(args, "account");
  const connection = api === null ? null : pickConnection(api, given === "" ? undefined : given);
  if (api === null || api.connections === undefined || connection === null) return NO_CONNECTION;
  const client = calendarClient({
    connections: api.connections,
    connection: connection.id,
    account: connection.account,
  });
  return await run({ api, client, account: connection.account });
}

/**
 * Shows the confirm card for a write. Null when the reader confirmed, so the
 * write goes ahead; otherwise the text the tool answers instead of writing.
 * With `events`, a prifly that has the agenda card ("confirm-events") draws
 * them in place of `spec.content`; any other prifly shows `spec` as it is.
 */
export async function confirmFirst(
  api: ExtensionApi,
  spec: ConfirmSpec,
  events?: ConfirmEvents,
): Promise<string | null> {
  if (api.confirm === undefined) return NO_CONFIRM;
  const shown: ConfirmSpec & { events?: ConfirmEvents } =
    events !== undefined && api.features?.includes("confirm-events") ? { ...spec, events } : spec;
  return (await api.confirm(shown)) ? null : CANCELLED;
}
