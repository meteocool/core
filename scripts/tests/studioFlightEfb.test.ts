import assert from "node:assert/strict";
import test from "node:test";
import { COCKPIT_SCREENS, controlAlong, onQuad, partOf, SEAT, touchAlong } from "../../src/lib/studio/flight/cockpit.ts";
import type { Quad, ScreenTouch } from "../../src/lib/studio/flight/cockpit.ts";
import {
  buttonAt, CHART_REACH_KM, chartFrame, chartStorms, defaultStorm, EFB_BUTTONS, EFB_HEIGHT, EFB_LAYOUT, EFB_RANGES_NM, EFB_START_RANGE,
  EFB_WIDTH, EfbState, echoAreas, fromMercator, MAP_MIDDLE, mercator, offChart, onChart, RING_PX, stormNear, within,
} from "../../src/lib/studio/flight/efb.ts";
import type { EfbButton } from "../../src/lib/studio/flight/efb.ts";
import { destination, distanceM } from "../../src/lib/studio/flight/geo.ts";
import type { StormMark } from "../../src/lib/studio/flight/marks.ts";
import type { StormTile } from "../../src/lib/studio/flight/spawn.ts";
import { seenFrom } from "../../src/lib/studio/flight/view.ts";
import type { Vec3 } from "../../src/lib/studio/flight/view.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const storm = (lon: number, lat: number, peakDbz = 50, extra: Partial<StormMark> = {}): StormMark => ({
  lon, lat, peakDbz, top: null, heading: null, speed: null, hail: false, ...extra,
});
const touch: ScreenTouch = { tap: () => undefined, drag: () => undefined, release: () => undefined };

/* ---- the tablet on the model ---- */

const EFB = COCKPIT_SCREENS.efb as Quad;
const middleOf = (quad: Quad): Vec3 => partOf(quad, 0.5, 0.5, 0.5, 0.5)[0];

test("the tablet's screen is 4:3, about 24 cm across, left of the seat and below the eye", () => {
  const across = Math.hypot(...minus(EFB[1], EFB[0]));
  const down = Math.hypot(...minus(EFB[3], EFB[0]));
  near(across, 0.24, 0.01);
  near(across / down, EFB_WIDTH / EFB_HEIGHT, 0.04);
  const middle = middleOf(EFB);
  assert.ok(middle[1] < SEAT[1] - 0.2, "left of the seat");
  assert.ok(middle[2] > SEAT[2] + 0.2, "below the eye");
});

test("from the seat the tablet's picture reads the right way round: its top left at the top left", () => {
  // The head turned to look at the tablet's middle.
  const look = minus(middleOf(EFB), SEAT);
  const heading = (Math.atan2(look[1], look[0]) * 180) / Math.PI;
  const pitch = (Math.atan2(-look[2], Math.hypot(look[0], look[1])) * 180) / Math.PI;
  // `seenFrom` takes no point nearer than a metre: the cockpit, ten times over, is the same picture.
  const seen = EFB.map((corner) => seenFrom({ heading, pitch, roll: 0 }, minus(corner, SEAT).map((v) => v * 10) as Vec3, 60, 1.6)!);
  const [topLeft, topRight, bottomRight, bottomLeft] = seen;
  assert.ok(topLeft.x < topRight.x && bottomLeft.x < bottomRight.x, "left is left");
  assert.ok(topLeft.y < bottomLeft.y && topRight.y < bottomRight.y, "top is up");
});

test("a line from the seat to a point of the tablet's picture is told where on it it is", () => {
  for (const [across, down] of [[0.5, 0.5], [0.1, 0.9], [0.93, 0.07]]) {
    const point = partOf(EFB, across, down, across, down)[0];
    const hit = onQuad(SEAT, minus(point, SEAT), EFB);
    assert.ok(hit);
    // Its four measured corners are not quite in one plane: a tenth of a millimetre off it.
    near(hit.across, across, 1e-3);
    near(hit.down, down, 1e-3);
    near(hit.distance, Math.hypot(...minus(point, SEAT)), 1e-3);
  }
  // Seen from behind the tablet, nothing is met.
  const behind: Vec3 = [15.3, -1.4, -0.3];
  assert.equal(onQuad(behind, minus(middleOf(EFB), behind), EFB), null);
});

test("the tablet is touched where it is, before any control behind it, and only a screen with a touch is", () => {
  const screens = [{ corners: COCKPIT_SCREENS.pfd as Quad }, { corners: EFB, touch }];
  for (const [across, down] of [[0.5, 0.5], [0.05, 0.05], [0.95, 0.95], [0.05, 0.95], [0.95, 0.05]]) {
    const way = minus(partOf(EFB, across, down, across, down)[0], SEAT);
    const hit = touchAlong(SEAT, way, screens);
    assert.ok(hit, `${across}, ${down}`);
    assert.equal(hit.index, 1);
    const control = controlAlong(SEAT, way);
    assert.ok(!control || control.distance > hit.distance, `${control?.name} in front of the tablet`);
  }
  // The primary flight display has no touch: looked at, nothing is touched.
  assert.equal(touchAlong(SEAT, minus(middleOf(COCKPIT_SCREENS.pfd as Quad), SEAT), screens), null);
  // Past the tablet's edge, neither.
  assert.equal(touchAlong(SEAT, minus(partOf(EFB, 1.1, 0.5, 1.1, 0.5)[0], SEAT), screens), null);
});

/* ---- the map ---- */

test("the map is north up, and its outer ring is the range from the aircraft", () => {
  const [lon, lat] = [4.6, 43.3];
  const frame = chartFrame(lon, lat, 80);
  const middle = onChart(frame, lon, lat);
  near(middle[0], MAP_MIDDLE[0], 1e-6);
  near(middle[1], MAP_MIDDLE[1], 1e-6);
  for (const bearing of [0, 90, 180, 270]) {
    const [x, y] = onChart(frame, ...destination(lon, lat, bearing, 80 * 1852));
    near(Math.hypot(x - middle[0], y - middle[1]), RING_PX, RING_PX * 0.02);
  }
  const north = onChart(frame, ...destination(lon, lat, 0, 50_000));
  assert.ok(north[1] < middle[1] && Math.abs(north[0] - middle[0]) < 1e-6, "north is up");
  const east = onChart(frame, ...destination(lon, lat, 90, 50_000));
  assert.ok(east[0] > middle[0], "east is right");
});

test("a point of the map is a place, and that place is drawn at that point", () => {
  const frame = chartFrame(10, 50, 40);
  for (const [x, y] of [[0, 40], [200, 260], [391, 479]]) {
    const [lon, lat] = offChart(frame, x, y);
    const [bx, by] = onChart(frame, lon, lat);
    near(bx, x, 1e-6);
    near(by, y, 1e-6);
  }
  const [lon, lat] = fromMercator(...mercator(-3.2, 61.5));
  near(lon, -3.2, 1e-9);
  near(lat, 61.5, 1e-9);
});

test("the buttons are each where they are drawn, on the map or the storm's page, and none over another", () => {
  const names = Object.keys(EFB_BUTTONS) as EfbButton[];
  for (const name of names) {
    const rect = EFB_BUTTONS[name];
    assert.equal(buttonAt(rect.x + rect.width / 2, rect.y + rect.height / 2), name);
    const inside = within(EFB_LAYOUT.map, rect.x, rect.y) && within(EFB_LAYOUT.map, rect.x + rect.width, rect.y + rect.height)
      || within(EFB_LAYOUT.panel, rect.x, rect.y) && within(EFB_LAYOUT.panel, rect.x + rect.width, rect.y + rect.height);
    assert.ok(inside, name);
    // A fingertip's worth: at least 44 pixels each way on a 640-pixel tablet.
    assert.ok(rect.width >= 44 && rect.height >= 44, name);
  }
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const [one, other] = [EFB_BUTTONS[a], EFB_BUTTONS[b]];
      const apart = one.x + one.width < other.x || other.x + other.width < one.x || one.y + one.height < other.y || other.y + other.height < one.y;
      assert.ok(apart, `${a} and ${b}`);
    }
  }
  assert.equal(buttonAt(MAP_MIDDLE[0], MAP_MIDDLE[1]), null);
});

/* ---- the storms ---- */

test("the tablet lists the marked storms, then the tracked cells, then the cores where no cell is, nearest first, within reach", () => {
  const [lon, lat] = [4.6, 43.3];
  const marked = [storm(5.0, 43.5, 55, { top: 12_000, strikes: 4 })];
  const cells = [
    storm(5.0, 43.5, 55), // the marked one again, from the cells
    storm(4.7, 43.35, 47, { heading: 60, speed: 12 }),
    storm(4.9, 43.0, 30), // too weak to be a storm
  ];
  const cores = [
    storm(4.72, 43.36, 52), // where a cell stands
    storm(6.5, 44.5, 60),
    storm(lon + 9, lat, 60), // beyond reach
  ];
  const listed = chartStorms(marked, cells, cores, lon, lat);
  assert.deepEqual(listed.map((s) => [s.lon, s.lat]), [[4.7, 43.35], [5.0, 43.5], [6.5, 44.5]]);
  // The marked one keeps what was measured of it.
  assert.equal(listed[1].strikes, 4);
  assert.equal(listed[1].top, 12_000);
  for (const each of listed) assert.ok(distanceM(lon, lat, each.lon, each.lat) <= CHART_REACH_KM * 1000);
});

test("the tablet chooses the system flown at's strongest, or with none the nearest ahead, or the nearest", () => {
  const aircraft = { lon: 0, lat: 45, heading: 90 };
  const storms = [storm(-0.3, 45, 55), storm(0.5, 45, 48), storm(1.2, 45.1, 58), storm(1.3, 44.9, 52)];
  assert.equal(defaultStorm(storms, aircraft, { lon: 1.25, lat: 45, radiusKm: 20 }), 2);
  assert.equal(defaultStorm(storms, aircraft, null), 1);
  assert.equal(defaultStorm(storms, { ...aircraft, heading: 270 }, null), 0);
  // A system with none of the listed storms in it: the nearest ahead.
  assert.equal(defaultStorm(storms, aircraft, { lon: 10, lat: 50, radiusKm: 20 }), 1);
  assert.equal(defaultStorm([], aircraft, null), -1);
});

test("a storm in a newer list is the one nearest where it was, and none where nothing is near", () => {
  const storms = [storm(1, 45), storm(1.1, 45)];
  assert.equal(stormNear(storms, 1.09, 45.01), 1);
  assert.equal(stormNear(storms, 3, 45), -1);
});

test("each storm's echo is the listed area of the strong tiles nearest it", () => {
  const storms = [storm(1, 45), storm(1.2, 45)];
  const tile = (lon: number, peakDbz: number, areaKm2: number | null): StormTile => ({ lon, lat: 45, peakDbz, areaKm2, coarse: false, tile: null });
  const tiles = [tile(0.98, 50, 100), tile(1.05, 45, 50), tile(1.17, 55, 70), tile(1.21, 20, 500), tile(2.5, 60, 900), tile(1.0, 50, null)];
  assert.deepEqual(echoAreas(storms, tiles), [150, 70]);
  assert.deepEqual(echoAreas([storm(5, 50)], tiles), [null]);
});

/* ---- a hand on it ---- */

/** A tablet with an aircraft at 4.6 E 43.3 N heading east, and three storms. */
function tablet(): EfbState {
  const efb = new EfbState();
  efb.update([storm(4.8, 43.3, 50), storm(5.2, 43.6, 58), storm(3.6, 43.1, 46)], { lon: 4.6, lat: 43.3, heading: 90 }, null);
  return efb;
}

test("a tap on a storm's mark chooses it, and it stays chosen as the list is renewed and it moves on", () => {
  const efb = tablet();
  assert.equal(efb.selected, 0);
  assert.equal(efb.chosen, false);
  const [x, y] = onChart(efb.frame(), 5.2, 43.6);
  assert.ok(efb.tap(x + 6, y - 5));
  assert.equal(efb.selected, 1);
  assert.equal(efb.chosen, true);
  // Newer: it has moved a little, and the list is in another order.
  efb.update([storm(5.22, 43.61, 57), storm(4.8, 43.3, 50)], { lon: 4.62, lat: 43.3, heading: 90 }, null);
  assert.equal(efb.selected, 0);
  assert.equal(efb.chosen, true);
  // Gone: the tablet chooses again.
  efb.update([storm(4.8, 43.3, 50)], { lon: 4.64, lat: 43.3, heading: 90 }, null);
  assert.equal(efb.selected, 0);
  assert.equal(efb.chosen, false);
});

test("a tap on nothing does nothing", () => {
  const efb = tablet();
  const version = efb.version;
  assert.equal(efb.tap(MAP_MIDDLE[0], EFB_LAYOUT.map.y + 8), false);
  assert.equal(efb.tap(EFB_LAYOUT.panel.x + 120, 300), false);
  assert.equal(efb.version, version);
  assert.equal(efb.chosen, false);
});

test("the range keys step through the ranges and stop at either end", () => {
  const efb = tablet();
  const tapOn = (button: EfbButton) => efb.tap(EFB_BUTTONS[button].x + 10, EFB_BUTTONS[button].y + 10);
  assert.equal(efb.rangeNm, EFB_RANGES_NM[EFB_START_RANGE]);
  tapOn("zoomIn");
  assert.equal(efb.rangeNm, EFB_RANGES_NM[EFB_START_RANGE - 1]);
  for (let i = 0; i < 10; i += 1) tapOn("zoomIn");
  assert.equal(efb.rangeNm, EFB_RANGES_NM[0]);
  for (let i = 0; i < 10; i += 1) tapOn("zoomOut");
  assert.equal(efb.rangeNm, EFB_RANGES_NM[EFB_RANGES_NM.length - 1]);
});

test("the storm keys go round the list, nearest first, and bring a storm off the map onto it", () => {
  const efb = tablet();
  efb.press("next");
  assert.equal(efb.selected, 1);
  efb.press("next");
  efb.press("next");
  assert.equal(efb.selected, 0);
  efb.press("previous");
  assert.equal(efb.selected, 2);
  assert.equal(efb.chosen, true);
  // At 10 NM the storm a hundred kilometres west is off the map: the map goes to it.
  for (let i = 0; i < 6; i += 1) efb.press("zoomIn");
  efb.press("next");
  efb.press("next");
  assert.equal(efb.selected, 1);
  assert.deepEqual(efb.centre, [5.2, 43.6]);
  const [x, y] = onChart(efb.frame(), 5.2, 43.6);
  near(x, MAP_MIDDLE[0], 1e-6);
  near(y, MAP_MIDDLE[1], 1e-6);
  efb.press("centre");
  assert.equal(efb.centre, null);
});

test("a drag moves the map with the hand, and the centre key brings it back to the aircraft", () => {
  const efb = tablet();
  const from: [number, number] = [150, 200];
  const place = offChart(efb.frame(), ...from);
  efb.drag(from, [180, 170]);
  efb.drag(from, [230, 260]);
  const [x, y] = onChart(efb.frame(), ...place);
  near(x, 230, 1e-6);
  near(y, 260, 1e-6);
  efb.release();
  assert.ok(efb.centre);
  efb.tap(EFB_BUTTONS.centre.x + 20, EFB_BUTTONS.centre.y + 20);
  assert.equal(efb.centre, null);
  // A drag that begins on the storm's page, or on a key, moves nothing.
  efb.drag([EFB_LAYOUT.panel.x + 40, 300], [EFB_LAYOUT.panel.x - 100, 300]);
  efb.drag([EFB_BUTTONS.zoomIn.x + 5, EFB_BUTTONS.zoomIn.y + 5], [100, 300]);
  assert.equal(efb.centre, null);
});
