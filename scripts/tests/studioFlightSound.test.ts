import assert from "node:assert/strict";
import test from "node:test";
import {
  BANK_AGAIN_S, CALLOUT_LONGEST_S, CalloutQueue, DETENTS, HEIGHT_CALLS, IDLE_LEVER, IDLE_N1, initialMemory, LIGHT_TURBULENCE, mixSound,
  PULL_UP_CYCLE_S, PULL_UP_WORDS_S, pullUpBelow, RETARD_AGAIN_S, RETARD_GROUND_S, RETARD_M, ROUGH_TURBULENCE, SPOOL_DOWN_S, SPOOL_UP_S,
  spoolTowards, VOLUME,
} from "../../src/lib/studio/flight/soundMix.ts";
import type { Callout, CalloutKind, SoundEvent, SoundInput, SoundMemory, SoundStatus } from "../../src/lib/studio/flight/soundMix.ts";
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
  const slow = fly({ ...CRUISE, ias: 70, mach: 0.3 }, 0.1).levels.wind;
  const fast = fly({ ...CRUISE, ias: 160, mach: 0.7 }, 0.1).levels.wind;
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

/* ---- the cockpit's voice ---- */

const FRAME = 1 / 60;

/**
 * Fly the mix frame by frame, the flight at each moment given by `at`
 * (seconds in), and note what the voice says, what it takes back and when
 * the whoops start, each with its time.
 */
function listen(
  seconds: number, at: (t: number) => { input?: Partial<SoundInput>; status?: Partial<SoundStatus> },
): { said: Array<[number, string]>; quiet: Array<[number, CalloutKind]>; whoops: number[]; callouts: Callout[] } {
  const first = at(0);
  let memory = initialMemory({ ...CRUISE, ...first.input }, { ...STATUS, ...first.status });
  const said: Array<[number, string]> = [];
  const quiet: Array<[number, CalloutKind]> = [];
  const whoops: number[] = [];
  const callouts: Callout[] = [];
  for (let frame = 0; frame * FRAME < seconds; frame++) {
    const t = frame * FRAME;
    const now = at(t);
    const out = mixSound(memory, { ...CRUISE, ...now.input }, { ...STATUS, ...now.status }, false, FRAME, never);
    memory = out.memory;
    for (const callout of out.callouts) said.push([t, callout.words]);
    callouts.push(...out.callouts);
    for (const kind of out.quiet) quiet.push([t, kind]);
    if (out.events.some((event) => event.kind === "whoops")) whoops.push(t);
  }
  return { said, quiet, whoops, callouts };
}

const words = (said: Array<[number, string]>, which: string) => said.filter(([, one]) => one === which).map(([t]) => t);

/** An approach at 3 m/s down from 200 m with the gear down, on the ground from then on; the levers where `lever` says. */
const approach = (lever: (t: number, height: number) => number) => (t: number) => {
  const height = Math.max(0, 200 - 3 * t);
  const onGround = height === 0;
  return { input: { gear: 1, height, sink: onGround ? 0 : 3, onGround, lever: lever(t, height), throttle: lever(t, height) } };
};
/** When that approach passes a height, and when it touches down, seconds. */
const passes = (metres: number) => (200 - metres) / 3;
const TOUCHDOWN_S = 200 / 3;

test("\"bank angle, bank angle\" at once as the bank warning starts, again every few seconds, and no more once the wings are back", () => {
  const { said, quiet } = listen(20, (t) => ({ status: { warnings: t >= 2 && t < 12 ? ["bank"] : [] } }));
  const times = words(said, "Bank angle, bank angle");
  assert.equal(said.length, times.length);
  near(times[0], 2, 2 * FRAME);
  assert.equal(times.length, Math.ceil(10 / BANK_AGAIN_S));
  times.slice(1).forEach((time, i) => near(time - times[i], BANK_AGAIN_S, 2 * FRAME));
  assert.ok(times.every((time) => time < 12));
  // What was being said of it is taken back as the bank ends.
  assert.deepEqual(quiet.map(([, kind]) => kind), ["bank"]);
  near(quiet[0][0], 12, 2 * FRAME);
});

test("a bank that wobbles about the limit is not called at every crossing, and none is called from outside", () => {
  // In and out of the warning four times a second for ten seconds.
  const wobble = listen(10, (t) => ({ status: { warnings: Math.floor(t * 8) % 2 === 0 ? ["bank"] : [] } }));
  assert.ok(wobble.said.length <= Math.ceil(10 / BANK_AGAIN_S), `${wobble.said.length} calls`);
  for (const view of ["outside", "clean"] as const) {
    assert.deepEqual(listen(10, () => ({ status: { view, warnings: ["bank"] } })).said, []);
  }
});

test("the heights are called on passing them on the way down with the gear down, each once", () => {
  const { said } = listen(TOUCHDOWN_S + 2, approach(() => 0));
  assert.deepEqual(said.map(([, one]) => one), HEIGHT_CALLS.map(([, one]) => one));
  HEIGHT_CALLS.forEach(([metres], i) => near(said[i][0], passes(metres), 2 * FRAME));
  // Gear up, or going up through them, or from outside: none.
  assert.deepEqual(listen(TOUCHDOWN_S, (t) => ({ input: { ...approach(() => 0)(t).input, gear: 0.5 } })).said, []);
  assert.deepEqual(listen(60, (t) => ({ input: { gear: 1, height: 3 * t, sink: -3, lever: 1, throttle: 1 } })).said, []);
  assert.deepEqual(listen(TOUCHDOWN_S, (t) => ({ ...approach(() => 0)(t), status: { view: "outside" as const } })).said, []);
});

test("a height not flown through is not called: a new start on the ground, the ground found, a cut to black", () => {
  // From the first frame on the ground, as a take-off starts.
  assert.deepEqual(listen(5, () => ({ input: { gear: 1, height: 0, onGround: true } })).said, []);
  // High up, then at once on the ground: the aircraft put back, not flown down.
  assert.deepEqual(listen(5, (t) => ({ input: { gear: 1, height: t < 2 ? 3000 : 0, onGround: t >= 2 } })).said, []);
  // No height known, then one: nothing passed.
  assert.deepEqual(listen(5, (t) => ({ input: { gear: 1, height: t < 2 ? undefined : 2 } })).said, []);
  // Several passed in one frame: the lowest is the one called.
  assert.deepEqual(listen(5, (t) => ({ input: { gear: 1, lever: 0, height: t < 2 ? 40 : 5 } })).said.map(([, one]) => one), ["Twenty"]);
  // Through a cut nothing is said.
  assert.deepEqual(listen(TOUCHDOWN_S, (t) => ({ input: { ...approach(() => 0.4)(t).input, fade: 1 }, status: { warnings: ["bank"] } })).said, []);
});

test("\"retard, retard\" from twenty feet with the levers above idle, again and again until they are at idle", () => {
  const idleAt = passes(RETARD_M) + 4;
  const { said, quiet } = listen(TOUCHDOWN_S + 10, approach((t) => (t < idleAt ? 0.3 : 0)));
  const times = words(said, "Retard, retard");
  // With "twenty", and after it.
  near(times[0], passes(RETARD_M), 2 * FRAME);
  const twenty = said.findIndex(([, one]) => one === "Twenty");
  assert.equal(said[twenty + 1][1], "Retard, retard");
  assert.equal(times.length, Math.ceil(4 / RETARD_AGAIN_S));
  times.slice(1).forEach((time, i) => near(time - times[i], RETARD_AGAIN_S, 2 * FRAME));
  assert.ok(times.every((time) => time < idleAt));
  // Cut off as the levers reach idle; "ten" was still called between.
  assert.deepEqual(quiet.map(([, kind]) => kind), ["retard"]);
  near(quiet[0][0], idleAt, 2 * FRAME);
  assert.ok(said.some(([, one]) => one === "Ten"));
  assert.ok(IDLE_LEVER > 0 && IDLE_LEVER <= 0.1);
});

test("\"retard\" is not said with the levers at idle, and stops a few seconds after touching down with them still up", () => {
  assert.deepEqual(words(listen(TOUCHDOWN_S + 10, approach(() => 0)).said, "Retard, retard"), []);
  assert.deepEqual(words(listen(TOUCHDOWN_S + 10, approach(() => IDLE_LEVER)).said, "Retard, retard"), []);
  const kept = words(listen(TOUCHDOWN_S + 30, approach(() => 0.3)).said, "Retard, retard");
  assert.ok(kept.length > 2);
  near(kept[kept.length - 1], TOUCHDOWN_S + RETARD_GROUND_S, RETARD_AGAIN_S);
  assert.ok(kept[kept.length - 1] <= TOUCHDOWN_S + RETARD_GROUND_S + 2 * FRAME);
  // Brought back to idle and pushed up again on the way down: said again.
  const again = words(listen(TOUCHDOWN_S, approach((t, height) => (height < 2 || height > 4 ? 0.3 : 0))).said, "Retard, retard");
  assert.ok(again.some((time) => time > passes(2)), `${again.join(", ")}`);
});

test("\"retard\" is not said on a take-off or a go-around", () => {
  // A take-off: full thrust on the ground, then up through twenty feet.
  const takeOff = listen(40, (t) => {
    const height = Math.max(0, 4 * (t - 20));
    return { input: { gear: 1, height, onGround: height === 0, sink: height === 0 ? 0 : -4, lever: 1, throttle: 1 } };
  });
  assert.deepEqual(takeOff.said, []);
  // A go-around from ten feet: down at 3 m/s with some thrust on, then full thrust and away.
  const down = (200 - 3) / 3;
  const goAround = listen(down + 30, (t) => {
    const height = t < down ? 200 - 3 * t : 3 + 5 * (t - down);
    const lever = t < down ? 0 : 1;
    return { input: { gear: 1, height, sink: t < down ? 3 : -5, lever, throttle: lever } };
  });
  assert.deepEqual(words(goAround.said, "Retard, retard"), []);
  // The levers only on their way up, and the aircraft climbing already: still nothing.
  const slow = listen(down + 30, (t) => {
    const height = t < down ? 200 - 3 * t : 3 + 2 * (t - down);
    const lever = t < down ? 0 : Math.min(1, 0.35 * (t - down));
    return { input: { gear: 1, height, sink: t < down ? 3 : -2, lever, throttle: lever } };
  });
  assert.deepEqual(words(slow.said, "Retard, retard"), []);
  // Sinking on with the levers coming up but not yet at climb power: it is said, and no more once they are there.
  const late = listen(passes(RETARD_M) + 6, approach((t) => Math.min(1, Math.max(0.2, 0.35 * (t - passes(RETARD_M))))));
  const times = words(late.said, "Retard, retard");
  assert.ok(times.length >= 1 && times.length <= 2, `${times.length}`);
  assert.ok(times.every((time) => time < passes(RETARD_M) + DETENTS[1] / 0.35));
});

test("the pull-up warning: two whoops, then \"pull up, pull up\", and again, the words never over the whoops", () => {
  const { said, quiet, whoops, callouts } = listen(20, (t) => ({ status: { warnings: t >= 1 && t < 11 ? ["terrain"] : [] } }));
  near(whoops[0], 1, 2 * FRAME);
  assert.equal(whoops.length, Math.ceil(10 / PULL_UP_CYCLE_S));
  whoops.slice(1).forEach((time, i) => near(time - whoops[i], PULL_UP_CYCLE_S, 2 * FRAME));
  const times = words(said, "Pull up, pull up");
  assert.equal(said.length, times.length);
  // The whoops take a second (two of 0.45 s, 0.55 s apart): the words come after them and have the rest of the round.
  assert.ok(PULL_UP_WORDS_S >= 1 && PULL_UP_CYCLE_S - PULL_UP_WORDS_S >= 1.5);
  times.forEach((time, i) => near(time - whoops[i], PULL_UP_WORDS_S, 2 * FRAME));
  assert.ok(times.length === whoops.length || times.length === whoops.length - 1);
  // It outranks everything else said.
  assert.ok(callouts.every((callout) => callout.kind === "pullUp" && callout.rank === 3));
  assert.deepEqual(quiet.filter(([, kind]) => kind === "pullUp").map(([t]) => Math.round(t)), [11]);
  // The whoops are let through for exactly as long.
  const on = mixSound(initialMemory(CRUISE, STATUS), CRUISE, { ...STATUS, warnings: ["terrain"] }, false, FRAME, never);
  assert.equal(on.levels.alerts.terrain, true);
  assert.deepEqual(on.events.map(({ kind }) => kind), ["whoops"]);
  assert.equal(mixSound(on.memory, CRUISE, STATUS, false, FRAME, never).levels.alerts.terrain, false);
  // Outside, neither whoops nor words.
  const outside = listen(10, () => ({ status: { view: "outside", warnings: ["terrain"] } }));
  assert.deepEqual([outside.said, outside.whoops], [[], []]);
});

test("while the pull-up warning sounds nothing else is said, and what was being said gives way to it", () => {
  const { said, quiet } = listen(12, (t) => ({ status: { warnings: t >= 4 && t < 9 ? ["bank", "terrain", "gear"] : ["bank"] } }));
  const during = said.filter(([t]) => t >= 4 && t < 9).map(([, one]) => one);
  assert.ok(during.length > 0 && during.every((one) => one === "Pull up, pull up"), during.join("; "));
  // As it starts, the bank's callout is taken back; after it, the bank is called again.
  assert.ok(quiet.some(([t, kind]) => kind === "bank" && Math.abs(t - 4) < 2 * FRAME));
  assert.ok(words(said, "Bank angle, bank angle").some((time) => time >= 9));
});

test("sinking too fast is \"sink rate\" first, and \"pull up\" once the height left is too little for it", () => {
  assert.equal(pullUpBelow(5), 0);
  // About 1,700 ft/min at 280 ft and 7,100 ft/min at 2,450 ft.
  near(pullUpBelow(8.7), 87, 2);
  near(pullUpBelow(36.2), 747, 5);
  // Down at 20 m/s from 700 m: the warning from the start, the pull-up from where the curve says.
  const below = pullUpBelow(20);
  const dive = listen(30, (t) => ({ input: { height: Math.max(700 - 20 * t, 1), sink: 20 }, status: { warnings: ["sink"] } }));
  assert.deepEqual(dive.said[0], [0, "Sink rate"]);
  near(dive.whoops[0], (700 - below) / 20, 3 * FRAME);
  assert.equal(words(dive.said, "Sink rate").length, 1);
  assert.ok(words(dive.said, "Pull up, pull up").length >= 3);
  // Already that low as it starts: "pull up" at once, and no "sink rate" over its whoops.
  const low = listen(6, () => ({ input: { height: 100, sink: 20 }, status: { warnings: ["sink"] } }));
  assert.deepEqual(low.whoops[0], 0);
  assert.deepEqual(words(low.said, "Sink rate"), []);
  // Sinking no faster than the warning's own limit, high up: "sink rate" alone.
  const high = listen(6, () => ({ input: { height: 600, sink: 10 }, status: { warnings: ["sink"] } }));
  assert.deepEqual([high.said.map(([, one]) => one), high.whoops], [["Sink rate"], []]);
  // "Too low, gear" as its warning starts, once.
  assert.deepEqual(listen(6, (t) => ({ status: { warnings: t > 1 ? ["gear"] : [] } })).said.map(([, one]) => one), ["Too low, gear"]);
});

/* ---- whose turn it is to be said ---- */

const HEIGHT: Callout = { kind: "height", words: "Fifty", rank: 0, keep: 0.5 };
const RETARD: Callout = { kind: "retard", words: "Retard, retard", rank: 0, keep: 0.8 };
const BANK: Callout = { kind: "bank", words: "Bank angle, bank angle", rank: 1, keep: 1 };
const PULL_UP: Callout = { kind: "pullUp", words: "Pull up, pull up", rank: 3, keep: 0.4 };

test("a warning cuts a height call off; a lesser callout waits its turn", () => {
  const queue = new CalloutQueue();
  assert.deepEqual(queue.push(HEIGHT, 0), { cut: false, say: HEIGHT });
  assert.deepEqual(queue.push(BANK, 0.1), { cut: true, say: BANK });
  // The height call that was cut off is not said again; one that comes now waits, and is said when the warning is over.
  assert.deepEqual(queue.push(HEIGHT, 0.2), { cut: false, say: null });
  assert.deepEqual(queue.done(BANK, 0.6), { cut: false, say: HEIGHT });
  assert.deepEqual(queue.done(HEIGHT, 1), { cut: false, say: null });
  // Of the same rank, neither cuts the other: "twenty", then "retard".
  queue.push({ ...HEIGHT, words: "Twenty" }, 2);
  assert.deepEqual(queue.push(RETARD, 2), { cut: false, say: null });
});

test("nothing is said late: what has waited longer than it is worth is dropped", () => {
  const queue = new CalloutQueue();
  queue.push(PULL_UP, 0);
  queue.push(HEIGHT, 0.1);
  queue.push(BANK, 0.1);
  // The words took 1.3 s: the height call is stale by then (0.5 s), and so is the bank's (1 s).
  assert.deepEqual(queue.done(PULL_UP, 1.3), { cut: false, say: null });
  // In time, the higher rank goes first, and the other after it if it is still worth it.
  queue.push(PULL_UP, 2);
  queue.push(HEIGHT, 2.1);
  queue.push(BANK, 2.2);
  assert.deepEqual(queue.done(PULL_UP, 2.5), { cut: false, say: BANK });
  assert.deepEqual(queue.done(BANK, 2.55), { cut: false, say: HEIGHT });
});

test("the same words never wait twice; behind themselves they wait once, and no longer than they are worth", () => {
  const queue = new CalloutQueue();
  const first = { ...RETARD };
  const second = { ...RETARD };
  assert.equal(queue.push(first, 0).say, first);
  // The repeat comes due while the first is still being said: it follows it, the one after that does not.
  assert.deepEqual(queue.push(second, 1.5), { cut: false, say: null });
  assert.deepEqual(queue.push({ ...RETARD }, 1.55), { cut: false, say: null });
  assert.equal(queue.done(first, 1.7).say, second);
  assert.deepEqual(queue.done(second, 2.9), { cut: false, say: null });
  // Too long behind itself, it is not said at all.
  const third = { ...RETARD };
  queue.push(third, 3);
  queue.push({ ...RETARD }, 3.1);
  assert.deepEqual(queue.done(third, 3.1 + RETARD.keep + 0.1), { cut: false, say: null });
  queue.clear();
  queue.push(PULL_UP, 1);
  queue.push({ ...BANK }, 1.1);
  queue.push({ ...BANK }, 1.2);
  const next = queue.done(PULL_UP, 1.4);
  assert.equal(next.say?.words, BANK.words);
  assert.deepEqual(queue.done(next.say!, 1.9), { cut: false, say: null });
});

test("a callout that no longer holds is cut off and none of its kind waits; one the browser never ended does not block the rest", () => {
  const queue = new CalloutQueue();
  queue.push(BANK, 0);
  queue.push(HEIGHT, 0.1);
  assert.deepEqual(queue.drop("bank", 0.2), { cut: true, say: HEIGHT });
  queue.push(RETARD, 0.3);
  // Not the one being said: only taken out of the line.
  assert.deepEqual(queue.drop("retard", 0.35), { cut: false, say: null });
  assert.deepEqual(queue.done(HEIGHT, 0.5), { cut: false, say: null });
  // Told of the end of something it is not saying: nothing.
  queue.push(BANK, 1);
  assert.deepEqual(queue.done(HEIGHT, 1.1), { cut: false, say: null });
  assert.deepEqual(queue.push(RETARD, 1.2), { cut: false, say: null });
  // The bank's callout never reported over: after a while the voice is taken to be free.
  assert.deepEqual(queue.push(HEIGHT, 1 + CALLOUT_LONGEST_S + 0.1), { cut: false, say: HEIGHT });
  queue.clear();
  assert.deepEqual(queue.push(BANK, 10), { cut: false, say: BANK });
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
