import assert from "node:assert/strict";
import test from "node:test";
import { describeSignature, nearestSignature, signaturesOf, toDegrees } from "../../src/lib/rotationSignatures.ts";
import type { RotationSignature } from "../../src/lib/rotationSignatures.ts";

/** Borkum's east, 53.6 N 7.3 E, as EPSG:3857 metres. */
const EASTING = 7.3 * (Math.PI / 180) * 6378137;
const NORTHING = Math.log(Math.tan(Math.PI / 4 + (53.6 * Math.PI) / 360)) * 6378137;

const signature: RotationSignature = {
  source: "meteocool", lat: NORTHING, lon: EASTING, time: 1, site: "deasb", network: "de", scanned_at: 0,
  vrot_m_s: 11.4, shear_max: 6.2e-3, tilts_deg: [0.5, 1.5, 2.5], heights_m: [420, 1300, 2100], range_km: 41.6,
  persistent: true, agrees_with_dwd: true,
};

test("a projected point comes back in degrees", () => {
  const [lon, lat] = toDegrees(EASTING, NORTHING);
  assert.ok(Math.abs(lon - 7.3) < 1e-6);
  assert.ok(Math.abs(lat - 53.6) < 1e-6);
});

test("ours are picked out of the list by source, and DWD's left to the layer", () => {
  const list = [{ source: "dwd" as const, lat: 1, lon: 2, time: 3, intensity: 1 }, signature, { lat: 1, lon: 2, time: 4 }];
  assert.deepEqual(signaturesOf(list), [signature]);
});

test("the nearest signature within reach, else none", () => {
  assert.equal(nearestSignature([signature], 53.6, 7.3, 5)?.signature, signature);
  // 4 km north: within 5, not within 3.
  assert.ok((nearestSignature([signature], 53.636, 7.3, 5)?.km ?? 0) > 3.9);
  assert.equal(nearestSignature([signature], 53.636, 7.3, 3), null);
  assert.equal(nearestSignature([], 53.6, 7.3, 5), null);
});

const t = (key: string, options?: { values?: Record<string, string | number> }) => (
  options?.values ? `${key}(${Object.entries(options.values).map(([k, v]) => `${k}=${v}`).join(",")})` : key
);

test("a signature says its couplet, its depth, its range and what DWD says", () => {
  assert.deepEqual(describeSignature(signature, t), [
    "signature.vrot(value=11.4)",
    "signature.depth(count=3,lowest=0.4,highest=2.1)",
    "signature.range(range=42,site=DEASB)",
    "signature.persistent",
    "signature.agrees",
  ]);
  const abroad = { ...signature, vrot_m_s: null, persistent: false, agrees_with_dwd: null, site: "frtra", network: "fr" };
  assert.deepEqual(describeSignature(abroad, t), [
    "signature.depth(count=3,lowest=0.4,highest=2.1)",
    "signature.range(range=42,site=FRTRA)",
  ]);
  assert.equal(describeSignature({ ...signature, agrees_with_dwd: false }, t).at(-1), "signature.disagrees");
});
