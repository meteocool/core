import { expect, test } from "@playwright/test";
import { openRadar, productControl, productMenu } from "./app";

/** The radar product menu, opened from the scan pill (phone) or the legend's caption (desktop). */

test.beforeEach(async ({ page }) => {
  await openRadar(page);
  await productControl(page).click();
  await expect(productMenu(page)).toBeVisible();
});

test("its close disc closes it", async ({ page }) => {
  await productMenu(page).getByRole("button", { name: "Close" }).click();
  await expect(productMenu(page)).toBeHidden();
});

test("a tap outside closes it", async ({ page }) => {
  await page.mouse.click(10, 10);
  await expect(productMenu(page)).toBeHidden();
});

test("its \"?\" opens How the Radar Works, which stays open", async ({ page }) => {
  await productMenu(page).getByRole("button", { name: "How the radar works" }).click();
  const explainer = page.getByRole("dialog", { name: "How the Radar Works" });
  await expect(explainer).toBeVisible();
  // It broke by closing again a moment later, with the tray its sheet hides.
  await page.waitForTimeout(1_000);
  await expect(explainer).toBeVisible();
});

test("choosing a product closes it and names the product", async ({ page }) => {
  // DMAX: the demo backend has no EU composites, and a product without
  // scans is drawn as the default instead.
  const option = productMenu(page).getByRole("menuitemradio", { name: /DMAX/ });
  await option.click();
  await expect(productMenu(page)).toBeHidden();
  await productControl(page).click();
  await expect(productMenu(page).getByRole("menuitemradio", { checked: true })).toContainText("DMAX");
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the blur is a phone's");

  test("the map behind it is blurred, the scan pill drawn sharp in front", async ({ page }) => {
    const blur = page.locator("body > .blur");
    await expect(blur).toBeVisible();
    // The control's twin, over the blur where the control is, and the
    // control itself hidden, or its blurred copy ghosts through the twin.
    const twin = page.locator("body > button.twin");
    await expect(twin).toBeVisible();
    const control = page.locator("button[aria-haspopup='menu'].twinned");
    await expect(control).toHaveCSS("visibility", "hidden");
    const [a, b] = [await twin.boundingBox(), await control.boundingBox()];
    expect(a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1).toBe(true);
    // Topmost where it is drawn.
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.className ?? "",
      { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 });
    expect(top).toContain("twin");
  });

  test("tapping the scan pill again closes it", async ({ page }) => {
    await page.locator("body > button.twin").click();
    await expect(productMenu(page)).toBeHidden();
    await expect(page.locator("body > .blur")).toHaveCount(0);
  });
});
