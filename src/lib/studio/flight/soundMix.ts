/**
 * What the flight sounds like at a moment, as numbers: from the telemetry,
 * the flight's status and the view to the levels, pitches and filter
 * frequencies the sound graph (soundGraph.ts) is set to, and the one-off
 * sounds a frame starts (a thump, a creak, thunder, a chime).
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
import { GEAR_S, MMO, VMO_MS } from "./physics";

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
  | { kind: "gearLock"; strength: number };

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

/** The throttle's detents: idle, climb, and full. */
export const DETENTS = [0, 0.85, 1];

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
    gear: 0, gearGoing: 0,
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
 * A frame's sound: the levels to set, the sounds to start, and what to
 * remember for the next. `random` rolls the dice for the irregular sounds
 * (the bumps, the distant thunder), 0 to 1.
 */
export function mixSound(
  memory: SoundMemory, input: SoundInput, status: SoundStatus, muted: boolean, dt: number, random: () => number = Math.random,
): { levels: SoundLevels; events: SoundEvent[]; memory: SoundMemory } {
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

  const has = (warning: FlightStatus["warnings"][number]) => cockpit && status.warnings.includes(warning);
  const levels: SoundLevels = {
    volume: muted || status.paused ? 0 : VOLUME,
    world: 1 - 0.85 * clamp01(input.fade),
    engine,
    wind,
    rumble: (cockpit ? 1 : 0.4) * ramp(turbulence, LIGHT_TURBULENCE, 1) ** 1.3 * (turbulence > SEVERE_TURBULENCE ? 1.3 : 1),
    rain,
    thunder: { gain: view.thunder, cutoff: view.thunderCutoff },
    cabin: view.cabin,
    warp: status.warp ? 1 : 0,
    alerts: { gain: cockpit ? 1 : 0, terrain: has("terrain"), stall: has("stall"), overspeed: has("overspeed") },
  };
  return {
    levels,
    events,
    memory: {
      spool, throttle: input.throttle, flash: input.flash, autopilot: status.autopilot, low: status.low, seatbelt, thunderQuiet,
      gear, gearGoing,
    },
  };
}
