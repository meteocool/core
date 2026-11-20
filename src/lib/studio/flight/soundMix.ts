/**
 * What the flight sounds like at a moment, as numbers: from the telemetry,
 * the flight's status and the view to the levels, pitches and filter
 * frequencies the sound graph (soundGraph.ts) is set to, and the one-off
 * sounds a frame starts (a thump, a creak, thunder, a chime), and what the
 * cockpit's voice says in it and when: the heights on the way down, "retard",
 * "bank angle", and "pull up" between the terrain warning's whoops. Saying
 * them is the flight's sound's (sound.ts); which of them gets to be heard
 * when several are due is `CalloutQueue`'s, here too.
 *
 * Pure, so the tests can fly it: what it remembers from frame to frame (how
 * far the engines have spooled, what was on a frame ago) goes in and comes
 * back out as `SoundMemory`, and the dice for the irregular sounds are
 * handed in.
 *
 * Levels are 0 to 1 against each sound's own loudest; the graph scales them
 * to the mix. The view decides what is heard: from the cockpit the world
 * outside is muffled and the cockpit's own sounds (its alerts, the creaks
 * of the panels) are clear; from outside the engines and the wind are full
 * and there are no cockpit sounds; the clean view is outside's, gentler.
 */
import type { FlightStatus, FlightView } from "../store";
import { FLAP_NOTCH_S, GEAR_S, MMO, VMO_MS } from "./physics";

/** What of the telemetry the sound follows. */
export interface SoundInput {
  /** Where the throttle lever is, 0 to 1. */
  throttle: number;
  /** Indicated airspeed, m/s, and Mach number. */
  ias: number;
  mach: number;
  /** The reflectivity where the aircraft is, dBZ; null where none is known. */
  dbz: number | null;
  rain: number;
  turbulence: number;
  /** A lightning flash, 0 to 1: it jumps to 1 on a strike and dies away. */
  flash: number;
  /** A strike nearby was seen this frame, flash or not (no flash is drawn with reduced motion). */
  strike: boolean;
  brake: boolean;
  /** A cut to black and back, 0 to 1. */
  fade: number;
  /** The storm system flown at: its strongest echo, dBZ, and how far it is, metres. */
  storm: { peakDbz: number; distance: number } | null;
  /** How far the landing gear is down, 0 up to 1 down; up where not said. */
  gear?: number;
  /** Where the flaps are, in the lever's places; in where not said. */
  flaps?: number;
  /** How fast the aircraft is rolling over the ground, m/s; none in the air. */
  rolling?: number;
  /** Where the thrust levers themselves are, 0 to 1, whatever the reversers do; the throttle's where not said. */
  lever?: number;
  /** The height over the ground, metres; not known where not said. */
  height?: number;
  /** How fast the aircraft is coming down, m/s; negative climbing. */
  sink?: number;
  /** Whether the wheels are on the ground. */
  onGround?: boolean;
}

export type SoundStatus = Pick<FlightStatus, "view" | "warnings" | "paused" | "autopilot" | "warp" | "low">;

/** What the mix carries from one frame to the next. */
export interface SoundMemory {
  /** How far the engines have spooled towards the throttle, 0 to 1. */
  spool: number;
  throttle: number;
  flash: number;
  autopilot: boolean;
  low: boolean;
  /** Whether the seat-belt sign has chimed this flight. */
  seatbelt: boolean;
  /** Seconds until distant thunder may roll again. */
  thunderQuiet: number;
  /** Where the gear was a frame ago, and which way it was going then: 1 down, -1 up, 0 not at all. */
  gear: number;
  gearGoing: number;
  /** Where the flaps were a frame ago, and for how long their motor has been heard since it was last started, seconds. */
  flaps: number;
  flapsFor: number;
  voice: VoiceMemory;
}

/** What the cockpit's voice carries from one frame to the next. */
export interface VoiceMemory {
  /** The height over the ground a frame ago, metres: what is called is called on passing it. Not a number before the first. */
  height: number;
  /** What was being warned of a frame ago. */
  warned: FlightStatus["warnings"];
  /** Whether "bank angle" was being said, and the seconds until it may be again. */
  banking: boolean;
  bankIn: number;
  /** Whether the pull-up warning was sounding, and how far into its cycle of whoops and words it is, seconds. */
  pulling: boolean;
  pullFor: number;
  /** Whether the aircraft has come down through twenty feet to land; whether "retard" was being said, and the seconds until it is again. */
  landing: boolean;
  retarding: boolean;
  retardIn: number;
  /** How long the wheels have been on the ground, seconds. */
  groundFor: number;
}

/** What a callout is about: one that no longer holds is taken back by its kind. */
export type CalloutKind = "height" | "retard" | "bank" | "caution" | "pullUp";

/**
 * Something for the cockpit's voice to say: the words, how they rank (a
 * higher rank cuts a lower one off), and how long they may wait for the
 * voice to be free before they are no longer worth saying, seconds.
 */
export interface Callout {
  kind: CalloutKind;
  words: string;
  rank: number;
  keep: number;
}

/** Sounds a frame starts, each once. */
export type SoundEvent =
  | { kind: "thunder"; distance: number; strength: number }
  | { kind: "thump"; strength: number }
  | { kind: "creak"; strength: number }
  | { kind: "rattle"; strength: number }
  | { kind: "seatbelt" | "low" | "apOff" | "apOn" | "detent" }
  /** The gear's hydraulics running for as long as it has left to travel, seconds; and its lock at either end. */
  | { kind: "gearMotor"; seconds: number }
  | { kind: "gearLock"; strength: number }
  /** The pull-up warning's pair of whoops. */
  | { kind: "whoops" }
  /** A tone in place of a callout of this rank, where the browser has no voice. */
  | { kind: "attention"; rank: number }
  /** The airframe giving way, and an explosion: 0 to 1 by how much of it. */
  | { kind: "breakup" | "explosion"; strength: number };

/** The continuous sounds, set every frame. */
export interface SoundLevels {
  /** The loudness of everything, 0 muted. */
  volume: number;
  /** The flight's sounds against the reader's own (the clicks): ducked through a cut to black. */
  world: number;
  engine: {
    /** The fan's speed, a share of full: what the rest follows. */
    n1: number;
    rumble: number;
    rumbleHz: number;
    /** The fan's tone, at its blades' passing frequency, Hz. */
    whine: number;
    whineHz: number;
    /** The buzz of a fan whose tips go supersonic at high power, at the shaft's own rate, Hz. */
    buzz: number;
    buzzHz: number;
    hiss: number;
    hissHz: number;
    /** What the engines are heard through: a low-pass, Hz. */
    cutoff: number;
  };
  wind: {
    gain: number;
    hz: number;
    /** How hard the rough air buffets the airflow, 0 to 1: the depth of its swells. */
    buffet: number;
    /** The low roar of the speed brake out, and of the airframe near its limit. */
    brake: number;
    roar: number;
    cutoff: number;
  };
  /** The rough air's own low rumble, under the thumps. */
  rumble: number;
  rain: { gain: number; hz: number; hail: number };
  thunder: { gain: number; cutoff: number };
  /** The cockpit's own sounds: the creaks, the rattles, the chimes. */
  cabin: number;
  /** The airflow's whoosh while time runs faster. */
  warp: number;
  alerts: { gain: number; terrain: boolean; stall: boolean; overspeed: boolean };
}

/** The loudness everything is played at unmuted, against full scale: well under it. */
export const VOLUME = 0.5;

/** The fan at idle, a share of full speed. */
export const IDLE_N1 = 0.22;
/** How long the engines take to spool up and down after the lever, seconds: up is the slower. */
export const SPOOL_UP_S = 3.5;
export const SPOOL_DOWN_S = 2.4;
/** The fan's blade-passing frequency at full speed, Hz (36 blades at about 5,200 rpm), and the shaft's rate. */
const BLADE_HZ = 3120;
const SHAFT_HZ = 87;

/** The turbulence below which nothing is heard of it; where it gets rough, and where violent. */
export const LIGHT_TURBULENCE = 0.12;
export const ROUGH_TURBULENCE = 0.4;
const SEVERE_TURBULENCE = 0.7;

/** Where hail starts to tick on the windshield, dBZ, and where it is at its hardest. */
const HAIL_DBZ: [number, number] = [52, 62];

/** How much louder the airflow is with the gear all the way down. */
export const GEAR_WIND = 0.3;
/** The speed over the ground at which its rumble is loudest, m/s. */
export const ROLLING_LOUDEST_MS = 60;

/** The throttle's detents: idle, climb, and full. */
export const DETENTS = [0, 0.85, 1];

/** The heights called out on the way down, metres, and as they are said: 500, 100, 50, 30, 20 and 10 ft. */
export const HEIGHT_CALLS: Array<[number, string]> = [
  [152.4, "Five hundred"], [30.5, "One hundred"], [15.2, "Fifty"], [9.1, "Thirty"], [6.1, "Twenty"], [3, "Ten"],
];
/** A height that falls by more than this in a frame was not flown through, metres: a new start, or the ground found. */
const HEIGHT_JUMP_M = 50;

/**
 * "Retard": from twenty feet down with the gear down, for as long as the
 * thrust levers are above idle, this often (start to start, seconds: the
 * words themselves take most of it), until the aircraft has been on the
 * ground this long. Back above thirty feet, or with the levers at climb power or
 * more, it is not a landing any more.
 */
export const RETARD_M = 6.1;
export const RETARD_OVER_M = 9.1;
export const RETARD_AGAIN_S = 1.5;
export const RETARD_GROUND_S = 3;
export const IDLE_LEVER = 0.05;
/** Going up this fast, m/s, the aircraft is not landing: nothing is said of the levers. */
const CLIMBING_MS = 0.5;

/** How often "bank angle" is said while the bank lasts, start to start, seconds. */
export const BANK_AGAIN_S = 3;

/**
 * The pull-up warning: two whoops, then the words, and again; how long one
 * round is and when in it the words start, seconds. The whoops take the
 * first second, the words a little over another, and the rest is the room
 * a slower voice needs.
 */
export const PULL_UP_CYCLE_S = 2.8;
export const PULL_UP_WORDS_S = 1.05;

/** What is said as a warning starts, besides what it sounds like. */
const CAUTIONS: Array<[FlightStatus["warnings"][number], string]> = [["gear", "Too low, gear"], ["sink", "Sink rate"]];

/** How the callouts rank, and how long each may wait for the voice, seconds. */
const SAY: Record<CalloutKind, { rank: number; keep: number }> = {
  height: { rank: 0, keep: 0.5 },
  retard: { rank: 0, keep: 0.8 },
  bank: { rank: 1, keep: 1 },
  caution: { rank: 2, keep: 1.5 },
  pullUp: { rank: 3, keep: 0.4 },
};
const callout = (kind: CalloutKind, words: string): Callout => ({ kind, words, ...SAY[kind] });

/**
 * The height under which coming down this fast, m/s, is "pull up" and no
 * longer "sink rate", metres: the inner curve of a ground proximity
 * warning's excessive descent rate mode, from about 1,700 ft/min at 280 ft
 * to 7,100 ft/min at 2,450 ft.
 */
export function pullUpBelow(sink: number): number {
  return sink < 8.7 ? 0 : 87 + 24 * (sink - 8.7);
}

/** How each view hears: the engines, their low-pass, the wind, its low-pass, the rain, the thunder's level and low-pass, the cockpit's own. */
const VIEWS: Record<FlightView, {
  engine: number; engineCutoff: number; wind: number; windCutoff: number; rain: number; thunder: number; thunderCutoff: number; cabin: number;
}> = {
  cockpit: { engine: 0.4, engineCutoff: 750, wind: 1, windCutoff: 2600, rain: 1, thunder: 0.8, thunderCutoff: 1800, cabin: 1 },
  outside: { engine: 1, engineCutoff: 16000, wind: 0.75, windCutoff: 9000, rain: 0.35, thunder: 1, thunderCutoff: 9000, cabin: 0 },
  clean: { engine: 0.6, engineCutoff: 9000, wind: 0.5, windCutoff: 6000, rain: 0.25, thunder: 0.85, thunderCutoff: 7000, cabin: 0 },
};

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const ramp = (value: number, low: number, high: number) => clamp01((value - low) / (high - low));

/** What a flight's sound starts from: the engines already at the throttle, as they are in the air. */
export function initialMemory(input: Pick<SoundInput, "throttle">, status: Pick<SoundStatus, "autopilot" | "low">): SoundMemory {
  return {
    spool: input.throttle, throttle: input.throttle, flash: 0, autopilot: status.autopilot, low: status.low, seatbelt: false, thunderQuiet: 4,
    gear: 0, gearGoing: 0, flaps: 0, flapsFor: Infinity,
    voice: {
      height: NaN, warned: [], banking: false, bankIn: 0, pulling: false, pullFor: 0, landing: false, retarding: false, retardIn: 0,
      groundFor: 0,
    },
  };
}

/** The engines a step on: towards the lever, the slower spooling up. */
export function spoolTowards(spool: number, throttle: number, dt: number): number {
  const tau = throttle > spool ? SPOOL_UP_S : SPOOL_DOWN_S;
  return spool + (throttle - spool) * (1 - Math.exp(-dt / tau));
}

/** Whether a rate a second fires in a step of `dt`. */
const fires = (rate: number, dt: number, random: () => number) => rate > 0 && random() < 1 - Math.exp(-rate * dt);

/**
 * What the cockpit's voice says in a frame, which kinds of callout no longer
 * hold and are taken back, and whether a pair of whoops starts.
 *
 * - The heights, on passing each on the way down with the gear down.
 * - "Retard, retard" from twenty feet with the levers above idle, again and
 *   again until they are at idle; never on the way up.
 * - "Bank angle, bank angle" at once as the bank warning starts, and again
 *   every few seconds while it lasts.
 * - "Too low, gear" and "sink rate", once as each warning starts.
 * - "Pull up, pull up" after each pair of whoops, for the ground ahead and
 *   for a sink rate that has become too much for the height left. While it
 *   sounds nothing else is said: the whoops would be talked over.
 *
 * All of it in the cockpit only, as the alerts are; through a cut to black
 * nothing is said and what was under way is forgotten.
 */
function voice(memory: VoiceMemory, input: SoundInput, status: SoundStatus, dt: number, cutting: boolean): {
  callouts: Callout[]; quiet: CalloutKind[]; whoops: boolean; memory: VoiceMemory;
} {
  const cockpit = status.view === "cockpit" && !cutting;
  const callouts: Callout[] = [];
  const quiet: CalloutKind[] = [];
  const onGround = input.onGround ?? false;
  const height = onGround ? 0 : (input.height ?? Infinity);
  const before = memory.height;
  const sink = input.sink ?? 0;
  const lever = input.lever ?? input.throttle;
  const gearDown = (input.gear ?? 0) >= 1;
  // Passed on the way down, and flown through: not jumped over by a new start.
  const passed = (metres: number) => before > metres && height <= metres && before - height < HEIGHT_JUMP_M;

  // The pull-up warning: the ground ahead, or sinking faster than the height left allows. It lets go a little later than it took hold.
  const sinking = status.warnings.includes("sink") && height < pullUpBelow(sink) * (memory.pulling ? 1.15 : 1);
  const pulling = cockpit && (status.warnings.includes("terrain") || sinking);
  let pullFor = 0;
  let whoops = false;
  if (pulling) {
    pullFor = memory.pulling ? memory.pullFor + dt : 0;
    if (pullFor >= PULL_UP_CYCLE_S) pullFor = 0;
    whoops = pullFor === 0;
    // Whatever was being said gives way to the whoops.
    if (!memory.pulling) quiet.push("height", "retard", "bank", "caution");
    if (!whoops && memory.pullFor < PULL_UP_WORDS_S && pullFor >= PULL_UP_WORDS_S) callouts.push(callout("pullUp", "Pull up, pull up"));
  } else if (memory.pulling) {
    quiet.push("pullUp");
  }
  const free = cockpit && !pulling;

  // The heights: the lowest one passed in this frame.
  if (free && gearDown) {
    const called = HEIGHT_CALLS.filter(([metres]) => passed(metres)).pop();
    if (called) callouts.push(callout("height", called[1]));
  }

  // "Retard": a landing from twenty feet down, until the levers are at idle or it has been on the ground a while.
  const groundFor = onGround ? memory.groundFor + dt : 0;
  let landing = memory.landing || (gearDown && passed(RETARD_M));
  if (height > RETARD_OVER_M || groundFor > RETARD_GROUND_S || lever >= DETENTS[1] || !gearDown || cutting) landing = false;
  const climbing = !onGround && sink < -CLIMBING_MS;
  const retarding = free && landing && lever > IDLE_LEVER && !climbing;
  let retardIn = Math.max(0, memory.retardIn - dt);
  if (retarding && retardIn === 0) {
    callouts.push(callout("retard", "Retard, retard"));
    retardIn = RETARD_AGAIN_S;
  }
  if (!retarding && memory.retarding) quiet.push("retard");

  // "Bank angle": at once, then every few seconds; a bank that comes straight back waits out the rest of them.
  const banking = free && status.warnings.includes("bank");
  let bankIn = Math.max(0, memory.bankIn - dt);
  if (banking && bankIn === 0) {
    callouts.push(callout("bank", "Bank angle, bank angle"));
    bankIn = BANK_AGAIN_S;
  }
  if (!banking && memory.banking) quiet.push("bank");

  // What a warning says as it starts; not "sink rate" where it is "pull up" at once.
  if (free) {
    for (const [warning, words] of CAUTIONS) {
      if (status.warnings.includes(warning) && !memory.warned.includes(warning)) callouts.push(callout("caution", words));
    }
  }

  return {
    callouts,
    quiet,
    whoops,
    memory: {
      height: cutting ? NaN : height, warned: status.warnings, banking, bankIn, pulling, pullFor, landing, retarding, retardIn, groundFor,
    },
  };
}

/**
 * A frame's sound: the levels to set, the sounds to start, what the
 * cockpit's voice says and takes back, and what to remember for the next.
 * `random` rolls the dice for the irregular sounds (the bumps, the distant
 * thunder), 0 to 1.
 */
export function mixSound(
  memory: SoundMemory, input: SoundInput, status: SoundStatus, muted: boolean, dt: number, random: () => number = Math.random,
): { levels: SoundLevels; events: SoundEvent[]; callouts: Callout[]; quiet: CalloutKind[]; memory: SoundMemory } {
  const view = VIEWS[status.view];
  const cockpit = status.view === "cockpit";
  const events: SoundEvent[] = [];
  // Through a cut to black the world goes quiet, and nothing new starts in it.
  const cutting = input.fade > 0.3;

  const spool = spoolTowards(memory.spool, input.throttle, dt);
  const n1 = IDLE_N1 + (1 - IDLE_N1) * spool;
  const engine = {
    n1,
    rumble: view.engine * (0.25 + 0.75 * n1 * n1),
    rumbleHz: 70 + 130 * n1,
    whine: view.engine * (0.35 + 0.65 * n1),
    whineHz: BLADE_HZ * n1,
    buzz: view.engine * ramp(n1, 0.78, 0.97),
    buzzHz: SHAFT_HZ * n1,
    hiss: view.engine * n1 ** 2.5,
    hissHz: 500 + 1700 * n1,
    cutoff: view.engineCutoff,
  };

  // The airflow: with the dynamic pressure, so with the indicated speed squared.
  const speed = input.ias / VMO_MS;
  const limit = Math.max(speed, input.mach / MMO);
  const turbulence = input.turbulence;
  const rough = ramp(turbulence, LIGHT_TURBULENCE, 1);
  const wind = {
    // The gear down in the airflow roars a little.
    gain: view.wind * Math.min(speed, 1.3) ** 2 / 1.69 * (1 + GEAR_WIND * (input.gear ?? 0)),
    hz: 280 + 900 * Math.min(speed, 1.3),
    buffet: rough * 0.9,
    brake: input.brake ? view.wind * clamp01(speed) ** 2 : 0,
    roar: view.wind * ramp(limit, 0.93, 1.06),
    cutoff: view.windCutoff,
  };

  const hail = ramp(input.dbz ?? -Infinity, HAIL_DBZ[0], HAIL_DBZ[1]);
  const rain = { gain: view.rain * input.rain, hz: 2600 + 1800 * input.rain, hail: view.rain * hail };

  // The bumps of rough air: irregular, more and harder the rougher, none below light.
  if (rough > 0 && !cutting) {
    const strength = () => (0.3 + 0.7 * rough) * (0.55 + 0.45 * random());
    if (fires(0.5 + 3.5 * rough, dt, random)) events.push({ kind: "thump", strength: strength() * (cockpit ? 1 : 0.6) });
    if (cockpit && fires(0.25 + 1.6 * rough, dt, random)) events.push({ kind: "creak", strength: strength() });
    if (cockpit && turbulence > ROUGH_TURBULENCE * 0.75 && fires(0.4 + 3 * ramp(turbulence, 0.3, 1), dt, random)) {
      events.push({ kind: "rattle", strength: strength() });
    }
  }
  let seatbelt = memory.seatbelt;
  if (!seatbelt && turbulence >= ROUGH_TURBULENCE && !cutting) {
    seatbelt = true;
    if (cockpit) events.push({ kind: "seatbelt" });
  }

  // Thunder: close on a strike, the flash's rising edge; distant now and then near a strong storm, strike or not.
  let thunderQuiet = Math.max(0, memory.thunderQuiet - dt);
  if (input.flash > memory.flash + 0.5 || input.strike) {
    events.push({ kind: "thunder", distance: 0.05 + 0.2 * random(), strength: 1 });
    thunderQuiet = Math.max(thunderQuiet, 6);
  } else if (thunderQuiet === 0 && !cutting) {
    const storm = input.storm;
    const near = storm ? ramp(storm.peakDbz, 45, 60) * (1 - ramp(storm.distance, 15_000, 90_000)) : 0;
    const inside = ramp(input.dbz ?? -Infinity, 38, 55);
    if (fires(near * 0.05 + inside * 0.08, dt, random)) {
      const far = inside >= near ? 0.4 + 0.3 * random() : 0.5 + 0.45 * ramp(storm!.distance, 10_000, 90_000);
      events.push({ kind: "thunder", distance: far, strength: 0.5 + 0.5 * Math.max(near, inside) });
      thunderQuiet = 8;
    }
  }

  // The cockpit's chimes, each on its edge.
  if (cockpit && !cutting) {
    if (status.autopilot && !memory.autopilot) events.push({ kind: "apOn" });
    if (!status.autopilot && memory.autopilot) events.push({ kind: "apOff" });
    if (status.low && !memory.low) events.push({ kind: "low" });
    const before = memory.throttle;
    const now = input.throttle;
    if (now !== before && DETENTS.some((detent) => (before < detent && now >= detent) || (before > detent && now <= detent))) {
      events.push({ kind: "detent" });
    }
  }

  // The gear's motor while it travels, started again if it is sent back; a thunk as it locks up or down.
  const gear = input.gear ?? 0;
  const gearGoing = gear > memory.gear ? 1 : gear < memory.gear ? -1 : 0;
  if (!cutting && gearGoing !== 0 && gearGoing !== memory.gearGoing) {
    events.push({ kind: "gearMotor", seconds: (gearGoing > 0 ? 1 - memory.gear : memory.gear) * GEAR_S });
  }
  if (!cutting && gearGoing === 0 && memory.gearGoing !== 0 && (gear <= 0 || gear >= 1)) {
    events.push({ kind: "gearLock", strength: gear >= 1 ? 1 : 0.75 });
  }

  // The flaps' motor, quieter than the gear's and for as long as they travel: started again each place they pass.
  const flaps = input.flaps ?? memory.flaps;
  let flapsFor = memory.flapsFor + dt;
  if (!cutting && flaps !== memory.flaps && flapsFor >= FLAP_NOTCH_S * 0.6) {
    events.push({ kind: "gearMotor", seconds: FLAP_NOTCH_S * 0.6 });
    flapsFor = 0;
  }

  // Rolling: the wheels over open ground, felt more than heard, and its bumps.
  const rolling = ramp(input.rolling ?? 0, 2, ROLLING_LOUDEST_MS);
  if (rolling > 0 && !cutting && fires(1 + 5 * rolling, dt, random)) {
    events.push({ kind: "thump", strength: (0.25 + 0.5 * rolling) * (0.5 + 0.5 * random()) * (cockpit ? 1 : 0.6) });
  }

  const said = voice(memory.voice, input, status, dt, cutting);
  if (said.whoops) events.push({ kind: "whoops" });

  const has = (warning: FlightStatus["warnings"][number]) => cockpit && status.warnings.includes(warning);
  const levels: SoundLevels = {
    volume: muted || status.paused ? 0 : VOLUME,
    world: 1 - 0.85 * clamp01(input.fade),
    engine,
    wind,
    rumble: (cockpit ? 1 : 0.4) * Math.max(
      ramp(turbulence, LIGHT_TURBULENCE, 1) ** 1.3 * (turbulence > SEVERE_TURBULENCE ? 1.3 : 1), 0.8 * rolling,
    ),
    rain,
    thunder: { gain: view.thunder, cutoff: view.thunderCutoff },
    cabin: view.cabin,
    warp: status.warp ? 1 : 0,
    alerts: { gain: cockpit ? 1 : 0, terrain: said.memory.pulling, stall: has("stall"), overspeed: has("overspeed") },
  };
  return {
    levels,
    events,
    callouts: said.callouts,
    quiet: said.quiet,
    memory: {
      spool, throttle: input.throttle, flash: input.flash, autopilot: status.autopilot, low: status.low, seatbelt, thunderQuiet,
      gear, gearGoing, flaps, flapsFor, voice: said.memory,
    },
  };
}

/** What the voice is to do now: stop what it is saying, and say something. */
export interface Spoken {
  cut: boolean;
  say: Callout | null;
}

/** However long the words, a callout the browser never said was over is taken to be after this long, seconds. */
export const CALLOUT_LONGEST_S = 3;

/**
 * Which callout the voice says when: one at a time, a higher rank cutting a
 * lower one off, the rest waiting their turn for as long as each is worth
 * saying and no longer, and the same words never waiting twice (once more
 * behind themselves they may: that is a callout repeating). It keeps
 * the order only: the speaking is done with what it hands back, and it is
 * told when that is over. Times are seconds on any one clock.
 */
export class CalloutQueue {
  private current: { callout: Callout; since: number } | null = null;
  private waiting: Array<{ callout: Callout; until: number }> = [];

  /** Something to say: now, if the voice is free or saying something that ranks lower; else in its turn. */
  push(callout: Callout, now: number): Spoken {
    if (this.current && now - this.current.since > CALLOUT_LONGEST_S) this.current = null;
    const current = this.current?.callout;
    if (!current) return this.start(callout, now, false);
    if (this.waiting.some((one) => one.callout.words === callout.words)) return { cut: false, say: null };
    if (callout.rank > current.rank) return this.start(callout, now, true);
    this.waiting.push({ callout, until: now + callout.keep });
    return { cut: false, say: null };
  }

  /** The voice has finished a callout: the next, if one still worth saying waits. Nothing where that was not the one being said. */
  done(callout: Callout, now: number): Spoken {
    if (this.current?.callout !== callout) return { cut: false, say: null };
    this.current = null;
    return this.next(now, false);
  }

  /** A kind of callout no longer holds: none of it waits any more, and one being said is cut off. */
  drop(kind: CalloutKind, now: number): Spoken {
    this.waiting = this.waiting.filter((one) => one.callout.kind !== kind);
    if (this.current?.callout.kind !== kind) return { cut: false, say: null };
    this.current = null;
    return this.next(now, true);
  }

  /** Forget everything, said or waiting. */
  clear(): void {
    this.current = null;
    this.waiting = [];
  }

  /** The highest rank still worth saying, the longest waiting first. */
  private next(now: number, cut: boolean): Spoken {
    this.waiting = this.waiting.filter((one) => one.until >= now);
    let best = -1;
    this.waiting.forEach((one, index) => {
      if (best < 0 || one.callout.rank > this.waiting[best].callout.rank) best = index;
    });
    if (best < 0) return { cut, say: null };
    const [{ callout }] = this.waiting.splice(best, 1);
    return this.start(callout, now, cut);
  }

  private start(callout: Callout, now: number, cut: boolean): Spoken {
    this.current = { callout, since: now };
    return { cut, say: callout };
  }
}
