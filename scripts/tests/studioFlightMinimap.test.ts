import assert from "node:assert/strict";
import test from "node:test";
import { destination } from "../../src/lib/studio/flight/geo.ts";
import {
  drawChart, place, placeAt, RANGES_NM, ringsOf, shiftSince, tileBox, TileStore, tilesOver, tileUrl, tileZoom, upOf, withinRim,
} from "../../src/components/studio/flight/minimap.ts";
import type { Chart, Tile } from "../../src/components/studio/flight/minimap.ts";

const NM = 1852;
const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/** A map over southern France, a hundred pixels from its middle to its rim. */
const chart = (over: Partial<Chart> = {}): Chart => ({
  lon: 4.6, lat: 43.3, heading: 0, headingUp: true, rangeNm: 40, radius: 100, ...over,
});

test("a place is as far from the middle as its share of the range, at every range", () => {
  for (const rangeNm of RANGES_NM) {
    const map = chart({ rangeNm });
    // Half the range due north: half way up.
    const [lon, lat] = destination(map.lon, map.lat, 0, (rangeNm / 2) * NM);
    const [x, y] = place(map, lon, lat);
    near(x, 0, 0.05);
    near(y, -50, 0.6);
    const [east] = place(map, ...destination(map.lon, map.lat, 90, rangeNm * NM));
    near(east, 100, 0.6);
  }
  assert.deepEqual(ringsOf(40), [20, 40]);
});

test("heading up, what is ahead is up and what is to the right is right", () => {
  const east = chart({ heading: 90 });
  assert.equal(upOf(east), 90);
  // Flying east: north is to the left, and the storm ahead and to the right is up and right.
  const [nx, ny] = placeAt(east, 0, 20 * NM);
  near(nx, -50, 1e-9);
  near(ny, 0, 1e-9);
  const [ax, ay] = placeAt(east, 90, 20 * NM);
  near(ax, 0, 1e-9);
  near(ay, -50, 1e-9);
  const [rx, ry] = placeAt(east, 120, 20 * NM);
  assert.ok(rx > 20 && ry < -40, `${rx}, ${ry}`);
  // The same by where it is as by its bearing.
  const [lon, lat] = destination(east.lon, east.lat, 120, 20 * NM);
  const [px, py] = place(east, lon, lat);
  near(px, rx, 0.6);
  near(py, ry, 0.6);
});

test("north up, the map stays and only the aircraft turns", () => {
  const map = chart({ heading: 200, headingUp: false });
  assert.equal(upOf(map), 0);
  const [x, y] = placeAt(map, 90, 40 * NM);
  near(x, 100, 1e-9);
  near(y, 0, 1e-9);
});

test("what is beyond the rim is held on it, on the line to it", () => {
  assert.deepEqual(withinRim([30, -40], 100), { x: 30, y: -40, beyond: false });
  const held = withinRim([300, -400], 100, 10);
  near(held.x, 54, 1e-9);
  near(held.y, -72, 1e-9);
  assert.equal(held.beyond, true);
});

test("the radar's tiles are as fine as the map is drawn, and cover it", () => {
  // The wider the range, the coarser the tile; a sharper screen takes a finer one.
  const zooms = RANGES_NM.map((rangeNm) => tileZoom(chart({ rangeNm }), 1));
  assert.deepEqual(zooms, [...zooms].sort((a, b) => b - a));
  assert.ok(zooms.every((zoom) => zoom >= 3 && zoom <= 8), String(zooms));
  assert.ok(tileZoom(chart(), 2) >= tileZoom(chart(), 1));
  for (const rangeNm of RANGES_NM) {
    const map = chart({ rangeNm });
    const zoom = tileZoom(map, 2);
    const tiles = tilesOver(map, zoom);
    // A handful, never a screenful.
    assert.ok(tiles.length >= 1 && tiles.length <= 9, `${tiles.length} tiles at ${rangeNm} NM`);
    // Every point of the rim is in one of them.
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const [x, y] = placeAt(map, bearing, rangeNm * NM * 0.999);
      const inside = tiles.some((tile) => {
        const box = tileBox(map, tile);
        return x >= box.x && x <= box.x + box.side && y >= box.y && y <= box.y + box.side;
      });
      assert.ok(inside, `nothing under the rim at ${bearing}° and ${rangeNm} NM`);
    }
  }
});

test("a tile stands where its corners are on the ground", () => {
  const map = chart({ headingUp: false });
  const tile: Tile = [7, 65, 46];
  const box = tileBox(map, tile);
  // A tile's corner, as a map's tiles are numbered: from the north-west.
  const corner = (column: number, row: number): [number, number] => [
    (column / 128) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 128))) * 180) / Math.PI,
  ];
  const [x, y] = place(map, ...corner(65, 46));
  near(box.x, x, 1e-6);
  near(box.y, y, 1e-6);
  const [right, bottom] = place(map, ...corner(66, 47));
  near(box.x + box.side, right, 1e-6);
  near(box.y + box.side, bottom, 1e-6);
  // Some 228 km across at this latitude, at 100 px to 40 NM.
  near(box.side, (40075 * Math.cos((43.3 * Math.PI) / 180) / 128) * 1000 * (100 / (40 * NM)), 0.5);
  assert.equal(tileUrl("masked://7/{z}/{x}/{y}", tile), "masked://7/7/65/46");
});

test("the picture has moved by how far the aircraft went and turned, and another map is another picture", () => {
  const drawn = chart();
  assert.equal(shiftSince(chart(), null), Infinity);
  assert.equal(shiftSince(chart({ rangeNm: 80 }), drawn), Infinity);
  assert.equal(shiftSince(chart({ headingUp: false }), drawn), Infinity);
  assert.equal(shiftSince(chart(), drawn), 0);
  // A degree's turn is 1.7 px at the rim, heading up; north up it turns the aircraft alone.
  near(shiftSince(chart({ heading: 1 }), drawn), 1.745, 0.01);
  assert.ok(shiftSince(chart({ heading: 1, headingUp: false }), chart({ headingUp: false })) < 0.5);
  // A nautical mile on is 2.5 px at 40 NM to the rim.
  const [lon, lat] = destination(drawn.lon, drawn.lat, 0, NM);
  near(shiftSince(chart({ lon, lat }), drawn), 2.5, 0.05);
});

test("a tile is asked for once, kept while it is used, and let go of when others are newer", async () => {
  const asked: string[] = [];
  const freed: string[] = [];
  let arrived = 0;
  const store = new TileStore<string>(
    async (url) => {
      asked.push(url);
      if (url === "broken") throw new Error("no network");
      return url === "empty" ? null : `picture of ${url}`;
    },
    (picture) => freed.push(picture),
    () => { arrived += 1; },
    2,
    1000,
  );
  assert.equal(store.get("a", 0), undefined);
  assert.equal(store.get("a", 1), undefined);
  assert.equal(store.peek("a", 1), undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.get("a", 2), "picture of a");
  assert.equal(arrived, 1);
  assert.deepEqual(asked, ["a"]);

  // A tile with nothing in it is known to have nothing; one that failed is asked for again, later.
  store.get("empty", 3);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.get("empty", 4), null);
  store.get("broken", 5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Three were held where two are kept: the longest unused went.
  assert.deepEqual(freed, ["picture of a"]);
  assert.equal(store.get("broken", 500), undefined);
  assert.equal(asked.filter((url) => url === "broken").length, 1);
  store.get("broken", 2000);
  assert.equal(asked.filter((url) => url === "broken").length, 2);

  // What one drawing asks for is all kept through it, though it is more than are kept.
  for (const url of ["p", "q", "r", "s"]) store.get(url, 3000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(["p", "q", "r", "s"].map((url) => store.get(url, 3000)), ["p", "q", "r", "s"].map((url) => `picture of ${url}`));
  // And the next drawing, of two others, lets go of them.
  store.get("t", 3001);
  store.get("u", 3001);
  assert.equal(store.peek("p", 3001), undefined);

  // One that arrives after everything was let go of is let go of too.
  store.get("late", 2001);
  store.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(freed.includes("picture of late"), String(freed));
});

test("the map draws the radar turned with it, and the storm flown at on the rim where it is beyond", () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const context = new Proxy({}, {
    get: (_target, name: string) => (...args: unknown[]) => { calls.push([name, ...args]); },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const map = chart({ heading: 90 });
  drawChart(context, map, {
    radar: [{ picture: "tile" as unknown as CanvasImageSource, tile: [7, 65, 46] }],
    storms: null, cores: [], inspected: null, track: [], strikes: [],
    target: { bearing: 90, distance: 200 * NM, seconds: 600, peakDbz: 60 },
  });
  // Heading east: the ground is turned a quarter back, so east is up.
  const turn = calls.find(([name]) => name === "rotate")!;
  near(turn[1] as number, -Math.PI / 2, 1e-9);
  const drawn = calls.find(([name]) => name === "drawImage")!;
  const box = tileBox(map, [7, 65, 46]);
  assert.equal(drawn[1], "tile");
  near(drawn[2] as number, box.x, 1e-9);
  near(drawn[3] as number, box.y, 1e-9);
  // Ahead and far beyond the rim: the last diamond is at the top, just inside it.
  const tops = calls.filter(([name, x]) => name === "moveTo" && x === 0).map(([, , y]) => y as number);
  assert.ok(tops.some((y) => Math.abs(y - (-91 - 6)) < 1e-9), String(tops));
});
