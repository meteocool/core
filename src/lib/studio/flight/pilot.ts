/**
 * Flies the aircraft of Studio's flight over the 3D map: the flight's
 * counterpart of the director, which plays a scene.
 *
 * Each frame it reads the keys, asks the map for the ground and the weather
 * where the aircraft is, steps the physics (physics.ts), and stands the
 * camera in the cockpit. What the instruments show it writes into one
 * telemetry object, which the flight deck reads every frame; the few things
 * that change now and then (the view, the warnings, a pause) go to
 * `flightStatus`, a store, which the deck's markup follows.
 *
 * Starting a flight borrows Studio's storm style, peel, lens and scan, and
 * leaving hands them back; the map's own changes are `Stage.setFlying`'s.
 */
import { get } from "svelte/store";
import { cloudStyle, cloudsTime, peelLevel, peelManual } from "../../../stores";
import { isMapStyle, mapStyleOf } from "../../cloudStyle";
import { isHandheld } from "../../gpuBudget";
import type { CloudStyle } from "../../cloudStyle";
import { captionOf, recordStage, saveRecording } from "../director";
import type { InspectMode, Stage, StormTileInfo } from "../director";
import type { Recording } from "../record";
import { flightStatus, INITIAL_FLIGHT_STATUS, studioFlying, studioFov, studioOpen } from "../store";
import type { FlightCrash, FlightStatus, FlightView, FlightWarning } from "../store";
import { indicatedFromTrue, machOf } from "./atmosphere";
import { Keys } from "./controls";
import type { FlightAction } from "./controls";
import { FLAPS_MOST, levelFlight, MAX_DT, moveGear, overspeed, PITCH_RATE, ROLL_RATE, SPEEDBRAKE, step, terrainAhead } from "./physics";
import type { AircraftState, Environment } from "./physics";
import { approachOf, cruiseSpeed } from "./plan";
import type { FlightPlan } from "./plan";
import { chooseApproach, towards } from "./spawn";
import type { Approach } from "./spawn";
import { USUAL_BASE_KM } from "./cloudBase";
import { cloudBaseAt } from "./stationAir";
import { EXHAUSTS, SEAT, SUN, throughWindows, WHEELS_BELOW_M } from "./cockpit";
import { FLIGHT_SUPPORT } from "./support";
import { coresOf, echoTop, flatOffset, MARK_APART_KM, MARK_REACH_KM, markAltitude, marksNear, MARKS_SHOWN } from "./marks";
import { bearingDeg, destination, distanceM } from "./geo";
import type { StormMark } from "./marks";
import { cockpitEye, inAircraft, outsideEye, seenFrom } from "./view";
import type { Attitude as FlightAttitude, Eye, Look } from "./view";
import { VERTICAL_SCALE } from "../../../layers/terrain";
import { toggleFullscreen } from "../../fullscreen";
import { airAt, noise, roughAir } from "./weather";
import { advance, BLAST_FROM, broken, harmed, intact, shown, shudder, surfacesLost } from "./damage";
import type { Damage, DamageEvent } from "./damage";
import { boltPaths, FLASH_S, flicker, glare, thunderDelay } from "./lightning";
import type { Bolt } from "../../../layers/weatherPass";
import { FlightSound } from "./sound";
import { alarmsOf, alarmStep, NO_ALARMS, silence, silencedOf } from "./alarms";
import type { AlarmMemory } from "./alarms";
import type { AircraftScreen } from "../../../layers/aircraftLayer";
import { COCKPIT_CONTROLS, controlAlong } from "./cockpit";
import type { CockpitControl, CockpitPick } from "./cockpit";
import { merged } from "./controls";
import { NO_INPUT } from "./physics";
import type { ControlInput } from "./physics";
import { lookedAlong } from "./view";
import { easeLevers, leverTargets, LEVERS_AT_REST } from "./levers";
import type { Levers } from "./levers";

/** A marked storm's lightning: the strikes this near it, km, in this long, ms. */
const STRIKES_ROUND_KM = 14;
const STRIKES_LATELY_MS = 5 * 60_000;

/** How far round the aircraft lightning is looked for, km, and from how far its thunder is heard. */
const LIGHTNING_KM = 110;
const THUNDER_KM = 30;

/** The fewest frames a second a flight should have, how many are plenty, and the least sharpness it is drawn at to get them. */
const FPS_LEAST = 30;
const FPS_PLENTY = 47;
/** How long into a flight its frames begin to count, seconds flown. */
const SETTLE_S = 6;
const QUALITY_LEAST = 0.1;
/**
 * The sharpness a phone's or a tablet's first flight starts at: the clouds
 * coarser, the map at all of its pixels still. Its GPU and its memory are a
 * fraction of a desktop's (lib/gpuBudget.ts), and the first seconds of a
 * flight are when the most is asked of both; it is given more once its
 * frames have been plenty for a while, as any flight is.
 */
const HANDHELD_QUALITY = 0.45;
/** The longest a frame is taken to have been, seconds. */
const LONGEST_FRAME_S = 8;

/** The sharpness the last flight settled at: the next one on this machine starts there, not at the top again. */
let settledQuality = isHandheld() ? HANDHELD_QUALITY : 1;

/** How often the cloud base is asked for again, seconds flown: the aircraft has come to other air by then. */
const BASE_S = 120;

/** The ways of looking into a storm, in the order the key takes them. */
const INSPECT_MODES: InspectMode[] = ["xray", "cut", "peel"];

/** How fast rain falls, m/s: next to nothing beside an aircraft's speed, and what makes it slant. */
const FALL_M_S = 7;

/** The room a mark's label takes on the screen, CSS pixels across and down: no other is put in it. */
const MARK_ROOM: [number, number] = [120, 46];
/** A mark this near the middle of the storm system flown at is that system's, m. */
const MARK_TARGET_M = 45_000;

/** The lens from the cockpit, degrees: a wide one, as a windshield is. */
export const FLIGHT_FOV = 60;

/** The storm style a flight is planned in unless the reader says otherwise: white cloud, as it is seen from an aircraft. */
export const FLIGHT_STYLE: CloudStyle = "sky";
/** The styles `C` steps through. */
const STYLES: CloudStyle[] = ["sky", "tinted", "cloud", "glow"];

/**
 * Where the eye looks before the mouse turns it. From the seat, a little
 * below the nose: over the glareshield at the ground ahead, with the top of
 * the panel in the picture. From outside, off the tail's left and above.
 */
const COCKPIT_LOOK: Look = { yaw: 0, pitch: -6 };
const OUTSIDE_LOOK: Look = { yaw: 24, pitch: -11 };

/** How far the head turns in its seat, and the eye round the aircraft, degrees. */
const HEAD_YAW = 150;
const HEAD_PITCH: [number, number] = [-70, 75];
const ORBIT_PITCH: [number, number] = [-80, 80];

/** How far off the eye stands outside, metres: to begin with, and as near and far as the wheel takes it. */
const OUTSIDE_DISTANCE = 60;
const OUTSIDE_RANGE: [number, number] = [28, 600];

/** The lens from the seat as the wheel narrows it, degrees: down to one that reads a button's lettering. */
const COCKPIT_FOV_RANGE: [number, number] = [9, FLIGHT_FOV];

/** How far a pixel of mouse turns the eye, degrees. */
const LOOK_PER_PX = 0.16;

/** How far the mouse drags the stick for it to be all the way over, or the thrust levers for them to move as fast as they go, CSS pixels. */
const HAND_FULL_PX = 90;

const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);

/** How many times the ground distance Shift covers. */
export const WARP = 4;

/** Below this height over the ground, the radar altimeter reads out: 2,500 ft. */
const LOW_M = 762;

/**
 * How high the aircraft is with its wheels on the ground, true metres over
 * it: the map draws heights taller than life and the aircraft as it is, so
 * its wheels reach the drawn ground from that much less far up.
 */
const STAND_M = WHEELS_BELOW_M / VERTICAL_SCALE;
/** How far ahead the ground's slope is taken over, metres, and below what height it is asked for at all. */
const SLOPE_RUN_M = 40;
/** How far either side of where it stands the ground's lie under the aircraft is measured, metres. */
const TILT_SPAN_M = 15;
const SLOPE_BELOW_M = 60;
/** Time runs no faster than it does this near the ground, metres: a landing is flown, not skipped. */
const WARP_ABOVE_M = 300;
/** Gear up this low and this slow, the aircraft says so: metres, and m/s indicated. */
const GEAR_WARNING = { below: 150, slower: 98 };
/** Coming down faster than this near the ground, m/s, it says so too, gear down or not. */
const SINK_WARNING_MS = 9;
/** Banked steeper than this in the air, degrees, it says so. */
const BANK_WARNING = 45;
/**
 * Seen from the cockpit, something about to come off the aircraft is shown
 * from outside, as a film cuts to it: out to the usual outside view this
 * long before it is reckoned to go, seconds, held this long after it went,
 * and back in; or back in this long after cutting out where, slowed in
 * time, nothing went.
 */
const SHOW_BREAK = { lead: 0.8, after: 3.2, gaveUp: 2.5 };
/** How long the reason a flight ended stays up into the next one, seconds. */
const CRASH_SHOWN_S = 5;
/**
 * A flight that has ended on the ground is not cut at once: its wreck is
 * watched until it has stopped sliding and this much longer, seconds, and
 * this long after anything last blew up, which is how long that is heard
 * for; for at least this long, and no longer than that.
 */
const WRECK_WATCHED_S = { after: 2.8, blast: 5, least: 6, most: 11 };
/**
 * From where. Far enough off that a fireball is a thing in the picture and
 * not the picture, metres, for the gentlest end and the most violent; from
 * this far above, degrees. And from ahead of the wreck and to one side,
 * looking back (so many degrees round from the way it was going): the
 * smoke of a wreck that slides blows away from there, and what is thrown
 * from one comes on into the picture. Where the ground rises in the way of
 * that (the eye is to stand this many metres clear of it), from the next
 * place round, and where it does all round, from steeply above.
 */
const WRECK_EYE = { distance: [70, 105], pitch: -20, round: [145, -145, 40, -40], clear: 6, steep: -45 } as const;
/** How far under its middle a hull lying on its belly reaches, metres; and how long the gear takes to fold under one, seconds. */
const BELLY_BELOW_M = 2.3;
const GEAR_FOLDS_S = 0.4;
/**
 * How far the eye stays over the ground, outside, metres: over the drawn
 * ground, whose heights between its own samples are not quite the ones it
 * is asked for, with the map's nearest drawable distance to spare.
 */
const EYE_OVER_GROUND_M = 4;
/** How much of a rough air's shaking a fast roll over the ground is, at most, and the speed it is that at, m/s. */
const ROLL_SHAKE = 0.3;
const ROLL_SHAKE_MS = 70;

/** How long the keys card stays up on entry, ms. */
const KEYS_MS = 7000;

/** How a cut to a new start fades: out, then in, seconds. */
const FADE_OUT_S = 0.35;
const FADE_IN_S = 0.6;

/** How often the map's slower answers are asked again, seconds: the ground ahead, the storm list, the strikes. */
const SLOW_S = 0.25;

/** What the instruments draw, rewritten every frame. */
export interface Telemetry {
  state: AircraftState;
  /** Indicated airspeed, m/s, and Mach number. */
  ias: number;
  mach: number;
  /** The ground under the aircraft, true metres, and the height over it; null where the map has none. */
  ground: number | null;
  radarAltitude: number | null;
  /** The storm system flown at: which way, how far (m), how long at this speed (s); null with none. */
  target: { bearing: number; distance: number; seconds: number; peakDbz: number } | null;
  /** The reflectivity where the aircraft is, and what it makes of the view: cloud, rain, rough air, 0 to 1. */
  dbz: number | null;
  cloud: number;
  rain: number;
  turbulence: number;
  /** How much rougher again the air is than rough, 0 to 1: nothing short of a storm's core (weather.ts). */
  severity: number;
  /** Hail and ice crystals going past, 0 to 1 each; ice built up on the glass, 0 to 1. */
  hail: number;
  ice: number;
  frost: number;
  /** How fast the air itself rises or sinks, m/s, and its temperature, degrees C. */
  draft: number;
  temperature: number;
  /** Frames a second, as the flight is being drawn, and the share of its full sharpness it is drawn at to keep them. */
  fps: number;
  quality: number;
  /** Every listed storm tile, for the weather radar. */
  storms: StormTileInfo[];
  /**
   * The storms marked in the view, each where it is on the screen (0 to 1
   * across and down) and how far off, m; which is the one flown at, and
   * which the one being looked into.
   */
  marks: Array<{ mark: StormMark; x: number; y: number; distance: number; target: boolean; inspected: boolean }>;
  /** A cut to black and back, 0 to 1; a lightning flash, 0 to 1. */
  fade: number;
  flash: number;
  /** Whether the spoilers are up at all: the speed brake's in the air, all of them after a landing. */
  brake: boolean;
  /** How far the landing gear is down, 0 up to 1 down: on its way between (G). */
  gear: number;
  /** Where the flap lever is, 0 to 4 (J out, U in); the flaps follow at their own pace (`state.flaps`). */
  flapLever: number;
  /** How far the aircraft has rolled since it last touched down, metres. */
  rolled: number;
  /** Seconds flown. */
  time: number;
}

const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Pilot {
  readonly telemetry: Telemetry;
  private readonly listeners = new Set<(telemetry: Telemetry) => void>();
  private readonly keys: Keys;
  private approach: Approach;
  /** The speed an approach starts at, m/s: the plan's, and the flight's own for a storm picked on the way. */
  private tas: number;
  private autopilot: number | null = null;
  /** Whether the reader has asked for the gear down (G); it gets there at its own pace. A flight starts in the air, gear up. */
  private gearDown = false;
  /** Whether the speed brake's lever is pulled (B). */
  private speedbrake = false;
  /** Whether the radar's colours are painted on the ground: as the plan had it, until O. */
  private radarOnGround = false;
  /** Until when the reason the flight ended is shown, seconds flown. */
  private crashUntil = -Infinity;
  /** The flight's own clock, seconds: real time, four times over while time runs faster. The rough air keeps it. */
  private airTime = 0;
  /** What the airframe has been through, and what has come off it (damage.ts); and how many flights there have been, which is its chance's seed. */
  private damage: Damage = intact();
  private flights = 1;
  /**
   * A wreck being watched before the cut: since when and until when,
   * seconds flown, and where from (the way the eye looks, how far off it
   * stands, how far down it looks), which stays put while the wreck swings
   * round.
   */
  private wreck: { since: number; until: number; stopped: boolean; bearing: number; distance: number; pitch: number } | null = null;

  /** Cut out of the cockpit to show something coming off: since when, and when it went; see `SHOW_BREAK`. */
  private showing: { since: number; went: number | null } | null = null;

  /**
   * An aircraft broken up in the air, followed down from outside: the way
   * the eye looked when it broke, as a bearing, and the orbit then. The eye
   * keeps that bearing however the hull tumbles, turning only as the reader
   * turns it, so the picture does not spin with the wreckage.
   */
  private fallen: { bearing: number; yaw: number } | null = null;
  private paused = false;
  private frame: number | null = null;
  private last: number | null = null;
  private slowAt = -Infinity;
  /** The frame's length, seconds, for what `place` moves by it. */
  private dt = 0;
  /** Where the clouds begin, km above the sea, and how much warmer than standard the air is, degrees; see `findBase`. */
  private baseKm = USUAL_BASE_KM;
  private warmer = 0;
  /** How far the air has gone past the aircraft since take-off, metres in its frame: what carries the rain past the eye. */
  private travel: [number, number, number] = [0, 0, 0];
  /** Lightning under way: where, when it began (seconds flown), and whether it reaches the ground. */
  private flashes: Array<{ lon: number; lat: number; born: number; seed: number; ground: boolean }> = [];
  /** The strikes already seen, by when each struck: a strike flashes once. Null before the first look. */
  private struck: Set<number> | null = null;
  private thunder: Array<ReturnType<typeof setTimeout>> = [];
  /** Frames a second, smoothed, and for how long they have been too few, or plenty; see `keepUp`. */
  private fps = 60;
  private tooSlow = 0;
  private plenty = 0;
  private sinceLowered = Infinity;
  /** How long the flight has been drawn, seconds by the clock: a slow machine's flight has flown less than that. */
  private flown = 0;
  private quality = 1;
  /** When the cloud base was last asked for, seconds flown; see `findBase`. */
  private baseAt = 0;
  private terrain = false;
  /** Where a fade is: seconds into it, and whether the aircraft has been put back yet. */
  private fading: { at: number; moved: boolean } | null = null;
  private recording: Recording | null = null;
  private keysTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly reducedMotion = prefersReducedMotion();
  /** What the flight borrowed of Studio, to give back. */
  private readonly before: { style: CloudStyle; peel: number; manual: boolean; fov: number; scan: number | null };
  private readonly look: { lon: number; lat: number; bearing: number };
  /** Where the eye looks, from the seat and from outside, and how far off it stands there. */
  private head: Look = { ...COCKPIT_LOOK };
  private orbit: Look = { ...OUTSIDE_LOOK };
  private distance = OUTSIDE_DISTANCE;
  /** The lens from the seat, degrees: the wheel narrows it, to look closely at the panel. */
  private zoomed = FLIGHT_FOV;
  /** The lens this frame is drawn with: the seat's own, the flight's from outside. */
  private fov = FLIGHT_FOV;
  /** What the surfaces the stick and pedals move stand at, -1 to 1: they follow what is asked of them at their own pace. */
  private surfaces = { ailerons: 0, elevator: 0, rudder: 0 };
  /** Where the flight deck's stick, levers, pedals and handles stand; see `moveLevers`. */
  private levers: Levers = { ...LEVERS_AT_REST };
  /** The stick, pedals and lever as last read. */
  private input: ReturnType<Keys["read"]> | null = null;
  /** The cockpit's live screens, which the deck draws; see `setScreens`. */
  private screens: AircraftScreen[] = [];
  /** The storms marked in the view, chosen now and then (`slow`) and placed every frame (`seen`). */
  private marked: StormMark[] = [];
  /** The storm being looked into, and how; see `inspect`. */
  private inspected: { mark: StormMark; mode: InspectMode } | null = null;
  /** What the flight sounds like (sound.ts); from take-off to landing. */
  private sound: FlightSound | null = null;
  /** The alarms the reader has silenced (alarms.ts), from frame to frame. */
  private alarms: AlarmMemory = NO_ALARMS;

  constructor(
    private readonly stage: Stage,
    private readonly options: {
      credits: () => string;
      /** Who made the aircraft's model, which a video with the aircraft in it says. */
      modelCredit: string;
      onLeave: () => void;
    },
    /** What the reader settled before taking off (plan.ts). */
    private readonly flightPlan: FlightPlan,
  ) {
    this.keys = new Keys((action) => this.act(action));
    this.before = {
      style: get(cloudStyle), peel: get(peelLevel), manual: get(peelManual), fov: get(studioFov), scan: get(cloudsTime).shown,
    };
    const camera = stage.studioCamera();
    this.look = { lon: camera?.lon ?? 10, lat: camera?.lat ?? 50, bearing: camera?.bearing ?? 0 };
    this.approach = approachOf(flightPlan);
    this.tas = flightPlan.tas;
    this.telemetry = {
      state: this.startState(), ias: 0, mach: 0, ground: null, radarAltitude: null, target: null, dbz: null,
      cloud: 0, rain: 0, turbulence: 0, severity: 0, hail: 0, ice: 0, frost: 0, draft: 0, temperature: 0, fps: 60, quality: 1,
      storms: stage.stormTiles(), marks: [], fade: 0, flash: 0, brake: false, time: 0, gear: 0, flapLever: 0, rolled: 0,
    };
  }

  /** Take off: the map into the flight, the cockpit's style and lens, and the loop running. */
  start(): void {
    this.stage.setFlying(true, FLIGHT_SUPPORT);
    this.radarOnGround = this.flightPlan.radarOnGround;
    this.stage.setRadarOnGround(this.radarOnGround);
    this.status({ radarOnGround: this.radarOnGround });
    this.quality = settledQuality;
    this.telemetry.quality = this.quality;
    this.stage.setFlightQuality(this.quality);
    this.findBase();
    // The newest scan's storms, whichever Studio had on the map: an earlier
    // one's are looked for where the map's camera has stood, and a camera in
    // the air stands nowhere on it, so the storms ahead would never come.
    this.stage.blendScans(null);
    if (this.before.scan !== null) void this.stage.stageScan(null);
    cloudStyle.set(this.flightPlan.style);
    peelManual.set(true);
    peelLevel.set(0);
    studioFov.set(FLIGHT_FOV);
    flightStatus.set({ ...INITIAL_FLIGHT_STATUS, view: this.flightPlan.view, clearSky: this.approach.target === null });
    studioFlying.set(true);
    this.place();
    // Taking off is a click or a key: when a page may begin to make sound.
    this.sound = new FlightSound();
    this.keys.start();
    this.keysTimer = setTimeout(() => this.status({ keys: false }), KEYS_MS);
    this.frame = requestAnimationFrame((now) => this.tick(now));
    // While developing, within reach of the console: to put the aircraft somewhere, or a storm round it.
    if (import.meta.env?.DEV) (window as unknown as { flightPilot?: Pilot }).flightPilot = this;
  }

  /**
   * Land. The map gives back what it changed itself; Studio's style, peel
   * and lens go back here. With Studio closing, which has handed the map its
   * own peel back already, the style goes back only as far as one the map
   * offers outside Studio, as closing Studio does (lib/studio/session.ts).
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.keysTimer !== null) clearTimeout(this.keysTimer);
    this.keysTimer = null;
    this.keys.stop();
    this.sound?.dispose();
    this.sound = null;
    // A video the reader was taking is kept, not thrown away with the flight.
    const recording = this.recording;
    this.recording = null;
    if (recording) void saveRecording(recording);
    for (const timer of this.thunder) clearTimeout(timer);
    this.thunder = [];
    this.stage.setFlightWeather(null);
    this.stage.setFlying(false);
    studioFlying.set(false);
    flightStatus.set(INITIAL_FLIGHT_STATUS);
    studioFov.set(this.before.fov);
    if (get(studioOpen)) {
      // Once landed, where the camera stands on the map again.
      if (this.before.scan !== null) void this.stage.stageScan(this.before.scan);
      cloudStyle.set(this.before.style);
      peelManual.set(this.before.manual);
      peelLevel.set(this.before.peel);
    } else {
      const own = isMapStyle(this.before.style) ? this.before.style : mapStyleOf(window.settings?.get("layer3dStyle"));
      cloudStyle.set(own);
    }
    this.listeners.clear();
  }

  /** End the flight, as the reader has said to. */
  leave(): void {
    this.options.onLeave();
  }

  /** Fly on: the question whether to end the flight is taken back. */
  stay(): void {
    this.status({ leaving: false });
    // The frame it resumes on is not as long as the question took.
    this.last = null;
  }

  /** Be told after every frame, with the telemetry; returns how to stop. */
  onFrame(listener: (telemetry: Telemetry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The lightning under way, for a map of the flight to show where it is: each flash where it is, and when it began, seconds flown. */
  flashing(): ReadonlyArray<{ lon: number; lat: number; born: number; seed: number; ground: boolean }> {
    return this.flashes;
  }

  /** The radar's picture as the map has it on the ground, for a map of the flight to draw (`Stage.radarTiles`). */
  radarTiles(): string[] {
    return this.stage.radarTiles();
  }

  /** Do what a key press asks; the deck's buttons call this too. */
  act(action: FlightAction): void {
    // Asked whether to end the flight, the keys answer that and nothing else: Enter ends it, Escape flies on.
    if (get(flightStatus).leaving) {
      if (action === "confirm") this.leave();
      else if (action === "leave") this.stay();
      return;
    }
    switch (action) {
      case "leave":
        // Not at a keystroke: the flight is held, and the reader asked.
        this.status({ leaving: true });
        break;
      case "confirm":
        return;
      case "radar":
        this.radarOnGround = !this.radarOnGround;
        this.stage.setRadarOnGround(this.radarOnGround);
        this.status({ radarOnGround: this.radarOnGround });
        break;
      case "autopilot":
        // It flies; it does not taxi.
        if (this.telemetry.state.onGround) return;
        this.autopilot = this.autopilot === null ? this.telemetry.state.altitude : null;
        this.status({ autopilot: this.autopilot !== null });
        break;
      case "next":
        this.approach = this.another();
        // Rather fast for its level, which is the next storm's.
        this.tas = cruiseSpeed(this.approach.altitude);
        this.status({ clearSky: this.approach.target === null });
        this.cut();
        break;
      case "restart":
        this.cut();
        break;
      case "view": {
        const views = ["cockpit", "outside", "clean"] as const;
        this.status({ view: views[(views.indexOf(get(flightStatus).view) + 1) % views.length] });
        break;
      }
      case "style":
        cloudStyle.set(STYLES[(STYLES.indexOf(get(cloudStyle)) + 1) % STYLES.length]);
        break;
      case "record":
        void this.toggleRecording();
        break;
      case "pause":
        this.paused = !this.paused;
        this.status({ paused: this.paused });
        break;
      case "mute":
        this.sound?.toggleMute();
        break;
      case "inspect":
        this.inspectNext();
        break;
      case "gear":
        // Standing on it, it stays down.
        if (this.telemetry.state.onGround) return;
        this.gearDown = !this.gearDown;
        break;
      case "fullscreen":
        toggleFullscreen();
        break;
      case "flapsOut":
      case "flapsIn": {
        const lever = Math.min(Math.max(this.telemetry.flapLever + (action === "flapsOut" ? 1 : -1), 0), FLAPS_MOST);
        if (lever === this.telemetry.flapLever) return;
        this.telemetry.flapLever = lever;
        this.status({ flaps: lever });
        break;
      }
      case "speedbrake":
        this.speedbrake = !this.speedbrake;
        break;
      case "autobrake": {
        this.autobrake = !this.autobrake;
        // Armed again while rolling out a landing, it brakes the rest of it.
        const { state } = this.telemetry;
        if (this.autobrake && state.onGround && state.touchdown) this.telemetry.state = { ...state, autobrake: true };
        break;
      }
      case "parkingBrake":
        // It holds wheels that stand on the ground: in the air there is nothing for it to hold.
        if (!this.telemetry.state.onGround) return;
        this.parkingBrake = !this.parkingBrake;
        break;
      case "help":
        if (this.keysTimer !== null) clearTimeout(this.keysTimer);
        this.keysTimer = null;
        this.status({ keys: !get(flightStatus).keys });
        break;
      case "silence": {
        // What is raised now goes quiet and its light out, paused or not; what is raised after sounds.
        const { alarms } = get(flightStatus);
        this.alarms = silence(this.alarms, alarms);
        this.status({ silenced: silencedOf(this.alarms, alarms) });
        break;
      }
    }
    // Its click, and a pause's or a recording's sound; after leaving, there is none.
    this.sound?.act(action, get(flightStatus));
  }

  /**
   * Look into a marked storm, by its place among the marks in the view: seen
   * through to its core, to begin with. The one already looked
   * into is let go of instead.
   */
  inspect(index: number): void {
    const seen = this.telemetry.marks[index];
    if (!seen) return;
    this.lookInto(seen.inspected ? null : { mark: seen.mark, mode: this.inspected?.mode ?? INSPECT_MODES[0] });
  }

  /** Look into the storm another way, or let go of it for null. */
  inspectAs(mode: InspectMode | null): void {
    this.lookInto(mode && this.inspected ? { mark: this.inspected.mark, mode } : null);
  }

  /**
   * The key's turn: the storm flown at, or the one nearest the middle of the
   * view, seen through; then cut open, then peeled, then left alone again.
   */
  private inspectNext(): void {
    if (this.inspected) {
      const next = INSPECT_MODES[INSPECT_MODES.indexOf(this.inspected.mode) + 1] ?? null;
      this.inspectAs(next);
      return;
    }
    const marks = this.telemetry.marks;
    const chosen = marks.find((seen) => seen.target)
      ?? [...marks].sort((a, b) => Math.hypot(a.x - 0.5, a.y - 0.45) - Math.hypot(b.x - 0.5, b.y - 0.45))[0];
    if (chosen) this.lookInto({ mark: chosen.mark, mode: INSPECT_MODES[0] });
  }

  private lookInto(next: { mark: StormMark; mode: InspectMode } | null): void {
    this.inspected = next;
    this.applyInspection();
    this.status({ inspecting: next?.mode ?? null });
    if (this.paused) this.refresh();
  }

  /**
   * Have the map draw the storm looked into as it is looked into, from where
   * the aircraft is now: a cut stays across the line of sight as it turns.
   */
  private applyInspection(): void {
    const looked = this.inspected;
    const { state } = this.telemetry;
    this.stage.inspectStorm(looked && {
      lon: looked.mark.lon, lat: looked.mark.lat, mode: looked.mode,
      from: bearingDeg(state.lon, state.lat, looked.mark.lon, looked.mark.lat),
    });
  }

  /** A paused flight's picture, made again: the eye has turned, or what it looks into has changed, and no frame is coming to show it. */
  private refresh(): void {
    this.place();
    for (const listener of this.listeners) listener(this.telemetry);
  }

  /** What a phone's controls on the glass ask of the aircraft, beside the keys and a gamepad; null with no finger on them. */
  touch(input: Parameters<Keys["setTouch"]>[0]): void {
    this.keys.setTouch(input);
  }

  /** Turn the eye by a drag of the mouse, in pixels: the head in its seat, or the eye round the aircraft. */
  lookBy(dx: number, dy: number): void {
    if (get(flightStatus).view === "outside") {
      // Dragging the picture: the eye goes the other way round.
      this.orbit = { yaw: (this.orbit.yaw - dx * LOOK_PER_PX * 1.6) % 360, pitch: clamp(this.orbit.pitch - dy * LOOK_PER_PX * 1.6, ORBIT_PITCH) };
    } else {
      // Through a long lens the same drag turns the head by less: the picture moves as far under the hand.
      const per = LOOK_PER_PX * (this.zoomed / FLIGHT_FOV);
      this.head = {
        yaw: clamp(this.head.yaw + dx * per, [-HEAD_YAW, HEAD_YAW]),
        pitch: clamp(this.head.pitch - dy * per, HEAD_PITCH),
      };
    }
    if (this.paused) this.refresh();
  }

  /** A wheel's turn: stand nearer or further off, outside; from the seat, look closer at the panel or back out again. */
  zoomBy(steps: number): void {
    const { view } = get(flightStatus);
    if (view === "outside") this.distance = clamp(this.distance * 1.12 ** steps, OUTSIDE_RANGE);
    else if (view === "cockpit") this.zoomed = clamp(this.zoomed * 1.1 ** steps, COCKPIT_FOV_RANGE);
    else return;
    if (this.paused) this.refresh();
  }

  /** Look where the view began again. */
  recentre(): void {
    this.head = { ...COCKPIT_LOOK };
    this.orbit = { ...OUTSIDE_LOOK };
    this.distance = OUTSIDE_DISTANCE;
    this.zoomed = FLIGHT_FOV;
    if (this.paused) this.refresh();
  }

  /** The stick, a pedal or the thrust levers of the flight deck with the mouse held on it, and what that asks of the aircraft; see `hold`. */
  private hand: { hold: NonNullable<CockpitControl["hold"]>; input: ControlInput } | null = null;
  /** The autobrake armed (X, its MED button): after a landing the wheels are braked without a foot on them. */
  private autobrake = true;
  /** The parking brake set (K, its handle): the wheels held where they stand. */
  private parkingBrake = false;

  /**
   * The control of the flight deck at a point of the view, CSS pixels from
   * its top left: what the mouse is over, from the seat (cockpit.ts). Null
   * where there is none, and in the views that show no flight deck.
   */
  controlAt(x: number, y: number): CockpitPick | null {
    if (get(flightStatus).view !== "cockpit") return null;
    const canvas = this.stage.canvas();
    const [width, height] = [canvas?.clientWidth || 1, canvas?.clientHeight || 1];
    // Rough air shakes the cockpit and the eye in it alike: from the seat, a control is where the head's turn alone puts it.
    const head = { heading: this.head.yaw, pitch: this.head.pitch, roll: 0 };
    return controlAlong(SEAT, lookedAlong(head, x / width, y / height, this.zoomed, width / height));
  }

  /**
   * A click on the control at a point of the view: a lever moved, a button
   * pushed, as its key does it. Returns the control, null where there is
   * none; one that is held, not clicked, is left alone.
   */
  press(x: number, y: number): CockpitPick | null {
    const pick = this.controlAt(x, y);
    const press = pick && (COCKPIT_CONTROLS[pick.name] as CockpitControl).press;
    // A lever's forward half moves it forward, its aft half aft.
    if (press) this.act(typeof press === "string" ? press : press[pick.down < 0.5 ? 0 : 1]);
    return pick;
  }

  /**
   * Take hold of the control at a point of the view, if it is one that is
   * held: the stick, a pedal, the thrust levers. It is the hand's until
   * `release`, and `moveHeld` moves it; a pedal is pushed at once. Returns
   * whether there was one to take hold of.
   */
  hold(x: number, y: number): boolean {
    const pick = this.controlAt(x, y);
    const control = pick && (COCKPIT_CONTROLS[pick.name] as CockpitControl);
    if (!pick || !control?.hold) return false;
    this.hand = { hold: control.hold, input: { ...NO_INPUT, yaw: control.faces[pick.face].push ?? 0 } };
    this.handOn = pick.name;
    return true;
  }

  /**
   * Move the control held, by how far the mouse has gone since it took
   * hold, CSS pixels: the stick as far over (towards the bottom of the view
   * is pulled back, nose up), the thrust levers pushed forward or pulled
   * back as fast, as W and S do.
   */
  moveHeld(dx: number, dy: number): void {
    const hand = this.hand;
    if (!hand) return;
    const unit = (pixels: number) => Math.min(Math.max(pixels / HAND_FULL_PX, -1), 1);
    if (hand.hold === "stick") hand.input = { ...NO_INPUT, roll: unit(dx), pitch: unit(dy) };
    else if (hand.hold === "thrust") hand.input = { ...NO_INPUT, throttle: unit(-dy) };
  }

  /** Let go of the control held: the stick and the pedals spring back, the levers stay where they were put. */
  release(): void {
    this.hand = null;
    this.handOn = null;
  }

  /** The brakes a hand sets and no readout shows, for the deck to say and to light: the autobrake armed, the parking brake set. */
  get brakes(): { autobrake: boolean; parking: boolean } {
    return { autobrake: this.autobrake, parking: this.parkingBrake };
  }

  /**
   * What the keys ask, and with it what a hand on the flight deck's own
   * controls does: the stick, a pedal or the levers under the mouse, and
   * the wheels held by the parking brake. And the autobrake kept off where
   * it is not armed.
   */
  private withHand(input: ReturnType<Keys["read"]>): ReturnType<Keys["read"]> {
    const { state } = this.telemetry;
    // In the air there is nothing for the parking brake to hold, and no landing is made on locked wheels: it lets go.
    if (!state.onGround) this.parkingBrake = false;
    // Every touchdown arms the aircraft's autobrake; disarmed here, it is let go of again before it has braked.
    if (!this.autobrake && state.autobrake) this.telemetry.state = { ...state, autobrake: false };
    const asked = this.hand ? merged(input, this.hand.input) : input;
    return { ...asked, brake: asked.brake || this.parkingBrake, warp: input.warp };
  }

  /** The pictures on the cockpit's screens, drawn by the deck every frame. */
  setScreens(screens: AircraftScreen[]): void {
    this.screens = screens;
  }

  /** The approach to the next system after the one flown at, severest first, from the storms listed now. */
  private another(): Approach {
    return chooseApproach(this.stage.stormTiles(), this.look, this.approach.target, (lon, lat) => this.stage.groundElevation(lon, lat));
  }

  private startState(): AircraftState {
    const { lon, lat, altitude, heading } = this.approach;
    return levelFlight(lon, lat, altitude, heading, this.tas);
  }

  /** Back to the start of the approach, through black. */
  private cut(): void {
    this.fading = { at: 0, moved: false };
  }

  private status(patch: Partial<FlightStatus>): void {
    const current = get(flightStatus);
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current[key as keyof FlightStatus]) === JSON.stringify(value))) {
      return;
    }
    flightStatus.set({ ...current, ...patch });
  }

  private async toggleRecording(): Promise<void> {
    const running = this.recording;
    if (running) {
      this.recording = null;
      this.status({ recording: false });
      await saveRecording(running);
      return;
    }
    this.status({ recording: true });
    const credits = get(flightStatus).view === "clean"
      ? this.options.credits()
      : `${this.options.modelCredit} | ${this.options.credits()}`;
    const recording = await recordStage(this.stage, credits, () => captionOf(), this.sound?.stream() ?? null);
    if (!recording || this.frame === null) {
      recording?.cancel();
      this.status({ recording: false });
      return;
    }
    this.recording = recording;
  }

  private tick(now: number): void {
    this.frame = requestAnimationFrame((next) => this.tick(next));
    const elapsed = this.last === null ? 0 : (now - this.last) / 1000;
    const dt = Math.min(elapsed, 0.1);
    this.last = now;
    // A hidden tab draws nothing; the time away is not flown.
    if (typeof document !== "undefined" && document.hidden) return;
    this.keepUp(elapsed);
    this.dt = dt;
    if (this.paused || get(flightStatus).leaving) {
      if (this.recording) this.stage.repaint();
      return;
    }
    const telemetry = this.telemetry;
    const input = this.withHand(this.keys.read());
    this.input = input;
    if (this.autopilot !== null && Keys.moving(input)) this.act("autopilot");

    if (this.fading) this.fade(dt);
    else this.fly(input, dt);

    telemetry.time += dt;
    if (telemetry.time - this.slowAt >= SLOW_S) this.slow();
    this.place();
    for (const listener of this.listeners) listener(telemetry);
    // Heard as it is seen: from outside where the picture has cut out of the cockpit.
    const seen = this.seenView();
    const orbit = seen === "cockpit" ? null : this.orbitNow(telemetry.state);
    this.sound?.update(telemetry, { ...get(flightStatus), view: seen }, dt, {
      ended: Boolean(telemetry.state.crash) || broken(this.damage), orbit: orbit?.yaw ?? this.orbit.yaw, eye: orbit?.distance ?? this.distance,
      flight: this.flights,
    });
  }

  /** A frame of flight: the weather, the physics, the ground. */
  private fly(input: ReturnType<Keys["read"]>, dt: number): void {
    const telemetry = this.telemetry;
    let { state } = telemetry;
    // The radar's field at the aircraft and a little way round it: what the air there is doing (weather.ts).
    const { lon, lat, altitude } = state;
    const perDegree = 111_195;
    const air = airAt((east, north, up) => this.stage.reflectivityAt(
      lon + east / (perDegree * Math.cos((lat * Math.PI) / 180)), lat + north / perDegree, altitude + up,
    ), altitude, this.baseKm * 1000, this.warmer);
    const dbz = air.dbz;
    const { turbulence, severity } = air;
    const ground = this.stage.groundElevation(lon, lat);
    // Over the sea the terrain may be drawn below it; the water is the floor.
    const floor = Math.max(ground ?? 0, 0);
    const low = altitude - floor < SLOPE_BELOW_M;
    // Time runs faster only well clear of the ground, never on it, and not for an aircraft coming apart.
    const warp = input.warp && altitude - floor > WARP_ABOVE_M && !harmed(this.damage) ? WARP : 1;
    /* The seconds of flight this frame flies. Warped, all of it runs faster
       alike, the turning and the climbing and the gusts with the distance:
       the flight is the one it would have been, only sooner. Faster ground
       alone flew a bank's turn four times as wide, and a climb four times as
       flat, as the same bank and climb unwarped. */
    const flown = dt * warp;
    this.airTime += flown;
    // The rough air, and what the damage adds to it: a surface's jolt as it goes, and the buffet of what is left.
    const rough = roughAir(this.airTime, turbulence, air.draft, severity);
    const shaken = shudder(this.damage);
    const env: Environment = {
      gust: state.onGround
        ? { roll: 0, pitch: 0, vertical: 0 }
        : { roll: rough.roll + shaken.roll, pitch: rough.pitch + shaken.pitch, vertical: rough.vertical + shaken.vertical },
      autopilot: this.autopilot, gear: telemetry.gear, flapLever: telemetry.flapLever, speedbrake: this.speedbrake,
      // A wreck lies on its belly, not on its wheels.
      ground: floor + (state.crash ? BELLY_BELOW_M / VERTICAL_SCALE : STAND_M),
      slope: low ? this.slopeAhead(state, floor) : 0, tilt: low ? this.tiltUnder(state) : undefined, ice: telemetry.frost,
      lost: this.damage.lost, flapsStuck: this.damage.flapsStuck,
    };
    const before = state;
    // The hands keep real time: what they ask for each second of flight is shared out over the seconds it now flies.
    const asked = warp > 1
      ? { ...input, pitch: input.pitch / warp, roll: input.roll / warp, yaw: input.yaw / warp, throttle: input.throttle / warp }
      : input;
    for (let left = flown; left > 1e-6; left -= MAX_DT) state = step(state, asked, Math.min(left, MAX_DT), env);
    this.strain(state, floor, flown);
    // An autopilot does not fly a stall, nor a landing, nor an aircraft that has lost anything.
    if ((state.stalled || state.onGround || harmed(this.damage)) && this.autopilot !== null) this.act("autopilot");
    this.landed(before, state, dt);

    telemetry.state = state;
    telemetry.ground = ground;
    telemetry.radarAltitude = Math.max(0, state.altitude - floor - STAND_M);
    telemetry.ias = indicatedFromTrue(state.tas, state.altitude);
    telemetry.mach = machOf(state.tas, state.altitude);
    telemetry.dbz = dbz;
    telemetry.turbulence = turbulence;
    telemetry.severity = severity;
    telemetry.brake = state.spoilers > 0.05;
    // The gear folds under a wreck, and one jammed by too much air stays where it is.
    if (state.crash) telemetry.gear = Math.max(0, telemetry.gear - dt / GEAR_FOLDS_S);
    else if (!this.damage.gearStuck) telemetry.gear = moveGear(telemetry.gear, this.gearDown, dt);
    this.status({
      gear: telemetry.gear <= 0 ? "up" : telemetry.gear >= 1 ? "down" : "moving",
      flapsMoving: Math.abs(state.flaps - telemetry.flapLever) > 0.02,
      spoilers: state.spoilers < 0.05 ? "in" : state.spoilers > SPEEDBRAKE + 0.1 ? "ground" : "brake",
      onGround: state.onGround, reverse: state.reverse > 0.5, alphaFloor: state.alphaFloor,
    });
    if (telemetry.time > this.crashUntil) this.status({ crash: null });
    // Cloud thickens and thins over half a second or so, as it does past the glass.
    telemetry.cloud += (air.cloud - telemetry.cloud) * (1 - Math.exp(-dt / 0.5));
    telemetry.rain += (air.rain - telemetry.rain) * (1 - Math.exp(-dt / 0.3));
    telemetry.hail += (air.hail - telemetry.hail) * (1 - Math.exp(-dt / 0.3));
    telemetry.ice += (air.ice - telemetry.ice) * (1 - Math.exp(-dt / 0.6));
    telemetry.draft = air.draft;
    telemetry.temperature = air.temperature;
    // Ice takes a couple of minutes to cover the glass, and goes nearly as slowly once the aircraft is out of what made it.
    telemetry.frost = Math.min(1, Math.max(0, telemetry.frost + (air.icing > 0.05 ? air.icing / 150 : -1 / 110) * flown));
    const target = this.approach.target;
    if (target) {
      const { bearing, distance } = towards(state.lon, state.lat, target);
      const speed = state.tas * (input.warp ? WARP : 1);
      telemetry.target = { bearing, distance, seconds: distance / Math.max(speed, 1), peakDbz: target.peakDbz };
    } else {
      telemetry.target = null;
    }
    const warnings: FlightWarning[] = [];
    const coming = telemetry.radarAltitude < LOW_M && state.verticalSpeed < -SINK_WARNING_MS;
    // The ground ahead is no surprise to an aircraft with its wheels down for it; coming down too fast still is.
    if (!state.onGround) {
      if (telemetry.gear < 1 && this.terrain) warnings.push("terrain");
      else if (coming) warnings.push("sink");
      if (telemetry.gear < 1 && telemetry.radarAltitude < GEAR_WARNING.below && telemetry.ias < GEAR_WARNING.slower) warnings.push("gear");
    }
    if (!state.onGround && Math.abs(state.roll) > BANK_WARNING) warnings.push("bank");
    if (state.stalled) warnings.push("stall");
    if (overspeed(state, telemetry.ias, telemetry.gear)) warnings.push("overspeed");
    if (telemetry.frost > 0.35) warnings.push("ice");
    if (this.damage.flapsStuck) warnings.push("flapsJammed");
    if (this.damage.gearStuck) warnings.push("gearJammed");
    // What is left of an aircraft has nothing more to be warned of: why it is so is already said.
    const ended = Boolean(state.crash) || broken(this.damage);
    if (ended) warnings.length = 0;
    // The alarms: the surfaces lost and the warnings, each heard until it clears or the reader silences it.
    const alarms = alarmsOf(warnings, ended ? [] : get(flightStatus).lost);
    this.alarms = alarmStep(this.alarms, alarms, dt);
    this.status({ warnings, alarms, silenced: silencedOf(this.alarms, alarms), warp: warp > 1, low: telemetry.radarAltitude < LOW_M });
  }

  /**
   * What the flight just did to the airframe (damage.ts), and the noise of
   * it: a surface fluttering off, a piece tearing off, the flaps or the gear
   * jamming, a blast. The surfaces lost so far are the status's; an
   * aircraft that has lost a wing or the tail in the air says why from then
   * on.
   */
  private strain(state: AircraftState, floor: number, dt: number): void {
    const flight = {
      ias: indicatedFromTrue(state.tas, state.altitude), mach: machOf(state.tas, state.altitude), gear: this.telemetry.gear,
      // The ground under the hull's middle, as far down as the aircraft is drawn over it.
      over: (state.altitude - floor) * VERTICAL_SCALE,
    };
    const whole = this.damage.violence === null;
    const before = this.damage;
    const { damage, events } = advance(this.damage, state, flight, dt);
    this.damage = damage;
    this.foresee(before, damage, events, dt);
    if (broken(damage) && !this.fallen && !state.crash) {
      const yaw = this.orbitNow(state).yaw;
      this.fallen = { bearing: state.heading + yaw, yaw: this.orbit.yaw };
    }
    // Meeting the ground for good is a blast, or where it only slides, the airframe giving way: by how hard it came down.
    if (whole && damage.violence !== null && !events.some((event) => event.kind === "blast")) {
      this.sound?.breakup(Math.min(1, 0.35 + 2 * damage.violence));
    }
    for (const event of events) {
      if (event.kind === "blast" || event.kind === "shed") this.sound?.explosion(event.strength);
      else this.sound?.breakup(event.strength);
    }
    const lost = surfacesLost(damage);
    if (lost.length !== get(flightStatus).lost.length) this.status({ lost: [...lost] });
    if (damage.cause && !state.crash && events.some((event) => event.kind === "torn")) {
      this.crashUntil = Infinity;
      this.status({ crash: this.ended(state) });
    }
  }

  /**
   * Whether something is about to come off, and the reader is in the
   * cockpit: then out to see it (`SHOW_BREAK`). What is used up of each
   * margin (damage.ts), at the rate it went this step, says how soon.
   */
  private foresee(before: Damage, after: Damage, events: readonly DamageEvent[], dt: number): void {
    const time = this.telemetry.time;
    const went = events.some((event) => event.kind === "shed" || event.kind === "torn");
    if (this.showing) {
      if (went && this.showing.went === null) this.showing.went = time;
      const over = this.showing.went !== null
        ? time >= this.showing.went + SHOW_BREAK.after
        : time >= this.showing.since + SHOW_BREAK.gaveUp;
      if (over && !broken(after)) this.showing = null;
      return;
    }
    if (get(flightStatus).view !== "cockpit" || dt <= 0) return;
    const margins = ["flutter", "stress", "airframe", "fin"] as const;
    const soonest = Math.min(...margins.map((margin) => {
      const rate = (after[margin] - before[margin]) / dt;
      return rate > 0 ? (1 - after[margin]) / rate : Infinity;
    }));
    if (soonest <= SHOW_BREAK.lead) this.showing = { since: time, went: null };
  }

  /** The view drawn: the reader's, but outside for a wreck, and from the cockpit to see something come off. */
  private seenView(): FlightView {
    const chosen = get(flightStatus).view;
    if (this.wreck) return "outside";
    return chosen === "cockpit" && (this.showing || this.fallen) ? "outside" : chosen;
  }

  /** Where round the aircraft the eye outside stands now, and how far off. */
  private orbitNow(state: AircraftState): { yaw: number; pitch: number; distance: number } {
    if (this.wreck) return { yaw: this.wreck.bearing - state.heading, pitch: this.wreck.pitch, distance: this.wreck.distance };
    const chosen = get(flightStatus).view;
    // Cut out of the cockpit: the usual outside view, not wherever the orbit was last left.
    const own = chosen === "cockpit" ? { ...OUTSIDE_LOOK, distance: OUTSIDE_DISTANCE } : { ...this.orbit, distance: this.distance };
    const yaw = this.fallen ? this.fallen.bearing + (this.orbit.yaw - this.fallen.yaw) - state.heading : own.yaw;
    return { yaw, pitch: Math.min(own.pitch, this.lowestOrbit(state, yaw, own.distance)), distance: own.distance };
  }

  /**
   * Why the flight ended: what first broke the aircraft, where something
   * did before it met the ground; else how it met it, which for one that
   * blew up there was no kind of touchdown.
   */
  private ended(state: AircraftState): FlightCrash | null {
    const { cause, violence } = this.damage;
    if (cause === "ground") return "wing";
    if (cause === "flutter") return "flutter";
    if (cause === "load") return "breakup";
    if (state.crash && violence !== null && violence >= BLAST_FROM) return "impact";
    return state.crash;
  }

  /** How steeply the ground rises ahead of the aircraft, a rise over its run; level where the map has no ground there. */
  /**
   * The most an eye `distance` metres off the aircraft, turned `yaw` from its
   * nose, may look up at it, degrees: as far as keeps it `EYE_OVER_GROUND_M`
   * over the drawn ground, both under the aircraft and where the eye stands.
   * The eye's offset is true metres; heights over the sea are drawn stretched.
   */
  private lowestOrbit(state: AircraftState, yaw: number, distance: number): number {
    const groundAt = (lon: number, lat: number) => Math.max(this.stage.groundElevation(lon, lat) ?? 0, 0);
    let pitch = this.orbit.pitch;
    // Twice round: where the eye stands moves a little with how far up it looks.
    for (let round = 0; round < 2; round += 1) {
      const across = distance * Math.cos((pitch * Math.PI) / 180);
      const [lon, lat] = destination(state.lon, state.lat, state.heading + yaw + 180, across);
      const ground = Math.max(groundAt(state.lon, state.lat), groundAt(lon, lat));
      const room = (state.altitude - ground) * VERTICAL_SCALE - EYE_OVER_GROUND_M;
      pitch = Math.min(this.orbit.pitch, (Math.asin(clamp(room / distance, [-1, 1])) * 180) / Math.PI);
    }
    return pitch;
  }

  /**
   * How the ground lies under the aircraft (`Environment.tilt`): its rise
   * from tail to nose and its fall from the left main to the right, each
   * over `TILT_SPAN_M` either side of where it stands, which is about as far
   * as the drawn ground's own heights are apart. Level where the map has no
   * heights there; the sea is level.
   */
  private tiltUnder(state: AircraftState): { pitch: number; roll: number } {
    const at = (bearing: number) => {
      const [lon, lat] = destination(state.lon, state.lat, bearing, TILT_SPAN_M);
      const ground = this.stage.groundElevation(lon, lat);
      return ground === null ? null : Math.max(ground, 0);
    };
    const [front, back, right, left] = [0, 180, 90, 270].map((turn) => at(state.heading + turn));
    const degrees = (high: number | null, low: number | null) => (
      high === null || low === null ? 0 : (Math.atan((high - low) / (2 * TILT_SPAN_M)) * 180) / Math.PI
    );
    return { pitch: degrees(front, back), roll: degrees(left, right) };
  }

  private slopeAhead(state: AircraftState, floor: number): number {
    const [lon, lat] = destination(state.lon, state.lat, state.heading, SLOPE_RUN_M);
    const ahead = this.stage.groundElevation(lon, lat);
    return ahead === null ? 0 : (Math.max(ahead, 0) - floor) / SLOPE_RUN_M;
  }

  /**
   * What a step on the ground, or onto it, or off it, means for the flight:
   * a landing is kept as it was made and its roll measured; one that was
   * not a landing ends the flight, saying why. Its wreck is watched from
   * outside while it slides, burns and comes to rest, and then the flight
   * starts again from the approach, through black.
   */
  private landed(before: AircraftState, state: AircraftState, dt: number): void {
    const telemetry = this.telemetry;
    if (state.crash) {
      if (this.fading) return;
      if (!this.wreck) {
        this.wreck = {
          since: telemetry.time, until: telemetry.time + WRECK_WATCHED_S.most, stopped: false, ...this.wreckEye(state),
        };
        this.crashUntil = Infinity;
        this.status({ crash: this.ended(state), landing: null });
      }
      const wreck = this.wreck;
      if (!wreck.stopped && state.tas === 0) {
        wreck.stopped = true;
        wreck.until = Math.min(wreck.until, Math.max(wreck.since + WRECK_WATCHED_S.least, telemetry.time + WRECK_WATCHED_S.after));
      }
      // Not while it still has something coming, nor with a blast still in the air and in the ears; but not for ever.
      const { blasts, coming, clock } = this.damage;
      const settled = !coming.length && blasts.every((blast) => clock - blast.born >= WRECK_WATCHED_S.blast);
      if (telemetry.time >= wreck.until && (settled || telemetry.time >= wreck.since + WRECK_WATCHED_S.most)) {
        this.crashUntil = telemetry.time + CRASH_SHOWN_S;
        this.cut();
      }
      return;
    }
    if (!state.onGround) {
      if (before.onGround) this.status({ landing: null });
      return;
    }
    const touchdown = state.touchdown;
    if (!before.onGround && touchdown) {
      telemetry.rolled = 0;
      this.sound?.touchdown(touchdown.sink, false);
    }
    telemetry.rolled += state.tas * dt;
    if (!touchdown) return;
    const stopped = state.tas === 0;
    const landing = get(flightStatus).landing;
    // Written when it touches down and when it stops; the deck reads how far it has rolled each frame meanwhile.
    if (!landing || landing.stopped !== stopped || !before.onGround) {
      this.status({ landing: { sink: touchdown.sink, speed: touchdown.tas, load: touchdown.load, rolled: telemetry.rolled, stopped } });
    }
  }

  /**
   * Where a wreck is watched from (`WRECK_EYE`): the first of its places
   * that stands clear of the ground, further off the harder it came down.
   */
  private wreckEye(state: AircraftState): { bearing: number; distance: number; pitch: number } {
    const [near, far] = WRECK_EYE.distance;
    const distance = near + (far - near) * (this.damage.violence ?? 0);
    const radians = Math.PI / 180;
    const clearance = (bearing: number, pitch: number) => {
      const [lon, lat] = destination(state.lon, state.lat, bearing + 180, distance * Math.cos(pitch * radians));
      const ground = Math.max(this.stage.groundElevation(lon, lat) ?? 0, 0);
      // The eye's height is in metres as the aircraft is drawn; the ground's are true ones, drawn taller.
      return (state.altitude - ground) * VERTICAL_SCALE - distance * Math.sin(pitch * radians);
    };
    const round = WRECK_EYE.round.find((each) => clearance(state.track + each, WRECK_EYE.pitch) > WRECK_EYE.clear);
    return round === undefined
      ? { bearing: state.track + WRECK_EYE.round[0], distance, pitch: WRECK_EYE.steep }
      : { bearing: state.track + round, distance, pitch: WRECK_EYE.pitch };
  }

  /** A frame of a cut: to black, the aircraft put back, and in again. */
  private fade(dt: number): void {
    const fading = this.fading!;
    fading.at += dt;
    if (!fading.moved && fading.at >= FADE_OUT_S) {
      fading.moved = true;
      const state = this.startState();
      this.telemetry.state = state;
      this.telemetry.cloud = 0;
      this.telemetry.rain = 0;
      // A new aircraft: whole, with no ice on it, and nothing of the last one's end left to watch.
      this.flights += 1;
      this.damage = intact(this.flights);
      this.status({ lost: [] });
      this.wreck = null;
      this.showing = null;
      this.fallen = null;
      this.telemetry.frost = 0;
      // Nothing of the last one's end left on the screen either.
      this.crashUntil = -Infinity;
      this.status({ crash: null });
      this.autopilot = null;
      this.terrain = false;
      // Back at the start of the approach, in the air: clean, gear up.
      this.gearDown = false;
      this.speedbrake = false;
      this.telemetry.gear = 0;
      this.telemetry.flapLever = 0;
      this.telemetry.rolled = 0;
      this.status({ gear: "up", flaps: 0, flapsMoving: false, spoilers: "in", onGround: false, reverse: false, alphaFloor: false, landing: null });
      this.alarms = NO_ALARMS;
      this.status({ autopilot: false, warnings: [], alarms: [], silenced: [], clearSky: this.approach.target === null });
    }
    this.telemetry.fade = fading.at < FADE_OUT_S
      ? fading.at / FADE_OUT_S
      : Math.max(0, 1 - (fading.at - FADE_OUT_S) / FADE_IN_S);
    if (fading.at >= FADE_OUT_S + FADE_IN_S) {
      this.fading = null;
      this.telemetry.fade = 0;
    }
  }

  /**
   * Ask the weather stations round the aircraft where the clouds begin, and
   * have the map draw them from there; the usual base where they do not say.
   */
  private findBase(): void {
    const { state, time } = this.telemetry;
    this.baseAt = time;
    void cloudBaseAt(state.lon, state.lat).then((base) => {
      if (this.stopped) return;
      this.baseKm = base?.km ?? USUAL_BASE_KM;
      this.warmer = base?.warmer ?? 0;
      this.stage.setCloudBase(this.baseKm);
    });
  }

  /** What need not be asked every frame: the ground ahead, the storm list, the strikes nearby. */
  private slow(): void {
    const telemetry = this.telemetry;
    this.slowAt = telemetry.time;
    if (telemetry.time - this.baseAt >= BASE_S) this.findBase();
    const warp = get(flightStatus).warp ? WARP : 1;
    this.terrain = terrainAhead(telemetry.state, (lon, lat) => this.stage.groundElevation(lon, lat), warp);
    telemetry.storms = this.stage.stormTiles();
    this.marked = this.flightPlan.marks
      ? marksNear(this.stage.trackedCells(), coresOf(telemetry.storms), telemetry.state.lon, telemetry.state.lat, telemetry.state.heading)
      : [];
    this.measureMarks();
    const looked = this.inspected;
    if (looked) {
      // The storm looked into keeps its mark whatever else is nearer, and is the same storm in a newer list.
      const again = this.marked.find((mark) => distanceM(mark.lon, mark.lat, looked.mark.lon, looked.mark.lat) < MARK_APART_KM * 1000);
      if (again) looked.mark = again;
      else this.marked = [looked.mark, ...this.marked.slice(0, MARKS_SHOWN - 1)];
      this.applyInspection();
    }
    this.lookForLightning();
  }

  /**
   * What the map can say of each marked storm beyond its strength: how high
   * its echo reaches, read from its volume where one is held and its cell
   * did not say; and how much lightning there has been round it, from the
   * strikes the map draws.
   */
  private measureMarks(): void {
    const strikes = this.marked.length ? this.stage.strikesNear(this.telemetry.state.lon, this.telemetry.state.lat, MARK_REACH_KM + 20, 0) : [];
    // "Lately" by the strikes' own clock: a replayed storm's are not from now.
    const lately = strikes.reduce((newest, strike) => Math.max(newest, strike.at), 0) - STRIKES_LATELY_MS;
    for (const mark of this.marked) {
      mark.top ??= echoTop((altitude) => this.stage.reflectivityAt(mark.lon, mark.lat, altitude));
      const round = strikes.filter((strike) => strike.at >= lately
        && distanceM(mark.lon, mark.lat, strike.lon, strike.lat) < STRIKES_ROUND_KM * 1000).length;
      mark.strikes = round || undefined;
    }
  }

  /**
   * Lightning round the aircraft. Each strike the map has not shown before
   * is a flash, and a bolt to the ground under it. And the cores in view
   * flicker from inside now and then, the stronger the oftener: most of a
   * storm's lightning never leaves the cloud and is in no list of strikes,
   * so those are made up, and are light only.
   */
  private lookForLightning(): void {
    const { state, time } = this.telemetry;
    const strikes = this.stage.strikesNear(state.lon, state.lat, LIGHTNING_KM, 0);
    const known = this.struck;
    this.struck = new Set(strikes.map((strike) => strike.at));
    // The first look only learns which are already there.
    for (const strike of known ? strikes.filter(({ at }) => !known.has(at)).slice(-3) : []) {
      this.flashAt(strike.lon, strike.lat, time, strike.at % 100_000, true);
    }
    for (const mark of this.marked) {
      const rate = Math.min(0.14, Math.max(0, 0.02 + 0.011 * (mark.peakDbz - 50)));
      if (mark.peakDbz < 48 || Math.random() > rate * SLOW_S) continue;
      const [lon, lat] = destination(mark.lon, mark.lat, Math.random() * 360, Math.random() * 5000);
      this.flashAt(lon, lat, time, Math.floor(Math.random() * 100_000), false);
    }
  }

  private flashAt(lon: number, lat: number, born: number, seed: number, ground: boolean): void {
    const { state } = this.telemetry;
    if (this.flashes.length >= 4) this.flashes.shift();
    this.flashes.push({ lon, lat, born, seed, ground });
    // Thunder, when the sound of it has had time to arrive; from too far, there is none to hear.
    const away = distanceM(state.lon, state.lat, lon, lat);
    if (away < THUNDER_KM * 1000) {
      this.thunder.push(setTimeout(() => this.sound?.strikeNear(), Math.min(thunderDelay(away), 25) * 1000));
    }
  }

  /**
   * The lightning under way, for this frame: the bolts, each in the
   * aircraft's frame; the brightest flash, as a light inside the clouds; and
   * how bright the nearest is on the glass.
   */
  private lightning(pose: FlightAttitude): {
    bolts: Bolt[]; glow: { lon: number; lat: number; km: number; brightness: number } | null; glare: number;
  } {
    const { state, time } = this.telemetry;
    this.flashes = this.flashes.filter((flash) => time - flash.born < FLASH_S);
    const bolts: Bolt[] = [];
    let glow: { lon: number; lat: number; km: number; brightness: number } | null = null;
    let onGlass = 0;
    for (const flash of this.flashes) {
      const brightness = flicker(time - flash.born);
      if (brightness <= 0.01) continue;
      const [north, east] = flatOffset(state.lon, state.lat, flash.lon, flash.lat);
      onGlass = Math.max(onGlass, brightness * glare(Math.hypot(north, east)));
      // In the cloud, some way over its base: where the charge is.
      const km = this.baseKm + 3.5;
      if (!glow || brightness > glow.brightness) glow = { lon: flash.lon, lat: flash.lat, km, brightness };
      if (!flash.ground) continue;
      for (const path of boltPaths(flash.seed, (this.baseKm + 1.2) * 1000)) {
        bolts.push({
          brightness,
          points: path.map(([pe, pn, up]) => inAircraft(pose, [north + pn, east + pe, -(up - state.altitude) * VERTICAL_SCALE])),
        });
      }
    }
    return { bolts, glow, glare: onGlass };
  }

  /**
   * Keep the flight moving: count the frames, and where there have been too
   * few of them for a moment, have the map draw less (`Stage.setFlightQuality`),
   * a step at a time; and more again, slowly, once there have been plenty
   * for a while. Thirty a second is the least a flight should have.
   */
  private keepUp(elapsed: number): void {
    // A frame after a pause, or a tab that was away, says nothing of how fast frames come.
    // A gap as long as that is a tab that was away, not a frame.
    if (elapsed <= 0 || elapsed > LONGEST_FRAME_S) return;
    // Averaged over half a second, however many frames that is: a flight drawn once a second is told so within two of them.
    this.fps += (1 / elapsed - this.fps) * (1 - Math.exp(-elapsed / 0.5));
    this.telemetry.fps = this.fps;
    // The first seconds of a flight are the map fetching what it is about to draw, not how fast it draws it.
    this.flown += elapsed;
    if (this.flown < SETTLE_S) return;
    // One long frame is a hitch, not a slow flight: it counts for no more than half a second of one.
    this.tooSlow = this.fps < FPS_LEAST + 2 ? this.tooSlow + Math.min(elapsed, 0.5) : 0;
    this.plenty = this.fps > FPS_PLENTY ? this.plenty + elapsed : 0;
    this.sinceLowered += elapsed;
    if (this.tooSlow > 1.5 && this.quality > QUALITY_LEAST) {
      // A long way short of enough is made up in one step, not in six.
      this.quality = Math.max(QUALITY_LEAST, this.quality - (this.fps < 20 ? 0.3 : 0.15));
      this.sinceLowered = 0;
    } else if (this.plenty > 6 && this.quality < 1 && this.sinceLowered > 25) {
      // Not straight back to where it was just too much: that only goes round again.
      this.quality = Math.min(1, this.quality + 0.15);
    } else {
      return;
    }
    this.tooSlow = 0;
    this.plenty = 0;
    settledQuality = this.quality;
    this.telemetry.quality = this.quality;
    this.stage.setFlightQuality(this.quality);
  }

  /**
   * Stand the camera with the aircraft: in the captain's seat, the head
   * turned as the mouse left it, or outside. Shaken by rough air from the
   * seat (the camera only: the flight is not). And the aircraft drawn as
   * that camera sees it; in the clean view there is none.
   */
  private place(): void {
    const { state, turbulence, time, cloud } = this.telemetry;
    // A wreck is watched from outside, wherever the reader was sitting; the view they chose is theirs again after the cut.
    const view = this.seenView();
    const pose ={ lon: state.lon, lat: state.lat, altitude: state.altitude, heading: state.heading, pitch: state.pitch, roll: state.roll };
    const outside = view === "outside";
    // The seat's lens is the wheel's; the map's camera is given the same one, so the two pictures stay one.
    this.fov = view === "cockpit" ? this.zoomed : FLIGHT_FOV;
    if (get(studioFov) !== this.fov) studioFov.set(this.fov);
    this.moveSurfaces();
    this.moveLevers();
    // Rough air shakes the seat, and so does rolling fast over open ground, and an airframe shaking or losing its surfaces.
    const rumble = state.onGround ? ROLL_SHAKE * Math.min(1, state.tas / ROLL_SHAKE_MS) : 0;
    const shake = this.reducedMotion || outside ? 0 : Math.max(turbulence, rumble, shudder(this.damage).shake);
    const shaken = {
      heading: state.heading + noise(time * 11, 4) * 0.4 * shake,
      pitch: state.pitch + noise(time * 13, 5) * 0.6 * shake,
      roll: state.roll + noise(time * 9, 6) * 0.8 * shake,
    };
    /* Outside, the eye stays over the ground: low down it is not let look up
       from under it. Over the ground where it stands, which is the length of
       the hull and more behind and below the aircraft, not only the ground
       under the aircraft: a runway's far end, a slope, a valley's side. */
    // A wreck's eye stands where it stood when the wreck came down, and neither does one broken up in the air swing round with it.
    const orbit = outside ? this.orbitNow(state) : null;
    const eye = orbit
      ? outsideEye(pose, orbit, orbit.distance)
      : cockpitEye(shaken, this.head, SEAT);
    // What has come off the aircraft, each piece where it has got to, and what burns (damage.ts): nothing for a whole one.
    const wrecked = shown(this.damage, state);
    if (wrecked && this.reducedMotion) wrecked.effects.calm = true;
    this.stage.setFlightCamera(pose, eye);
    this.stage.setAircraft(view === "clean" ? null : {
      modelView: eye.modelView,
      fov: this.fov,
      light: inAircraft(pose, SUN),
      inside: !outside,
      // The cloud round the eye and the lightning on the glass are the weather's to draw, under the aircraft.
      veil: 0,
      flash: 0,
      gear: this.telemetry.gear,
      flaps: state.flaps / FLAPS_MOST,
      spoilers: state.spoilers,
      ...this.surfaces,
      cockpit: this.levers,
      ...wrecked,
    }, outside ? [] : this.screens);
    this.telemetry.marks = view === "clean" ? [] : this.seen(eye, view === "cockpit");

    // The weather going past: carried by the air, which goes the other way to the aircraft.
    const path = (state.flightPath * Math.PI) / 180;
    const course = (state.track * Math.PI) / 180;
    const air = inAircraft(pose, [
      -state.tas * Math.cos(path) * Math.cos(course), -state.tas * Math.cos(path) * Math.sin(course), state.tas * Math.sin(path) + FALL_M_S,
    ]);
    this.travel = [this.travel[0] + air[0] * this.dt, this.travel[1] + air[1] * this.dt, this.travel[2] + air[2] * this.dt];
    const lightning = this.lightning(pose);
    this.telemetry.flash = this.reducedMotion ? 0 : lightning.glare;
    const { rain, hail, ice, frost } = this.telemetry;
    this.stage.setFlightWeather({
      modelView: eye.modelView, fov: this.fov, eye: eye.at, travel: this.travel, air,
      rain, hail, ice,
      // Shreds of cloud where it is thin: at its edge, going in and coming out.
      wisps: Math.min(1, cloud * 3) * (1 - 0.7 * cloud),
      frost: outside ? 0 : frost,
      bolts: this.reducedMotion ? [] : lightning.bolts,
      veil: cloud,
      flash: this.telemetry.flash,
      // Trails form where the air is cold enough to freeze the exhaust at once, and show against clear sky.
      trails: { from: EXHAUSTS, strength: Math.min(1, Math.max(0, (-38 - this.telemetry.temperature) / 6)) * (1 - cloud) },
    }, this.reducedMotion ? null : lightning.glow);
  }

  /** Which control the hand on the flight deck holds: the rudder's pedals and its trim knob move the rudder alike, and only one of them turns. */
  private handOn: CockpitPick["name"] | null = null;

  /**
   * The flight deck's controls, as the frame draws them (levers.ts): the
   * stick and the pedals where the keys, a gamepad, a finger or the mouse
   * put them, the thrust levers where the throttle is, the flap, gear and
   * speed brake levers and the parking brake where they were put.
   */
  private moveLevers(): void {
    const { state, flapLever } = this.telemetry;
    const input = this.input ?? NO_INPUT;
    const trim = this.handOn === "rudderTrim" ? this.hand?.input.yaw ?? 0 : 0;
    const target = leverTargets({
      pitch: input.pitch, roll: input.roll, yaw: trim ? 0 : input.yaw, trim,
      throttle: state.throttle, reverse: state.reverse, alphaFloor: state.alphaFloor,
      flapLever, gearDown: this.gearDown,
      // Held in the air, the speed brake's key is its lever pulled for as long.
      speedBrake: this.speedbrake || (input.brake && !state.onGround), parkingBrake: this.parkingBrake,
    }, this.levers);
    this.levers = easeLevers(this.levers, target, this.dt);
  }

  /**
   * The ailerons, the elevator and the rudder, as the frame draws them: what
   * the fly-by-wire is asking of the roll and the pitch (which is not only
   * what the stick asks: it also flies the turn and the gusts), and the
   * pedals, each reached at a surface's own pace.
   */
  private moveSurfaces(): void {
    const { state } = this.telemetry;
    const unit = (value: number) => Math.min(Math.max(value, -1), 1);
    const wanted = {
      ailerons: unit(state.rollRate / ROLL_RATE),
      elevator: unit(state.pitchRate / PITCH_RATE + (state.onGround ? this.input?.pitch ?? 0 : 0)),
      rudder: unit(this.input?.yaw ?? 0),
    };
    const closing = 1 - Math.exp(-this.dt / 0.12);
    for (const name of ["ailerons", "elevator", "rudder"] as const) {
      this.surfaces[name] += (wanted[name] - this.surfaces[name]) * closing;
    }
  }

  /**
   * Where each marked storm is in the picture this eye sees: those in front
   * of it and on the screen, the nearest first, and none where a nearer
   * one's label already is.
   */
  private seen(eye: Eye, fromSeat = false): Telemetry["marks"] {
    const { state } = this.telemetry;
    const canvas = this.stage.canvas();
    const [width, height] = [canvas?.clientWidth || 1, canvas?.clientHeight || 1];
    const target = this.approach.target;
    const placed: Telemetry["marks"] = [];
    for (const mark of this.marked) {
      const [north, east] = flatOffset(state.lon, state.lat, mark.lon, mark.lat);
      // The world is drawn taller than it is, the aircraft and the mark with it; the eye's own place from the aircraft is not.
      const up = (markAltitude(mark) - state.altitude) * VERTICAL_SCALE;
      const offset: [number, number, number] = [north - eye.north, east - eye.east, -(up - eye.up)];
      const at = seenFrom(eye, offset, this.fov, width / height);
      if (!at || at.x < 0.03 || at.x > 0.97 || at.y < 0.05 || at.y > 0.9) continue;
      // From the seat a storm is marked only where a window shows it: not through the panel, the floor or the roof.
      if (fromSeat && !throughWindows(inAircraft(state, offset))) continue;
      if (placed.some((other) => Math.abs(other.x - at.x) * width < MARK_ROOM[0] && Math.abs(other.y - at.y) * height < MARK_ROOM[1])) continue;
      placed.push({
        mark, x: at.x, y: at.y, distance: Math.hypot(north, east), inspected: mark === this.inspected?.mark,
        target: target !== null && Math.hypot(...flatOffset(target.lon, target.lat, mark.lon, mark.lat)) < MARK_TARGET_M,
      });
    }
    return placed;
  }
}
