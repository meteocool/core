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
import type { CloudStyle } from "../../cloudStyle";
import { captionOf, recordStage, saveRecording } from "../director";
import type { InspectMode, Stage, StormTileInfo } from "../director";
import type { Recording } from "../record";
import { flightStatus, INITIAL_FLIGHT_STATUS, studioFlying, studioFov, studioOpen } from "../store";
import type { FlightStatus, FlightWarning } from "../store";
import { indicatedFromTrue, machOf } from "./atmosphere";
import { Keys } from "./controls";
import type { FlightAction } from "./controls";
import { levelFlight, MAX_DT, moveGear, overspeed, step, terrainAhead } from "./physics";
import type { AircraftState } from "./physics";
import { approachOf } from "./plan";
import type { FlightPlan } from "./plan";
import { chooseApproach, START_TAS, towards } from "./spawn";
import type { Approach } from "./spawn";
import { USUAL_BASE_KM } from "./cloudBase";
import { cloudBaseAt } from "./stationAir";
import { EXHAUSTS, SEAT, SUN, throughWindows } from "./cockpit";
import { FLIGHT_SUPPORT } from "./support";
import { coresOf, echoTop, flatOffset, MARK_APART_KM, MARK_REACH_KM, markAltitude, marksNear, MARKS_SHOWN } from "./marks";
import { bearingDeg, destination, distanceM } from "./geo";
import type { StormMark } from "./marks";
import { cockpitEye, inAircraft, outsideEye, seenFrom } from "./view";
import type { Attitude as FlightAttitude, Eye, Look } from "./view";
import { VERTICAL_SCALE } from "../../../layers/terrain";
import { airAt, noise, roughAir } from "./weather";
import { boltPaths, FLASH_S, flicker, glare, thunderDelay } from "./lightning";
import type { Bolt } from "../../../layers/weatherPass";
import { FlightSound } from "./sound";
import type { AircraftScreen } from "../../../layers/aircraftLayer";

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
/** The longest a frame is taken to have been, seconds. */
const LONGEST_FRAME_S = 8;

/** The sharpness the last flight settled at: the next one on this machine starts there, not at the top again. */
let settledQuality = 1;

/** How often the cloud base is asked for again, seconds flown: the aircraft has come to other air by then. */
const BASE_S = 120;

/** The ways of looking into a storm, in the order the key takes them. */
const INSPECT_MODES: InspectMode[] = ["cut", "peel", "xray"];

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

/** How far a pixel of mouse turns the eye, degrees. */
const LOOK_PER_PX = 0.16;

const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);

/** How many times the ground distance Shift covers. */
export const WARP = 4;

/** Below this height over the ground, the radar altimeter reads out: 2,500 ft. */
const LOW_M = 762;

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
  /** Whether the speed brake is out. */
  brake: boolean;
  /** How far the landing gear is down, 0 up to 1 down: on its way between (G). */
  gear: number;
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
  /** Which of the ranked storm systems is flown at; `N` moves on. */
  private systemIndex = 0;
  private autopilot: number | null = null;
  /** Whether the reader has asked for the gear down (G); it gets there at its own pace. A flight starts in the air, gear up. */
  private gearDown = false;
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
  /** The cockpit's live screens, which the deck draws; see `setScreens`. */
  private screens: AircraftScreen[] = [];
  /** The storms marked in the view, chosen now and then (`slow`) and placed every frame (`seen`). */
  private marked: StormMark[] = [];
  /** The storm being looked into, and how; see `inspect`. */
  private inspected: { mark: StormMark; mode: InspectMode } | null = null;
  /** What the flight sounds like (sound.ts); from take-off to landing. */
  private sound: FlightSound | null = null;

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
      cloud: 0, rain: 0, turbulence: 0, hail: 0, ice: 0, frost: 0, draft: 0, temperature: 0, fps: 60, quality: 1,
      storms: stage.stormTiles(), marks: [], fade: 0, flash: 0, brake: false, time: 0, gear: 0,
    };
  }

  /** Take off: the map into the flight, the cockpit's style and lens, and the loop running. */
  start(): void {
    this.stage.setFlying(true, FLIGHT_SUPPORT);
    this.stage.setRadarOnGround(this.flightPlan.radarOnGround);
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

  /** Be told after every frame, with the telemetry; returns how to stop. */
  onFrame(listener: (telemetry: Telemetry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Do what a key press asks; the deck's buttons call this too. */
  act(action: FlightAction): void {
    switch (action) {
      case "leave":
        this.options.onLeave();
        break;
      case "autopilot":
        this.autopilot = this.autopilot === null ? this.telemetry.state.altitude : null;
        this.status({ autopilot: this.autopilot !== null });
        break;
      case "next":
        this.systemIndex += 1;
        this.approach = this.another();
        this.tas = START_TAS;
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
        this.gearDown = !this.gearDown;
        break;
      case "help":
        if (this.keysTimer !== null) clearTimeout(this.keysTimer);
        this.keysTimer = null;
        this.status({ keys: !get(flightStatus).keys });
        break;
    }
    // Its click, and a pause's or a recording's sound; after leaving, there is none.
    this.sound?.act(action, get(flightStatus));
  }

  /**
   * Look into a marked storm, by its place among the marks in the view: cut
   * open across the line of sight, to begin with. The one already looked
   * into is let go of instead.
   */
  inspect(index: number): void {
    const seen = this.telemetry.marks[index];
    if (!seen) return;
    this.lookInto(seen.inspected ? null : { mark: seen.mark, mode: this.inspected?.mode ?? "cut" });
  }

  /** Look into the storm another way, or let go of it for null. */
  inspectAs(mode: InspectMode | null): void {
    this.lookInto(mode && this.inspected ? { mark: this.inspected.mark, mode } : null);
  }

  /**
   * The key's turn: the storm flown at, or the one nearest the middle of the
   * view, cut open; then peeled, then seen through, then left alone again.
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
    if (chosen) this.lookInto({ mark: chosen.mark, mode: "cut" });
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

  /** Turn the eye by a drag of the mouse, in pixels: the head in its seat, or the eye round the aircraft. */
  lookBy(dx: number, dy: number): void {
    if (get(flightStatus).view === "outside") {
      // Dragging the picture: the eye goes the other way round.
      this.orbit = { yaw: (this.orbit.yaw - dx * LOOK_PER_PX * 1.6) % 360, pitch: clamp(this.orbit.pitch - dy * LOOK_PER_PX * 1.6, ORBIT_PITCH) };
    } else {
      this.head = {
        yaw: clamp(this.head.yaw + dx * LOOK_PER_PX, [-HEAD_YAW, HEAD_YAW]),
        pitch: clamp(this.head.pitch - dy * LOOK_PER_PX, HEAD_PITCH),
      };
    }
    if (this.paused) this.refresh();
  }

  /** Stand nearer or further off, outside: a wheel's turn. */
  zoomBy(steps: number): void {
    if (get(flightStatus).view !== "outside") return;
    this.distance = clamp(this.distance * 1.12 ** steps, OUTSIDE_RANGE);
    if (this.paused) this.refresh();
  }

  /** Look where the view began again. */
  recentre(): void {
    this.head = { ...COCKPIT_LOOK };
    this.orbit = { ...OUTSIDE_LOOK };
    this.distance = OUTSIDE_DISTANCE;
    if (this.paused) this.refresh();
  }

  /** The pictures on the cockpit's screens, drawn by the deck every frame. */
  setScreens(screens: AircraftScreen[]): void {
    this.screens = screens;
  }

  /** The approach to the next system down the list, from the storms listed now. */
  private another(): Approach {
    return chooseApproach(this.stage.stormTiles(), this.look, this.systemIndex, (lon, lat) => this.stage.groundElevation(lon, lat));
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
    if (this.paused) {
      if (this.recording) this.stage.repaint();
      return;
    }
    const telemetry = this.telemetry;
    const input = this.keys.read();
    if (this.autopilot !== null && Keys.moving(input)) this.act("autopilot");

    if (this.fading) this.fade(dt);
    else this.fly(input, dt);

    telemetry.time += dt;
    if (telemetry.time - this.slowAt >= SLOW_S) this.slow();
    this.place();
    for (const listener of this.listeners) listener(telemetry);
    this.sound?.update(telemetry, get(flightStatus), dt);
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
    const rough = this.flightPlan.turbulence;
    const turbulence = rough ? air.turbulence : 0;
    const env = {
      warp: input.warp ? WARP : 1, gust: roughAir(telemetry.time, turbulence, rough ? air.draft : 0), autopilot: this.autopilot,
      gear: telemetry.gear,
    };
    for (let left = dt; left > 1e-6; left -= MAX_DT) state = step(state, input, Math.min(left, MAX_DT), env);
    // An autopilot does not fly a stall.
    if (state.stalled && this.autopilot !== null) this.act("autopilot");

    const ground = this.stage.groundElevation(state.lon, state.lat);
    // Over the sea the terrain may be drawn below it; the water is the floor.
    const floor = Math.max(ground ?? 0, 0);
    if (state.altitude <= floor) {
      // No crash: the approach again, through black.
      state = { ...state, altitude: floor };
      this.cut();
    }
    telemetry.state = state;
    telemetry.ground = ground;
    telemetry.radarAltitude = state.altitude - floor;
    telemetry.ias = indicatedFromTrue(state.tas, state.altitude);
    telemetry.mach = machOf(state.tas, state.altitude);
    telemetry.dbz = dbz;
    telemetry.turbulence = turbulence;
    telemetry.brake = input.brake;
    telemetry.gear = moveGear(telemetry.gear, this.gearDown, dt);
    this.status({ gear: telemetry.gear <= 0 ? "up" : telemetry.gear >= 1 ? "down" : "moving" });
    // Cloud thickens and thins over half a second or so, as it does past the glass.
    telemetry.cloud += (air.cloud - telemetry.cloud) * (1 - Math.exp(-dt / 0.5));
    telemetry.rain += (air.rain - telemetry.rain) * (1 - Math.exp(-dt / 0.3));
    telemetry.hail += (air.hail - telemetry.hail) * (1 - Math.exp(-dt / 0.3));
    telemetry.ice += (air.ice - telemetry.ice) * (1 - Math.exp(-dt / 0.6));
    telemetry.draft = rough ? air.draft : 0;
    telemetry.temperature = air.temperature;
    // Ice takes a couple of minutes to cover the glass, and goes nearly as slowly once the aircraft is out of what made it.
    telemetry.frost = Math.min(1, Math.max(0, telemetry.frost + (air.icing > 0.05 ? air.icing / 150 : -1 / 110) * dt));
    const target = this.approach.target;
    if (target) {
      const { bearing, distance } = towards(state.lon, state.lat, target);
      const speed = state.tas * (input.warp ? WARP : 1);
      telemetry.target = { bearing, distance, seconds: distance / Math.max(speed, 1), peakDbz: target.peakDbz };
    } else {
      telemetry.target = null;
    }
    const warnings: FlightWarning[] = [];
    if (this.terrain) warnings.push("terrain");
    if (state.stalled) warnings.push("stall");
    if (overspeed(state, telemetry.ias)) warnings.push("overspeed");
    if (telemetry.frost > 0.35) warnings.push("ice");
    this.status({ warnings, warp: input.warp, low: telemetry.radarAltitude < LOW_M });
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
      this.autopilot = null;
      this.terrain = false;
      // Back at the start of the approach, in the air: gear up.
      this.gearDown = false;
      this.telemetry.gear = 0;
      this.status({ gear: "up" });
      this.status({ autopilot: false, warnings: [], clearSky: this.approach.target === null });
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
    } else if (this.plenty > 10 && this.quality < 1 && this.sinceLowered > 45) {
      // Not straight back to where it was just too much: that only goes round again.
      this.quality = Math.min(1, this.quality + 0.1);
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
    const { view } = get(flightStatus);
    const pose = { lon: state.lon, lat: state.lat, altitude: state.altitude, heading: state.heading, pitch: state.pitch, roll: state.roll };
    const outside = view === "outside";
    const shake = this.reducedMotion || outside ? 0 : turbulence;
    const shaken = {
      heading: state.heading + noise(time * 11, 4) * 0.4 * shake,
      pitch: state.pitch + noise(time * 13, 5) * 0.6 * shake,
      roll: state.roll + noise(time * 9, 6) * 0.8 * shake,
    };
    const eye = outside ? outsideEye(pose, this.orbit, this.distance) : cockpitEye(shaken, this.head, SEAT);
    this.stage.setFlightCamera(pose, eye);
    this.stage.setAircraft(view === "clean" ? null : {
      modelView: eye.modelView,
      fov: FLIGHT_FOV,
      light: inAircraft(pose, SUN),
      inside: !outside,
      // The cloud round the eye and the lightning on the glass are the weather's to draw, under the aircraft.
      veil: 0,
      flash: 0,
      gear: this.telemetry.gear,
    }, outside ? [] : this.screens);
    this.telemetry.marks = view === "clean" ? [] : this.seen(eye, view === "cockpit");

    // The weather going past: carried by the air, which goes the other way to the aircraft.
    const path = (state.flightPath * Math.PI) / 180;
    const course = (state.heading * Math.PI) / 180;
    const air = inAircraft(pose, [
      -state.tas * Math.cos(path) * Math.cos(course), -state.tas * Math.cos(path) * Math.sin(course), state.tas * Math.sin(path) + FALL_M_S,
    ]);
    this.travel = [this.travel[0] + air[0] * this.dt, this.travel[1] + air[1] * this.dt, this.travel[2] + air[2] * this.dt];
    const lightning = this.lightning(pose);
    this.telemetry.flash = this.reducedMotion ? 0 : lightning.glare;
    const { rain, hail, ice, frost } = this.telemetry;
    this.stage.setFlightWeather({
      modelView: eye.modelView, fov: FLIGHT_FOV, eye: eye.at, travel: this.travel, air,
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
      const at = seenFrom(eye, offset, FLIGHT_FOV, width / height);
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
