/**
 * Plays a Studio scene onto the 3D map.
 *
 * The scene says what the map holds at each second (scene.ts); this asks it,
 * frame after frame, and puts the answer on the map: the camera where it
 * says, the planes, the style, the peel, the scan. It also goes the other way, reading
 * the map as it stands into a keyframe, and it records a scene to a video.
 *
 * The map is the 3D capability's, reached through `Stage`, which is all of
 * it this needs.
 */
import { get } from "svelte/store";
import { cloudStyle, cloudsTime, peelLevel, peelManual } from "../../stores";
import { currentLocale, t } from "../../locale/t";
import {
  keyframeAt, orbitScene, pairsOf, sample, SCAN_SECONDS, scansOf, timelapseScene, withKeyframe, withoutKeyframe,
} from "./scene";
import type { Moment, Scene, SceneState, StudioCamera } from "./scene";
import { viewCamera } from "./camera";
import type { ViewName } from "./camera";
import type { AircraftScreen, AircraftView, TrafficPass, WeatherView } from "../../layers/aircraftLayer";
import type { StormMark } from "./flight/marks";
import logoUrl from "../../assets/logo.svg";
import { download, loadImage, RECORD_FPS, startRecording } from "./record";
import type { Recording } from "./record";
import {
  studioAspect, studioFov, studioLoading, studioPlanes, studioPlayhead, studioPlaying, studioRecording, studioScene,
} from "./store";

/**
 * Where the aircraft of Studio's flight is and how it sits (lib/studio/flight):
 * true metres above sea level, degrees, nose up and right wing down positive.
 */
export interface FlightPose {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
}

type RouteSection = import("./flight/routeSection").RouteSection;

/** The ways a flight looks into a storm; see `Stage.inspectStorm`. */
export type InspectMode = "cut" | "peel" | "xray";

/** Where a flight's cut through a storm stands: a point, and the compass direction of the side taken away. */
export interface FlightCut {
  lon: number;
  lat: number;
  facingDeg: number;
  /** How far it reaches to either side of its point, km, as it is drawn. */
  halfKm: number;
}

/**
 * Where the eye of a flight is, when it is not simply the aircraft's own
 * nose: turned in the cockpit, or standing outside it (flight/view.ts).
 */
export interface FlightEye {
  /** Which way it looks, as an aircraft's attitude is said. */
  heading: number;
  pitch: number;
  roll: number;
  /** Where it stands from the aircraft, true metres. */
  north: number;
  east: number;
  up: number;
}

/**
 * Studio's own code that the map calls while Studio is open; see
 * support.ts, which is where it is gathered and why.
 */
export interface StudioSupport {
  makeStudioPlanesLayer: typeof import("../../layers/studioPlanesLayer").makeStudioPlanesLayer;
  clipPlanes: typeof import("./planes").clipPlanes;
  isLevel: typeof import("./planes").isLevel;
}

/**
 * The flight's own code that the map calls while one is under way; see
 * flight/support.ts, which is where it is gathered and why.
 */
export interface FlightSupport {
  flightWanted: typeof import("./flight/selection").flightWanted;
  flightFine: typeof import("./flight/selection").flightFine;
  nearEnoughForFine: typeof import("./flight/selection").nearEnoughForFine;
  withinHold: typeof import("./flight/selection").withinHold;
  reflectivityAt: typeof import("./flight/weather").reflectivityAt;
  /** The section along the aircraft's track; see flight/routeSection.ts. */
  trackSection: typeof import("./flight/routeSection").trackSection;
  makeAircraftLayer: typeof import("../../layers/aircraftLayer").makeAircraftLayer;
  /** Where the aircraft's model and textures are served from. */
  aircraftFiles: string;
  destination: typeof import("./flight/geo").destination;
  distanceM: typeof import("./flight/geo").distanceM;
  /** The sky of a flight with its clouds beginning so high, km, for the storm layer to draw the white cloud from; see flight/cloudscape.ts. */
  cloudscape: (baseKm: number) => string;
  /** What that sky draws besides its clouds: its sun, and the picture the clouds are drawn in. */
  makeScenicPass: typeof import("../../layers/scenicPass").makeScenicPass;
  /** The mountain peaks charted on the ground while flying; see flight/peaks.ts. */
  peaks: typeof import("./flight/peaks").peaks;
  /** Lakes, rivers and the sea drawn as water, with the sky and the sun in them; see flight/water.ts. */
  water: typeof import("./flight/water").water;
}

/** A listed volume, as the flight aims at and charts one. */
export interface StormTileInfo {
  lon: number;
  lat: number;
  peakDbz: number | null;
  areaKm2: number | null;
  coarse: boolean;
  tile: readonly number[] | null;
  /** The radars it was built from, by their codes; none where the list does not say. */
  sites?: readonly string[];
}

/** What of the 3D map a scene is played onto, and flown over; Cells3DCapability is one. */
export interface Stage {
  studioCamera(): StudioCamera | null;
  setStudioCamera(camera: StudioCamera): void;
  easeStudioCamera(camera: Partial<Pick<StudioCamera, "pitch" | "bearing" | "zoom">>, ms?: number): void;
  stageScan(scan: number | null): Promise<boolean>;
  blendScans(blend: { from: number; to: number; fraction: number } | null): void;
  prepareBlend(from: number, to: number): void;
  setDirected(on: boolean): void;
  newestScan3D(): number | null;
  canvas(): HTMLCanvasElement | null;
  onFrame(listener: () => void): () => void;
  repaint(): void;
  /**
   * Put the map into the flight, or take it back out exactly as it was: a
   * free camera that may look at and above the horizon, no hand on the map,
   * a sky, and the storms chosen from the aircraft rather than the screen.
   */
  setFlying(on: boolean, support?: FlightSupport): void;
  /** Hand the map what of Studio's own code it calls: what cuts storms by its planes, and draws them. */
  setStudioSupport(support: StudioSupport): void;
  /**
   * Stand the camera with the aircraft: one frame of the flight. At its
   * nose, looking where it points, or where `eye` says.
   */
  setFlightCamera(pose: FlightPose, eye?: FlightEye): void;
  /**
   * The weather going past the eye this frame, for the map to draw under the
   * aircraft (layers/weatherPass.ts); and a light inside the clouds, where
   * lightning is: a place, its height in km, and how bright, 0 to 1.
   */
  setFlightWeather(weather: WeatherView | null, glow?: { lon: number; lat: number; km: number; brightness: number } | null): void;
  /** Other aircraft, drawn into the flight's picture under its own (layers/aircraftLayer.ts); none for null. */
  setTraffic(traffic: TrafficPass | null): void;
  /** Every lightning strike within `km` of a place since `since`, ms since the epoch: where, and when. */
  strikesNear(lon: number, lat: number, km: number, since: number): Array<{ lon: number; lat: number; at: number }>;
  /** Every lightning strike the map holds since `since`, ms since the epoch, wherever it struck; outside a flight too. */
  strikesSince(since: number): Array<{ lon: number; lat: number; at: number }>;
  /**
   * Draw the flight at this share of its full sharpness, 1 down to about a
   * quarter: fewer pixels and coarser clouds, for a machine that cannot keep up.
   */
  setFlightQuality(share: number): void;
  /** Have the clouds of a flight begin this high, kilometres above the sea (flight/cloudBase.ts). */
  setCloudBase(km: number): void;
  /** Paint the radar's picture on the ground under the storms, or leave the ground as the basemap has it. */
  setRadarOnGround(on: boolean): void;
  /**
   * The radar's picture as it is draped on the ground now, painted or not:
   * a tile template (`{z}/{x}/{y}`) for each radar in it, for
   * layers/maskedTiles.ts `loadMaskedTile` to answer.
   */
  radarTiles(): string[];
  /**
   * Look into the storm at a place, or into none for null: `cut` open by an
   * upright section plane, drawn where it stands, through `cut`'s point with
   * the side `facingDeg` points to taken away; `peel`ed towards its core in
   * the radar's colours, as far as `peel` (0 to 1, as the map's own peel) where
   * given; or left as it is with its core showing through it (`xray`).
   * Whether there is a storm drawn there to look into.
   */
  inspectStorm(target: { lon: number; lat: number; mode: InspectMode; cut: FlightCut | null; peel?: number } | null): boolean;
  /**
   * The section along a track, read from the volumes held now
   * (flight/routeSection.ts): from a little behind `from` to far ahead of
   * it, with its height marked. Null outside a flight.
   */
  sectionAhead(from: { lon: number; lat: number; track: number; altitude: number }): RouteSection | null;
  /** The storm cells the radar network tracks, as marks for the view (flight/marks.ts); none where it tracks none. */
  trackedCells(): StormMark[];
  /** Draw the aircraft as this camera sees it, or not at all for null (layers/aircraftLayer.ts). */
  setAircraft(view: AircraftView | null, screens?: AircraftScreen[]): void;
  /** The ground's height at a point, true metres; null where the map has none loaded there. */
  groundElevation(lon: number, lat: number): number | null;
  /** Every listed volume, for the flight to aim at and chart. */
  stormTiles(): StormTileInfo[];
  /** The reflectivity at a point from the volumes held, dBZ; null where none reaches. */
  reflectivityAt(lon: number, lat: number, altitude: number): number | null;
  /** When the newest strike within `km` of a point struck, ms since the epoch; null with none recent. */
  strikeNear(lon: number, lat: number, km: number): number | null;
}

/**
 * Start recording the map, as Studio records: the frame `studioAspect`
 * chooses, the time as `caption` says it, the `credits`, and the badge.
 * Null where the map has no canvas yet.
 */
export async function recordStage(
  stage: Stage, credits: string, caption: () => string, audio: MediaStream | null = null,
): Promise<Recording | null> {
  const source = stage.canvas();
  if (!source) return null;
  const logo = await loadImage(logoUrl);
  return startRecording({
    source,
    aspect: get(studioAspect),
    eachFrame: (listener) => stage.onFrame(listener),
    caption,
    credits,
    badge: { logo, name: "meteocool.com", tagline: t("studio.video.tagline"), pitch: t("studio.video.pitch") },
    audio,
  });
}

/** Stop a recording and hand it to the reader as a download. */
export async function saveRecording(recording: Recording): Promise<void> {
  const { blob, extension } = await recording.finish();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  download(blob, `meteocool-studio-${stamp}.${extension}`);
}

/**
 * A scan's time as a recording says it: the reader's own date and clock.
 * `moment` is the time between two scans a scene stands at, if it does.
 */
export function captionOf(moment: number | null = null): string {
  const { shown, newest } = get(cloudsTime);
  const scan = moment ?? shown ?? newest;
  if (scan === null) return "";
  return new Date(scan * 1000).toLocaleString(currentLocale(), {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** How far back a time-lapse made with one click starts: an hour. */
const TIMELAPSE_SECONDS = 3600;

const nextFrame = () => new Promise<number>((resolve) => { requestAnimationFrame(resolve); });

export class Director {
  /** The scan last asked of the stage, so a frame that wants the same one asks nothing. */
  private asked: number | null | undefined = undefined;

  /** The scans this visit has had on the map in full, which come back at once. */
  private ready = new Set<number | null>();

  /** The running playback, so a newer one or a pause ends it. */
  private playing: symbol | null = null;

  /** Whether `load` is putting the scene's scans on the map one by one. */
  private loading = false;

  /** The time the storms on the map are at, between two scans; null when they stand on one. */
  private moment: number | null = null;

  private recording: Recording | null = null;

  private readonly unsubscribe: () => void;

  constructor(private readonly stage: Stage) {
    // A scene changed may have the camera elsewhere when a scan comes up, where
    // other storms stand: each is looked at again before it next plays. One
    // already held comes back at once, so this costs a moment, not a wait.
    this.unsubscribe = studioScene.subscribe(() => this.ready.clear());
  }

  /** The map as it stands; null before it is up. */
  capture(): SceneState | null {
    const camera = this.stage.studioCamera();
    if (!camera) return null;
    return {
      camera,
      planes: get(studioPlanes).map((plane) => ({ ...plane })),
      peel: get(peelLevel),
      scan: get(cloudsTime).shown,
      style: get(cloudStyle),
    };
  }

  /**
   * Put a moment of a scene on the map: between two scans, the scan the
   * storms set off from, and both drawn at once as far on as the moment is.
   */
  apply(state: Moment): void {
    this.stage.setStudioCamera(state.camera);
    if (get(studioFov) !== state.camera.fov) studioFov.set(state.camera.fov);
    // Only when they differ: every write redraws their sheets and handles.
    if (JSON.stringify(get(studioPlanes)) !== JSON.stringify(state.planes)) studioPlanes.set(state.planes);
    peelManual.set(true);
    if (get(peelLevel) !== state.peel) peelLevel.set(state.peel);
    // The store, not the setting: a scene's style is the scene's, not the reader's choice for next time.
    if (get(cloudStyle) !== state.style) cloudStyle.set(state.style);
    void this.stageScan(state.scan);
    // Not while loading: each scan is put on the map alone then, to be drawn with its neighbours after.
    const { toward } = state;
    this.moment = toward && state.scan !== null ? state.scan + toward.fraction * SCAN_SECONDS : null;
    this.stage.blendScans(toward && state.scan !== null && !this.loading
      ? { from: state.scan, to: toward.scan, fraction: toward.fraction }
      : null);
  }

  /** Put one scan's storms on the map, alone; whether it is there once everything of it has loaded. */
  showScan(scan: number | null): Promise<boolean> {
    this.moment = null;
    this.stage.blendScans(null);
    return this.stageScan(scan);
  }

  private stageScan(scan: number | null): Promise<boolean> {
    if (scan === this.asked) return Promise.resolve(true);
    this.asked = scan;
    return this.stage.stageScan(scan).then((shown) => {
      if (shown) this.ready.add(scan);
      return shown;
    }, () => false);
  }

  /** Turn the camera to one of the named views, about what it is looking at. */
  lookFrom(view: ViewName): void {
    const camera = this.stage.studioCamera();
    if (camera) this.stage.easeStudioCamera(viewCamera(view, camera.bearing));
  }

  /** Move the playhead, and the map with it where the scene has keyframes. */
  seek(at: number): void {
    const scene = get(studioScene);
    const clamped = Math.min(Math.max(at, 0), scene.duration);
    studioPlayhead.set(clamped);
    const state = sample(scene, clamped);
    if (state) this.apply(state);
  }

  /** Keep the map as it stands at the playhead: a new keyframe, or the one there replaced. */
  addKeyframe(): void {
    const state = this.capture();
    if (!state) return;
    studioScene.update((scene) => withKeyframe(scene, { ...state, at: get(studioPlayhead) }));
  }

  /** Take the keyframe under the playhead out, if there is one. */
  removeKeyframe(): void {
    studioScene.update((scene) => {
      const index = keyframeAt(scene, get(studioPlayhead));
      return index === null ? scene : withoutKeyframe(scene, index);
    });
  }

  /**
   * A scene of one slow turn round what the camera is looking at, in place
   * of the one there. Its own length, not the scene's: a turn in the twelve
   * seconds a new scene runs is a blur. The length can be changed after.
   */
  makeOrbit(): void {
    const state = this.capture();
    if (!state) return;
    this.replaceScene(orbitScene(state));
  }

  /** A scene of the last hour of storms from where the camera stands, in place of the one there. */
  makeTimelapse(): void {
    const state = this.capture();
    const newest = this.stage.newestScan3D();
    if (!state || newest === null) return;
    const to = state.scan ?? newest;
    this.replaceScene(timelapseScene(state, to - TIMELAPSE_SECONDS, to, get(studioScene).duration));
  }

  replaceScene(scene: Scene): void {
    this.pause();
    studioScene.set(scene);
    studioPlayhead.set(0);
  }

  /**
   * Have every scan the scene shows on the map once, with the camera where
   * the scene has it by then, so playing it afterwards fetches nothing.
   * Whether it ran to the end.
   */
  async load(): Promise<boolean> {
    const scene = get(studioScene);
    const scans = scansOf(scene).filter(({ scan }) => !this.ready.has(scan));
    // And the storms' motion between each two, worked out now rather than on the frame each pair comes up.
    const prepare = () => {
      for (const { from, to } of pairsOf(scene)) this.stage.prepareBlend(from, to);
    };
    if (!scans.length) {
      prepare();
      return true;
    }
    const token = Symbol("load");
    this.playing = token;
    this.stage.setDirected(true);
    this.loading = true;
    // Where the reader had the playhead, for the scene to be back at once loaded.
    const playhead = get(studioPlayhead);
    try {
      for (const [index, { scan, at }] of scans.entries()) {
        studioLoading.set({ done: index, of: scans.length });
        this.seek(at);
        // `seek` asked for the scan the storms set off from, which may be
        // the one before this; this one, awaited.
        this.asked = undefined;
        await this.stageScan(scan);
        if (this.playing !== token) return false;
      }
      prepare();
      // Loading walked the playhead through the scene; it goes back where it was.
      this.loading = false;
      this.seek(playhead);
      return true;
    } finally {
      this.loading = false;
      studioLoading.set(null);
      if (this.playing === token) {
        this.playing = null;
        this.stage.setDirected(false);
      }
    }
  }

  /**
   * Play the scene from the playhead to its end, or from its start if the
   * playhead is at the end. Loads its scans first.
   *
   * From where the playhead was before the load: loading leaves it on the
   * last scan it loaded, and the first play of a time-lapse played its last
   * second.
   */
  async play(): Promise<void> {
    const scene = get(studioScene);
    if (!scene.keyframes.length) return;
    const playhead = get(studioPlayhead);
    if (!(await this.load())) return;
    const from = playhead >= scene.duration - 1e-3 ? 0 : playhead;
    await this.run(from, () => {});
  }

  pause(): void {
    this.playing = null;
    studioPlaying.set(false);
    this.stage.setDirected(false);
    this.recording?.cancel();
    this.recording = null;
    studioRecording.set(null);
  }

  /** Step the scene from `from` to its end as the clock runs, a frame at a time. Whether it got there. */
  private async run(from: number, eachFrame: (at: number) => void): Promise<boolean> {
    const token = Symbol("play");
    this.playing = token;
    studioPlaying.set(true);
    this.stage.setDirected(true);
    const { duration } = get(studioScene);
    this.seek(from);
    let started: number | null = null;
    try {
      for (;;) {
        const now = await nextFrame();
        if (this.playing !== token) return false;
        started ??= now;
        const at = Math.min(from + (now - started) / 1000, duration);
        this.seek(at);
        eachFrame(at);
        if (at >= duration) return true;
      }
    } finally {
      if (this.playing === token) {
        this.playing = null;
        studioPlaying.set(false);
        this.stage.setDirected(false);
      }
    }
  }

  /**
   * Record the whole scene to a video and hand it over as a download. The
   * frame is the part of the map `studioAspect` frames; `credits` is drawn
   * into it. Whether a video was made.
   */
  async record(credits: string): Promise<boolean> {
    const scene = get(studioScene);
    if (!scene.keyframes.length || !this.stage.canvas()) return false;
    if (!(await this.load())) return false;
    studioRecording.set(0);
    this.seek(0);
    // A frame with the opening on it, before anything is recorded.
    await nextFrame();
    const recording = await recordStage(this.stage, credits, () => captionOf(this.moment));
    if (!recording) return false;
    this.recording = recording;
    const finished = await this.run(0, (at) => {
      studioRecording.set(at / scene.duration);
      // A frame every tick, moved or not: a still camera is still a second of video.
      this.stage.repaint();
    });
    if (!finished || this.recording !== recording) return false;
    // The last frame held for a moment, so the video does not end on the cut.
    for (let frame = 0; frame < RECORD_FPS / 2; frame += 1) {
      this.stage.repaint();
      await nextFrame();
    }
    this.recording = null;
    await saveRecording(recording);
    studioRecording.set(null);
    return true;
  }

  /** Studio closed: stop whatever is running, and forget what this visit loaded, which the map has let go of. */
  dispose(): void {
    this.pause();
    this.unsubscribe();
    this.asked = undefined;
    this.ready.clear();
  }
}
