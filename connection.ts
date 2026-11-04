/**
 * Which Google connection a Calendar call uses, and the words for the ways it
 * can fail. A failure is text a tool returns, never a throw.
 */

import type { ExtensionApi, ExtensionConnection } from "@prifly/extension-api";

export const NO_CONNECTION =
  "No Google account is connected for Google Calendar: connect one in prifly's Vault → Connections.";

export function signInText(account: string): string {
  return `The Google Calendar grant for ${account} ended: sign in again in prifly's Vault → Connections.`;
}

export function httpText(status: number, account: string, body: string): string {
  const said = `Google Calendar answered ${status} for ${account}: ${body.slice(0, 300)}`;
  // A grant that lacks a calendar scope: approving the scopes again fixes it.
  return status === 403 && /insufficient.*scope|SCOPE_INSUFFICIENT/i.test(body)
    ? `${said}\nThe Google grant for ${account} does not allow this: run calendar_sign_in so the reader approves reading calendars and changing events, then try again.`
    : said;
}

/** The connected account to use: `account` argument, else the `account` setting, else the first. */
export function pickConnection(api: ExtensionApi, account?: string): ExtensionConnection | null {
  const all = api.connections?.list("google") ?? [];
  const setting = api.settings?.["account"];
  const wanted = (account ?? (typeof setting === "string" ? setting : "")).trim().toLowerCase();
  if (wanted === "") return all[0] ?? null;
  return all.find((each) => each.account.toLowerCase() === wanted) ?? null;
}
