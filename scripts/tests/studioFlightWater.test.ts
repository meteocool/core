import assert from "node:assert/strict";
import test from "node:test";
import { clipRing, heightsOf, piecesOf, polygonsOf, ringArea, surfaceOf, type WaterFeature } from "../../src/lib/studio/flight/waterMesh.ts";

const ring = (...points: Array<[number, number]>) => points.map(([x, y]) => ({ x, y }));
/** A square ring, closed as a tile's are; clockwise as the tile's y runs down. */
const square = (x0: number, y0: number, x1: number, y1: number) => ring([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
const feature = (properties: Record<string, unknown>, rings: ReturnType<typeof ring>[], id?: number, type = 3): WaterFeature => ({
  type, id, properties, loadGeometry: () => rings,
});

test("lakes are level, rivers sloped, the sea only when asked for, and reefs, lines and labels not at all", () => {
  assert.equal(surfaceOf({ type: 3, properties: { kind: "water", kind_detail: "lake" } }, true), "level");
  assert.equal(surfaceOf({ type: 3, properties: { kind: "water", kind_detail: "reservoir" } }, true), "level");
  assert.equal(surfaceOf({ type: 3, properties: { kind: "water", kind_detail: "river" } }, true), "sloped");
  assert.equal(surfaceOf({ type: 3, properties: { kind: "water" } }, true), "either");
  assert.equal(surfaceOf({ type: 3, properties: { kind: "ocean" } }, true), "sea");
  assert.equal(surfaceOf({ type: 3, properties: { kind: "ocean" } }, false), null);
  assert.equal(surfaceOf({ type: 3, properties: { kind: "reef" } }, true), null);
  assert.equal(surfaceOf({ type: 3, properties: { kind: "fountain" } }, true), null);
  assert.equal(surfaceOf({ type: 2, properties: { kind: "river" } }, true), null);
  assert.equal(surfaceOf({ type: 1, properties: { kind: "water", kind_detail: "lake" } }, true), null);
});

test("a ring is cut to its tile, with a margin where one is asked for", () => {
  const cut = clipRing(square(-100, -100, 50, 50), 4096);
  assert.equal(Math.abs(ringArea(cut)), 2 * 50 * 50);
  const wider = clipRing(square(-100, -100, 50, 50), 4096, 1);
  assert.ok(Math.abs(Math.abs(ringArea(wider)) - 2 * 51 * 51) < 1e-6);
  assert.deepEqual(clipRing(square(5000, 5000, 6000, 6000), 4096), []);
  // Wholly inside: as it was, without the closing point.
  assert.equal(clipRing(square(10, 10, 20, 20), 4096).length, 8);
});

test("a hole follows its outline, and a ring turning the outline's way starts the next polygon", () => {
  const polygons = polygonsOf([square(0, 0, 100, 100), square(10, 10, 20, 20).reverse(), square(200, 200, 300, 300)]);
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].length, 2);
  assert.equal(polygons[1].length, 1);
});

test("a tile's lake is cut into triangles that cover it, its hole left out", () => {
  const lake = feature({ kind: "water", kind_detail: "lake" }, [square(0, 0, 100, 100), square(25, 25, 75, 75).reverse()], 7);
  const [piece] = piecesOf([lake, feature({ kind: "reef" }, [square(0, 0, 10, 10)])], 4096, true);
  assert.equal(piece.surface, "level");
  assert.equal(piece.lake, "level:7");
  let area = 0;
  for (let i = 0; i < piece.triangles.length; i += 3) {
    const [a, b, c] = piece.triangles.slice(i, i + 3);
    const [ax, ay, bx, by, cx, cy] = [a, b, c].flatMap((index) => [piece.points[index * 2], piece.points[index * 2 + 1]]);
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  assert.equal(area, 100 * 100 - 50 * 50);
});

test("still water is put at the lowest ground round it, a river at the ground under each corner, the sea at 0", () => {
  const ground = (x: number) => 400 + x / 10;
  const [lake] = piecesOf([feature({ kind: "water", kind_detail: "lake" }, [square(0, 0, 100, 100)])], 4096, false);
  const level = heightsOf(lake, ground);
  assert.equal(level.level, 400);
  assert.ok(level.heights.every((height) => height === 400));

  const [river] = piecesOf([feature({ kind: "water", kind_detail: "river" }, [square(0, 0, 100, 10)])], 4096, false);
  const sloped = heightsOf(river, ground);
  assert.equal(sloped.level, null);
  assert.deepEqual([...sloped.heights].sort((a, b) => a - b), [400, 400, 410, 410]);

  const [sea] = piecesOf([feature({ kind: "ocean" }, [square(0, 0, 100, 100)])], 4096, true);
  assert.equal(heightsOf(sea, ground).level, 0);
});

test("water the tiles say nothing more of is level on flat ground and follows a valley down", () => {
  const [flat] = piecesOf([feature({ kind: "water" }, [square(0, 0, 100, 100)])], 4096, false);
  assert.equal(heightsOf(flat, (x) => 300 + x / 100).level, 300);
  const [steep] = piecesOf([feature({ kind: "water" }, [square(0, 0, 1000, 100)])], 4096, false);
  assert.equal(heightsOf(steep, (x) => 300 + x / 10).level, null);
});

test("ground not known yet leaves a level piece at 0 rather than at a guess", () => {
  const [lake] = piecesOf([feature({ kind: "water", kind_detail: "lake" }, [square(0, 0, 100, 100)])], 4096, false);
  assert.equal(heightsOf(lake, () => null).level, 0);
});
