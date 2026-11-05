import { expect, test } from "./test";
import { openRadar } from "./app";

/**
 * The rain's motion arrows: a setting, off by default, that draws the
 * newest motion over the radar map from the backend's vector tile set.
 * Its answer was written by hand (`fixtures/api/GET_v3_motion_layer.json`)
 * before staging served it; `record.ts` asks for it since. The tiles are
 * blank here, as every tile is: an empty vector tile.
 */

const TILE_SET = "5d0c1a52-8f1e-4c2b-9a77-motion000001";

test("Rain Motion is off until it is turned on in Settings, and is remembered", async ({ page }) => {
  await openRadar(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const motion = page.getByRole("switch", { name: "Rain Motion" });
  await expect(motion).not.toBeChecked();

  await motion.check();

  await expect(motion).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("layerMotion"))).toBe("true");
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "Rain Motion" })).toBeChecked();
});

test("the arrows are asked for only once they are on, from the newest tile set", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await openRadar(page);
  expect(asked.filter((path) => path === "/v3/motion/layer")).toEqual([]);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Rain Motion" }).check();

  await expect.poll(() => asked.filter((path) => path === "/v3/motion/layer").length).toBe(1);
  await expect.poll(() => asked.some((path) => path.startsWith(`/tiles/meteoradar/${TILE_SET}/`) && path.endsWith(".pbf")))
    .toBe(true);
});

test("turned off, the arrows stop being drawn and are not asked for again", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await openRadar(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const motion = page.getByRole("switch", { name: "Rain Motion" });
  await motion.check();
  await expect.poll(() => asked.filter((path) => path === "/v3/motion/layer").length).toBe(1);

  await motion.uncheck();

  expect(await page.evaluate(() => localStorage.getItem("layerMotion"))).toBeNull();
  await openRadar(page);
  expect(asked.filter((path) => path === "/v3/motion/layer").length).toBe(1);
});
