import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeStudio, DEFAULT_FOV, emptyScene, encodeStudio, keyframeAt, ORBIT_DURATION, orbitScene, sample, scansOf,
  STUDIO_MAX_PITCH,
  timelapseScene, unwound, withDuration, withKeyframe, withoutKeyframe,
} from "../../src/lib/studio/scene.ts";
import type { Keyframe, SceneState } from "../../src/lib/studio/scene.ts";
import type { SectionPlane } from "../../src/lib/studio/planes.ts";
import { cropOf, outputSize } from "../../src/lib/studio/record.ts";
import { LENS_FOV, lensOf, viewCamera, VIEWS } from "../../src/lib/studio/camera.ts";

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

const SCAN = Date.UTC(2026, 10, 18, 23, 0) / 1000;

const plane = (patch: Partial<SectionPlane> = {}): SectionPlane => ({
  id: 1, lon: 10, lat: 50, heightKm: 0, facingDeg: 0, tiltDeg: 0, slabKm: null, enabled: true, ...patch,
});

const state = (patch: Partial<SceneState> = {}, camera: Partial<SceneState["camera"]> = {}): SceneState => ({
  camera: { lon: 10, lat: 50, zoom: 8, pitch: 55, bearing: 0, fov: DEFAULT_FOV, ...camera },
  planes: [],
  peel: 0,
  scan: null,
  style: "cloud",
  ...patch,
});
const keyframe = (at: number, patch: Partial<SceneState> = {}, camera: Partial<SceneState["camera"]> = {}): Keyframe => ({
  ...state(patch, camera), at,
});

test("a scene with no keyframes decides nothing", () => {
  assert.equal(sample(emptyScene(), 3), null);
});

test("keyframes stay in order, and one at the same moment replaces the other", () => {
  let scene = emptyScene();
  scene = withKeyframe(scene, keyframe(8));
  scene = withKeyframe(scene, keyframe(2));
  scene = withKeyframe(scene, keyframe(2.01, { peel: 0.5 }));
  assert.deepEqual(scene.keyframes.map(({ at }) => at), [2.01, 8]);
  assert.equal(scene.keyframes[0].peel, 0.5);
  assert.equal(keyframeAt(scene, 2), 0);
  assert.equal(keyframeAt(scene, 5), null);
  // One past the end is held at the end.
  assert.equal(withKeyframe(scene, keyframe(99)).keyframes.at(-1)?.at, scene.duration);
  assert.deepEqual(withoutKeyframe(scene, 0).keyframes.map(({ at }) => at), [8]);
});

test("a scene made longer plays the same film slower", () => {
  const scene = withKeyframe(withKeyframe(emptyScene(), keyframe(0)), keyframe(6));
  const longer = withDuration(scene, 24);
  assert.equal(longer.duration, 24);
  assert.deepEqual(longer.keyframes.map(({ at }) => at), [0, 12]);
  assert.equal(withDuration(scene, 9999).duration, 120);
});

test("the camera holds before the first keyframe and after the last, and passes through each", () => {
  let scene = emptyScene();
  scene = withKeyframe(scene, keyframe(2, {}, { zoom: 6 }));
  scene = withKeyframe(scene, keyframe(6, {}, { zoom: 9 }));
  scene = withKeyframe(scene, keyframe(10, {}, { zoom: 7 }));
  near(sample(scene, 0)!.camera.zoom, 6);
  near(sample(scene, 2)!.camera.zoom, 6);
  near(sample(scene, 6)!.camera.zoom, 9);
  near(sample(scene, 10)!.camera.zoom, 7);
  near(sample(scene, 12)!.camera.zoom, 7);
  // Eased out of the first: a tenth of the way in time is less than a tenth of the way there.
  const early = sample(scene, 2.4)!.camera.zoom;
  assert.ok(early > 6 && early < 6.3, String(early));
});

test("the camera turns the short way round, and all the way round for an orbit", () => {
  assert.deepEqual(unwound([350, 10]), [350, 370]);
  assert.deepEqual(unwound([10, 350]), [10, -10]);
  let scene = withKeyframe(emptyScene(), keyframe(0, {}, { bearing: 350 }));
  scene = withKeyframe(scene, keyframe(10, {}, { bearing: 10 }));
  near(sample(scene, 5)!.camera.bearing, 0);

  const orbit = orbitScene(state({}, { bearing: 30 }));
  assert.equal(orbit.duration, ORBIT_DURATION);
  assert.deepEqual(orbit.keyframes.map(({ camera }) => camera.bearing), [30, 150, 270, 30]);
  assert.deepEqual(orbit.keyframes.map(({ at }) => at), [0, 1, 2, 3].map((third) => (ORBIT_DURATION * third) / 3));
  // Always onward: never back the way it came.
  let before = -Infinity;
  for (let at = 0; at <= ORBIT_DURATION; at += 0.5) {
    const turned = unwound([30, sample(orbit, at)!.camera.bearing])[1];
    const onward = turned < before - 1e-6 ? turned + 360 : turned;
    assert.ok(onward >= before - 1e-6, `${at}s: ${onward} after ${before}`);
    before = onward;
  }
  near(sample(orbit, ORBIT_DURATION / 2)!.camera.bearing, 210, 1e-6);
});

test("an orbit goes round slowly, whatever length a new scene has, and can be made shorter after", () => {
  // Slow enough to look at: no faster than a turn in 45 seconds, and well past a new scene's length.
  assert.ok(ORBIT_DURATION >= 45 && ORBIT_DURATION <= 60, String(ORBIT_DURATION));
  assert.ok(ORBIT_DURATION > emptyScene().duration);
  const orbit = orbitScene(state({}, { bearing: 0 }));
  // Eased out of standing still: a tenth of the way in, less than a tenth of the way round.
  const tenth = sample(orbit, ORBIT_DURATION / 10)!.camera.bearing;
  assert.ok(tenth > 0 && tenth < 36, String(tenth));
  const shorter = withDuration(orbit, 12);
  assert.equal(shorter.duration, 12);
  near(sample(shorter, 6)!.camera.bearing, 180, 1e-6);
});

test("what a camera cannot do, a scene does not ask of it", () => {
  let scene = withKeyframe(emptyScene(), keyframe(0, {}, { pitch: 0 }));
  scene = withKeyframe(scene, keyframe(4, {}, { pitch: STUDIO_MAX_PITCH }));
  scene = withKeyframe(scene, keyframe(5, {}, { pitch: STUDIO_MAX_PITCH }));
  scene = withKeyframe(scene, keyframe(12, {}, { pitch: 0 }));
  for (let at = 0; at <= 12; at += 0.1) {
    const { pitch } = sample(scene, at)!.camera;
    assert.ok(pitch >= 0 && pitch <= STUDIO_MAX_PITCH, `${at}s: ${pitch}`);
  }
});

test("the scan runs evenly between two keyframes, on the radar's five-minute clock", () => {
  const scene = timelapseScene(state(), SCAN - 3600, SCAN, 12);
  assert.equal(sample(scene, 0)!.scan, SCAN - 3600);
  assert.equal(sample(scene, 12)!.scan, SCAN);
  assert.equal(sample(scene, 6)!.scan, SCAN - 1800);
  assert.equal(sample(scene, 6.4)!.scan, SCAN - 1800);
  for (let at = 0; at <= 12; at += 0.3) assert.equal(sample(scene, at)!.scan! % 300, 0);
  const scans = scansOf(scene);
  assert.equal(scans.length, 13);
  assert.equal(scans[0].scan, SCAN - 3600);
  assert.equal(scans[12].scan, SCAN);
  assert.ok(scans.every(({ at }, i) => i === 0 || at > scans[i - 1].at));
});

test("to or from the newest scan there is no clock to run on, so the scan holds", () => {
  let scene = withKeyframe(emptyScene(), keyframe(0, { scan: SCAN - 600 }));
  scene = withKeyframe(scene, keyframe(10, { scan: null }));
  assert.equal(sample(scene, 9.9)!.scan, SCAN - 600);
  assert.equal(sample(scene, 10)!.scan, null);
  assert.deepEqual(scansOf(orbitScene(state({ scan: null }))).map(({ scan }) => scan), [null]);
});

test("a plane moves from one keyframe to the next, and one only the first has stays as it is", () => {
  let scene = withKeyframe(emptyScene(), keyframe(0, {
    planes: [plane({ id: 1, lat: 50, facingDeg: 350, heightKm: 2 }), plane({ id: 2, tiltDeg: 90 })],
  }));
  scene = withKeyframe(scene, keyframe(10, { planes: [plane({ id: 1, lat: 51, facingDeg: 10, heightKm: 6 })] }));
  const mid = sample(scene, 5)!;
  assert.equal(mid.planes.length, 2);
  near(mid.planes[0].lat, 50.5);
  near(mid.planes[0].heightKm, 4);
  near(mid.planes[0].facingDeg, 0);
  assert.equal(mid.planes[1].tiltDeg, 90);
  // From the keyframe without it on, it is gone.
  assert.deepEqual(sample(scene, 10)!.planes.map(({ id }) => id), [1]);
});

test("a scene goes into a link and comes back the same, to what a reader can tell apart", () => {
  let scene = timelapseScene(state({ peel: 0.4, planes: [plane({ slabKm: 3.5, facingDeg: 123.4 })] }), SCAN - 3600, SCAN, 20);
  scene = withKeyframe(scene, keyframe(7.25, {
    scan: SCAN - 1200, style: "shells", planes: [plane({ enabled: false, tiltDeg: -90 })],
  }, {
    lon: 19.123456, lat: 52.654321, zoom: 8.416, pitch: 71.23, bearing: 301.99, fov: 16,
  }));
  const still = state({ planes: [plane({ id: 2, tiltDeg: 90, heightKm: 4 })], scan: null, style: "glow" }, { bearing: 45 });
  const text = encodeStudio({ still, scene });
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  const back = decodeStudio(text)!;
  assert.equal(back.scene.duration, 20);
  assert.equal(back.scene.keyframes.length, 3);
  assert.deepEqual(back.still, still);
  const middle = back.scene.keyframes[1];
  assert.equal(middle.at, 7.25);
  assert.equal(middle.scan, SCAN - 1200);
  assert.deepEqual(back.scene.keyframes.map(({ style }) => style), ["cloud", "shells", "cloud"]);
  assert.deepEqual(middle.camera, { lon: 19.1235, lat: 52.6543, zoom: 8.42, pitch: 71.2, bearing: 302, fov: 16 });
  assert.deepEqual(middle.planes, [plane({ enabled: false, tiltDeg: -90 })]);
  assert.deepEqual(back.scene.keyframes[0].planes, [plane({ slabKm: 3.5, facingDeg: 123.4 })]);
  assert.equal(back.scene.keyframes[0].peel, 0.4);
});

test("anything that is not a scene is refused, not guessed at", () => {
  assert.equal(decodeStudio(""), null);
  assert.equal(decodeStudio("not base64 at all!"), null);
  assert.equal(decodeStudio(btoa("{}")), null);
  assert.equal(decodeStudio(btoa(JSON.stringify([2, [], 12, []]))), null);
  assert.equal(decodeStudio(btoa(JSON.stringify([1, [1, 2, 3], 12, []]))), null);
  assert.equal(decodeStudio(btoa(JSON.stringify([1, [10, 50, 8, 55, 0, 36.9, 0, 0, 0, [["x"]]], 12, []]))), null);
  // Out of range, a link's numbers are brought back into it, and a style this build does not know is the default.
  const wild = decodeStudio(btoa(JSON.stringify([1, [10, 50, 8, 400, 725, 1, 9, 0, 7, []], 5000, []])))!;
  assert.deepEqual(
    [wild.still.camera.pitch, wild.still.camera.bearing, wild.still.camera.fov, wild.still.peel, wild.scene.duration],
    [STUDIO_MAX_PITCH, 5, 4, 1, 120],
  );
  assert.equal(wild.still.style, "cloud");
});

test("a recording frames the largest part of the map of its shape, at an even size no larger than full HD", () => {
  assert.deepEqual(cropOf(2880, 1800, "window"), { x: 0, y: 0, width: 2880, height: 1800 });
  assert.deepEqual(cropOf(2880, 1800, "16:9"), { x: 0, y: 90, width: 2880, height: 1620 });
  assert.deepEqual(cropOf(2880, 1800, "1:1"), { x: 540, y: 0, width: 1800, height: 1800 });
  const tall = cropOf(2880, 1800, "9:16");
  near(tall.width, 1012.5);
  near(tall.x, 933.75);
  assert.deepEqual(outputSize(cropOf(2880, 1800, "16:9")), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize(tall), { width: 1012, height: 1800 });
  assert.deepEqual(outputSize({ width: 801, height: 601 }), { width: 802, height: 602 });
});

test("a side view is named for where it looks from, and looks from low down", () => {
  assert.deepEqual(viewCamera("top", 123), { pitch: 0, bearing: 0 });
  // From the south, the camera looks north.
  assert.deepEqual(VIEWS.filter((view) => view !== "top" && view !== "iso").map((view) => [view, viewCamera(view, 0).bearing]), [
    ["north", 180], ["east", 270], ["south", 0], ["west", 90],
  ]);
  for (const view of ["north", "east", "south", "west"] as const) {
    const { pitch } = viewCamera(view, 0);
    assert.ok(pitch > 80 && pitch <= STUDIO_MAX_PITCH, String(pitch));
  }
});

test("the three-quarter view is from the corner nearest where the camera already is", () => {
  assert.equal(viewCamera("iso", 0).bearing, 45);
  assert.equal(viewCamera("iso", 100).bearing, 135);
  assert.equal(viewCamera("iso", -135).bearing, 225);
  assert.equal(viewCamera("iso", 350).bearing, 315);
  assert.equal(viewCamera("iso", 0).pitch, 55);
});

test("a lens is known by its field of view, and anything between two is none of them", () => {
  assert.equal(lensOf(DEFAULT_FOV), "normal");
  assert.equal(lensOf(LENS_FOV.flat), "flat");
  assert.equal(lensOf(36.9), "normal");
  assert.equal(lensOf(25), null);
});

test("the style is one or another, and changes at the keyframe that says so", () => {
  let scene = withKeyframe(emptyScene(), keyframe(0, { style: "cloud" }));
  scene = withKeyframe(scene, keyframe(6, { style: "shells" }));
  scene = withKeyframe(scene, keyframe(10, { style: "glow" }));
  assert.deepEqual([0, 5.9, 6, 9.9, 10, 12].map((at) => sample(scene, at)!.style), [
    "cloud", "cloud", "shells", "shells", "glow", "glow",
  ]);
  // The presets keep the style the map is in.
  assert.ok(orbitScene(state({ style: "glow" })).keyframes.every(({ style }) => style === "glow"));
});
