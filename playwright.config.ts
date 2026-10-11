import { defineConfig, devices } from "@playwright/test";

/**
 * The UI tests: the whole app in real browsers, driven the way a reader does.
 *
 * They catch what the unit tests under scripts/tests cannot, a change in one
 * part of the screen breaking another (a sheet that hides the tray, a pill
 * that covers another). Not in CI yet: run `npm run test:ui` before pushing
 * develop.
 *
 * Offline: the backend's answers are recorded once and replayed, on the
 * recording's clock, so a run depends on nothing but the repository
 * (tests/ui/README.md). An iPhone in WebKit, the closest a desktop gets to
 * the iOS app's web view, and a desktop Chromium.
 *
 * `npm run test:ui:record` (UI_RECORD=1) runs the recorder instead of the
 * specs, against staging, or demo with UI_RECORD_FROM=demo.
 */
const PORT = 8130;
const recording = Boolean(process.env.UI_RECORD);

/** The dev server's proxy targets (vite.config.ts): staging unless told otherwise. Only the recorder reaches them. */
const backend: Record<string, string> = process.env.UI_RECORD_FROM === "demo"
  ? {
    MC_API: "https://api-demo.meteocool.com",
    MC_DATA: "https://data-demo.meteocool.com",
    MC_TILES: "https://assets-demo.meteocool.com",
  }
  : {};

export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    // The service worker would answer requests the tests route, and cache
    // one run's app for the next.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: recording
    ? [{ name: "record", testMatch: "record.ts" }]
    : [
      { name: "iphone", use: { ...devices["iPhone 15"] } },
      { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always its own: a server already on the port may be another session's,
    // on another branch, or one proxying to another backend. A taken port
    // fails the run outright (--strictPort) rather than testing the wrong app.
    reuseExistingServer: false,
    timeout: 120_000,
    env: backend,
  },
});
