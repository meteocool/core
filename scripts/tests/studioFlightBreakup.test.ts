import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BREAKS, parseModel, pieceOf, piecesOf } from "../../src/lib/studio/flight/model.ts";
import type { AircraftModel } from "../../src/lib/studio/flight/model.ts";
import {
  BLAST_S, blastGlare, blastHeat, blastSwell, effectSprites, MAX_SPRITES, SPRITE_FLOATS,
} from "../../src/layers/aircraftEffects.ts";
import type { AircraftEffects } from "../../src/layers/aircraftRenderer.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/* ---- the pieces an aircraft breaks into ---- */

const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
const model: AircraftModel = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const middle = (part: string) => {
  const chunk = model.chunks.find((one) => one.part === part)!;
  return chunk.min.map((least, axis) => least + chunk.size[axis] / 2);
};

test("a point of the model is of the hull, of the wing on its side, or of the tail", () => {
  assert.equal(pieceOf([10, 0, 0]), "hull");
  assert.equal(pieceOf([0, 1.9, 1]), "hull");
  assert.equal(pieceOf([0, 8, 0]), "rightWing");
  assert.equal(pieceOf([0, -8, 0]), "leftWing");
  assert.equal(pieceOf([-17, 0, -5]), "tail");
  // The tailplane's tips are wider than the fuselage, and are the tail's all the same.
  assert.equal(pieceOf([-18, 5, -1.5]), "tail");
  assert.equal(pieceOf([-18, -5, -1.5]), "tail");
});

test("each wing takes its engine, its leg and everything that moves on it; the tail its elevators and rudder; the hull keeps the rest", () => {
  for (const name of Object.keys(model.parts)) {
    const piece = pieceOf(middle(name));
    if (/^(flap|slat|spoiler|fairing|aileron)\./.test(name) || /^gear\.(left|right)/.test(name)) {
      assert.equal(piece, /left/i.test(name) ? "leftWing" : "rightWing", name);
    } else if (/^(elevator|rudder)/.test(name)) {
      assert.equal(piece, "tail", name);
    } else {
      assert.equal(piece, "hull", name);
    }
  }
  // The engines hang well outside the break, the fuselage is inside it, and the cabin ends ahead of the tail's.
  assert.ok(BREAKS.wingRoot + BREAKS.ragged < 3 && BREAKS.wingRoot - BREAKS.ragged > 1.97);
  assert.ok(BREAKS.tail + BREAKS.ragged < -13.5 && BREAKS.tail - BREAKS.ragged > -14.5);
});

test("a mesh is drawn as part of every piece its box reaches, and of no other", () => {
  assert.deepEqual(piecesOf([-20, -18, -8], [37, 36, 10]), ["hull", "leftWing", "rightWing", "tail"]);
  assert.deepEqual(piecesOf([13, -1, -1.5], [2.5, 2, 1.5]), ["hull"]);
  assert.deepEqual(piecesOf([0, 4, 0.5], [6, 3, 3]), ["rightWing"]);
  assert.deepEqual(piecesOf([0, -7, 0.5], [6, 14, 3]), ["hull", "leftWing", "rightWing"]);
  assert.deepEqual(piecesOf([-19.5, -6.3, -1.8], [2.5, 5.4, 1]), ["tail"]);
  // Within a break's wander of it, a box may be of both sides.
  assert.deepEqual(piecesOf([0, BREAKS.wingRoot + 0.05, 0], [1, 1, 1]), ["hull", "rightWing"]);
  // Every mesh of the model is of some piece, and the cockpit's are the hull's alone.
  for (const chunk of model.chunks) assert.ok(piecesOf(chunk.min, chunk.size).length > 0);
  for (const chunk of model.chunks.filter((one) => one.min[0] > 13)) assert.deepEqual(piecesOf(chunk.min, chunk.size), ["hull"]);
});

/* ---- what burns and bursts ---- */

const STILL: Pick<AircraftEffects, "air" | "up"> = { air: [0, 0, 0], up: [0, 0, -1] };
/** Every sprite of the effects, as objects. */
function sprites(effects: AircraftEffects) {
  const out = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);
  const count = effectSprites(effects, out);
  return Array.from({ length: count }, (_, i) => {
    const [x, y, z, radius, sx, sy, sz, heat, opacity, seed, grain, lift] = out.subarray(i * SPRITE_FLOATS, (i + 1) * SPRITE_FLOATS);
    return { at: [x, y, z], radius, stretch: [sx, sy, sz], heat, opacity, seed, grain, lift };
  });
}
const fire = (time: number, more: Partial<AircraftEffects> = {}): AircraftEffects => ({
  time, fires: [{ at: [1, 4, 0.5], size: 3, strength: 1, born: 10 }], blasts: [], ...STILL, ...more,
});
const blast = (time: number, more: Partial<AircraftEffects> = {}): AircraftEffects => ({
  time, fires: [], blasts: [{ at: [0, 0, 1], size: 16, born: 10 }], ...STILL, ...more,
});

test("the same moment is always drawn the same, and the next one differently", () => {
  const both = (time: number): AircraftEffects => ({ ...fire(time), blasts: blast(time).blasts });
  assert.deepEqual(sprites(both(12.345)), sprites(both(12.345)));
  assert.notDeepEqual(sprites(both(12.345)), sprites(both(12.36)));
  assert.ok(sprites(both(12.345)).length > 30);
});

test("nothing is drawn of a fire or a blast that has not begun, nor of a blast long over", () => {
  assert.equal(sprites(fire(9.9)).length, 0);
  assert.equal(sprites(blast(9.9)).length, 0);
  assert.equal(sprites(blast(10 + BLAST_S + 0.1)).length, 0);
  assert.ok(sprites(blast(10 + BLAST_S - 1)).length > 0);
  assert.equal(sprites({ ...fire(12), fires: [{ at: [0, 0, 0], size: 3, strength: 0, born: 10 }] }).length, 0);
});

test("a fire starts small and at once: flames first, its smoke following over seconds", () => {
  const early = sprites(fire(10.1));
  assert.ok(early.length >= 2 && early.every((one) => one.heat > 0.5), "flames and their glow, no cold smoke yet");
  const later = sprites(fire(20));
  assert.ok(later.filter((one) => one.heat === 0).length > 15, "a train of smoke");
  assert.ok(later.filter((one) => one.heat > 1).length >= 3, "and flames still");
  // The flames stay about the fire's own size, round where it burns.
  for (const flame of later.filter((one) => one.heat > 1 && one.grain === 1)) {
    assert.ok(Math.hypot(flame.at[0] - 1, flame.at[1] - 4, flame.at[2] - 0.5) < 3 * 1.8, `${flame.at}`);
    assert.ok(flame.radius <= 3 * 0.56);
  }
});

test("in still air a fire's smoke rises, spreading and thinning as it goes", () => {
  const smoke = sprites(fire(30)).filter((one) => one.heat === 0).sort((a, b) => b.at[2] - a.at[2]);
  // Up is less down. The lowest is by the fire, the highest tens of metres over it.
  const [lowest, highest] = [smoke[0], smoke[smoke.length - 1]];
  assert.ok(highest.at[2] < -12, `${highest.at}`);
  assert.ok(lowest.at[2] > -6, `${lowest.at}`);
  assert.ok(highest.radius > lowest.radius * 1.5);
  assert.ok(highest.opacity < lowest.opacity);
  // Straight up, but for its wandering.
  assert.ok(smoke.every((one) => Math.hypot(one.at[0] - 1, one.at[1] - 4) < 4));
  assert.ok(smoke.every((one) => Math.hypot(...one.stretch) === 0));
});

test("in flight the air carries the smoke off behind in one long streak", () => {
  // The air comes from ahead at 70 m/s.
  const smoke = sprites(fire(30, { air: [-70, 0, 0] })).filter((one) => one.heat === 0);
  const farthest = Math.min(...smoke.map((one) => one.at[0]));
  assert.ok(farthest < -250 && farthest > -420, `${farthest}`);
  assert.ok(smoke.every((one) => one.at[0] < 1.5), "none ahead of the fire");
  // Each puff is drawn out along the air, far enough to meet the next.
  const sorted = smoke.sort((a, b) => b.at[0] - a.at[0]);
  for (let i = 3; i < sorted.length; i++) {
    const gap = sorted[i - 1].at[0] - sorted[i].at[0];
    assert.ok(sorted[i].stretch[0] < 0 && sorted[i].stretch[1] === 0);
    assert.ok(gap < 2 * (-sorted[i].stretch[0] + sorted[i].radius) + 2, `a gap of ${gap} at ${sorted[i].at[0]}`);
  }
  // The flames lean back too, but stay by the fire.
  const flames = sprites(fire(30, { air: [-70, 0, 0] })).filter((one) => one.heat > 1 && one.grain === 1);
  assert.ok(flames.every((one) => one.at[0] > 1 - 3 * 4.5 && one.at[0] < 2.2));
  assert.ok(flames.some((one) => one.at[0] < -2));
});

test("a blast swells to its size in under half a second", () => {
  near(blastSwell(0), 0, 1e-9);
  assert.ok(blastSwell(0.1) > 0.5 && blastSwell(0.1) < 0.6);
  assert.ok(blastSwell(0.4) > 0.94 && blastSwell(0.4) <= 1);
  const reach = (time: number) => Math.max(...sprites(blast(time)).filter((one) => one.grain === 1).map((one) => Math.hypot(one.at[0], one.at[1]) + one.radius));
  assert.ok(reach(10.05) < 5, `${reach(10.05)}`);
  // Its lobes reach about half its size from its middle.
  assert.ok(reach(10.4) > 6 && reach(10.4) < 11, `${reach(10.4)}`);
});

test("a blast flashes white, burns orange, and is dark smoke within a few seconds, rising and fading", () => {
  assert.ok(blastHeat(0) === 2 && blastHeat(0.3) > 1.1);
  assert.ok(blastHeat(0.8) > 0.4 && blastHeat(0.8) < 1.1);
  near(blastHeat(2.5), 0, 1e-9);
  const lobes = (time: number) => sprites(blast(time)).filter((one) => one.grain === 1);
  const height = (time: number) => -lobes(time).reduce((sum, one) => sum + one.at[2], 0) / lobes(time).length;
  assert.ok(lobes(10.1).every((one) => one.heat > 1.2));
  assert.ok(lobes(13).every((one) => one.heat === 0));
  assert.ok(height(15) > height(11) + 5, `${height(11)} to ${height(15)}`);
  assert.ok(lobes(17)[0].opacity < lobes(12)[0].opacity * 0.3);
  // The flash: one plain glow, larger than the ball, gone in a third of a second.
  const flash = (time: number) => sprites(blast(time)).filter((one) => one.grain === 0 && one.radius > 16);
  assert.equal(flash(10.05).length, 1);
  assert.equal(flash(10.35).length, 0);
  near(blastGlare(blast(10)), 1, 1e-9);
  assert.ok(blastGlare(blast(10.15)) > 0.1 && blastGlare(blast(10.15)) < 0.5);
  assert.equal(blastGlare(blast(10.4)), 0);
  assert.equal(blastGlare(blast(9)), 0);
  // Asked to be calm, a blast is the same ball without the flash.
  assert.equal(flash(10.05).length, 1);
  assert.equal(sprites(blast(10.05, { calm: true })).filter((one) => one.grain === 0 && one.radius > 16).length, 0);
  assert.equal(blastGlare(blast(10, { calm: true })), 0);
  assert.equal(sprites(blast(11, { calm: true })).length, sprites(blast(11)).length);
});

test("a blast throws glowing fragments that fly out, slow, and fall", () => {
  const fragments = (time: number) => sprites(blast(time)).filter((one) => one.grain === 0 && one.radius < 1);
  assert.ok(fragments(10.5).length >= 10);
  assert.ok(fragments(10.5).every((one) => one.heat > 1));
  const spread = (time: number) => Math.max(...fragments(time).map((one) => Math.hypot(one.at[0], one.at[1])));
  assert.ok(spread(10.5) > 4 && spread(11.5) > spread(10.5) * 1.5);
  // Up at first, on the whole; then down past where they began.
  const height = (time: number) => -fragments(time).reduce((sum, one) => sum + one.at[2] - 1, 0) / fragments(time).length;
  assert.ok(height(10.6) > 2, `${height(10.6)}`);
  assert.ok(height(13) < -8, `${height(13)}`);
  assert.equal(fragments(13.5).length, 0);
});

test("however much burns, no more sprites are made than the GPU has room for", () => {
  const many: AircraftEffects = {
    time: 30, ...STILL,
    fires: Array.from({ length: 40 }, (_, i) => ({ at: [i, 0, 0] as [number, number, number], size: 3, strength: 1, born: 0 })),
    blasts: Array.from({ length: 10 }, (_, i) => ({ at: [i, 0, 0] as [number, number, number], size: 10, born: 29.5 })),
  };
  assert.equal(sprites(many).length, MAX_SPRITES);
  assert.equal(effectSprites(many, new Float32Array(10 * SPRITE_FLOATS)), 10);
});
