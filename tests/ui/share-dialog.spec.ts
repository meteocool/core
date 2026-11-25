import type { Page, Route } from "@playwright/test";
import { expect, test } from "./test";
import { PREVIEW_CARD, openRadar, shareField } from "./app";

/**
 * The share dialog: the link on the clipboard and in a selected field the
 * moment it opens, the preview card drawn meanwhile (a few seconds on the
 * real backend, held here until the test lets it go), and the services the
 * link goes out to. See components/ShareDialog.svelte.
 */
const VIEW = "/?layer=radar&latLonZ=50.20000,9.20000,7.20";

const card = (page: Page) => page.getByRole("img", { name: "Preview of the shared map" });
const instagram = (page: Page) => page.getByRole("button", { name: "Instagram" });

/** Hold each request for the card until `release` answers it; what was asked for, by its query. */
async function holdPreview(page: Page) {
  const asked: URL[] = [];
  const waiting: Route[] = [];
  await page.route("**/v3/preview/**", (route) => {
    asked.push(new URL(route.request().url()));
    waiting.push(route);
  });
  return {
    asked,
    /** Answer the oldest request still waiting, once there is one. */
    release: async (respond: (route: Route) => Promise<void>) => {
      await expect.poll(() => waiting.length).toBeGreaterThan(0);
      await respond(waiting.shift()!);
    },
  };
}

const ok = (route: Route) => route.fulfill({ contentType: "image/png", body: PREVIEW_CARD });

test("the dialog offers the link at once and the card when it is drawn", async ({ page }) => {
  const preview = await holdPreview(page);
  await openRadar(page, VIEW);
  await page.locator(".ol-share button").click();

  const field = shareField(page);
  await expect(field).toBeVisible();
  const link = new URL(await field.inputValue());
  expect(link.searchParams.get("latLonZ")).toBe("50.20000,9.20000,7.20");
  expect(link.searchParams.get("shared")).toMatch(/^\d{8}T\d{4}Z$/);

  // Drawing: said so, and Instagram, which only takes the picture, waits for it.
  await expect(page.getByText("Generating preview…")).toBeVisible();
  await expect(instagram(page)).toBeDisabled();
  await expect(card(page)).toHaveCount(0);

  await preview.release(ok);
  await expect(card(page)).toBeVisible();
  await expect(page.getByText("Generating preview…")).toHaveCount(0);
  await expect(instagram(page)).toBeEnabled();
  // The card at the link's own view: the one a messenger unfurls it as.
  expect(preview.asked.map((url) => url.searchParams.get("latLonZ"))).toEqual(["50.20000,9.20000,7.20"]);

  const whatsapp = new URL((await page.getByRole("link", { name: "WhatsApp" }).getAttribute("href"))!);
  expect(whatsapp.host).toBe("wa.me");
  expect(whatsapp.searchParams.get("text")).toContain(link.href);
});

test("a card that cannot be drawn says so, and is asked for again", async ({ page }) => {
  const preview = await holdPreview(page);
  await openRadar(page, VIEW);
  await page.locator(".ol-share button").click();
  await preview.release((route) => route.fulfill({ status: 502, body: "" }));
  await expect(page.getByText("Couldn't make the preview.")).toBeVisible();
  await expect(instagram(page)).toBeDisabled();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Generating preview…")).toBeVisible();
  await preview.release(ok);
  await expect(card(page)).toBeVisible();
  expect(preview.asked).toHaveLength(2);
});

test("the link is on the clipboard and selected as the dialog opens", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium's to grant");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/v3/preview/**", ok);
  await openRadar(page, VIEW);
  await page.locator(".ol-share button").click();

  const field = shareField(page);
  await expect(page.getByText("Link copied")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const link = await field.inputValue();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expect(field).toBeFocused();
  expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
    .toEqual([0, link.length]);

  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
});
