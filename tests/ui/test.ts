import { existsSync, readFileSync } from "node:fs";
import { expect, test as base } from "@playwright/test";
import { answerStorms, recordedStorms } from "./storms";
import {
  fixtureFile, fulfilBlankTile, isApi, isLocal, isTile, quietLightningSocket, readRecording,
  type RecordedResponse,
} from "./offline";

/**
 * `test` for the UI specs: every page offline and on the recording's clock.
 *
 * - The backend's answers come from tests/ui/fixtures (offline.ts).
 * - Tiles are blank, the lightning socket connected and quiet.
 * - The clock starts when the answers were recorded and runs on from there,
 *   so the newest scan is as old as it was then and the live frame is the
 *   recording's.
 * - A request that has no recording, or that would leave the machine, is
 *   refused, and the test fails naming it: the cue to re-record.
 */
export const test = base.extend<{ unrecorded: string[] }>({
  unrecorded: [async ({ page }, use) => {
    const unrecorded: string[] = [];
    const recording = readRecording();
    const storms = recordedStorms();
    await page.clock.install({ time: recording.recordedAt });
    await quietLightningSocket(page);

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
      if (isTile(url)) return fulfilBlankTile(route, url);
      if (isApi(url)) {
        const file = fixtureFile(request.method(), url);
        // Until a recording has storms (staging does not serve them yet), they
        // are made from the recorded KONRAD3D tracks; see storms.ts.
        if (url.pathname.startsWith("/storms") && !recordedOk(file)) return answerStorms(route, url, storms);
        if (!existsSync(file)) {
          unrecorded.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        }
        const answer = JSON.parse(readFileSync(file, "utf8")) as RecordedResponse;
        return route.fulfill({
          status: answer.status,
          contentType: answer.contentType,
          body: answer.json !== undefined ? JSON.stringify(answer.json) : (answer.text ?? ""),
        });
      }
      // socket.io's polling fallback, should the websocket ever not take.
      if (isLocal(url) && url.pathname.startsWith("/socket.io/")) return route.abort();
      // The dev server's own files: the app itself.
      if (isLocal(url)) return route.continue();
      unrecorded.push(`${request.method()} ${url.host}${url.pathname}`);
      return route.abort("blockedbyclient");
    });

    await use(unrecorded);

    expect(unrecorded, [
      "These requests have no recording and were refused.",
      "If the app now needs them, add them to offline.ts and re-record:",
      "npm run test:ui:record (tests/ui/README.md).",
    ].join(" ")).toEqual([]);
  }, { auto: true }],
});

/** Whether there is a recorded answer, and a successful one, rather than the 404 of a backend without the path. */
function recordedOk(file: string): boolean {
  if (!existsSync(file)) return false;
  return (JSON.parse(readFileSync(file, "utf8")) as RecordedResponse).status === 200;
}

export { expect };

