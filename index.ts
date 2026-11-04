/**
 * The Google Calendar extension: what prifly imports. `activate` is given the
 * api, registers the Calendar tools every session can use (`tools.ts`) and
 * keeps the one status line current (`status.ts`). There is nothing else to
 * see: no launcher, no chips. Types come from `@prifly/extension-api` with
 * `import type`, so nothing of it is loaded at run time.
 */

import type { ExtensionApi } from "@prifly/extension-api";
import { startStatus } from "./status";
import { calendarTools } from "./tools";

let api: ExtensionApi | null = null;

export function activate(given: ExtensionApi): () => void {
  api = given;
  const status = startStatus(given);
  // Absent on an older prifly: optional, like every part added after the first version.
  given.tools?.register(calendarTools(() => api, { onSignedIn: status.refresh }));
  given.onSettings?.(() => status.refresh());
  given.log("activated");
  return () => {
    status.stop();
    api = null;
  };
}
