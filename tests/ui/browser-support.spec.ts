import { expect, test } from "./test";
import { RADAR_VIEW, timeline } from "./app";

/**
 * A browser the bundle cannot run in is told so, and nothing starts behind
 * the notice (src/browserCheck.js). An Android WebView 91 got past the check
 * and threw on every frame of the map, for want of Object.hasOwn.
 */

for (const missing of ["Object.hasOwn", "Array.prototype.at", "window.structuredClone"]) {
  test(`without ${missing}, the page says the browser is too old and starts no map`, async ({ page }) => {
    await page.addInitScript({ content: `delete ${missing};` });
    await page.goto(RADAR_VIEW);

    await expect(page.getByRole("alert")).toContainText("This Browser Is Too Old for meteocool");
    await expect(page.getByRole("alert")).toContainText("iOS 15.4");
    await expect(timeline(page)).toBeHidden();
  });
}
