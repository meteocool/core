/**
 * What the flight sounds like at a moment, as numbers: from the telemetry,
 * the flight's status and the view to the levels, pitches and filter
 * frequencies the sound graph (soundGraph.ts) is set to, and the one-off
 * sounds a frame starts (a thump, a creak, thunder, a chime), and what the
 * cockpit's voice says in it and when: the heights on the way down, "retard",
 * "bank angle", and "pull up" between the terrain warning's whoops; and the
 * master warning's and caution's chimes (alarms.ts), none of it for what the
 * reader has silenced. Saying
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
 *
 * The soundtrack (soundtrack.ts) is mixed here too, as a film's score is to
 * its pictures (`mixMusic`): fullest in the clean view, the most cinematic;
 * softer from outside; from the cockpit soft and narrow, as heard through a
 * headset over the cabin's noise. Dense cloud muffles it and breaking out
 * into clear air opens it up again in a swell, as taking off does; a storm's
 * worst air and its hail take it down so the storm is heard, and so do the
 * cockpit's voice and its alarms (an alarm silenced no longer does); time
 * running faster and a slow turn round the aircraft bring it up; on the
 * ground it is low until the take-off roll; a wreck silences it, until the
 * next start. And how difficult the flight has become (`tensionOf`) slowly
 * crossfades the theme into the suspenseful piece and back.
 */
import type { FlightAlarm, FlightStatus, FlightView } from "../store";
import { kindOf } from "./alarms";
import { THUNDER_M } from "./lightning";
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
  /**
   * How far off a strike is whose thunder arrives this frame, metres (the
   * nearest, where several do); null where none does. A strike's thunder
   * comes as long after its flash as sound takes from it, flash drawn or not
   * (none is with reduced motion).
   */
  strike: number | null;
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
  /** How thick the cloud round the aircraft is, 0 to 1. */
  cloud?: number;
  /** How much rougher than rough the air is, 0 to 1 (weather.ts), and the hail going past, 0 to 1. */
  severity?: number;
  hail?: number;
  /** Whether the cockpit's voice is saying something now. */
  speaking?: boolean;
  /** How many surfaces have come off the airframe; and whether what is left is a wreck, on the ground or broken up. */
  lost?: number;
  ended?: boolean;
  /** Which way the eye outside looks round the aircraft, degrees: how fast that turns is the orbit. */
  orbit?: number;
  /** How far the eye outside is from the aircraft, metres: where it hears the engines from, with the orbit. */
  eye?: number;
  /** Which aircraft this is, counting each start again: a new one is a calm start, whatever the last went through. */
  flight?: number;
}

export type SoundStatus = Pick<FlightStatus, "view" | "warnings" | "alarms" | "silenced" | "paused" | "autopilot" | "warp" | "low">;

/** What the mix carries from one frame to the next. */
export interface SoundMemory {
  /** How far the engines have spooled towards the throttle, 0 to 1. */
  spool: number;
  throttle: number;
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
  /** The alarms heard a frame ago: raised, and not silenced. */
  heard: FlightAlarm[];
  voice: VoiceMemory;
  music: MusicMemory;
}

/** What the soundtrack's mix carries from one frame to the next. */
export interface MusicMemory {
  /** What was heard a frame ago: the level, the band (Hz), and the theme's thinning (a low-pass, Hz). */
  gain: number;
  high: number;
  low: number;
  /**
   * How difficult the flight is, 0 to 1, eased twice over (`drive` the first
   * time), so that it sets off gently as well as arriving gently; and whether
   * it counts as difficult (it takes more to start than to keep).
   */
  drive: number;
  tension: number;
  tense: boolean;
  /** Seconds it has been difficult enough to begin, without a break. */
  difficultFor: number;
  /** Seconds the aircraft has been low over the ground, and with several warnings at once. */
  lowFor: number;
  warnedFor: number;
  /** Seconds lately spent in thick cloud, whether in it, and a swell's envelope, 0 to 1. */
  clouded: number;
  inCloud: boolean;
  swell: number;
  /** Whether it was in the air; which way the eye outside looked, and how fast it was turning, degrees a second. */
  aloft: boolean;
  orbit: number;
  turning: number;
  /** The aircraft a frame ago (`SoundInput.flight`); and seconds left of letting the last one's trouble go quickly. */
  flight: number;
  calming: number;
  /** Seconds since the flight's music began. */
  age: number;
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
  /**
   * Thunder: how far, 0 (overhead) to 1 (as far as it is heard), and how
   * strong; and whether it struck right by the aircraft deep in a storm's
   * core, where it is one hard blast with none of the long roll the ground
   * gives thunder further off.
   */
  | { kind: "thunder"; distance: number; strength: number; deep: boolean }
  | { kind: "thump"; strength: number }
  | { kind: "creak"; strength: number }
  | { kind: "rattle"; strength: number }
  | { kind: "seatbelt" | "low" | "apOff" | "apOn" | "detent" }
  /** The master caution's single chime, as a caution is raised. */
  | { kind: "chime" }
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
  /** The loudness of everything: 0 paused, when only the soundtrack plays on. */
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
    /** Where the roar of the jets and the fans' tone are heard from, -1 left to 1 right; the middle but for an eye outside. */
    roarPan: number;
    fanPan: number;
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
  /** The pull-up warning, the stall's cricket and shaker, and the master warning's continuous repetitive chime. */
  alerts: { gain: number; terrain: boolean; stall: boolean; chime: boolean };
  music: MusicLevels;
}

/**
 * The soundtrack: how loud (0 to 1, against its loudest), the band it is
 * heard in (a high-pass and a low-pass, Hz); the theme's share and its
 * thinning (a low-pass, Hz), and the suspenseful piece's share.
 */
export interface MusicLevels {
  gain: number;
  high: number;
  low: number;
  theme: number;
  themeLow: number;
  tension: number;
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

/** A strike nearer than this, metres, with the aircraft deep in a storm's core, is heard as one blast from inside the cloud. */
const DEEP_STRIKE_M = 2500;

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
 * How each view hears the soundtrack: how loud, and the band (Hz). From the
 * cockpit through a headset over the cabin's noise; outside, the score of a
 * film; the clean view, the picture alone, the most cinematic, fullest.
 */
const MUSIC_VIEWS: Record<FlightView, { gain: number; high: number; low: number }> = {
  // Over the engines' and the airflow's drone, which sit low and wide and are loudest here: a headset's band, a little
  // narrower than the whole, and as loud as the cleanest view's, or the drone has it.
  cockpit: { gain: 1, high: 120, low: 9000 },
  outside: { gain: 0.8, high: 20, low: 18000 },
  clean: { gain: 1, high: 20, low: 20000 },
};
/** The widest the band opens, Hz. */
const MUSIC_LOW_MOST = 20000;
/** How fast the music follows: down (a duck under the voice or an alarm), up, and its band; time constants, seconds. */
const MUSIC_DOWN_S = 0.3;
const MUSIC_UP_S = 1.4;
/** Taking off, the music comes in slowly: for this long, seconds, it rises at this pace instead (most of the way in about eight seconds). */
const LAUNCH_S = 12;
const LAUNCH_UP_S = 3.5;
const MUSIC_BAND_S = 0.35;
/** A wreck: how fast the music goes. */
const MUSIC_GONE_S = 0.5;
/** Under the cockpit's voice, and under an alarm heard, the music's share. */
const UNDER_VOICE = 0.55;
const UNDER_ALARM = 0.35;
/** Cloud this thick is thick, and below this the aircraft is out of it; this long in it, seconds, and coming out swells. */
const CLOUD_IN = 0.55;
const CLOUD_OUT = 0.2;
const CLOUDED_S = 4;
/** A swell: how much louder at its height, and how fast it dies away (a time constant, seconds). */
export const SWELL = 0.4;
const SWELL_S = 7;
/** A turn round the aircraft this slow, degrees a second, is a camera's slow orbit, and brings the music up so much. */
const ORBIT_SLOW: [number, number, number, number] = [1.5, 6, 40, 110];
const ORBIT_UP = 0.2;
/** Time running faster: the music this much louder. */
const WARP_UP = 0.3;

/**
 * Tension: how difficult the flight is, 0 to 1. It takes this much to be
 * difficult and goes only below this, so that it never flickers between the
 * two; once difficult, the suspenseful piece is at least this much of the
 * music. It comes in over a few seconds and goes a little more slowly (each
 * the time of its two easings together, seconds); faster as a wreck
 * silences everything. Not slower: the two pieces are not written to be
 * heard together, so the crossfade is a passage between them and not a
 * place to stay.
 */
export const TENSE_ON = 0.5;
export const TENSE_OFF = 0.3;
export const TENSE_LEAST = 1;
/**
 * How long it has to stay difficult enough before the suspenseful piece
 * begins, seconds: one alarm going off, or a surface shed in it, is a
 * moment, and the music waits to hear whether it is more than that.
 */
export const TENSE_HOLD_S = 4;
export const TENSION_IN_S = 4;
export const TENSION_OUT_S = 6;
/** A new start's calm: the trouble before it gone in about this long, seconds, under the cut to black and out of it. */
export const CALM_AGAIN_S = 3;
/** Below this height over the ground, metres (about 1,000 ft), for this long and up to this long, seconds, is a long low approach. */
export const LOW_APPROACH_M = 300;
export const LOW_APPROACH_S: [number, number] = [40, 120];
/** Several warnings at once (a voice alone is not one) for this long and up to this long, seconds, is a flight in trouble. */
export const WARNED_S: [number, number] = [8, 25];
/** The theme under the suspenseful piece at its fullest: none of it, as the low-pass on its way out goes this low, Hz. */
const THEME_LEAST = 0;
const THEME_LOW_LEAST = 900;

/**
 * How difficult the flight is now, 0 to 1, from what makes it so: near a
 * strong storm or inside one, its worst air and its hail; the gear or the
 * flaps jammed; surfaces lost; a long, low approach; several warnings held
 * a while. Each is a chance of trouble, and they add as chances do.
 */
export function tensionOf(input: SoundInput, status: Pick<SoundStatus, "warnings">, lowFor: number, warnedFor: number): number {
  const storm = input.storm;
  const near = storm ? ramp(storm.peakDbz, 48, 62) * (1 - ramp(storm.distance, 8_000, 45_000)) : 0;
  const inside = ramp(input.dbz ?? -Infinity, 40, 55);
  const worst = Math.max(input.severity ?? 0, ramp(input.turbulence, ROUGH_TURBULENCE, 0.9), input.hail ?? 0, ramp(input.dbz ?? -Infinity, ...HAIL_DBZ));
  const parts = [
    0.8 * near, inside, worst,
    status.warnings.includes("gearJammed") ? 0.55 : 0,
    status.warnings.includes("flapsJammed") ? 0.45 : 0,
    // One surface shed is half a reason, as an overspeed held a little long sheds one; two are a whole one.
    input.lost ? Math.min(1, 0.1 + 0.25 * input.lost) : 0,
    0.75 * ramp(lowFor, ...LOW_APPROACH_S),
    0.8 * ramp(warnedFor, ...WARNED_S),
  ];
  return 1 - parts.reduce((calm, part) => calm * (1 - clamp01(part)), 1);
}

/** Ease towards a value with a time constant; a step of nothing leaves it. */
const ease = (from: number, to: number, dt: number, tau: number) => from + (to - from) * (1 - Math.exp(-dt / tau));
const easeLog = (from: number, to: number, dt: number, tau: number) => Math.exp(ease(Math.log(from), Math.log(to), dt, tau));

/** What the soundtrack starts a flight from: silent, coming in, and calm. */
export function initialMusic(): MusicMemory {
  return {
    gain: 0, high: 20, low: MUSIC_LOW_MOST, drive: 0, tension: 0, tense: false, difficultFor: 0, lowFor: 0, warnedFor: 0, clouded: 0, inCloud: false, swell: 0,
    aloft: true, orbit: NaN, turning: 0, flight: NaN, calming: 0, age: 0,
  };
}

/**
 * The soundtrack in a frame: its levels, and what to remember for the next.
 * `alarmed` is whether an alarm is heard in the cockpit now; `view` and the
 * rest of the status as the frame's.
 */
export function mixMusic(
  memory: MusicMemory, input: SoundInput, status: SoundStatus, alarmed: boolean, dt: number,
): { music: MusicLevels; memory: MusicMemory } {
  const view = MUSIC_VIEWS[status.view];
  const onGround = input.onGround ?? false;
  const cloud = clamp01(input.cloud ?? 0);

  // Cloud: time in thick cloud counts up, and coming out of it after a while swells; so does leaving the ground.
  const inCloud = memory.inCloud ? cloud > CLOUD_OUT : cloud >= CLOUD_IN;
  let clouded = inCloud ? memory.clouded + dt : memory.clouded * Math.exp(-dt / 20);
  let swell = memory.swell * Math.exp(-dt / SWELL_S);
  if (memory.inCloud && !inCloud && clouded >= CLOUDED_S) {
    swell = 1;
    clouded = 0;
  }
  const aloft = !onGround;
  if (aloft && !memory.aloft && !input.ended) swell = 1;

  // A slow orbit outside: how fast the eye turns round, smoothed; a drag's jerks are not one.
  let turning = memory.turning;
  if (input.orbit !== undefined && Number.isFinite(memory.orbit) && dt > 0) {
    const turned = ((input.orbit - memory.orbit + 540) % 360) - 180;
    turning = ease(turning, Math.abs(turned) / dt, dt, 0.6);
  }
  const orbiting = status.view === "cockpit" ? 0 : ramp(turning, ORBIT_SLOW[0], ORBIT_SLOW[1]) * (1 - ramp(turning, ORBIT_SLOW[2], ORBIT_SLOW[3]));

  // Tension, with its hysteresis and its slow ways.
  // A new aircraft (the next approach, or this one again) starts calm: the last one's trouble goes over a few seconds.
  const flight = input.flight ?? memory.flight;
  const fresh = Number.isFinite(memory.flight) && flight !== memory.flight;
  const calming = fresh ? CALM_AGAIN_S : Math.max(0, memory.calming - dt);
  const low = aloft && (input.height ?? Infinity) < LOW_APPROACH_M;
  const lowFor = fresh ? 0 : low ? memory.lowFor + dt : Math.max(0, memory.lowFor - 3 * dt);
  // A surface lost is counted for itself (tensionOf), and a voice alone (the bank angle) is no alarm.
  const warned = status.warnings.filter((warning) => kindOf(warning).level !== null).length;
  const warnedFor = fresh ? 0 : warned >= 2 ? memory.warnedFor + dt : Math.max(0, memory.warnedFor - 2 * dt);
  const difficulty = tensionOf(input, status, lowFor, warnedFor);
  const difficultFor = !fresh && difficulty >= TENSE_ON ? memory.difficultFor + dt : 0;
  const tense = memory.tense && !fresh ? difficulty >= TENSE_OFF : difficultFor >= TENSE_HOLD_S;
  const wanted = tense ? Math.max(TENSE_LEAST, difficulty) : 0;
  const tauTension = (input.ended ? 2 : calming > 0 && wanted <= memory.drive ? CALM_AGAIN_S / 3 : wanted > memory.drive ? TENSION_IN_S : TENSION_OUT_S) / 2;
  const drive = ease(memory.drive, wanted, dt, tauTension);
  const tension = ease(memory.tension, drive, dt, tauTension);

  // The level: the view's, under the weather, over a swell, a slow orbit and time running faster, ducked by the voice and the alarms.
  const worst = Math.max(ramp(input.turbulence, ROUGH_TURBULENCE, 1), input.severity ?? 0, ramp(input.dbz ?? -Infinity, ...HAIL_DBZ), input.hail ?? 0);
  let gain = view.gain * (1 - 0.3 * cloud) * (1 - 0.2 * input.rain) * (1 - 0.6 * clamp01(worst));
  gain *= (1 + SWELL * swell) * (1 + ORBIT_UP * orbiting) * (status.warp ? 1 + WARP_UP : 1);
  // On the ground, low; the take-off roll brings it up.
  if (onGround) gain *= 0.5 + 0.5 * ramp(input.rolling ?? 0, 15, 70);
  const cockpit = status.view === "cockpit";
  if (cockpit && alarmed) gain *= UNDER_ALARM;
  else if (cockpit && input.speaking) gain *= UNDER_VOICE;
  if (input.ended) gain = 0;
  gain = Math.min(gain, 1.3);
  const age = memory.age + dt;
  const tau = input.ended ? MUSIC_GONE_S : gain < memory.gain ? MUSIC_DOWN_S : age < LAUNCH_S ? LAUNCH_UP_S : MUSIC_UP_S;
  const level = ease(memory.gain, gain, dt, tau);

  // The band: the view's, muffled by thick cloud, opened by a swell.
  const lowTarget = Math.min(MUSIC_LOW_MOST, view.low * (1 - 0.82 * cloud ** 1.3) * (1 + 0.6 * swell) * (status.warp ? 1.3 : 1));
  const lowNow = easeLog(memory.low, Math.max(lowTarget, 300), dt, MUSIC_BAND_S);
  const highNow = easeLog(memory.high, view.high, dt, MUSIC_BAND_S);

  // The crossfade: equal in power, each piece wholly the other's once it is over.
  const angle = (tension * Math.PI) / 2;
  const music: MusicLevels = {
    gain: level,
    high: highNow,
    low: lowNow,
    theme: THEME_LEAST + (1 - THEME_LEAST) * Math.cos(angle),
    themeLow: MUSIC_LOW_MOST * (THEME_LOW_LEAST / MUSIC_LOW_MOST) ** tension,
    tension: Math.sin(angle),
  };
  return {
    music,
    memory: {
      gain: level, high: highNow, low: lowNow, drive, tension, tense, difficultFor, lowFor, warnedFor, clouded, inCloud, swell, aloft,
      orbit: input.orbit ?? memory.orbit, turning, flight, calming, age,
    },
  };
}

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

/**
 * The engines heard from an eye outside, `yaw` degrees round from behind the
 * aircraft (90 its left) and `distance` metres off. The jets' roar comes
 * from the plume behind the tail, the fans' tone from the intakes ahead of
 * the wing: seen from the side the roar is heard to the tail's side and the
 * tone to the nose's, and both close in on the middle from further off.
 * Behind it the roar is loudest, ahead of it the tone; and the whole falls
 * off with the distance, to nothing at all from far enough.
 */
export const ENGINE_HEARD = {
  /** Where each is heard from, metres ahead of the aircraft's middle. */
  roarAt: -28, fanAt: 6,
  /**
   * How far off the engines sound as they do from the eye's first place, metres; and where they fade out, to nothing:
   * barely heard by the time the aircraft fills only a quarter of the picture's height (about 125 m at the 60° view).
   */
  near: 60, fades: [60, 135] as const,
  /** How much of the airflow's noise is left from furthest: it is the eye's own air as much as the aircraft's. */
  windFar: 0.3,
};
export function heardFrom(yaw: number, distance: number): { level: number; roar: number; fan: number; roarPan: number; fanPan: number } {
  const radians = (yaw * Math.PI) / 180;
  const behind = (1 + Math.cos(radians)) / 2;
  // Across the picture, metres: the eye's right is the aircraft's right from behind, its left from ahead.
  const across = (ahead: number) => -ahead * Math.sin(radians);
  const spread = 8 + 0.3 * distance;
  const pan = (ahead: number) => Math.max(-0.9, Math.min(0.9, across(ahead) / spread));
  const level = Math.min(1.35, (ENGINE_HEARD.near / Math.max(distance, 1)) ** 0.7) * (1 - ramp(distance, ...ENGINE_HEARD.fades));
  return { level, roar: 0.7 + 0.6 * behind, fan: 1.25 - 0.5 * behind, roarPan: pan(ENGINE_HEARD.roarAt), fanPan: pan(ENGINE_HEARD.fanAt) };
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const ramp = (value: number, low: number, high: number) => clamp01((value - low) / (high - low));

/** What a flight's sound starts from: the engines already at the throttle, as they are in the air. */
export function initialMemory(input: Pick<SoundInput, "throttle">, status: Pick<SoundStatus, "autopilot" | "low">): SoundMemory {
  return {
    spool: input.throttle, throttle: input.throttle, autopilot: status.autopilot, low: status.low, seatbelt: false, thunderQuiet: 4,
    gear: 0, gearGoing: 0, flaps: 0, flapsFor: Infinity, heard: [],
    voice: {
      height: NaN, warned: [], banking: false, bankIn: 0, pulling: false, pullFor: 0, landing: false, retarding: false, retardIn: 0,
      groundFor: 0,
    },
    music: initialMusic(),
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
 * nothing is said and what was under way is forgotten. A warning the reader
 * has silenced says nothing more; what it was saying is cut off.
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
  const heard = (warning: FlightStatus["warnings"][number]) => status.warnings.includes(warning) && !status.silenced.includes(warning);
  // Passed on the way down, and flown through: not jumped over by a new start.
  const passed = (metres: number) => before > metres && height <= metres && before - height < HEIGHT_JUMP_M;

  // The pull-up warning: the ground ahead, or sinking faster than the height left allows. It lets go a little later than it took hold.
  const sinking = heard("sink") && height < pullUpBelow(sink) * (memory.pulling ? 1.15 : 1);
  const pulling = cockpit && (heard("terrain") || sinking);
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
  const banking = free && heard("bank");
  let bankIn = Math.max(0, memory.bankIn - dt);
  if (banking && bankIn === 0) {
    callouts.push(callout("bank", "Bank angle, bank angle"));
    bankIn = BANK_AGAIN_S;
  }
  if (!banking && memory.banking) quiet.push("bank");

  // What a warning says as it starts; not "sink rate" where it is "pull up" at once.
  if (free) {
    for (const [warning, words] of CAUTIONS) {
      if (heard(warning) && !memory.warned.includes(warning)) callouts.push(callout("caution", words));
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
  memory: SoundMemory, input: SoundInput, status: SoundStatus, musicMuted: boolean, dt: number, random: () => number = Math.random,
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
    roarPan: 0,
    fanPan: 0,
  };
  // Outside, where the eye is: round the aircraft and how far off.
  const fromEye = !cockpit && input.orbit !== undefined && input.eye !== undefined ? heardFrom(input.orbit, input.eye) : null;
  if (fromEye) {
    engine.rumble *= fromEye.level * fromEye.roar;
    engine.buzz *= fromEye.level * fromEye.roar;
    engine.hiss *= fromEye.level * fromEye.roar;
    engine.whine *= fromEye.level * fromEye.fan;
    engine.roarPan = fromEye.roarPan;
    engine.fanPan = fromEye.fanPan;
  }

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
  if (fromEye) {
    const far = ENGINE_HEARD.windFar + (1 - ENGINE_HEARD.windFar) * Math.min(1, fromEye.level);
    wind.gain *= far;
    wind.roar *= far;
    wind.brake *= far;
  }

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

  // Thunder: a strike's, from as far as it struck, as its sound arrives; distant now and then near a strong storm, strike or not.
  let thunderQuiet = Math.max(0, memory.thunderQuiet - dt);
  const inside = ramp(input.dbz ?? -Infinity, 38, 55);
  if (input.strike !== null) {
    const away = input.strike;
    const deep = inside > 0.6 && away < DEEP_STRIKE_M;
    events.push({ kind: "thunder", distance: 0.05 + 0.9 * ramp(away, 0, THUNDER_M), strength: 1, deep });
    thunderQuiet = Math.max(thunderQuiet, 6);
  } else if (thunderQuiet === 0 && !cutting) {
    const storm = input.storm;
    const near = storm ? ramp(storm.peakDbz, 45, 60) * (1 - ramp(storm.distance, 15_000, 90_000)) : 0;
    if (fires(near * 0.05 + inside * 0.08, dt, random)) {
      const far = inside >= near ? 0.45 + 0.25 * random() : 0.5 + 0.45 * ramp(storm!.distance, 10_000, 90_000);
      events.push({ kind: "thunder", distance: far, strength: 0.5 + 0.5 * Math.max(near, inside), deep: false });
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
  // Silenced as it is said, a warning's words are cut off.
  const hushed = memory.heard.filter((alarm) => status.silenced.includes(alarm));
  if (CAUTIONS.some(([warning]) => hushed.includes(warning)) && !said.quiet.includes("caution")) said.quiet.push("caution");

  const has = (warning: FlightStatus["warnings"][number]) => cockpit && status.warnings.includes(warning) && !status.silenced.includes(warning);
  // The master warning's chime for as long as an alarm that has it is heard; the caution's once, as one is raised.
  const heard = status.alarms.filter((alarm) => !status.silenced.includes(alarm));
  if (cockpit && !cutting && heard.some((alarm) => !memory.heard.includes(alarm) && kindOf(alarm).chime === "single")) {
    events.push({ kind: "chime" });
  }
  const alarmed = heard.length > 0 || said.memory.pulling || has("stall");
  const scored = mixMusic(memory.music, input, status, alarmed, dt);
  const levels: SoundLevels = {
    volume: status.paused ? 0 : VOLUME,
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
    alerts: {
      gain: cockpit ? 1 : 0, terrain: said.memory.pulling, stall: has("stall"),
      chime: cockpit && heard.some((alarm) => kindOf(alarm).chime === "continuous"),
    },
    // Muted, the music alone goes; it is still followed underneath, so it comes back as the flight is then.
    music: musicMuted ? { ...scored.music, gain: 0 } : scored.music,
  };
  return {
    levels,
    events,
    callouts: said.callouts,
    quiet: said.quiet,
    memory: {
      spool, throttle: input.throttle, autopilot: status.autopilot, low: status.low, seatbelt, thunderQuiet,
      gear, gearGoing, flaps, flapsFor, heard, voice: said.memory, music: scored.memory,
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
