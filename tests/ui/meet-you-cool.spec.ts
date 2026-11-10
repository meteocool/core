import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./test";
import { meetYouCool, noGeocoder, openRadar, overlaps, radarMark, settled, timeline, topCard, topRadar } from "./app";

/**
 * "meet you cool": the radars as profiles to swipe, opened only from
 * #meetyoucool, nothing in the app leading to it for now. Whether a like is a match is chance; the specs
 * fix it by standing in Math.random just before the like.
 */

/** The radars dealt: one for every photo there is, the radars nobody has photographed being left out. */
const PHOTOGRAPHED = readdirSync(path.join(import.meta.dirname, "..", "..", "public", "radars"))
  .filter((name) => name.endsWith(".webp")).length;

async function open(page: import("@playwright/test").Page): Promise<void> {
  await openRadar(page);
  await page.evaluate(() => { window.location.hash = "meetyoucool"; });
  await expect(topCard(page)).toBeVisible();
}

/** The next like is a match, or is not. */
const nextLikeMatches = (page: import("@playwright/test").Page, match: boolean) =>
  page.evaluate((value) => { Math.random = () => value; }, match ? 0.1 : 0.9);

/** Nothing on the page names it or links to it, and it is not open. */
async function noWayIn(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByText(/meet you cool/i)).toHaveCount(0);
  await expect(page.locator("a[href*='meetyoucool' i]")).toHaveCount(0);
  await expect(meetYouCool(page)).toHaveCount(0);
}

test("nothing in the app leads to it: not the map, a radar's tray or page, Settings or About", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("layerSites", "true"));
  await noGeocoder(page);
  await openRadar(page, "/?layer=radar&latLonZ=50.20000,9.20000,7.20");
  await noWayIn(page);

  await expect.poll(() => radarMark(page, "deoft"), { timeout: 20_000 }).not.toBeNull();
  const at = (await radarMark(page, "deoft"))!;
  await page.mouse.click(at.x, at.y);
  const tray = page.getByRole("group", { name: "Offenthal radar" });
  await settled(tray);
  await noWayIn(page);
  await tray.getByRole("button", { name: "About this radar" }).click();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await noWayIn(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings" }).click();
  await noWayIn(page);
  await page.getByRole("button", { name: "About meteocool" }).click();
  await expect(page.getByRole("heading", { name: "About meteocool" })).toBeVisible();
  await noWayIn(page);
});

test("a link with #meetyoucool opens it, and closing it takes the hash off", async ({ page }) => {
  await openRadar(page, "/?layer=radar&latLonZ=50.50000,9.50000,6.00#meetyoucool");
  await expect(topCard(page)).toBeVisible();
  await meetYouCool(page).getByRole("button", { name: "Close" }).click();
  await expect(meetYouCool(page)).toBeHidden();
  expect(await page.evaluate(() => window.location.hash)).toBe("");
});

test("Escape closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await expect(meetYouCool(page)).toBeHidden();
});

test("a profile shows the radar's name and age, its country, its chips and its bio", async ({ page }) => {
  await open(page);
  const card = topCard(page);
  await expect(card.getByRole("heading", { level: 3 })).toHaveText(/^.+(, \d+| age: a mystery)$/);
  await expect(card.getByRole("listitem").first()).toBeVisible();
  await expect(card.locator(".bio")).not.toBeEmpty();
});

test("every photo shown carries its credit and licence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  // About a third of the radars have a photo; the stack is shuffled.
  for (let i = 0; i < 60; i += 1) {
    if (await topCard(page).getByRole("img").count()) break;
    await meetYouCool(page).getByRole("button", { name: "Nope" }).click();
  }
  const card = topCard(page);
  await expect(card.getByRole("img")).toBeVisible();
  await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute("href", /^https:\/\//);
  await expect(card.locator("figcaption")).toContainText(/CC|[Pp]ublic domain|[Ll]icen|Attribution/);
});

test("a nope deals the next radar, and the one passed on does not come back", async ({ page }) => {
  await open(page);
  const first = await topRadar(page);
  await meetYouCool(page).getByRole("button", { name: "Nope" }).click();
  await expect.poll(() => topRadar(page)).not.toBe(first);
  const seen = new Set([first]);
  for (let i = 0; i < 5; i += 1) {
    const name = await topRadar(page);
    expect(seen.has(name)).toBe(false);
    seen.add(name);
    await meetYouCool(page).getByRole("button", { name: "Nope" }).click();
    await expect.poll(() => topRadar(page)).not.toBe(name);
  }
});

test("a like that is no match deals the next radar, with no match to show", async ({ page }) => {
  await open(page);
  const first = await topRadar(page);
  await nextLikeMatches(page, false);
  await meetYouCool(page).getByRole("button", { name: "Like" }).click();
  await expect.poll(() => topRadar(page)).not.toBe(first);
  await expect(page.getByRole("heading", { name: "It's a match!" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("meetYouCoolMatches"))).toBeNull();
});

test("a match waits for the radar to write first, and is kept in this browser", async ({ page }) => {
  await open(page);
  const name = await topRadar(page);
  await nextLikeMatches(page, true);
  await meetYouCool(page).getByRole("button", { name: "Like" }).click();
  await expect(page.getByRole("heading", { name: "It's a match!" })).toBeVisible();

  await page.getByRole("button", { name: "Send a message" }).click();
  await expect(page.getByRole("heading", { name: `${name} needs to send the first message` })).toBeVisible();
  await page.getByRole("button", { name: "Back to swiping" }).click();
  await expect(topCard(page)).toBeVisible();
  expect(await topRadar(page)).not.toBe(name);

  const matches = meetYouCool(page).getByRole("region", { name: /Matches/ });
  await expect(matches.getByRole("button", { name: new RegExp(`^${name}`) })).toContainText("Waiting for their first message");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("meetYouCoolMatches") ?? "[]"));
  expect(stored).toHaveLength(1);

  // Still there on the next visit, and still waiting.
  await page.reload();
  await page.evaluate(() => { window.location.hash = "meetyoucool"; });
  await expect(meetYouCool(page).getByRole("region", { name: /Matches/ })
    .getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
});

test("a match in the list opens its wait again", async ({ page }) => {
  await open(page);
  const name = await topRadar(page);
  await nextLikeMatches(page, true);
  await meetYouCool(page).getByRole("button", { name: "Like" }).click();
  await page.getByRole("button", { name: "Keep swiping" }).click();
  await meetYouCool(page).getByRole("region", { name: /Matches/ }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { name: `${name} needs to send the first message` })).toBeVisible();
});

test("the arrow keys swipe, and the timeline behind stays where it was", async ({ page }) => {
  await open(page);
  const at = await timeline(page).getAttribute("aria-valuenow");
  const first = await topRadar(page);
  await nextLikeMatches(page, false);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => topRadar(page)).not.toBe(first);
  const second = await topRadar(page);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => topRadar(page)).not.toBe(second);
  expect(await timeline(page).getAttribute("aria-valuenow")).toBe(at);
});

test("a card dragged far enough flies off; one let go too soon comes back", async ({ page }) => {
  await open(page);
  const card = topCard(page);
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  const first = await topRadar(page);

  // Too short, and slow: back it comes.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 30, y, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(box.x, 0);
  expect(await topRadar(page)).toBe(first);

  // Far enough to the left: a nope.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - box.width * 0.6, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => topRadar(page)).not.toBe(first);
});

test("with reduced motion the swipes are at once, every photographed radar is dealt once, and the end offers to start over", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const nope = meetYouCool(page).getByRole("button", { name: "Nope" });
  const seen = new Set<string>();
  while (await topCard(page).count()) {
    const name = await topRadar(page);
    expect(seen.has(name), `${name} dealt twice`).toBe(false);
    seen.add(name);
    await nope.click();
  }
  await expect(page.getByRole("heading", { name: "You've met every radar" })).toBeVisible();
  expect(seen.size).toBe(PHOTOGRAPHED);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(topCard(page)).toBeVisible();
});

test("the card and its buttons fit on the screen without covering each other", async ({ page }) => {
  await open(page);
  const viewport = page.viewportSize()!;
  const card = (await topCard(page).boundingBox())!;
  const like = (await meetYouCool(page).getByRole("button", { name: "Like" }).boundingBox())!;
  const nope = (await meetYouCool(page).getByRole("button", { name: "Nope" }).boundingBox())!;
  for (const box of [card, like, nope]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  expect(overlaps(card, like)).toBe(false);
  expect(overlaps(card, nope)).toBe(false);
  expect(card.height).toBeGreaterThan(300);
});
