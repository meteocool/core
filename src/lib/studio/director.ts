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
  keyframeAt, orbitScene, sample, scansOf, timelapseScene, withKeyframe, withoutKeyframe,
} from "./scene";
import type { Scene, SceneState, StudioCamera } from "./scene";
import { viewCamera } from "./camera";
import type { ViewName } from "./camera";
import logoUrl from "../../assets/logo.svg";
import { download, loadImage, RECORD_FPS, startRecording } from "./record";
import type { Recording } from "./record";
import {
  studioAspect, studioFov, studioLoading, studioPlanes, studioPlayhead, studioPlaying, studioRecording, studioScene,
} from "./store";

/** What of the 3D map a scene is played onto; Cells3DCapability is one. */
export interface Stage {
  studioCamera(): StudioCamera | null;
  setStudioCamera(camera: StudioCamera): void;
  easeStudioCamera(camera: Partial<Pick<StudioCamera, "pitch" | "bearing" | "zoom">>, ms?: number): void;
  stageScan(scan: number | null): Promise<boolean>;
  setDirected(on: boolean): void;
  newestScan3D(): number | null;
  canvas(): HTMLCanvasElement | null;
  onFrame(listener: () => void): () => void;
  repaint(): void;
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

  /** Put a moment of a scene on the map. */
  apply(state: SceneState): void {
    this.stage.setStudioCamera(state.camera);
    if (get(studioFov) !== state.camera.fov) studioFov.set(state.camera.fov);
    // Only when they differ: every write redraws their sheets and handles.
    if (JSON.stringify(get(studioPlanes)) !== JSON.stringify(state.planes)) studioPlanes.set(state.planes);
    peelManual.set(true);
    if (get(peelLevel) !== state.peel) peelLevel.set(state.peel);
    // The store, not the setting: a scene's style is the scene's, not the reader's choice for next time.
    if (get(cloudStyle) !== state.style) cloudStyle.set(state.style);
    this.showScan(state.scan);
  }

  /** Put a scan's storms on the map; whether it is there once everything of it has loaded. */
  showScan(scan: number | null): Promise<boolean> {
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
    if (!scans.length) return true;
    const token = Symbol("load");
    this.playing = token;
    this.stage.setDirected(true);
    try {
      for (const [index, { scan, at }] of scans.entries()) {
        studioLoading.set({ done: index, of: scans.length });
        this.seek(at);
        // `seek` asked for it; this is the same scan, awaited.
        this.asked = undefined;
        await this.showScan(scan);
        if (this.playing !== token) return false;
      }
      return true;
    } finally {
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
   */
  async play(): Promise<void> {
    const scene = get(studioScene);
    if (!scene.keyframes.length) return;
    if (!(await this.load())) return;
    const from = get(studioPlayhead) >= scene.duration - 1e-3 ? 0 : get(studioPlayhead);
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
    const source = this.stage.canvas();
    if (!scene.keyframes.length || !source) return false;
    if (!(await this.load())) return false;
    const logo = await loadImage(logoUrl);
    studioRecording.set(0);
    this.seek(0);
    // A frame with the opening on it, before anything is recorded.
    await nextFrame();
    const recording = startRecording({
      source,
      aspect: get(studioAspect),
      eachFrame: (listener) => this.stage.onFrame(listener),
      caption: () => this.caption(),
      credits,
      badge: { logo, name: "meteocool.com", tagline: t("studio.video.tagline"), pitch: t("studio.video.pitch") },
    });
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
    const { blob, extension } = await recording.finish();
    studioRecording.set(null);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    download(blob, `meteocool-studio-${stamp}.${extension}`);
    return true;
  }

  /** The time of the scan on the map, as a recording says it: the reader's own date and clock. */
  private caption(): string {
    const { shown, newest } = get(cloudsTime);
    const scan = shown ?? newest;
    if (scan === null) return "";
    return new Date(scan * 1000).toLocaleString(currentLocale(), {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }

  /** Studio closed: stop whatever is running, and forget what this visit loaded, which the map has let go of. */
  dispose(): void {
    this.pause();
    this.unsubscribe();
    this.asked = undefined;
    this.ready.clear();
  }
}
