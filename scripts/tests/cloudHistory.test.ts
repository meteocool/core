import assert from "node:assert/strict";
import test from "node:test";
import {
  around, askScan, coarseOf, FALLBACK_TEMPLATE, coarseTilesIn, earlierScans, HISTORY_SCANS, limited, listOf, noFinds, pathAt, peakDbz,
  placeKey, placesToAsk, quarters, scanOnClock, scanStamp, SCAN_SECONDS, tilesToAsk, volumeOf,
} from "../../src/lib/cloudHistory.ts";
import type { Place } from "../../src/lib/cloudHistory.ts";
import type { Cutaway, CutawayHeader } from "../../src/lib/cellCutaway.ts";
import { tileCentre, tileCode } from "../../src/lib/volumeBox.ts";

const SCAN = Date.UTC(2026, 9, 5, 22, 10) / 1000;
const LISTED = "meteoradar/volumes/20261005T221000/de-T110108100714.mcvx";

test("an older scan's tile is filed beside the listed one, under its own scan", () => {
  assert.equal(scanStamp(SCAN), "20261005T221000");
  assert.equal(
    pathAt(LISTED, SCAN - 300, "de", "T100054100360"),
    "meteoradar/volumes/20261005T220500/de-T100054100360.mcvx",
  );
  assert.equal(pathAt("meteoradar/volumes/1234.mcvx", SCAN, "de", "T1"), null);
  assert.equal(pathAt(FALLBACK_TEMPLATE, SCAN, "fr", "T1"), "meteoradar/volumes/20261005T221000/fr-T1.mcvx");
});

test("the picker offers two hours of scans, newest first", () => {
  const scans = earlierScans(SCAN);
  assert.equal(scans.length, HISTORY_SCANS);
  assert.equal(HISTORY_SCANS * SCAN_SECONDS, 2 * 3600);
  assert.equal(scans[0], SCAN - 300);
  assert.equal(scans[scans.length - 1], SCAN - 2 * 3600);
});

test("each network's scan is the one on its own clock nearest the picked one", () => {
  const minute = (m: number) => SCAN + m * 60;
  // DWD's clock is the picker's.
  assert.equal(scanOnClock(minute(0), minute(-30)), minute(-30));
  // France's runs land at :29 and :34; 22:40 back to 22:10 is 22:09.
  assert.equal(scanOnClock(minute(29), minute(0)), minute(-1));
  // Nearest, either way; forward from a clock an older list left.
  assert.equal(scanOnClock(minute(2), minute(0)), minute(2));
  assert.equal(scanOnClock(minute(-61), minute(0)), minute(-1));
});

/**
 * A coarse tile 4 by 4 columns inside a one-voxel apron, two levels high,
 * with reflectivity `dbz` wherever `at(column, row)` says, rows running
 * south to north.
 */
function coarse(at: (column: number, row: number) => number | null): Pick<Cutaway, "header" | "voxels"> {
  const header = {
    nx: 6, ny: 6, nz: 2, apron: [1, 1, 0], tile: [9, 270, 177], dbz_floor: -32, dbz_scale: 2,
  } as unknown as CutawayHeader;
  const voxels = new Uint8Array(6 * 6 * 2 * 2);
  for (let z = 0; z < 2; z += 1) {
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const dbz = column >= 1 && column <= 4 && row >= 1 && row <= 4 ? at(column - 1, row - 1) : null;
        const i = ((z * 6 + row) * 6 + column) * 2;
        voxels[i] = dbz === null ? 0 : (dbz + 32) * 2;
        // The apron is sampled too, at whatever it holds; nothing of it counts.
        voxels[i + 1] = 255;
        if (dbz === null && (column === 0 || row === 0)) voxels[i] = (60 + 32) * 2;
      }
    }
  }
  return { header, voxels };
}

test("a coarse tile says which of its quarters hold a storm", () => {
  // Echo in the north-east quarter only: the upper rows, the right columns.
  const found = quarters(coarse((column, row) => (column >= 2 && row >= 2 ? 40 : 10)));
  const ne = found.find(({ tile }) => tile[1] === 541 && tile[2] === 354)!;
  assert.deepEqual(ne, { tile: [10, 541, 354], peak: 40, columns: 4 });
  for (const quarter of found.filter((q) => q !== ne)) {
    assert.equal(quarter.columns, 0);
    assert.equal(quarter.peak, 10);
  }
});

test("a quarter is asked for its tile, its core's tiles, or nothing", () => {
  assert.deepEqual(tilesToAsk({ tile: [10, 4, 6], peak: 30, columns: 1 }), [[], []]);
  assert.deepEqual(tilesToAsk({ tile: [10, 4, 6], peak: 40, columns: 9 }), [
    [[10, 4, 6]],
    [[11, 8, 12], [11, 9, 12], [11, 8, 13], [11, 9, 13]],
  ]);
  assert.deepEqual(tilesToAsk({ tile: [10, 4, 6], peak: 52, columns: 9 })[0].length, 4);
});

test("a volume found in the bucket is listed as the list would have it, peak and all", () => {
  const cutaway = {
    ...coarse((column, row) => (column === 1 && row === 2 ? 47.5 : 20)),
    centreKm: [0, 0, 4], halfKm: [1, 1, 1], extentM: [1, 1, 1],
  } as Cutaway;
  Object.assign(cutaway.header, {
    code: "T090027000177", reference_time: "2026-10-05T22:05:00Z", lon: 10.2, lat: 48.2, coverage: 0.9, sites: ["deisn"],
  });
  // Over its own ground, not the apron's 60 dBZ.
  assert.equal(peakDbz(cutaway), 47.5);
  const volume = volumeOf("meteoradar/volumes/20261005T220500/de-T090027000177.mcvx", cutaway, "de");
  assert.equal(volume.coarse, true);
  assert.equal(volume.network, "de");
  assert.equal(volume.tier, 2);
  assert.equal(volume.peak_dbz, 47.5);
  assert.deepEqual(volume.tile, [9, 270, 177]);
  assert.equal(volume.reference_time, "2026-10-05T22:05:00Z");
});

test("a scan is asked for its coarse tiles, then the fine ones only where there is echo", async () => {
  const north = coarse((column, row) => (column >= 2 && row >= 2 ? 45 : null));
  const asked: string[] = [];
  const there = new Set([
    // The north-east quarter's zoom-10 tile is not built: it is a core's.
    `meteoradar/volumes/20261005T220500/de-${tileCode(9, 270, 177)}.mcvx`,
    `meteoradar/volumes/20261005T220500/de-${tileCode(11, 1082, 708)}.mcvx`,
  ]);
  const finds = noFinds();
  const shares: number[] = [];
  const ask = {
    scanOf: () => SCAN - 300,
    template: LISTED,
    places: [{ network: "de", x: 270, y: 177 }, { network: "de", x: 271, y: 177 }],
    fine: (_place: Place, stormy: unknown[]) => stormy.length > 0,
    fetch: async (path: string) => {
      asked.push(path);
      return there.has(path) ? (north as Cutaway) : null;
    },
    progress: (share: number) => shares.push(share),
  };
  await askScan(ask, finds);
  assert.equal(finds.coarse.get("de/270/177")?.volume.coarse, true);
  assert.equal(finds.coarse.get("de/271/177"), null);
  assert.deepEqual(
    finds.fine.get("de/270/177")!.map(({ path }) => path),
    [`meteoradar/volumes/20261005T220500/de-${tileCode(11, 1082, 708)}.mcvx`],
  );
  // Two coarse tiles, one zoom-10 tile and its four cores; no other quarter.
  assert.equal(asked.length, 2 + 1 + 4);
  assert.equal(listOf(finds).length, 2);
  assert.equal(shares[shares.length - 1], 1);
  assert.ok(shares.every((share, i) => i === 0 || share >= shares[i - 1]));

  // Asked again, over the same ground: nothing it has not asked before.
  await askScan(ask, finds);
  assert.equal(asked.length, 7);
});

test("a faint tile is asked for its quarters and left off the list", async () => {
  const north = coarse((column, row) => (column >= 2 && row >= 2 ? 45 : null)) as Cutaway;
  const wisp = { ...north } as Cutaway;
  const tile = { ...north, header: { ...north.header, tile: [10, 541, 354] } } as Cutaway;
  const finds = noFinds();
  const landed: string[] = [];
  await askScan({
    scanOf: () => SCAN,
    template: LISTED,
    places: [{ network: "de", x: 270, y: 177 }],
    fine: () => true,
    // Every tile there, the coarse one and the zoom-10 one; only the coarse one drawn.
    fetch: async (path) => (path.includes(tileCode(9, 270, 177)) ? north : wisp),
    faint: (cutaway) => cutaway === wisp,
    landed: (volume) => landed.push(volume.path),
  }, finds);
  assert.equal(finds.fine.get("de/270/177")?.length, 0);
  assert.equal(listOf(finds).length, 1);
  assert.equal(landed.length, 1);

  const faintFinds = noFinds();
  await askScan({
    scanOf: () => SCAN,
    template: LISTED,
    places: [{ network: "de", x: 270, y: 177 }],
    fine: () => true,
    fetch: async (path) => (path.includes(tileCode(9, 270, 177)) ? wisp : tile),
    faint: (cutaway) => cutaway === wisp,
  }, faintFinds);
  // The coarse tile is too faint to draw, but its quarter still had a tile asked for.
  assert.equal(faintFinds.coarse.get("de/270/177")?.faint, true);
  assert.deepEqual(listOf(faintFinds).map(({ coarse: isCoarse }) => isCoarse), [false]);
});

test("a tile that would not load is not taken for one that is not there", async () => {
  const finds = noFinds();
  let fail = true;
  const ask = {
    scanOf: () => SCAN,
    template: LISTED,
    places: [{ network: "de", x: 270, y: 177 }],
    fine: () => true,
    fetch: async () => {
      if (fail) throw new Error("offline");
      return null;
    },
  };
  await askScan(ask, finds);
  assert.equal(finds.failed, 1);
  assert.equal(finds.coarse.has("de/270/177"), false);
  fail = false;
  await askScan(ask, finds);
  assert.equal(finds.coarse.get("de/270/177"), null);
});

test("the places around a scan's storms are each asked once", () => {
  const places = around([{ network: "de", x: 5, y: 5 }, { network: "de", x: 6, y: 5 }]);
  assert.equal(places.length, 12);
  assert.ok(places.some(({ x, y }) => x === 7 && y === 4));
});

test("a tile of any zoom lies in its coarse tile", () => {
  assert.deepEqual(coarseOf([11, 1082, 708]), [270, 177]);
  assert.deepEqual(coarseOf([10, 541, 354]), [270, 177]);
  assert.deepEqual(coarseOf([9, 270, 177]), [270, 177]);
});

test("the coarse tiles over the view stop short of a tilted camera's horizon", () => {
  const [lon, lat] = tileCentre(9, 270, 177);
  const [west, north] = tileCentre(9, 268, 175);
  const [east, south] = tileCentre(9, 272, 179);
  const near = coarseTilesIn([west, south, east, north], { lon, lat }, 5);
  assert.equal(near.length, 25);
  assert.ok(near.some(([x, y]) => x === 268 && y === 175));
  const far = coarseTilesIn([west - 40, south - 20, east + 40, north + 20], { lon, lat }, 2);
  assert.equal(far.length, 25);
  assert.ok(far.every(([x, y]) => Math.abs(x - 270) <= 2 && Math.abs(y - 177) <= 2));
});

test("a scan is asked where storms were, then around them, then over the view", () => {
  const storm = { network: "de", x: 10, y: 10 };
  const view = [0, 1, 2, 3].flatMap((dx) => [0, 1].map((dy) => ({ network: "de", x: 8 + dx * 3, y: 9 + dy })));
  const centre = { x: 14, y: 10 };
  const places = placesToAsk({
    storms: [storm, storm],
    view,
    // Nothing west of x = 9 is on screen.
    inView: ({ x }) => x >= 9,
    distance: ({ x, y }) => Math.hypot(x - centre.x, y - centre.y),
    count: 12,
  });
  assert.deepEqual(places[0], storm);
  const keys = places.map(placeKey);
  assert.equal(new Set(keys).size, keys.length);
  // Its neighbours next, nearest the middle first, the ones off screen left out.
  assert.deepEqual(places.slice(1, 7).map(({ x }) => x), [11, 11, 11, 10, 10, 9].sort((a, b) => b - a));
  assert.ok(!keys.includes("de/8/9"));
  // Then the rest of the view.
  assert.deepEqual(places.slice(9).map(placeKey), ["de/14/10", "de/14/9", "de/17/10"]);
  assert.equal(placesToAsk({ storms: [storm], view, inView: () => true, distance: () => 0, count: 3 }).length, 3);
  // The ones asked before are free: a look elsewhere still asks as many new ones.
  const again = placesToAsk({
    storms: [storm], view, inView: () => true, distance: () => 0, count: 3, asked: ({ x }) => x <= 11,
  });
  assert.equal(again.filter(({ x }) => x > 11).length, 3);
  assert.ok(again.some((place) => placeKey(place) === "de/10/10"));
  // The view's emptier ground a little at a time, the storms first.
  const some = placesToAsk({ storms: [storm], view, inView: () => true, distance: () => 0, count: 30, viewCount: 2 });
  assert.equal(some.length, 9 + 2);
});

test("no more than so many fetches run at once", async () => {
  const run = limited(2);
  let running = 0;
  let most = 0;
  await Promise.all([1, 2, 3, 4, 5].map((n) => run(async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return n;
  })));
  assert.equal(most, 2);
});
