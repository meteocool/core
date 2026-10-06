import assert from "node:assert/strict";
import test from "node:test";
import makeCloudHints, { onePerStorm } from "../../src/layers/cloudHints.ts";
import { scanTime } from "../../src/lib/scans.ts";
import type { RadarVolume } from "../../src/api/index.ts";

const at = (hhmm: string) => `2026-10-01T${hhmm}:00Z`;
const cloud = (path: string, hhmm: string, network = "de") => (
  { path, lon: 8, lat: 54, peak_dbz: 50, network, reference_time: at(hhmm) } as unknown as RadarVolume
);
const radar = (de: string, networks: Record<string, string> = {}) => ({
  scan: scanTime(at(de)),
  networks: Object.fromEntries(Object.entries(networks).map(([code, hhmm]) => [code, { upstream_time: scanTime(at(hhmm)) }])),
});
const tagged = (hints: ReturnType<typeof makeCloudHints>) => hints.layer.getSource()!.getFeatures()
  .map((feature) => (feature.get("cloud") as RadarVolume).path).sort();

/**
 * The flat map's "3D" tags point only at storms the 3D map draws in colour:
 * one a scan behind the radar is drawn grey there, upwind of the echo.
 */
test("a core goes untagged when the radar moves past its scan, and back when its own lands", () => {
  const hints = makeCloudHints();
  hints.setRadar(radar("00:00", { fr: "00:04" }));
  hints.setClouds([cloud("a", "00:00"), cloud("b", "00:04", "fr")]);
  assert.deepEqual(tagged(hints), ["a", "b"]);

  // DWD's 00:05 frame lands before its cores are built; France's has not moved.
  hints.setRadar(radar("00:05", { fr: "00:04" }));
  assert.deepEqual(tagged(hints), ["b"]);

  // 00:05's cores are built.
  hints.setClouds([cloud("c", "00:05"), cloud("b", "00:04", "fr")]);
  assert.deepEqual(tagged(hints), ["b", "c"]);
});

test("with no radar known, every core is tagged", () => {
  const hints = makeCloudHints();
  hints.setClouds([cloud("a", "00:00")]);
  assert.deepEqual(tagged(hints), ["a"]);
});

test("a storm boxed by several tiles carries one tag, on its strongest", () => {
  const tile = (path: string, system: string | null, peak: number) => (
    { ...cloud(path, "00:00"), system, peak_dbz: peak } as unknown as RadarVolume
  );
  const tiles = [tile("a", "T1", 40), tile("b", "T1", 58), tile("c", "T2", 35), tile("d", null, 30), tile("e", null, 31)];

  assert.deepEqual(onePerStorm(tiles).map((kept) => kept.path), ["b", "c", "d", "e"]);

  const hints = makeCloudHints();
  hints.setClouds(tiles);
  assert.deepEqual(tagged(hints), ["b", "c", "d", "e"]);
});
