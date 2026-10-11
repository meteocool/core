import { defineConfig, devices } from "@playwright/test";

/**
 * The UI tests: the whole app in real browsers, driven the way a reader does.
 *
 * They catch what the unit tests under scripts/tests cannot, a change in one
 * part of the screen breaking another (a sheet that hides the tray, a pill
 * that covers another). Not in CI yet: run `npm run test:ui` before pushing
 * develop.
 *
 * The app is served by Vite against the demo backend, which replays a
 * recorded storm, so there is always radar and the tests do not depend on
 * today's weather. An iPhone in WebKit, the closest a desktop gets to the
 * iOS app's web view, and a desktop Chromium.
 */
const PORT = 8130;

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
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      MC_API: "https://api-demo.meteocool.com",
      MC_DATA: "https://data-demo.meteocool.com",
      MC_TILES: "https://assets-demo.meteocool.com",
    },
  },
});
