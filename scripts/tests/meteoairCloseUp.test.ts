import assert from "node:assert/strict";
import test from "node:test";
import {
  blankChaseView, ChaseCamera, CLOSE_UP_M, CloseUpLook, FOLLOW_S, FULL_AGAIN_S, LOOK_YAW, lostBits, ModelChoice,
} from "../../src/lib/studio/flight/airspace/closeUp.ts";
import { apart, DOCK_MARGIN, dockPlace, doingOf } from "../../src/lib/studio/flight/airspace/card.ts";
import type { Box } from "../../src/lib/studio/flight/airspace/card.ts";
import { blankLook, FIRE_PLACES } from "../../src/lib/studio/flight/airspace/look.ts";
import type { OtherAircraft } from "../../src/lib/studio/flight/airspace/traffic.ts";
import { GEAR_DOWN, ON_GROUND, PAUSED } from "../../src/lib/studio/flight/airspace/wire.ts";
import { overCloseUp, sharedOf } from "../../src/lib/studio/flight/airspace/shared.ts";
import { Traffic } from "../../src/lib/studio/flight/airspace/traffic.ts";

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const SUN: [number, number, number] = [0.3, 0.4, -0.866];

/** Where a point of the aircraft's frame goes through a model-view: x right, y up, z back. */
function seen(m: Float32Array, [f, r, d]: number[]): number[] {
  return [0, 1, 2].map((row) => m[row] * f + m[4 + row] * r + m[8 + row] * d + m[12 + row]);
}

function aircraft(change: Partial<OtherAircraft["shown"]> = {}, id = 5): OtherAircraft {
  return {
    id, callsign: "D-ABCD", look: blankLook(), heardAt: 0, since: 0, interval: 200, delay: 400, drawn: null, states: [], first: 0, count: 0, evaluatedAt: 0,
    shown: { lon: 9.5, lat: 50.4, altitude: 10_000, heading: 90, pitch: 2, roll: 0, east: 220, north: 0, up: 0, flags: 0, opacity: 1, ...change },
  };
}

test("the camera has the aircraft in the middle, so far ahead, and the horizon level whatever the aircraft does", () => {
  const camera = new ChaseCamera();
  const view = blankChaseView();
  camera.follow({ heading: 40, pitch: 12, roll: -35 }, 0.016, SUN, view);
  const middle = seen(view.modelView, [0, 0, 0]);
  near(middle[0], 0, 1e-5);
  near(middle[1], 0, 1e-5);
  near(middle[2], -CLOSE_UP_M, 1e-4);
  // The world's up, through the camera that sees the world: straight up the picture, never tilted.
  const up = [0, 1, 2].map((row) => -view.worldView[8 + row]);
  near(up[0], 0, 1e-6);
  assert.ok(up[1] > 0.9);
  // The aircraft's frame and the world's agree: its nose is where the world says it points.
  const nose = seen(view.modelView, [20, 0, 0]);
  const h = (40 * Math.PI) / 180;
  const p = (12 * Math.PI) / 180;
  const world = [Math.cos(h) * Math.cos(p) * 20, Math.sin(h) * Math.cos(p) * 20, -Math.sin(p) * 20];
  const w = view.worldView;
  const viaWorld = [0, 1, 2].map((row) => w[row] * world[0] + w[4 + row] * world[1] + w[8 + row] * world[2] + w[12 + row]);
  nose.forEach((value, i) => near(value, viaWorld[i], 1e-3));
  // And the light is the sun's, in the aircraft's frame.
  near(Math.hypot(...view.light), Math.hypot(...SUN), 1e-9);
});

test("a bank, a climb and a dive read against the horizon", () => {
  const camera = new ChaseCamera();
  const view = blankChaseView();
  camera.follow({ heading: 0, pitch: 0, roll: 30 }, 0, SUN, view);
  // Banked right: the right wing's tip lower in the picture than the left's.
  assert.ok(seen(view.modelView, [0, 17, 0])[1] < seen(view.modelView, [0, -17, 0])[1]);
  camera.reset();
  camera.follow({ heading: 0, pitch: 15, roll: 0 }, 0, SUN, view);
  assert.ok(seen(view.modelView, [18, 0, 0])[1] > seen(view.modelView, [-18, 0, 0])[1], "nose up in a climb");
  camera.reset();
  camera.follow({ heading: 0, pitch: -40, roll: 0 }, 0, SUN, view);
  assert.ok(seen(view.modelView, [18, 0, 0])[1] < seen(view.modelView, [-18, 0, 0])[1], "nose down in a dive");
});

test("the camera comes round after a turn at its own pace, and starts behind the aircraft at once", () => {
  const camera = new ChaseCamera();
  const view = blankChaseView();
  camera.follow({ heading: 350, pitch: 0, roll: 0 }, 0, SUN, view);
  near(view.heading, (350 + LOOK_YAW) % 360);
  camera.follow({ heading: 80, pitch: 0, roll: 0 }, FOLLOW_S, SUN, view);
  // A turn of ninety degrees, the short way through north: two-thirds of it after its time.
  near(view.heading, (350 + LOOK_YAW + 90 * (1 - Math.exp(-1))) % 360, 1e-6);
  for (let i = 0; i < 100; i++) camera.follow({ heading: 80, pitch: 0, roll: 0 }, 0.1, SUN, view);
  near(view.heading, 80 + LOOK_YAW, 0.01);
  camera.reset();
  camera.follow({ heading: 200, pitch: 0, roll: 0 }, 0.1, SUN, view);
  near(view.heading, 200 + LOOK_YAW);
});

test("its look is what the renderer draws: the gear and flaps where they are going, at their pace, from where they were heard first", () => {
  const look = new CloseUpLook();
  const camera = blankChaseView();
  const plane = aircraft({ flags: GEAR_DOWN });
  plane.look.flaps = 0.6;
  const view = look.update(plane, camera, { sunlight: 1, daylight: 0.8 }, 10, 0.016);
  assert.equal(view.gear, 1, "down at once, as first heard");
  near(view.flaps, 0.6);
  assert.equal(view.inside, false);
  assert.equal(view.daylight, 0.8);
  assert.equal(view.pieces, undefined);
  assert.equal(view.lost, undefined);
  assert.equal(view.effects, undefined);
  plane.shown.flags = 0;
  plane.look.flaps = 0;
  const again = look.update(plane, camera, { sunlight: 1, daylight: 1 }, 11, 1);
  assert.equal(again, view, "the same view, written over");
  near(again.gear, 1 - 1 / 8);
  near(again.flaps, 0.6 - 1 / 6);
  for (let i = 0; i < 20; i++) look.update(plane, camera, { sunlight: 1, daylight: 1 }, 12 + i, 1);
  assert.equal(view.gear, 0);
  assert.equal(view.flaps, 0);
});

test("its fans turn while it flies, smeared as the cockpit's own are, and stand still in a wreck", () => {
  const look = new CloseUpLook();
  const plane = aircraft();
  const view = look.update(plane, blankChaseView(), { sunlight: 1, daylight: 1 }, 0, 0.016);
  assert.ok(view.fans.sweep > 100);
  plane.look.crash = "slid";
  look.update(plane, blankChaseView(), { sunlight: 1, daylight: 1 }, 1, 0.016);
  assert.equal(view.fans.sweep, 0);
});

test("what it has lost is drawn gone, and what burns burns where its look says, its blast from when it went off", () => {
  const look = new CloseUpLook();
  const plane = aircraft({ heading: 0, pitch: 0, roll: 0, north: 200, east: 0 });
  plane.look.lost.rightWing = true;
  plane.look.lost.tail = true;
  plane.look.lost.surfaces = true;
  plane.look.crash = "broke";
  plane.look.burning = 0b0000101;
  plane.look.strength = 0.7;
  plane.look.blast = { seed: 255, size: 20, ago: 1.5 };
  const view = look.update(plane, blankChaseView(), { sunlight: 1, daylight: 1 }, 100, 0.016);
  assert.deepEqual(view.pieces, { rightWing: null, tail: null });
  assert.equal(Object.values(view.lost!)[0], null);
  assert.equal(lostBits(plane.look), 6);
  const effects = view.effects!;
  assert.equal(effects.fires.length, 2);
  assert.deepEqual(effects.fires[0].at, FIRE_PLACES[0].at);
  assert.deepEqual(effects.fires[1].at, FIRE_PLACES[2].at);
  assert.equal(effects.fires[1].strength, 0.7);
  assert.equal(effects.fires[0].born, 100);
  assert.equal(effects.blasts[0].born, 98.5);
  assert.equal(effects.blasts[0].size, 20);
  // Flying north, level: the air comes from ahead, and up is up.
  near(effects.air[0], -200);
  near(effects.up[2], -1);
  // Heard again a little later, the same fire and the same blast: neither starts again.
  plane.look.blast.ago = 2.6;
  look.update(plane, blankChaseView(), { sunlight: 1, daylight: 1 }, 101, 1);
  assert.equal(effects.fires[0].born, 100);
  assert.equal(effects.blasts[0].born, 98.5);
  // Gone out: nothing drawn.
  plane.look.burning = 0;
  plane.look.blast = null;
  assert.equal(look.update(plane, blankChaseView(), { sunlight: 1, daylight: 1 }, 102, 1).effects, undefined);
});

test("what its card says it is doing: the worst first", () => {
  const plane = aircraft();
  assert.equal(doingOf(plane), null);
  plane.shown.flags = ON_GROUND | PAUSED;
  assert.equal(doingOf(plane), "paused");
  plane.shown.flags = ON_GROUND;
  assert.equal(doingOf(plane), "ground");
  plane.look.burning = 1;
  assert.equal(doingOf(plane), "burning");
  plane.look.crash = "blew";
  assert.equal(doingOf(plane), "blew");
});

test("how far off another aircraft is", () => {
  near(apart({ lon: 9.5, lat: 50, altitude: 10_000 }, { lon: 9.5, lat: 50.1, altitude: 10_000 }), 11_119.5, 1);
  near(apart({ lon: 179.9, lat: 0, altitude: 0 }, { lon: -179.9, lat: 0, altitude: 0 }), 22_239, 1);
  near(apart({ lon: 9, lat: 50, altitude: 0 }, { lon: 9, lat: 50, altitude: 300 }), 300);
});

test("the full model where the flight has the room for it, the light one where not, and no taking turns", () => {
  const desk = new ModelChoice();
  assert.equal(desk.pick(1, false, 0), "full");
  assert.equal(desk.pick(0.8, false, 1), "full", "a step down is not enough to let it go");
  assert.equal(desk.pick(0.7, false, 2), "light");
  assert.equal(desk.pick(1, false, 3), "light", "not back at once");
  assert.equal(desk.pick(1, false, 3 + FULL_AGAIN_S), "full");
  const hand = new ModelChoice();
  assert.equal(hand.pick(0.45, true, 0), "light", "a phone, as it starts");
  assert.equal(hand.pick(0.9, true, 40), "light");
  assert.equal(hand.pick(1, true, 41), "light");
  assert.equal(hand.pick(1, true, 41 + FULL_AGAIN_S), "full");
  hand.reset();
  assert.equal(hand.pick(1, true, 0), "full");
});

test("the card docks low on the right, clear of what it keeps clear of", () => {
  const area = { width: 1280, height: 800 };
  const card = { width: 240, height: 260 };
  assert.deepEqual(dockPlace(area, card, []), { left: 1280 - DOCK_MARGIN - 240, top: 800 - DOCK_MARGIN - 260 });
  // A readout in the corner: just above it.
  const corner: Box = { left: 1100, top: 690, width: 168, height: 78 };
  const above = dockPlace(area, card, [corner]);
  assert.equal(above.left, 1280 - DOCK_MARGIN - 240);
  assert.ok(above.top + card.height <= corner.top - 8 && above.top + card.height > corner.top - 8 - 8);
  // The whole right edge taken: as far right as it is clear.
  const column: Box = { left: 1000, top: 0, width: 280, height: 800 };
  const beside = dockPlace(area, card, [column]);
  assert.ok(beside.left + card.width <= 1000 - 8 && beside.left + card.width > 1000 - 16);
});

test("with nowhere clear it covers the least; and it would rather not sit over the middle", () => {
  const area = { width: 600, height: 400 };
  const card = { width: 200, height: 150 };
  const wide: Box = { left: 0, top: 0, width: 600, height: 300 };
  const at = dockPlace(area, card, [wide]);
  assert.equal(at.top, 400 - DOCK_MARGIN - 150, "as low as it goes, under as little of it as can be");
  const middle: Box = { left: 300, top: 0, width: 300, height: 400 };
  const away = dockPlace(area, card, [], middle);
  assert.ok(away.left + card.width <= 300, "clear of the middle, though it is further from the right");
});

test("the picture is kept clear of the page's own labels, and only while a card is up", () => {
  const shared = sharedOf(new Traffic());
  const { closeUp } = shared;
  closeUp.rect = { x: 0.7, y: 0.6, w: 0.2, h: 0.2 };
  assert.equal(overCloseUp(closeUp, 0.75, 0.65, 0.8, 0.7), false, "none picked");
  closeUp.id = 3;
  assert.equal(overCloseUp(closeUp, 0.75, 0.65, 0.8, 0.7), true);
  assert.equal(overCloseUp(closeUp, 0.5, 0.65, 0.69, 0.7), false);
  closeUp.rect.w = 0;
  assert.equal(overCloseUp(closeUp, 0.75, 0.65, 0.8, 0.7), false, "nowhere to draw it");
});
