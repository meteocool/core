import type { Page } from "@playwright/test";
import { expect, test } from "./test";

/**
 * meteocool Studio: the 3D map's mode for cutting storms open with section
 * planes and making scenes of them. On a desktop only.
 *
 * The recording's volumes are blank tiles, so nothing here is about what a
 * cut looks like; it is about the mode itself: getting in and out, the
 * planes and keyframes being the scene's, and the scene being in the link.
 */
/* Looked at from straight above, as the other specs of the 3D map do: a
   tilted map is several times the tiles and the terrain, drawn here by a
   software renderer, and a page busy drawing answers no click. */
const MAP_3D = "/?layer=cells3d&latLonZ=50.50000,9.50000,7.00&pitch=0&bearing=0";

const enter = (page: Page) => page.getByRole("button", { name: "Studio", exact: true });
const panel = (page: Page) => page.getByRole("region", { name: "meteocool Studio" });
const timeline = (page: Page) => page.getByRole("region", { name: "Time and scene" });
const planes = (page: Page) => panel(page).locator(".planes button.plane");
const handles = (page: Page) => page.locator(".studio-plane-handle");
const marks = (page: Page) => timeline(page).locator(".marks i");

/** Whether the storms' boxes on the ground are drawn: both their outline and its halo. */
const boxes = (page: Page) => page.evaluate(() => {
  const { gl } = (window as any).lm.getCapability("cells3d");
  return ["cloud-box", "cloud-box-casing"].map((id) => (gl.getLayer(id) ? gl.getLayoutProperty(id, "visibility") ?? "visible" : "absent"));
});

/** The 3D map up, and Studio opened from the end of its peel tray. */
async function openStudio(page: Page): Promise<void> {
  // The 3D map brought up, then Studio's own chunk: past 45 s on a loaded machine.
  test.slow();
  await page.goto(MAP_3D);
  await enter(page).click({ timeout: 90_000 });
  await expect(panel(page)).toBeVisible({ timeout: 20_000 });
}

test.describe("on a desktop", () => {
  test.skip(({ isMobile }) => isMobile, "Studio is a desktop's");

  test("Studio takes the place of the 3D map's legend and peel, and gives it back", async ({ page }) => {
    await openStudio(page);
    await expect(timeline(page)).toBeVisible();
    await expect(enter(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Legend" })).toBeHidden();
    await expect(page).toHaveURL(/[?&]studio=/);

    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(enter(page)).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]studio=/);
    // Which scan the storms are from is Studio's to choose: the map's own tray has no picker for it.
    await expect(page.getByRole("button", { name: /^Storms/ })).toHaveCount(0);
    await expect(page.locator(".peel .picker")).toHaveCount(0);
  });

  test("the storms' boxes on the ground are put away in Studio, also across a restyle, and back after", async ({ page }) => {
    await openStudio(page);
    await expect.poll(() => boxes(page), { timeout: 30_000 }).toEqual(["none", "none"]);

    // A light/dark switch rebuilds every layer: they come back put away.
    await page.evaluate(() => {
      (window as any).restyled = false;
      (window as any).lm.getCapability("cells3d").gl.once("style.load", () => { (window as any).restyled = true; });
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => page.evaluate(() => (window as any).restyled), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => boxes(page), { timeout: 30_000 }).toEqual(["none", "none"]);

    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(panel(page)).toBeHidden();
    await expect.poll(() => boxes(page), { timeout: 30_000 }).toEqual(["visible", "visible"]);
  });

  test("the basemap is picked in the panel, as in Settings, and kept", async ({ page }) => {
    await openStudio(page);
    const basemap = panel(page).getByRole("combobox", { name: "Basemap" });
    await expect(basemap).toHaveValue("system");
    await basemap.selectOption("osm");
    await expect.poll(() => page.evaluate(() => window.settings.getString("mapBaseLayer", "system"))).toBe("osm");
    await basemap.selectOption("system");
    await expect.poll(() => page.evaluate(() => window.settings.getString("mapBaseLayer", "system"))).toBe("system");
  });

  test("Back leaves Studio, as it leaves anything opened over the map", async ({ page }) => {
    await openStudio(page);
    await expect(page).toHaveURL(/[?&]studio=/);
    await page.goBack();
    await expect(panel(page)).toBeHidden();
    await expect(enter(page)).toBeVisible();
  });

  test("a section plane has a handle on the map and is in the link, which opens Studio with it", async ({ page, freshPage }) => {
    await openStudio(page);
    await panel(page).getByRole("button", { name: "Upright", exact: true }).click();
    await expect(planes(page)).toHaveText(["1Upright, facing 180°"]);
    await expect(handles(page)).toHaveCount(1);

    // Level, it has no place on the ground to be held by.
    await panel(page).getByRole("button", { name: "Level", exact: true }).click();
    await expect(planes(page)).toHaveCount(2);
    await expect(handles(page)).toHaveCount(1);

    // Three is as many as a scene holds.
    await panel(page).getByRole("button", { name: "Upright", exact: true }).click();
    await expect(panel(page).getByRole("button", { name: "Upright", exact: true })).toBeDisabled();
    await expect(planes(page).nth(2)).toHaveAttribute("aria-pressed", "true");

    // Each row has its own way out, the selected plane's or not: the selection stays where it was.
    await expect(panel(page).getByRole("button", { name: /^Remove plane \d$/ })).toHaveCount(3);
    await panel(page).getByRole("button", { name: "Remove plane 3" }).click();
    await panel(page).getByRole("button", { name: "Upright", exact: true }).click();
    await expect(planes(page)).toHaveCount(3);
    await planes(page).nth(1).click();
    await panel(page).getByRole("button", { name: "Remove plane 3" }).click();
    await expect(planes(page)).toHaveCount(2);
    await expect(planes(page).nth(1)).toHaveAttribute("aria-pressed", "true");

    // The address has caught up with the scene.
    const withPlanes = async () => {
      const studio = new URL(page.url()).searchParams.get("studio") ?? "";
      try {
        return (JSON.parse(atob(studio.replace(/-/g, "+").replace(/_/g, "/")))[1][9] as unknown[]).length;
      } catch {
        return -1;
      }
    };
    await expect.poll(withPlanes).toBe(2);

    const other = await freshPage();
    await other.goto(page.url());
    await expect(panel(other)).toBeVisible({ timeout: 90_000 });
    await expect(planes(other)).toHaveText(["1Upright, facing 180°", /^2Level, at 4\.0 km$/]);
    await expect(handles(other)).toHaveCount(1);
  });

  test("a scene's keyframes mark the timeline, and it plays to its end", async ({ page }) => {
    await openStudio(page);
    const play = timeline(page).getByRole("button", { name: "Play the scene" });
    await expect(play).toBeDisabled();

    await timeline(page).getByRole("button", { name: "Keyframe", exact: true }).click();
    await expect(marks(page)).toHaveCount(1);
    await expect(timeline(page).getByRole("button", { name: "Update keyframe" })).toBeVisible();
    await timeline(page).getByRole("button", { name: "Remove the keyframe here" }).click();
    await expect(marks(page)).toHaveCount(0);

    // One slow turn round, whatever the scene's length was; then made two seconds.
    await timeline(page).getByRole("button", { name: "Orbit" }).click();
    await expect(marks(page)).toHaveCount(4);
    await expect(timeline(page)).toContainText("0.0 / 48 s");
    const length = timeline(page).getByRole("spinbutton", { name: "Length of the scene in seconds" });
    await length.fill("2");
    await length.blur();
    await expect(timeline(page)).toContainText("0.0 / 2 s");

    // Scrubbed a third of the way in, the camera is a third of the way round:
    // where the playhead is decides the map, however few frames a play draws.
    const bearing = () => page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.getBearing() as number);
    await timeline(page).getByRole("slider", { name: "Position in the scene" }).fill("0.67");
    await expect(timeline(page)).toContainText("0.7 / 2 s");
    const third = await bearing();
    expect(third).toBeGreaterThan(115);
    expect(third).toBeLessThan(125);

    // Played from there, it runs to the end, where the camera is back where it began.
    // It waits for the first frame's storms before it starts, and the
    // recording's are blank volumes that never load and are asked for again:
    // slow, on a loaded machine.
    test.setTimeout(240_000);
    await play.click();
    await expect(timeline(page)).toContainText("2.0 / 2 s", { timeout: 120_000 });
    expect(Math.abs(await bearing())).toBeLessThan(0.5);
    await expect(play).toBeEnabled();
  });

  test("the named views and lenses move the camera, and the style is picked in the panel", async ({ page }) => {
    await openStudio(page);
    const camera = () => page.evaluate(() => {
      const { gl } = (window as any).lm.getCapability("cells3d");
      return { pitch: gl.getPitch() as number, bearing: gl.getBearing() as number, fov: gl.getVerticalFieldOfView() as number };
    });
    // Turned a little by hand, then asked for the view from above: north up again.
    // (The side views' own angles are lib/studio/camera.ts's, and its unit test's.)
    await page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.jumpTo({ bearing: 40, pitch: 10 }));
    await panel(page).getByRole("button", { name: "Top", exact: true }).click();
    await expect.poll(async () => (await camera()).bearing).toBeCloseTo(0, 0);
    expect((await camera()).pitch).toBeCloseTo(0, 0);
    // The camera may tilt further here than the map lets it outside Studio.
    expect(await page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.getMaxPitch() as number)).toBe(89);

    await panel(page).getByRole("radio", { name: "Flat" }).click();
    await expect.poll(async () => (await camera()).fov).toBeCloseTo(5, 1);

    // How the storms are drawn is picked here too, where the map's own pill is put away.
    await panel(page).getByRole("radio", { name: "Shells" }).click();
    await expect(page).toHaveURL(/[?&]style=shells/);
    // Out of Studio, the map has its own lens again.
    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await camera()).fov).toBeCloseTo(36.87, 1);
    expect(await page.evaluate(() => (window as any).lm.getCapability("cells3d").gl.getMaxPitch() as number)).toBe(84);
  });
});

test("a phone's 3D map has no Studio, and a Studio link opens the map without it", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's");
  // An empty scene, as a desktop writes one.
  const scene = btoa(JSON.stringify([1, [9.5, 50.5, 6, 0, 0, 36.87, 0, 0, 0, []], 12, []])).replace(/=+$/, "");
  await page.goto(`${MAP_3D}&studio=${scene}`);
  test.slow();
  await expect(page.getByRole("button", { name: "Legend" })).toBeVisible({ timeout: 90_000 });
  await expect(enter(page)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
});
