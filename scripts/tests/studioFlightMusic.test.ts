import assert from "node:assert/strict";
import test from "node:test";
import {
  initialMemory, LOW_APPROACH_M, LOW_APPROACH_S, mixSound, TENSE_HOLD_S, TENSE_LEAST, TENSE_OFF, TENSE_ON, TENSION_IN_S, tensionOf,
} from "../../src/lib/studio/flight/soundMix.ts";
import type { MusicLevels, SoundInput, SoundMemory, SoundStatus } from "../../src/lib/studio/flight/soundMix.ts";

/** Cruise: 250 kt indicated, Mach 0.78, clear air, high up. */
const CRUISE: SoundInput = {
  throttle: 0.7, ias: 128, mach: 0.78, dbz: null, rain: 0, turbulence: 0, flash: 0, strike: false, brake: false, fade: 0, storm: null,
  height: 9000, cloud: 0,
};
const STATUS: SoundStatus = { view: "outside", warnings: [], alarms: [], silenced: [], paused: false, autopilot: false, warp: false, low: false };
const never = () => 0.999999;
const FRAME = 1 / 60;

/** Fly the mix for `seconds`, each frame's input and status from a function of the time; every frame's music kept. */
function fly(
  seconds: number, at: (t: number) => { input?: Partial<SoundInput>; status?: Partial<SoundStatus> } = () => ({}), memory?: SoundMemory,
) {
  let held = memory ?? initialMemory(CRUISE, STATUS);
  const frames: MusicLevels[] = [];
  for (let t = 0; t < seconds; t += FRAME) {
    const { input, status } = at(t);
    const frame = mixSound(held, { ...CRUISE, ...input }, { ...STATUS, ...status }, false, FRAME, never);
    held = frame.memory;
    frames.push(frame.levels.music);
  }
  return { music: frames[frames.length - 1], frames, memory: held };
}

/** The music settled in a steady state. */
const settled = (input: Partial<SoundInput> = {}, status: Partial<SoundStatus> = {}, seconds = 20) => fly(seconds, () => ({ input, status }));

test("a flight's music comes in from silence, slowly and smoothly", () => {
  const { frames } = fly(14);
  assert.equal(initialMemory(CRUISE, STATUS).music.gain, 0);
  assert.ok(frames[0].gain < 0.02);
  assert.ok(frames[Math.round(2 / FRAME)].gain < 0.4, `two seconds in: ${frames[Math.round(2 / FRAME)].gain}`);
  assert.ok(frames[frames.length - 1].gain > 0.75);
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i].gain - frames[i - 1].gain) < 0.02, "no step a frame");
});

test("the clean view is the fullest, outside softer, the cockpit as full over the engines and band-limited as through a headset", () => {
  const clean = settled({}, { view: "clean" }).music;
  const outside = settled({}, { view: "outside" }).music;
  const cockpit = settled({}, { view: "cockpit" }).music;
  assert.ok(clean.gain > outside.gain);
  // Over the engines' drone, loudest in the cockpit, the music is as full as anywhere.
  assert.ok(cockpit.gain > outside.gain && cockpit.gain >= clean.gain - 1e-9);
  assert.ok(cockpit.high > 80 && cockpit.low < 12000, "a narrower band in the cockpit");
  assert.ok(clean.high < 30 && clean.low > 15000, "the whole band outside");
});

test("under the cockpit's voice and an alarm the music ducks, quickly; a silenced alarm no longer ducks it", () => {
  const cockpit = { view: "cockpit" as const };
  const free = settled({}, cockpit).music.gain;
  const voice = settled({ speaking: true }, cockpit).music.gain;
  const alarm = settled({}, { ...cockpit, warnings: ["overspeed"], alarms: ["overspeed"] }).music.gain;
  const hushed = settled({}, { ...cockpit, warnings: ["overspeed"], alarms: ["overspeed"], silenced: ["overspeed"] }).music.gain;
  assert.ok(voice < free * 0.6 && alarm < free * 0.4 && alarm < voice);
  assert.ok(Math.abs(hushed - free) < 0.01);
  // A duck takes hold within a second.
  const ducking = fly(1, () => ({ input: { speaking: true }, status: cockpit }), settled({}, cockpit).memory).music.gain;
  assert.ok(ducking < free * 0.6);
});

test("dense cloud muffles the music; breaking out into clear air opens it up in a swell", () => {
  const clear = settled().music;
  const inCloud = settled({ cloud: 1 }).music;
  assert.ok(inCloud.low < clear.low * 0.3 && inCloud.gain < clear.gain);
  // Out of cloud after ten seconds in it: louder than plain clear air for a while, then back.
  const out = fly(10, () => ({ input: { cloud: 1 } }), settled().memory);
  const after = fly(25, () => ({ input: { cloud: 0 } }), out.memory);
  const peak = Math.max(...after.frames.map((frame) => frame.gain));
  assert.ok(peak > clear.gain * 1.2, `a swell: ${peak} over ${clear.gain}`);
  assert.ok(after.music.gain < peak && after.music.gain < clear.gain * 1.1);
  // A brush with cloud is not one.
  const brush = fly(1, () => ({ input: { cloud: 1 } }), settled().memory);
  const brushed = fly(6, () => ({ input: { cloud: 0 } }), brush.memory);
  assert.ok(Math.max(...brushed.frames.map((frame) => frame.gain)) < clear.gain * 1.05);
});

test("severe turbulence and hail take the music down; time running faster and a slow orbit bring it up", () => {
  const calm = settled().music.gain;
  assert.ok(settled({ turbulence: 0.95, severity: 0.8 }).music.gain < calm * 0.6);
  assert.ok(settled({ dbz: 62 }).music.gain < calm * 0.6);
  assert.ok(settled({}, { warp: true }).music.gain > calm * 1.2);
  const orbit = fly(20, (t) => ({ input: { orbit: 24 + 15 * t } })).music.gain;
  const whip = fly(20, (t) => ({ input: { orbit: 24 + 300 * t } })).music.gain;
  assert.ok(orbit > calm * 1.1, `a slow orbit: ${orbit} against ${calm}`);
  assert.ok(Math.abs(whip - calm) < 0.05, "a fast drag round is no orbit");
});

test("on the ground the music is low, and the take-off swells it", () => {
  const air = settled().music.gain;
  const parked = settled({ onGround: true, rolling: 0, height: 0 }).music.gain;
  assert.ok(parked < air * 0.6);
  const rolling = fly(15, (t) => ({ input: { onGround: true, rolling: t * 5, height: 0 } }), settled({ onGround: true, height: 0 }).memory);
  assert.ok(rolling.music.gain > parked * 1.3, "the roll brings it up");
  const lifted = fly(6, () => ({ input: { onGround: false, height: 30 } }), rolling.memory);
  assert.ok(Math.max(...lifted.frames.map((frame) => frame.gain)) > air * 1.1, "leaving the ground swells");
});

test("a wreck silences the music, and the next start brings it back", () => {
  const flying = settled();
  const wrecked = fly(2, () => ({ input: { ended: true } }), flying.memory);
  assert.ok(wrecked.music.gain < 0.05);
  const again = fly(8, () => ({}), wrecked.memory);
  assert.ok(again.music.gain > flying.music.gain * 0.9);
});

/* ---- tension ---- */

test("what makes a flight difficult: a strong storm near or around it, jammed gear, lost surfaces, a long low approach, warnings held", () => {
  const status = { warnings: [] };
  assert.equal(tensionOf(CRUISE, status, 0, 0), 0);
  assert.ok(tensionOf({ ...CRUISE, storm: { peakDbz: 62, distance: 5_000 } }, status, 0, 0) >= TENSE_ON, "close to a strong storm");
  assert.ok(tensionOf({ ...CRUISE, storm: { peakDbz: 62, distance: 120_000 } }, status, 0, 0) < TENSE_OFF, "a strong storm far off is not");
  assert.ok(tensionOf({ ...CRUISE, storm: { peakDbz: 40, distance: 5_000 } }, status, 0, 0) < TENSE_OFF, "nor a weak one near");
  assert.ok(tensionOf({ ...CRUISE, dbz: 56 }, status, 0, 0) >= TENSE_ON, "inside a strong storm");
  assert.ok(tensionOf(CRUISE, { warnings: ["gearJammed"] }, 0, 0) >= TENSE_ON);
  const one = tensionOf({ ...CRUISE, lost: 1 }, status, 0, 0);
  assert.ok(one < TENSE_ON && one > TENSE_OFF, "one part come off is half a reason");
  assert.ok(tensionOf({ ...CRUISE, lost: 2 }, status, 0, 0) >= TENSE_ON, "two are a whole one");
  const flaps = tensionOf(CRUISE, { warnings: ["flapsJammed"] }, 0, 0);
  assert.ok(flaps < TENSE_ON && flaps > TENSE_OFF, "jammed flaps alone are not quite");
  assert.ok(tensionOf(CRUISE, status, LOW_APPROACH_S[1], 0) >= TENSE_ON);
  assert.ok(tensionOf(CRUISE, status, LOW_APPROACH_S[0] / 2, 0) === 0);
  assert.ok(tensionOf(CRUISE, status, 0, 30) >= TENSE_ON);
  // Two half-reasons together are a whole one.
  assert.ok(tensionOf({ ...CRUISE, storm: { peakDbz: 55, distance: 30_000 } }, { warnings: ["flapsJammed"] }, 0, 0) >= TENSE_ON);
});

test("tension crossfades the theme into the suspenseful piece in a few seconds, at equal power, and the two do not linger together", () => {
  const calm = settled().music;
  assert.ok(calm.theme > 0.99 && calm.tension < 0.01);
  const storm = { storm: { peakDbz: 63, distance: 4_000 }, dbz: 56 };
  const rising = fly(40, () => ({ input: storm }));
  const at = (seconds: number) => rising.frames[Math.round(seconds / FRAME)];
  // Not at once: nothing while it waits to hear the trouble last; then a second in barely begun; a few seconds on, most of the way.
  assert.ok(at(TENSE_HOLD_S - 0.5).tension < 0.01, `before it is held: ${at(TENSE_HOLD_S - 0.5).tension}`);
  assert.ok(at(TENSE_HOLD_S + 1).tension < 0.4, `a second in: ${at(TENSE_HOLD_S + 1).tension}`);
  const most = TENSE_HOLD_S + TENSION_IN_S * 1.5;
  assert.ok(at(most).tension > 0.8, `${most} s in: ${at(most).tension}`);
  const full = rising.music;
  assert.ok(full.tension > 0.99 && full.theme < 0.02, "the theme gone under it");
  // Both heard at once only on the way across.
  const both = rising.frames.filter((frame) => frame.theme > 0.2 && frame.tension > 0.2).length * FRAME;
  assert.ok(both < 6.5, `${both.toFixed(1)} s of both`);
  for (const frame of rising.frames) assert.ok(Math.abs(frame.theme ** 2 + frame.tension ** 2 - 1) < 1e-6, "equal power");
  for (let i = 1; i < rising.frames.length; i++) {
    assert.ok(Math.abs(rising.frames[i].tension - rising.frames[i - 1].tension) < 0.01, "no step a frame");
  }
  // Clear of it again: a little slower to go, and gone within half a minute.
  const easing = fly(3, () => ({}), rising.memory);
  assert.ok(easing.music.tension > 0.5, `still going after three seconds: ${easing.music.tension}`);
  const gone = fly(30, () => ({}), easing.memory);
  assert.ok(gone.music.tension < 0.05);
});

test("tension never flickers: it takes more to begin than to keep, and once begun it is clearly there", () => {
  // Hovering at the threshold: jammed flaps alone just under it, jammed gear just over, by turns.
  const wobble = (t: number) => ({ status: { warnings: [Math.sin(t / 2) > 0 ? "gearJammed" as const : "flapsJammed" as const] } });
  const run = fly(120, wobble);
  assert.ok(run.music.tension >= Math.sin((TENSE_LEAST * Math.PI) / 2) * 0.9, "held at least its least once begun");
  const swing = run.frames.slice(-1800).map((frame) => frame.tension);
  assert.ok(Math.max(...swing) - Math.min(...swing) < 0.1, "steady, not flickering");
  // Below the threshold to begin, it never does.
  const below = fly(120, () => ({ status: { warnings: ["flapsJammed" as const] } }));
  assert.ok(below.music.tension < 0.01);
});

test("a long, low approach and warnings held build tension over time", () => {
  const low = fly(LOW_APPROACH_S[1] + 60, () => ({ input: { height: LOW_APPROACH_M - 50 } }));
  assert.ok(low.music.tension > 0.6);
  const brief = fly(LOW_APPROACH_S[0] - 5, () => ({ input: { height: LOW_APPROACH_M - 50 } }));
  assert.ok(brief.music.tension < 0.01);
  const warned = fly(80, () => ({ status: { warnings: ["overspeed", "sink"], alarms: ["overspeed", "sink"] } }));
  assert.ok(warned.music.tension > 0.6);
  const one = fly(80, () => ({ status: { warnings: ["overspeed"], alarms: ["overspeed"] } }));
  assert.ok(one.music.tension < 0.01, "one warning is not trouble enough");
  const voiced = fly(80, () => ({ status: { warnings: ["overspeed", "bank"], alarms: ["overspeed", "bank"] } }));
  assert.ok(voiced.music.tension < 0.01, "nor one with the bank angle called: a voice is not an alarm");
});

test("one alarm is not the suspenseful piece: an overspeed that sheds a surface, or an alarm that comes and goes", () => {
  // An overspeed, and five seconds on an aileron fluttered off: half a minute of it, and still the theme.
  const shed = fly(30, (t) => {
    const lost = t >= 5 ? ["lost.leftAileron" as const] : [];
    return { input: { lost: lost.length }, status: { warnings: ["overspeed"], alarms: ["overspeed", ...lost] } };
  });
  assert.ok(Math.max(...shed.frames.map((frame) => frame.tension)) < 0.01, `${shed.music.tension}`);
  // Jammed gear, a real reason, but only for a moment: no swell of suspense for it.
  const blip = fly(20, (t) => ({ status: { warnings: t < TENSE_HOLD_S - 1 ? ["gearJammed" as const] : [] } }));
  assert.ok(Math.max(...blip.frames.map((frame) => frame.tension)) < 0.01);
});

test("the suspenseful piece is shaped as the theme is: muffled in cloud, ducked in the cockpit", () => {
  const storm = { storm: { peakDbz: 63, distance: 4_000 } };
  const outside = fly(90, () => ({ input: storm })).music;
  const cockpit = fly(90, () => ({ input: storm, status: { view: "cockpit" } })).music;
  assert.ok(Math.abs(outside.tension - cockpit.tension) < 1e-9, "the crossfade is the view's alike");
  assert.ok(cockpit.gain > outside.gain && cockpit.low < outside.low, "the level and band are the view's, for both");
});
