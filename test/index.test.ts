import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionModule } from "@prifly/extension-api";
import * as extension from "../index";
import manifest from "../prifly-extension.json";
import { FIRST_ACCOUNT, SECOND_ACCOUNT, world } from "./world";

// The module is what prifly imports: it must fit the contract as a whole.
const module: ExtensionModule = extension;

const ROOT = join(import.meta.dir, "..");

let stop: (() => void) | undefined;
afterEach(() => stop?.());

test("activate registers the Calendar tools, every one named calendar_*", () => {
  const w = world();
  stop = w.stop;
  expect(w.fake.tools().map((tool) => tool.name)).toEqual([
    "calendar_list",
    "calendar_events",
    "calendar_agenda",
    "calendar_api",
    "calendar_create_events",
    "calendar_delete_events",
    "calendar_api_docs",
    "calendar_sign_in",
  ]);
  for (const tool of w.fake.tools()) expect(tool.inputSchema["type"]).toBe("object");
  expect(w.fake.logs).toEqual([{ event: "activated", fields: undefined }]);
  expect(typeof module.activate).toBe("function");
});

test("the module exports only activate: no launcher", () => {
  expect(Object.keys(extension)).toEqual(["activate"]);
});

test("the manifest has no launcher and asks for calendar.readonly and calendar.events", () => {
  expect("launch" in manifest).toBe(false);
  expect(manifest.id).toBe("google-calendar");
  expect(manifest.name).toBe("Google Calendar");
  expect(manifest.connections.flatMap((each) => each.scopes)).toEqual([
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ]);
});

test("no source file shows a chip, flags the launcher or answers a launch", () => {
  const sources = readdirSync(ROOT).filter((name) => name.endsWith(".ts"));
  expect(sources.length).toBeGreaterThan(5);
  for (const name of sources) {
    const code = readFileSync(join(ROOT, name), "utf8");
    expect(`${name}: ${code.match(/\.(show|flag|snoozeOptions)\??\.?\(/)?.[0] ?? ""}`).toBe(
      `${name}: `,
    );
    expect(
      `${name}: ${code.match(/export\s+(async\s+)?function\s+(choices|open|launch|launched)\b/)?.[0] ?? ""}`,
    ).toBe(`${name}: `);
  }
});

test("stopping makes the tools answer that no account is connected", async () => {
  const w = world();
  w.stop();
  expect(await w.call("calendar_list", {})).toContain("No Google account is connected");
});

test("the account setting picks the account when no account argument is given", async () => {
  const w = world({
    accounts: [FIRST_ACCOUNT, SECOND_ACCOUNT],
    settings: { account: "second@example.com" },
  });
  stop = w.stop;
  expect(await w.call("calendar_list", {})).toContain("Jimmy");
  const tokens = w.connections.requests.map((each) => each.headers.get("Authorization"));
  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.every((each) => each?.startsWith("Bearer token-g-2-"))).toBe(true);
  await w.call("calendar_list", { account: FIRST_ACCOUNT.account });
  expect(w.connections.requests.at(-1)?.headers.get("Authorization")).toStartWith(
    "Bearer token-g-1-",
  );
});

test("an account argument picks that account, and an unknown one is not used", async () => {
  const second = { id: "g-2", provider: "google", account: "second@example.com", scopes: [] };
  const w = world({ accounts: [{ ...second, scopes: manifest.connections[0]?.scopes ?? [] }] });
  stop = w.stop;
  expect(await w.call("calendar_list", { account: "second@example.com" })).toContain("Jimmy");
  expect(await w.call("calendar_list", { account: "other@example.com" })).toContain(
    "No Google account is connected",
  );
});
