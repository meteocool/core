import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { open3d } from "./app";
import { recorded } from "./storms";
import { tileCentre, tileCode } from "../../src/lib/volumeBox";

/**
 * The 3D map handing one picture of a storm over to the next: a coarse tile
 * drawn until every fine tile that replaces it is in, so zooming in never
 * empties the sky while they load, and a volume that failed asked for again
 * without the camera moving.
 *
 * The recording's volumes are tiles with blank textures (offline.ts), so the
 * test serves its own: one coarse tile over southern France and the four
 * tiles in it, each a slab of 50 dBZ, the fine ones held back until it lets
 * them go.
 */

const COARSE: [number, number, number] = [9, 265, 187];
const FINE: Array<[number, number, number]> = [[10, 530, 374], [10, 531, 374], [10, 530, 375], [10, 531, 375]];
const NETWORK = "fr";
const ACROSS = 52;
const APRON = 1;
const LEVELS = 16;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8;

const answer = recorded("GET_cells_volumes");
const SCAN = answer.reference_time as string;
const RUN = SCAN.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z$/, "");
const pathOf = (tile: readonly number[]) => `meteoradar/volumes/${RUN}/${NETWORK}-${tileCode(tile[0], tile[1], tile[2])}.mcvx`;

/** The list entry for a tile. */
function listed(tile: [number, number, number]) {
  const [lon, lat] = tileCentre(...tile);
  return {
    path: pathOf(tile), coverage: 1, sites: ["frnim"], bytes: 0, tier: 2, scanned_at: SCAN, oldest_scan_at: SCAN,
    code: tileCode(...tile), network: NETWORK, lon, lat, tile, system: tileCode(...COARSE), feature: null,
    coarse: tile[0] === COARSE[0], peak_dbz: 50, area_km2: 400, seed_dbz: 25, reference_time: SCAN,
  };
}

/** A tile's volume file: its header, and every voxel of its lower half 50 dBZ, seen well. */
function volumeFile(tile: [number, number, number]): Buffer {
  const [lon, lat] = tileCentre(...tile);
  const side = ACROSS + 2 * APRON;
  const step = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / 2 ** tile[0] / ACROSS;
  const header = {
    code: tileCode(...tile), reference_time: SCAN, lon, lat, nx: side, ny: side, nz: LEVELS,
    step_m: [step, step, 500], origin_m: [-(side / 2) * step, -(side / 2) * step, 0],
    dbz_floor: 0, dbz_scale: 2, sites: ["frnim"], coverage: 1, network: NETWORK, tier: 2, tile, apron: [APRON, APRON, 0],
  };
  const voxels = Buffer.alloc(side * side * LEVELS * 2);
  for (let i = 0; i < side * side * (LEVELS / 2); i += 1) {
    voxels[i * 2] = 100;
    voxels[i * 2 + 1] = 255;
  }
  const json = Buffer.from(JSON.stringify(header));
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x5856434d, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(json.length, 8);
  return Buffer.concat([head, json, voxels]);
}

/**
 * Serve the five tiles, the fine ones only once `release` lets them go;
 * `fail` answers a path's first request with an error.
 */
async function serveTiles(page: Page, { fail = null as string | null } = {}) {
  const requests = new Map<string, number>();
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  const tiles = new Map([COARSE, ...FINE].map((tile) => [pathOf(tile), tile]));
  await page.route("**/cells/volumes**", (route) => route.fulfill({
    json: { ...answer, volumes: [COARSE, ...FINE].map(listed) },
  }));
  await page.route("**/*.mcvx", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*?(meteoradar\/)/, "$1");
    const tile = tiles.get(path);
    if (!tile) return route.fulfill({ status: 404 });
    const count = (requests.get(path) ?? 0) + 1;
    requests.set(path, count);
    if (tile[0] !== COARSE[0]) await released;
    if (path === fail && count === 1) return route.fulfill({ status: 500 });
    return route.fulfill({ status: 200, contentType: "application/octet-stream", body: volumeFile(tile) });
  });
  return { release: () => release(), requests };
}

/**
 * Every set of volumes handed to the layer, from now on, by tile code: to
 * whichever layer the map holds, as a style loading again makes a new one.
 */
const watchLayer = (page: Page) => page.evaluate(() => {
  const capability = (window as any).lm.getCapability("cells3d");
  const pushes: string[][] = [];
  (window as any).__pushes = pushes;
  (window as any).__layers = 0;
  const watch = (layer: any) => {
    if (!layer || layer.__watched) return layer;
    const set = layer.setClouds.bind(layer);
    layer.setClouds = (next: Array<{ cutaway: { header: { code: string } } }>) => {
      pushes.push(next.map((cloud) => cloud.cutaway.header.code));
      return set(next);
    };
    layer.__watched = true;
    (window as any).__layers += 1;
    return layer;
  };
  let current = watch(capability.cloudsLayer);
  Object.defineProperty(capability, "cloudsLayer", {
    configurable: true,
    get: () => current,
    set: (layer) => { current = watch(layer); },
  });
});
const pushes = (page: Page): Promise<string[][]> => page.evaluate(() => (window as any).__pushes);
const drawnNow = async (page: Page) => (await pushes(page)).at(-1) ?? [];

/** What the map holds and is fetching, for a failure to say where it stuck. */
const held = (page: Page) => page.evaluate(() => {
  const capability = (window as any).lm.getCapability("cells3d");
  const code = (path: string) => /-(T\d+)\.mcvx$/.exec(path)?.[1] ?? path;
  return JSON.stringify({
    zoom: capability.gl.getZoom(),
    layers: (window as any).__layers,
    fine: [...capability.fineTiles],
    wanted: capability.wanted().map((volume: { path: string }) => code(volume.path)),
    held: [...capability.cutaways.keys()].map(code),
    fetching: [...capability.fetching.keys()].map(code),
    retries: [...capability.retries.failures].map(([path, failure]: [string, unknown]) => [code(path), failure]),
  });
});

/** Wait until the layer is handed exactly the four fine tiles, saying what it held if it never is. */
async function untilFine(page: Page, timeout: number) {
  try {
    await expect.poll(async () => [...await drawnNow(page)].sort(), { timeout }).toEqual([...FINE_CODES].sort());
  } catch (error) {
    throw new Error(`${(error as Error).message}\nheld: ${await held(page)}`);
  }
}

const COARSE_CODE = tileCode(...COARSE);
const FINE_CODES = FINE.map((tile) => tileCode(...tile));
const [CENTRE_LON, CENTRE_LAT] = tileCentre(...COARSE);
/** Looking straight down at the coarse tile, small enough on screen to be drawn whole. */
const FAR = `/?layer=cells3d&latLonZ=${CENTRE_LAT.toFixed(5)},${CENTRE_LON.toFixed(5)},9.00&pitch=0&bearing=0`;

/** Open the map on the coarse tile, drawn, and start watching what the layer is handed. */
async function openOnCoarse(page: Page) {
  await open3d(page, FAR);
  await expect.poll(() => page.evaluate((code) => {
    const capability = (window as any).lm?.getCapability("cells3d");
    return Boolean(capability?.cloudsLayer) && [...capability.cutaways.values()].some((entry: any) => entry.code === code);
  }, COARSE_CODE), { timeout: 30_000 }).toBe(true);
  await watchLayer(page);
}

/** Zoom in until the coarse tile stands large enough to be drawn as its tiles. */
const zoomIn = (page: Page) => page.evaluate(() => {
  const gl = (window as any).lm.getCapability("cells3d").gl;
  gl.jumpTo({ zoom: gl.getZoom() + 1.5 });
});

test.describe("handing a storm over to finer tiles", () => {
  test.skip(({ isMobile }) => isMobile, "one browser is enough for the loading, which is the same in both");
  // The 3D map's bring-up and a retry's back-off: past 45 s on a loaded machine.
  test.slow();

  test("the coarse tile stays until every tile in it is in, then they take its place at once", async ({ page }) => {
    const { release } = await serveTiles(page);
    await openOnCoarse(page);
    await zoomIn(page);
    // Its tiles asked for and held back: the coarse tile is still drawn.
    await expect.poll(() => page.evaluate(() => (window as any).lm.getCapability("cells3d").fetching.size)).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await drawnNow(page)).toEqual([COARSE_CODE]);
    release();
    await untilFine(page, 30_000);
    // Never less than the whole place in between: the coarse tile, or all four.
    for (const drawn of await pushes(page)) {
      const whole = drawn.includes(COARSE_CODE) || FINE_CODES.every((code) => drawn.includes(code));
      expect(whole, `handed over ${drawn.join(", ") || "nothing"}`).toBe(true);
      expect(drawn.includes(COARSE_CODE) && FINE_CODES.some((code) => drawn.includes(code)), "both drawn at once").toBe(false);
    }
  });

  test("a tile that failed is asked for again without the camera moving", async ({ page }) => {
    const failing = pathOf(FINE[2]);
    const { release, requests } = await serveTiles(page, { fail: failing });
    await openOnCoarse(page);
    release();
    await zoomIn(page);
    await untilFine(page, 40_000);
    expect(requests.get(failing)).toBe(2);
  });
});
