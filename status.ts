/**
 * The extension's one line in Settings → Extensions: "Connected as
 * ada@example.com · 4 calendars", or what is wrong with the sign-in in plain
 * words. Read at start, after a sign-in or a settings change, and then every
 * 15 minutes; it is the only thing the extension shows.
 */

import type { ExtensionApi } from "@prifly/extension-api";
import { calendarClient } from "./calendar";
import { pickConnection } from "./connection";
import { missingScopes } from "./sign-in";

export const STATUS_EVERY_MS = 15 * 60 * 1000;

export const NOT_CONNECTED =
  "Not connected: connect a Google account in Vault → Connections, or ask a session to sign in to Google Calendar.";

const signedOut = (account: string): string =>
  `Signed out: Google ended the grant for ${account}. Ask a session to sign in to Google Calendar again, or sign in again in Vault → Connections.`;

/** The status line as it stands now; never throws. */
export async function statusText(api: ExtensionApi): Promise<string> {
  const connection = pickConnection(api);
  if (api.connections === undefined || connection === null) return NOT_CONNECTED;
  if (connection.state === "needs-sign-in") return signedOut(connection.account);
  if (missingScopes(connection).length > 0) {
    return `Connected as ${connection.account}, but not every permission is approved: ask a session to run calendar_sign_in to approve reading calendars and changing events.`;
  }
  const client = calendarClient({
    connections: api.connections,
    connection: connection.id,
    account: connection.account,
  });
  try {
    const calendars = await client.calendars();
    if (!calendars.ok && calendars.kind === "sign-in") return signedOut(connection.account);
    if (!calendars.ok) {
      return `Connected as ${connection.account}, but Google Calendar answered ${calendars.status}.`;
    }
    const count = calendars.value.length;
    return `Connected as ${connection.account} · ${count} ${count === 1 ? "calendar" : "calendars"}`;
  } catch (error) {
    return `Connected as ${connection.account}, but Google Calendar could not be reached: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Keeps the status line current: now, then every 15 minutes. `refresh` reads
 * it again at once (after a sign-in); the returned `stop` ends the timer.
 */
export function startStatus(api: ExtensionApi): { refresh: () => void; stop: () => void } {
  let stopped = false;
  const refresh = () => {
    if (api.status === undefined) return;
    void statusText(api).then((line) => {
      if (!stopped) api.status?.(line);
    });
  };
  refresh();
  const timer = setInterval(refresh, STATUS_EVERY_MS);
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
