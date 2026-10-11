import { expect, test, type Page } from "@playwright/test";
import { RADAR_VIEW, productControl, productMenu, timeline } from "./app";

/**
 * What the page tells the iOS app, on the page the app loads (ios.html),
 * with the app's message handler stood in for by one that records.
 */

test.skip(({ isMobile }) => !isMobile, "the app runs on phones");

declare global {
  interface Window { sentToNative: string[] }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.sentToNative = [];
    Object.defineProperty(window, "webkit", {
      value: { messageHandlers: { scriptHandler: { postMessage: (m: string) => window.sentToNative.push(m) } } },
    });
  });
  await page.goto(`/ios.html${RADAR_VIEW.slice(1)}`);
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
});

const sent = (page: Page) => page.evaluate(() => window.sentToNative);

test("the page reports in for its settings", async ({ page }) => {
  expect(await sent(page)).toContain("requestSettings");
});

test("the radar menu hides the app's buttons while it is open", async ({ page }) => {
  await productControl(page).click();
  await expect(productMenu(page)).toBeVisible();
  expect(await sent(page)).toContain("hideControls");
  expect(await sent(page)).not.toContain("showControls");

  await productMenu(page).getByRole("button", { name: "Close" }).click();
  await expect(productMenu(page)).toBeHidden();
  const messages = await sent(page);
  expect(messages.lastIndexOf("showControls")).toBeGreaterThan(messages.lastIndexOf("hideControls"));
});
