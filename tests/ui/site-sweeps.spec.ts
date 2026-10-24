import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "./test";
import { flatPixel, noGeocoder, openRadar, playButton, settled, timeline } from "./app";
import type { Page } from "@playwright/test";

/**
 * Site mode: a radar's mark on the flat map opens that radar's own sweep,
 * with a tray to choose what and which tilt, over the composites dimmed.
 *
 * `/sweeps` is answered from a fixture written by hand
 * (fixtures/api/GET_sweeps.json): neither staging nor demo served the route
 * when this was written. The sweeps themselves are tiles, answered blank,
 * so the tray says the sweep could not be loaded; the tilts are the
 * listing's.
 */
const CENTRAL_GERMANY = "/?layer=radar&latLonZ=50.20000,9.20000,7.20";


/** The page pixel of a radar's mark, once the marks are drawn. */
const markOf = (page: Page, site: string) => page.evaluate((code) => {
  const map = (window as any).lm.getCurrentMap();
  const marks = map?.getAllLayers().find((layer: any) => layer.getSource?.()?.getFeatures?.()
    ?.some((feature: any) => feature.get("radarSite")));
  if (!marks?.getVisible()) return null;
  const feature = marks.getSource().getFeatures().find((candidate: any) => candidate.get("radarSite") === code);
  if (!feature) return null;
  const [x, y] = map.getPixelFromCoordinate(feature.getGeometry().getCoordinates());
  const rect = map.getViewport().getBoundingClientRect();
  const at = { x: rect.left + x, y: rect.top + y };
  const top = document.elementFromPoint(at.x, at.y);
  return top && map.getViewport().contains(top) ? at : null;
}, site);

/** How strongly DWD's composite is drawn. */
const compositeOpacity = (page: Page) => page.evaluate(() => (window as any).radar?.layer?.getOpacity() ?? null);

/** Whether DWD's composite is drawn in grey: its palette's strongest class, as its style has it. */
const compositeGrey = (page: Page) => page.evaluate(() => {
  const colours = (window as any).radar?.layer?.style_?.color?.[1]?.[2] as number[][] | undefined;
  const [r, g, b] = colours?.[colours.length - 1] ?? [];
  return r === g && g === b;
});

test("the radars' marks are on by default", async ({ page }) => {
  await noGeocoder(page);
  await openRadar(page, CENTRAL_GERMANY);
  await expect.poll(() => markOf(page, "deoft"), { timeout: 20_000 }).not.toBeNull();
});

test("the radars' marks stay off once turned off in Settings", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("layerSites", "false"));
  await noGeocoder(page);
  await openRadar(page, CENTRAL_GERMANY);
  await expect.poll(() => compositeOpacity(page), { timeout: 20_000 }).not.toBeNull();
  expect(await markOf(page, "deoft")).toBeNull();
});

test.describe("with the radars' marks on", () => {
  // On by default; every test below turns it on all the same, so none depends on it.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("layerSites", "true"));
  });

  test("a radar's mark opens its sweep and lists its tilts, and one that cannot be loaded leaves the composites whole", async ({ page }) => {
    await noGeocoder(page);
    await openRadar(page, CENTRAL_GERMANY);
    await expect.poll(() => markOf(page, "deoft"), { timeout: 20_000 }).not.toBeNull();
    await expect.poll(() => compositeOpacity(page), { timeout: 20_000 }).not.toBeNull();
    const before = (await compositeOpacity(page))!;

    const at = (await markOf(page, "deoft"))!;
    await page.mouse.click(at.x, at.y);

    const tray = page.getByRole("group", { name: "Offenthal radar" });
    await settled(tray);
    // Two rows at most, and the player grows by them rather than pushing the
    // strip and the play button out of its bottom.
    expect((await tray.boundingBox())!.height).toBeLessThanOrEqual(61);
    const player = page.locator(".timeslider");
    expect(await player.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    const [play, box] = [(await playButton(page).boundingBox())!, (await player.boundingBox())!];
    expect(play.y + play.height).toBeLessThanOrEqual(box.y + box.height);
    const tilts = tray.getByRole("combobox", { name: "Tilt" });
    await expect(tilts.locator("option")).toHaveCount(6);
    await expect(tilts.locator("option").first()).toHaveText(/^0\.5° · /);
    // Nothing drawn over them, so nothing to dim them for.
    await expect(tray.getByText("This sweep could not be loaded", { exact: true })).toBeVisible();
    expect(await compositeOpacity(page)).toBeCloseTo(before, 5);

    // Velocity is offered, the site having published it.
    await tray.getByRole("radio", { name: "Velocity", exact: true }).click();
    await expect(tray.getByRole("radio", { name: "Velocity", exact: true })).toBeChecked();
    await expect(tray.getByRole("combobox", { name: "Tilt" }).locator("option")).toHaveCount(6);

    await tray.getByRole("button", { name: "Close the radar" }).click();
    await expect(tray).toBeHidden();
    await expect.poll(() => compositeOpacity(page)).toBeCloseTo(before, 5);
  });

  /** Open Offenthal's radar from its mark, and wait for its tray. */
  async function openOffenthal(page: Page) {
    await expect.poll(() => markOf(page, "deoft"), { timeout: 20_000 }).not.toBeNull();
    const at = (await markOf(page, "deoft"))!;
    await page.mouse.click(at.x, at.y);
    const tray = page.getByRole("group", { name: "Offenthal radar" });
    await settled(tray);
    return tray;
  }

  test("with no storm selected, SRV takes a motion set by hand on the dial, says so, and keeps it", async ({ page }) => {
    await noGeocoder(page);
    await openRadar(page, CENTRAL_GERMANY);
    let tray = await openOffenthal(page);
    await tray.getByRole("radio", { name: "Storm-relative", exact: true }).click();

    // Nothing set yet: standing still, so nothing is taken out, and the badge says so.
    let motion = tray.getByRole("button", { name: /^Motion: / });
    await expect(motion).toHaveText("Motion: manual · 0 km/h NE");
    await expect(tray.getByText("No motion set", { exact: true })).toBeVisible();
    // One row more, and the player grows by it rather than clipping the play button.
    await settled(tray);
    expect((await tray.boundingBox())!.height).toBeLessThanOrEqual(93);
    const player = page.locator(".timeslider");
    expect(await player.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    const [play, box] = [(await playButton(page).boundingBox())!, (await player.boundingBox())!];
    expect(play.y + play.height).toBeLessThanOrEqual(box.y + box.height);

    // The row opens the dial. A thumb on its south-west points the arrow
    // there; dragged round past the dial's edge to the east, it follows.
    await motion.click();
    const controls = page.getByRole("dialog", { name: "Storm motion" });
    const dial = controls.getByRole("slider", { name: "Heading" });
    await expect(dial).toBeVisible();
    const face = (await dial.boundingBox())!;
    const centre = { x: face.x + face.width / 2, y: face.y + face.height / 2 };
    await page.mouse.move(centre.x - 30, centre.y + 30);
    await page.mouse.down();
    await expect(dial).toHaveAttribute("aria-valuenow", "225");
    await page.mouse.move(centre.x + 120, centre.y, { steps: 6 });
    await page.mouse.up();
    await expect(dial).toHaveAttribute("aria-valuenow", "90");

    // Three clicks back with the keys, and six steps of speed.
    await dial.press("ArrowLeft");
    await dial.press("ArrowLeft");
    await dial.press("ArrowLeft");
    const faster = controls.getByRole("button", { name: "Faster" });
    for (let i = 0; i < 6; i++) await faster.click();
    await expect(controls.getByRole("spinbutton", { name: "Speed in km/h" })).toHaveValue("30");
    await expect(dial).toHaveAttribute("aria-valuenow", "75");

    // The tray says whose motion it is and what, with the dial put away.
    // Escape puts the dial away and leaves the radar open.
    await dial.press("Escape");
    await expect(controls).toBeHidden();
    await expect(tray).toBeVisible();
    await expect(motion).toHaveText("Motion: manual · 30 km/h ENE");
    await expect(tray.getByText("No motion set", { exact: true })).toBeHidden();

    // Kept in the settings, and there again after a reload.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("srvMotion"))).toBe("75,30");
    await openRadar(page, CENTRAL_GERMANY);
    tray = await openOffenthal(page);
    await tray.getByRole("radio", { name: "Storm-relative", exact: true }).click();
    motion = tray.getByRole("button", { name: /^Motion: / });
    await expect(motion).toHaveText("Motion: manual · 30 km/h ENE");
  });

  /**
   * The same with real sweeps behind the listing: Borkum's (deasb) 0.5 degree tilt of
   * 2026-10-09 18:20, from staging's archive
   * (fixtures/sweeps). Whatever the listing names, these two objects answer.
   */
  const EMDEN = "/?layer=radar&latLonZ=53.70000,6.90000,8.20";

  test("a real sweep is drawn, says when it was scanned and that it was dealiased, and the hold reads it", async ({ page }) => {
    await noGeocoder(page);
    await page.route("**/meteoradar/sweeps/**", (route) => {
      const quantity = route.request().url().endsWith("VRADH.mcsw") ? "VRADH" : "DBZH";
      // Unwrapped here: a fulfilled route skips the browser's own gunzip,
      // which is what `Content-Encoding: gzip` buys from the bucket.
      const body = gunzipSync(readFileSync(`tests/ui/fixtures/sweeps/${quantity}.mcsw`));
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    });
    await openRadar(page, EMDEN);
    await expect.poll(() => markOf(page, "deasb"), { timeout: 20_000 }).not.toBeNull();
    const at = (await markOf(page, "deasb"))!;
    await page.mouse.click(at.x, at.y);

    const tray = page.getByRole("group", { name: "Borkum radar" });
    await settled(tray);
    await expect(tray.getByText(/^Scanned \d\d?:\d\d:\d\d/)).toBeVisible({ timeout: 15_000 });
    const drawn = () => page.evaluate(() => {
      const map = (window as any).lm.getCurrentMap();
      const layer = map.getAllLayers().find((candidate: any) => candidate.getZIndex() === 85);
      return layer?.getVisible() ?? false;
    });
    await expect.poll(drawn).toBe(true);

    await tray.getByRole("radio", { name: "Velocity", exact: true }).click();
    await expect(tray.getByText("Dealiased", { exact: true })).toBeVisible({ timeout: 15_000 });
    // The legend's labels each have room of their own, on a phone too.
    const labels = await page.locator(".timeslider .scale-tick")
      .evaluateAll((ticks) => ticks.map((tick) => tick.getBoundingClientRect()).map(({ left, right }) => ({ left, right })));
    expect(labels.length).toBeGreaterThan(2);
    labels.slice(1).forEach((label, i) => expect(label.left).toBeGreaterThan(labels[i].right));

    // Hold 20 km north-east of the radar, inside the sweep: the menu reads the bin.
    const box = await page.locator("#map").boundingBox();
    const target = await page.evaluate(() => {
      const map = (window as any).lm.getCurrentMap();
      const x = (6.95 * Math.PI * 6378137) / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + (53.72 * Math.PI) / 360)) * 6378137;
      const [px, py] = map.getPixelFromCoordinate([x, y]);
      const rect = map.getViewport().getBoundingClientRect();
      return { x: rect.left + px, y: rect.top + py };
    });
    expect(box).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await expect(page.locator(".site-reading .where")).toHaveText(/° · \d+\.\d km · beam \d+\.\d km$/, { timeout: 10_000 });
  });

  /* Borkum's sweep reaches 180 km. Out at sea 230 km north of it there is
     no other radar's mark and no storm to hit. */
  const BORKUM = "/?layer=radar&latLonZ=53.56413,6.74832,6.20";

  test("the timeline stays with a radar open, and Escape or a click past its reach closes it", async ({ page }) => {
    await noGeocoder(page);
    await page.route("**/meteoradar/sweeps/**", (route) => {
      const body = gunzipSync(readFileSync("tests/ui/fixtures/sweeps/DBZH.mcsw"));
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    });
    await openRadar(page, BORKUM);
    await expect.poll(() => markOf(page, "deasb"), { timeout: 20_000 }).not.toBeNull();
    const open = async () => {
      const at = (await markOf(page, "deasb"))!;
      await page.mouse.click(at.x, at.y);
      const tray = page.getByRole("group", { name: "Borkum radar" });
      await settled(tray);
      await expect(tray.getByText(/^Scanned \d\d?:\d\d:\d\d/)).toBeVisible({ timeout: 15_000 });
      return tray;
    };

    // Its sweeps are scrubbed and played as the frames are.
    const tray = await open();
    await expect(timeline(page)).toBeVisible();
    await expect(page.locator("button.controlButton.play")).toBeVisible();

    // Inside its reach, 100 km east: still open.
    const inside = await flatPixel(page, 8.25, 53.56413);
    await page.mouse.click(inside.x, inside.y);
    await page.waitForTimeout(400);
    await expect(tray).toBeVisible();

    const outside = await flatPixel(page, 6.74832, 55.63);
    await page.mouse.click(outside.x, outside.y);
    await expect(tray).toBeHidden();
    await expect(timeline(page)).toBeVisible();

    await open();
    await page.keyboard.press("Escape");
    await expect(tray).toBeHidden();
    await expect(timeline(page)).toBeVisible();

    // Opened again and again, it is drawn every time. Closing lets go of the
    // sweep's WebGL context, and the browser's word that it was lost, landing
    // after the next radar had built its own, left every other one blank.
    const draws = () => page.evaluate(() => (window as any).lm.getCurrentMap().getAllLayers()
      .find((layer: any) => layer.getZIndex() === 85 && layer.sweeps)?.sweeps.stats.draws ?? 0);
    for (let i = 0; i < 3; i += 1) {
      const before = await draws();
      await open();
      await expect.poll(draws).toBeGreaterThan(before);
      await page.keyboard.press("Escape");
      await expect(tray).toBeHidden();
      await page.waitForTimeout(300);
    }
  });

  test("a link opens a radar and its time; one the radar has moved past opens on its newest", async ({ page }) => {
    await noGeocoder(page);
    await page.route("**/meteoradar/sweeps/**", (route) => route.fulfill({
      status: 200, contentType: "application/octet-stream", body: gunzipSync(readFileSync("tests/ui/fixtures/sweeps/DBZH.mcsw")),
    }));
    // No view in the link: the map goes to the radar.
    await openRadar(page, "/?layer=radar&radar=deasb&tilt=0.5");
    const tray = page.getByRole("group", { name: "Borkum radar" });
    await settled(tray);
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");
    // What is open is written back, and a tilt turned with it.
    await expect.poll(() => new URL(page.url()).searchParams.get("radar")).toBe("deasb");
    expect(new URL(page.url()).searchParams.get("latLonZ")).toMatch(/^53\.5\d+,6\.7\d+,/);
    await tray.getByRole("radio", { name: "Velocity", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("sweep")).toBe("velocity");

    // A step before the radar's hour, from a link sent a while ago: its newest instead.
    const early = new URL(page.url());
    await timeline(page).focus();
    for (let i = 0; i < 13; i += 1) await page.keyboard.press("ArrowLeft");
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-1h");
    await expect.poll(() => new URL(page.url()).searchParams.get("t")).not.toBeNull();
    const t = new URL(page.url()).searchParams.get("t")!;
    const before = new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13)) - 30 * 60_000);
    early.searchParams.set("t", `${before.toISOString().slice(0, 16).replace(/[-:]/g, "")}Z`);
    await openRadar(page, `${early.pathname}${early.search}`);
    await settled(page.getByRole("group", { name: "Borkum radar" }));
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");
  });

  /**
   * Borkum's real sweep as the scan a path names: its header's scan time set to
   * the path's, so each step's sweep says it is its own.
   */
  function sweepScannedAs(path: string): Buffer {
    const quantity = path.endsWith("VRADH.mcsw") ? "VRADH" : "DBZH";
    const object = gunzipSync(readFileSync(`tests/ui/fixtures/sweeps/${quantity}.mcsw`));
    const length = object.readUInt32LE(8);
    const header = JSON.parse(object.subarray(12, 12 + length).toString("utf8"));
    const [, d, t] = /\/(\d{8})T(\d{6})\//.exec(path)!;
    header.scanned_at = header.started_at =
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`;
    const json = Buffer.from(JSON.stringify(header), "utf8");
    const head = Buffer.from(object.subarray(0, 12));
    head.writeUInt32LE(json.length, 8);
    return Buffer.concat([head, json, object.subarray(12 + length)]);
  }

  test("playing over the past, each step's sweep is drawn the first time round, only steps with one are played or scrubbed to, and the composites dim and grey only under one", async ({ page }) => {
    // Playback waits for its frames, which a busy machine draws slowly.
    test.setTimeout(90_000);
    await noGeocoder(page);
    // A second a sweep, more than a step of playback (450 ms): the next steps'
    // must already be on their way when their step comes.
    await page.route("**/meteoradar/sweeps/**", async (route) => {
      const body = sweepScannedAs(new URL(route.request().url()).pathname);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    });
    await openRadar(page, EMDEN);
    await expect.poll(() => compositeOpacity(page), { timeout: 20_000 }).not.toBeNull();
    const before = (await compositeOpacity(page))!;

    // Back to before the listing's hour (00:40 to 01:35), where it has no
    // sweep: opened there, the player moves on to its newest.
    await timeline(page).focus();
    for (let i = 0; i < 13; i += 1) await page.keyboard.press("ArrowLeft");
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-1h10m");
    expect(await compositeGrey(page)).toBe(false);
    await expect.poll(() => markOf(page, "deasb"), { timeout: 20_000 }).not.toBeNull();
    const at = (await markOf(page, "deasb"))!;
    await page.mouse.click(at.x, at.y);
    const tray = page.getByRole("group", { name: "Borkum radar" });
    await settled(tray);
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");
    // The steps it has none for are hatched: before its hour, and now and the forecast after it.
    await expect(page.locator(".timeslider rect.no-sweep")).toHaveCount(2);

    // Play through the hour once and round again, the page noting every step
    // played and every scan time the tray shows: each is a sweep drawn.
    await tray.evaluate((element) => {
      const slider = document.querySelector("[role=slider][aria-label='Radar timeline']")!;
      const seen = { steps: [] as string[], played: [] as string[], scans: [] as string[], none: [] as string[] };
      (window as any).seen = seen;
      const note = () => {
        const step = slider.getAttribute("aria-valuetext");
        const time = element.querySelector(".time")?.textContent;
        if (step && seen.played[seen.played.length - 1] !== step) seen.played.push(step);
        if (step && !seen.steps.includes(step)) seen.steps.push(step);
        if (time && !seen.scans.includes(time)) seen.scans.push(time);
        if (step && element.textContent?.includes("No sweep at this time")) seen.none.push(step);
      };
      new MutationObserver(note).observe(element, { subtree: true, childList: true, characterData: true });
      new MutationObserver(note).observe(slider, { attributes: true, attributeFilter: ["aria-valuetext"] });
    });
    await playButton(page).click();
    // Round again: a step played a second time.
    await expect.poll(() => page.evaluate(() => (window as any).seen.played.length > (window as any).seen.steps.length), { timeout: 60_000 }).toBe(true);
    const shown: string[] = await page.evaluate(() => (window as any).seen.scans);
    // Twelve scans in the hour; the first has no step ahead of it to be
    // fetched from.
    expect(shown.length, shown.join(", ")).toBeGreaterThanOrEqual(8);
    await expect.poll(() => compositeOpacity(page)).toBeCloseTo(before * 0.6, 5);
    expect(await compositeGrey(page)).toBe(true);

    // Only the steps it has a sweep for: from its first, an hour back, to the
    // newest observation five minutes back, and round to the first again,
    // never on into "Now" and the forecast past it.
    const played: string[] = await page.evaluate(() => (window as any).seen.played);
    // Played from its newest, round to its first. The tray may note the
    // step it opened on first, as its sweep comes in.
    expect(played.filter((step, i) => i > 0 || step !== "-5m")[0], played.join(", ")).toBe("-1h");
    expect(played.slice(played.indexOf("-5m") + 1)[0], played.join(", ")).toBe("-1h");
    expect(played.filter((step) => step === "Now" || step.startsWith("+")), played.join(", ")).toEqual([]);
    expect(await page.evaluate(() => (window as any).seen.none)).toEqual([]);

    // Scrubbed by hand, the needle keeps to the same steps.
    await playButton(page).click();
    await timeline(page).focus();
    await page.keyboard.press("End");
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");
    await page.keyboard.press("ArrowRight");
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("Shift+ArrowLeft");
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-1h");
    // A tap on the forecast rests on its last sweep.
    const strip = (await timeline(page).boundingBox())!;
    await page.mouse.click(strip.x + strip.width * 0.9, strip.y + strip.height / 2);
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", "-5m");

    // Closed, the composites come back whole.
    await tray.getByRole("button", { name: "Close the radar" }).click();
    await expect(tray).toBeHidden();
    await expect.poll(() => compositeOpacity(page)).toBeCloseTo(before, 5);
    expect(await compositeGrey(page)).toBe(false);
  });
});
