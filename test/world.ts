/** A fake prifly with a fake Google Calendar behind its Google connections, for the tests. */

import type { ConfirmSpec, SettingValues } from "@prifly/extension-api";
import { activate } from "../index";
import { type FakeAccount, fakeApi, fakeConnections } from "./fake-api";
import { type FakeCalendar, fakeCalendar, SELF } from "./fake-calendar";

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export const FIRST_ACCOUNT: FakeAccount = {
  id: "g-1",
  provider: "google",
  account: SELF,
  scopes: SCOPES,
};

export const SECOND_ACCOUNT: FakeAccount = {
  id: "g-2",
  provider: "google",
  account: "second@example.com",
  scopes: SCOPES,
};

/** A confirm card the extension showed, and how many write requests had gone out before it. */
export type Shown = { spec: ConfirmSpec; writesBefore: number };

export function world(
  options: {
    accounts?: FakeAccount[];
    settings?: SettingValues;
    /** What the reader answers on every confirm card (default: Confirm). */
    confirm?: boolean;
    /**
     * Gives the fake prifly the editable confirm card: what the reader leaves in
     * the text, from the text shown; null cancels. Left out, a prifly without it.
     */
    edit?: (shown: string) => string | null;
  } = {},
) {
  const calendar: FakeCalendar = fakeCalendar();
  const connections = fakeConnections({
    accounts: options.accounts ?? [FIRST_ACCOUNT],
    provider: calendar.provider,
  });
  /** The requests that could change a calendar: everything but GET. */
  const writes = () => connections.requests.filter((each) => each.method !== "GET");
  const confirms: Shown[] = [];
  const fake = fakeApi({
    connections: connections.connections,
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    confirm: async (spec) => {
      confirms.push({ spec, writesBefore: writes().length });
      return options.confirm ?? true;
    },
    ...(options.edit === undefined
      ? {}
      : {
          confirmEdit: async (spec: ConfirmSpec & { content: string }) => {
            confirms.push({ spec, writesBefore: writes().length });
            return options.edit?.(spec.content) ?? null;
          },
        }),
  });
  const stop = activate(fake.api);

  /** Calls a tool as a session would. */
  const call = (name: string, args: Record<string, unknown>) => fake.callTool(name, args);

  return { calendar, connections, fake, call, stop, confirms, writes };
}
