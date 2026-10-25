import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devices, test, type Browser } from "@playwright/test";
import { FIXTURES, fixtureFile, fulfilBlankTile, isApi, isTile, type RecordedResponse, type Recording } from "./offline";

/**
 * Records the backend's answers the UI tests replay: `npm run test:ui:record`.
 *
 * Opens the app the way the specs do, on a phone and on a desktop, lets each
 * settle, and writes every answer from the backend's paths (offline.ts) to
 * tests/ui/fixtures/api, replacing what was there. The time it ran becomes
 * the tests' clock (fixtures/recording.json).
 *
 * The backend is the dev server's proxy target: staging by default, demo
 * with UI_RECORD_FROM=demo (playwright.config.ts). Pick a moment with rain
 * on the map, or the radar has nothing for the player to show.
 */

/** Every view a spec opens, so each finds its answers: add a spec's view here. */
const VIEWS = [
  "/?layer=radar&latLonZ=50.50000,9.50000,6.00",
  "/?layer=radar&latLonZ=50.50000,10.00000,8.00",
  "/?layer=radar&latLonZ=44.80000,-0.60000,8.00",
  "/?layer=cells3d&latLonZ=50.50000,9.50000,7.00",
  "/ios.html?layer=radar&latLonZ=50.50000,9.50000,6.00",
  // site-sweeps.spec.ts: Offenthal's and Borkum's marks.
  "/?layer=radar&latLonZ=50.20000,9.20000,7.20",
  "/?layer=radar&latLonZ=53.70000,6.90000,8.20",
];
const SETTLE_MS = 15_000;

type Listing = { sites: { site: string }[] };

/**
 * One fixture answers `/sweeps` whatever its bbox, so each view's listing is
 * added to the ones before it rather than replacing them: every spec finds
 * the sites in its view, whichever view was recorded last.
 */
function withSitesOf(before: RecordedResponse | undefined, answer: RecordedResponse): RecordedResponse {
  const earlier = (before?.json as Listing | undefined)?.sites ?? [];
  const listing = answer.json as Listing | undefined;
  if (!listing?.sites) return answer;
  const sites = new Map([...earlier, ...listing.sites].map((site) => [site.site, site]));
  return { ...answer, json: { ...listing, sites: [...sites.values()] } };
}

async function visit(browser: Browser, baseURL: string | undefined, device: (typeof devices)[string],
  answers: Map<string, RecordedResponse>) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block", baseURL });
  // The radars' marks on, whatever the default: every view records its `/sweeps` listing.
  await context.addInitScript(() => localStorage.setItem("layerSites", "true"));
  // And the weather stations, off by default, so `/stations/observations` is recorded.
  await context.addInitScript(() => localStorage.setItem("layerStations", "true"));
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (isTile(url)) return fulfilBlankTile(route, url);
    if (!isApi(url)) return route.continue();
    const response = await route.fetch();
    const contentType = response.headers()["content-type"] ?? "application/json";
    const body = await response.text();
    const answer: RecordedResponse = { status: response.status(), contentType };
    try {
      answer.json = JSON.parse(body);
    } catch {
      answer.text = body;
    }
    const file = fixtureFile(route.request().method(), url);
    answers.set(file, url.pathname === "/sweeps" ? withSitesOf(answers.get(file), answer) : answer);
    return route.fulfill({ response });
  });
  for (const view of VIEWS) {
    await page.goto(view);
    await page.waitForTimeout(SETTLE_MS);
  }
  await context.close();
}

test("record the backend's answers", async ({ browser, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const answers = new Map<string, RecordedResponse>();
  await visit(browser, baseURL, devices["iPhone 15"], answers);
  await visit(browser, baseURL, devices["Desktop Chrome"], answers);

  const apiDir = path.join(FIXTURES, "api");
  rmSync(apiDir, { recursive: true, force: true });
  mkdirSync(apiDir, { recursive: true });
  for (const [file, answer] of answers) writeFileSync(file, `${JSON.stringify(answer, null, 1)}\n`);
  // When the last answer came in: the clock the tests run on, so that
  // nothing recorded lies in their future.
  const recordedAt = Date.now();
  const recording: Recording = { recordedAt, source: process.env.UI_RECORD_FROM ?? "staging" };
  writeFileSync(path.join(FIXTURES, "recording.json"), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`Recorded ${answers.size} answers at ${new Date(recordedAt).toISOString()} from ${recording.source}.`);
});
