import assert from "node:assert/strict";
import test from "node:test";
import {
  DETENTS, IDLE_N1, initialMemory, LIGHT_TURBULENCE, mixSound, ROUGH_TURBULENCE, SPOOL_DOWN_S, SPOOL_UP_S, spoolTowards, VOLUME,
} from "../../src/lib/studio/flight/soundMix.ts";
import type { SoundEvent, SoundInput, SoundMemory, SoundStatus } from "../../src/lib/studio/flight/soundMix.ts";
import { actionOf } from "../../src/lib/studio/flight/controls.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/** Cruise: 250 kt indicated, Mach 0.78, no weather. */
const CRUISE: SoundInput = {
  throttle: 0.7, ias: 128, mach: 0.78, dbz: null, rain: 0, turbulence: 0, flash: 0, strike: false, brake: false, fade: 0, storm: null,
};
const STATUS: SoundStatus = { view: "cockpit", warnings: [], paused: false, autopilot: false, warp: false, low: false };

/** Dice that never fire: no irregular sound starts. */
const never = () => 0.999999;
/** Dice that always fire. */
const always = () => 0;

/** A seeded generator, for the irregular sounds' counts. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/** Fly the mix for `seconds` at 60 frames a second, collecting the events. */
function fly(
  input: SoundInput, seconds: number, options: { status?: SoundStatus; memory?: SoundMemory; random?: () => number; muted?: boolean } = {},
) {
  const status = options.status ?? STATUS;
  let memory = options.memory ?? initialMemory(input, status);
  const events: SoundEvent[] = [];
  let levels = mixSound(memory, input, status, options.muted ?? false, 0, never).levels;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const frame = mixSound(memory, input, status, options.muted ?? false, 1 / 60, options.random ?? never);
    memory = frame.memory;
    levels = frame.levels;
    events.push(...frame.events);
  }
  return { levels, events, memory };
}

const count = (events: SoundEvent[], kind: SoundEvent["kind"]) => events.filter((event) => event.kind === kind).length;

/* ---- engines ---- */

test("the engines follow the throttle a few seconds behind, spooling down quicker than up", () => {
  const idle = initialMemory({ throttle: 0 }, STATUS);
  const up = fly({ ...CRUISE, throttle: 1 }, 1, { memory: idle });
  // A second after the lever goes up the fan has barely begun to wind up.
  assert.ok(up.memory.spool > 0.15 && up.memory.spool < 0.35, String(up.memory.spool));
  const upLater = fly({ ...CRUISE, throttle: 1 }, SPOOL_UP_S * 3, { memory: idle });
  near(upLater.memory.spool, 1, 0.06);
  // Down again: a second takes off more than a second up added.
  const full = initialMemory({ throttle: 1 }, STATUS);
  const down = fly({ ...CRUISE, throttle: 0 }, 1, { memory: full });
  assert.ok(1 - down.memory.spool > up.memory.spool, `${1 - down.memory.spool} down vs ${up.memory.spool} up`);
  assert.ok(SPOOL_DOWN_S < SPOOL_UP_S);
  near(spoolTowards(0.4, 0.4, 1), 0.4, 1e-12);
});

test("the fan's tone and the engines' level rise with the spool, from idle", () => {
  const idle = fly({ ...CRUISE, throttle: 0 }, 0.1, { memory: initialMemory({ throttle: 0 }, STATUS) }).levels.engine;
  const full = fly({ ...CRUISE, throttle: 1 }, 0.1, { memory: initialMemory({ throttle: 1 }, STATUS) }).levels.engine;
  near(idle.n1, IDLE_N1, 0.01);
  near(full.n1, 1, 0.01);
  assert.ok(full.whineHz > 4 * idle.whineHz);
  assert.ok(full.rumble > idle.rumble && full.hiss > 10 * idle.hiss && full.whine > idle.whine);
  // The buzz of supersonic fan tips only at high power.
  assert.equal(idle.buzz, 0);
  assert.ok(full.buzz > 0);
});

/* ---- airflow ---- */

test("the wind rises with the indicated speed, the brake adds to it, and a roar comes near the limits", () => {
  const slow = fly({ ...CRUISE, ias: 70 }, 0.1).levels.wind;
  const fast = fly({ ...CRUISE, ias: 160 }, 0.1).levels.wind;
  assert.ok(fast.gain > 3 * slow.gain, `${fast.gain} vs ${slow.gain}`);
  assert.ok(fast.hz > slow.hz);
  assert.equal(fast.brake, 0);
  assert.ok(fly({ ...CRUISE, ias: 160, brake: true }, 0.1).levels.wind.brake > 0);
  assert.equal(fast.roar, 0);
  assert.ok(fly({ ...CRUISE, ias: 182 }, 0.1).levels.wind.roar > 0.3);
  assert.ok(fly({ ...CRUISE, mach: 0.89 }, 0.1).levels.wind.roar > 0.3);
});

/* ---- turbulence ---- */

test("below light turbulence nothing of it is heard, however the dice fall", () => {
  const calm = fly({ ...CRUISE, turbulence: LIGHT_TURBULENCE * 0.9 }, 30, { random: always });
  assert.deepEqual(calm.events.filter((event) => ["thump", "creak", "rattle"].includes(event.kind)), []);
  assert.equal(calm.levels.wind.buffet, 0);
  assert.equal(calm.levels.rumble, 0);
});

test("rough air thumps, creaks and rattles irregularly, more and harder the rougher", () => {
  const light = fly({ ...CRUISE, turbulence: 0.2 }, 60, { random: seeded(1) });
  const strong = fly({ ...CRUISE, turbulence: 0.95 }, 60, { random: seeded(1) });
  assert.ok(count(light.events, "thump") > 10, `${count(light.events, "thump")} thumps in light`);
  assert.ok(count(strong.events, "thump") > 2 * count(light.events, "thump"));
  assert.ok(count(strong.events, "creak") > count(light.events, "creak"));
  assert.equal(count(light.events, "rattle"), 0);
  assert.ok(count(strong.events, "rattle") > 20);
  const strength = (events: SoundEvent[]) => {
    const thumps = events.filter((event) => event.kind === "thump") as Array<{ strength: number }>;
    return thumps.reduce((sum, { strength: one }) => sum + one, 0) / thumps.length;
  };
  assert.ok(strength(strong.events) > 1.5 * strength(light.events));
  assert.ok(strong.levels.wind.buffet > 2 * light.levels.wind.buffet);
  assert.ok(strong.levels.rumble > light.levels.rumble);
  // Irregular: the gaps between thumps are not all alike.
  let memory = initialMemory(CRUISE, STATUS);
  const times: number[] = [];
  const random = seeded(7);
  for (let frame = 0; frame < 60 * 30; frame++) {
    const next = mixSound(memory, { ...CRUISE, turbulence: 0.6 }, STATUS, false, 1 / 60, random);
    memory = next.memory;
    if (next.events.some((event) => event.kind === "thump")) times.push(frame);
  }
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  assert.ok(new Set(gaps).size > gaps.length / 3, `gaps ${gaps.join(",")}`);
});

test("the seat-belt sign chimes once, the first time the air gets rough", () => {
  const rough = fly({ ...CRUISE, turbulence: ROUGH_TURBULENCE + 0.05 }, 20);
  assert.equal(count(rough.events, "seatbelt"), 1);
  const again = fly({ ...CRUISE, turbulence: 0.9 }, 20, { memory: rough.memory });
  assert.equal(count(again.events, "seatbelt"), 0);
  assert.equal(count(fly({ ...CRUISE, turbulence: ROUGH_TURBULENCE - 0.05 }, 20).events, "seatbelt"), 0);
});

/* ---- rain, hail ---- */

test("rain follows the telemetry's rain, and hail only in the strongest echoes", () => {
  assert.equal(fly(CRUISE, 0.1).levels.rain.gain, 0);
  const rain = fly({ ...CRUISE, rain: 0.8, dbz: 46 }, 0.1).levels.rain;
  assert.ok(rain.gain > 0.5);
  assert.equal(rain.hail, 0);
  assert.ok(fly({ ...CRUISE, rain: 1, dbz: 60 }, 0.1).levels.rain.hail > 0.5);
});

/* ---- thunder ---- */

test("thunder cracks on a flash's rising edge only, not while it dies away", () => {
  let memory = initialMemory(CRUISE, STATUS);
  let thunder = 0;
  // The flash as the pilot draws it: jumping to 1 and falling off four a second.
  for (let flash = 1; flash > 0; flash -= 4 / 60) {
    const frame = mixSound(memory, { ...CRUISE, flash }, STATUS, false, 1 / 60, never);
    memory = frame.memory;
    thunder += frame.events.filter((event) => event.kind === "thunder" && event.distance < 0.35).length;
  }
  assert.equal(thunder, 1);
  // A strike with no flash (reduced motion) is heard too; a flash and its strike together are one thunder.
  assert.equal(count(mixSound(initialMemory(CRUISE, STATUS), { ...CRUISE, strike: true }, STATUS, false, 1 / 60, never).events, "thunder"), 1);
  assert.equal(count(mixSound(initialMemory(CRUISE, STATUS), { ...CRUISE, flash: 1, strike: true }, STATUS, false, 1 / 60, never).events, "thunder"), 1);
});

test("a strong storm nearby rumbles now and then, a weak or far one does not", () => {
  const strong = fly({ ...CRUISE, storm: { peakDbz: 58, distance: 25_000 } }, 300, { random: seeded(3) });
  const thunders = strong.events.filter((event) => event.kind === "thunder");
  assert.ok(thunders.length >= 3 && thunders.length <= 40, `${thunders.length} distant thunders`);
  assert.ok(thunders.every((event) => event.kind === "thunder" && event.distance > 0.35));
  assert.equal(count(fly({ ...CRUISE, storm: { peakDbz: 40, distance: 25_000 } }, 300, { random: seeded(3) }).events, "thunder"), 0);
  assert.equal(count(fly({ ...CRUISE, storm: { peakDbz: 60, distance: 120_000 } }, 300, { random: seeded(3) }).events, "thunder"), 0);
});

/* ---- alerts ---- */

test("the warnings sound in the cockpit, and none outside", () => {
  const warned = { ...STATUS, warnings: ["terrain", "stall", "overspeed"] as SoundStatus["warnings"] };
  const cockpit = fly(CRUISE, 0.1, { status: warned }).levels.alerts;
  assert.deepEqual([cockpit.terrain, cockpit.stall, cockpit.overspeed], [true, true, true]);
  assert.equal(cockpit.gain, 1);
  const stall = fly(CRUISE, 0.1, { status: { ...STATUS, warnings: ["stall"] } }).levels.alerts;
  assert.deepEqual([stall.terrain, stall.stall, stall.overspeed], [false, true, false]);
  for (const view of ["outside", "clean"] as const) {
    const outside = fly(CRUISE, 0.1, { status: { ...warned, view } }).levels.alerts;
    assert.deepEqual([outside.terrain, outside.stall, outside.overspeed, outside.gain], [false, false, false, 0]);
  }
});

test("the autopilot chimes on and falls in three tones off, the radar altimeter's tone once, the throttle clicks at its detents", () => {
  const memory = initialMemory(CRUISE, STATUS);
  const on = mixSound(memory, CRUISE, { ...STATUS, autopilot: true }, false, 1 / 60, never);
  assert.deepEqual(on.events.map(({ kind }) => kind), ["apOn"]);
  const off = mixSound(on.memory, CRUISE, STATUS, false, 1 / 60, never);
  assert.deepEqual(off.events.map(({ kind }) => kind), ["apOff"]);
  const low = fly(CRUISE, 2, { status: { ...STATUS, low: true }, memory });
  assert.equal(count(low.events, "low"), 1);
  // The lever up through climb and to full: two clicks; within the detents none.
  let lever = initialMemory({ throttle: 0.7 }, STATUS);
  let clicks = 0;
  for (let throttle = 0.7; throttle <= 1.0001; throttle += 0.01) {
    const frame = mixSound(lever, { ...CRUISE, throttle: Math.min(throttle, 1) }, STATUS, false, 1 / 60, never);
    lever = frame.memory;
    clicks += count(frame.events, "detent");
  }
  assert.equal(clicks, 2);
  assert.deepEqual(DETENTS, [0, 0.85, 1]);
  // Outside, none of the cockpit's chimes.
  const outside = mixSound(memory, CRUISE, { ...STATUS, view: "outside", autopilot: true, low: true }, false, 1 / 60, never);
  assert.deepEqual(outside.events, []);
});

/* ---- views, mute, pause ---- */

test("the cockpit muffles the engines; outside they are full and the cockpit's own sounds go; clean is gentler", () => {
  const input = { ...CRUISE, rain: 0.5 };
  const cockpit = fly(input, 0.1).levels;
  const outside = fly(input, 0.1, { status: { ...STATUS, view: "outside" } }).levels;
  const clean = fly(input, 0.1, { status: { ...STATUS, view: "clean" } }).levels;
  assert.ok(cockpit.engine.cutoff < 1500 && outside.engine.cutoff > 10_000);
  assert.ok(outside.engine.rumble > cockpit.engine.rumble && outside.engine.whine > cockpit.engine.whine);
  assert.ok(clean.engine.whine < outside.engine.whine && clean.wind.gain < outside.wind.gain);
  assert.ok(cockpit.rain.gain > outside.rain.gain);
  assert.equal(cockpit.cabin, 1);
  assert.equal(outside.cabin, 0);
  assert.equal(clean.cabin, 0);
  // Thunder in every view.
  assert.ok(cockpit.thunder.gain > 0 && outside.thunder.gain > 0 && clean.thunder.gain > 0);
});

test("muted or paused, the volume is nothing; through a cut to black the world quietens", () => {
  assert.equal(fly(CRUISE, 0.1).levels.volume, VOLUME);
  assert.ok(VOLUME > 0 && VOLUME <= 0.6);
  assert.equal(fly(CRUISE, 0.1, { muted: true }).levels.volume, 0);
  assert.equal(fly(CRUISE, 0.1, { status: { ...STATUS, paused: true } }).levels.volume, 0);
  const cut = fly({ ...CRUISE, fade: 1, turbulence: 0.9 }, 5, { random: always });
  assert.ok(cut.levels.world < 0.2);
  assert.equal(count(cut.events, "thump"), 0);
});

test("M mutes", () => {
  assert.equal(actionOf("KeyM"), "mute");
});
