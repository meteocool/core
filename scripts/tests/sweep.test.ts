import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { decodeSweep, readBin, velocityByte } from "../../src/lib/sweep.ts";

/** An object as the backend writes it, before the browser has gunzipped it. */
function encode(header: Record<string, unknown>, bins: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(12 + text.length + bins.length);
  out.set(new TextEncoder().encode("MCSW"), 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, text.length, true);
  out.set(text, 12);
  out.set(bins, 12 + text.length);
  return out.buffer;
}

const HEADER = { site: "deasb", nrays: 2, nbins: 3, encoding: "vrad-u8", elevation_deg: 0.5 };

test("a sweep reads back its header and its bins, rays outermost", () => {
  const sweep = decodeSweep(encode(HEADER, Uint8Array.from([1, 2, 3, 4, 5, 6])));

  assert.equal(sweep.header.site, "deasb");
  assert.equal(sweep.header.nrays, 2);
  assert.deepEqual([...sweep.bins], [1, 2, 3, 4, 5, 6]);
});

test("anything that is not a sweep is refused", () => {
  assert.throws(() => decodeSweep(new ArrayBuffer(4)), /not a sweep/);
  // Still gzipped: what a fetch that did not unwrap it would hand over.
  const zipped = gzipSync(new Uint8Array(encode(HEADER, new Uint8Array(6))));
  assert.throws(() => decodeSweep(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)), /not a sweep/);
  // A blank tile, as the UI tests answer anything under /tiles/.
  assert.throws(() => decodeSweep(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), /not a sweep/);
});

test("a sweep whose bins do not fill its header is refused", () => {
  assert.throws(() => decodeSweep(encode(HEADER, new Uint8Array(5))), /header wants 6/);
});

test("reflectivity bytes read as the tiles do", () => {
  assert.deepEqual(readBin("rvp6-u8", 0), { kind: "no_echo" });
  assert.deepEqual(readBin("rvp6-u8", 255), { kind: "unmeasured" });
  assert.deepEqual(readBin("rvp6-u8", 105), { kind: "value", value: 20 });
});

test("velocity bytes are half metres per second about 128, with three reserved", () => {
  assert.deepEqual(readBin("vrad-u8", 0), { kind: "unmeasured" });
  assert.deepEqual(readBin("vrad-u8", 1), { kind: "no_echo" });
  assert.deepEqual(readBin("vrad-u8", 255), { kind: "unresolved" });
  assert.deepEqual(readBin("vrad-u8", 148), { kind: "value", value: 10 });
  assert.deepEqual(readBin("vrad-u8", 108), { kind: "value", value: -10 });
});

test("a velocity is encoded within the bytes that hold one", () => {
  assert.equal(velocityByte(10), 148);
  assert.equal(velocityByte(-99), 2);
  assert.equal(velocityByte(99), 254);
});

/** Two readings the same, a value's float error aside. */
function sameReading(actual: ReturnType<typeof readBin>, expected: ReturnType<typeof readBin>) {
  if (expected.kind === "value" && actual.kind === "value") {
    assert.ok(Math.abs(actual.value - expected.value) < 1e-9, `${actual.value} is not ${expected.value}`);
  } else {
    assert.deepEqual(actual, expected);
  }
}

test("correlation coefficient bytes are 0.004 apart from 0.2, with not measured and too weak to read reserved", () => {
  sameReading(readBin("rhohv-u8", 0), { kind: "unmeasured" });
  sameReading(readBin("rhohv-u8", 1), { kind: "too_weak" });
  sameReading(readBin("rhohv-u8", 2), { kind: "value", value: 0.2 });
  sameReading(readBin("rhohv-u8", 128), { kind: "value", value: 0.704 });
  sameReading(readBin("rhohv-u8", 197), { kind: "value", value: 0.98 });
  sameReading(readBin("rhohv-u8", 254), { kind: "value", value: 1.208 });
});

test("differential reflectivity bytes are sixteenths of a dB about 128, with not measured and no echo reserved", () => {
  sameReading(readBin("zdr-u8", 0), { kind: "unmeasured" });
  sameReading(readBin("zdr-u8", 1), { kind: "no_echo" });
  sameReading(readBin("zdr-u8", 2), { kind: "value", value: -7.875 });
  sameReading(readBin("zdr-u8", 128), { kind: "value", value: 0 });
  sameReading(readBin("zdr-u8", 154), { kind: "value", value: 1.625 });
  sameReading(readBin("zdr-u8", 254), { kind: "value", value: 7.875 });
});

test("shear bytes are 1e-4 per second about 128, with no estimate and masked reserved", () => {
  sameReading(readBin("shear-u8", 0), { kind: "no_estimate" });
  sameReading(readBin("shear-u8", 1), { kind: "masked" });
  sameReading(readBin("shear-u8", 2), { kind: "value", value: -1.26e-2 });
  sameReading(readBin("shear-u8", 128), { kind: "value", value: 0 });
  sameReading(readBin("shear-u8", 168), { kind: "value", value: 4e-3 });
  sameReading(readBin("shear-u8", 254), { kind: "value", value: 1.26e-2 });
});

test("divergence bytes are 2e-4 per second about 128, with no estimate and masked reserved", () => {
  sameReading(readBin("divshear-u8", 0), { kind: "no_estimate" });
  sameReading(readBin("divshear-u8", 1), { kind: "masked" });
  sameReading(readBin("divshear-u8", 2), { kind: "value", value: -2.52e-2 });
  sameReading(readBin("divshear-u8", 128), { kind: "value", value: 0 });
  sameReading(readBin("divshear-u8", 103), { kind: "value", value: -5e-3 });
  sameReading(readBin("divshear-u8", 254), { kind: "value", value: 2.52e-2 });
});

test("byte 255, which none of the newer encodings uses, is never read as a value", () => {
  for (const encoding of ["rhohv-u8", "zdr-u8", "shear-u8", "divshear-u8"] as const) {
    assert.notEqual(readBin(encoding, 255).kind, "value", encoding);
  }
});

/**
 * Borkum's lowest tilt of 2026-11-28 02:30 as next published it, each
 * quantity's object as the UI tests serve it (tests/ui/fixtures/sweeps).
 */
test("a radar's published coefficient, ZDR, shear and divergence decode with their encodings and say what they are", () => {
  const read = (quantity: string) => {
    const bytes = gunzipSync(readFileSync(`tests/ui/fixtures/sweeps/${quantity}.mcsw`));
    return decodeSweep(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const rhohv = read("RHOHV");
  assert.equal(rhohv.header.encoding, "rhohv-u8");
  assert.equal(rhohv.header.source_quantity, "URHOHV");
  assert.equal(read("ZDR").header.encoding, "zdr-u8");
  const shear = read("SHEAR");
  assert.equal(shear.header.encoding, "shear-u8");
  assert.equal(read("DIVSHEAR").header.encoding, "divshear-u8");
  // The velocity's geometry, as the shear is fitted on its bins.
  assert.equal(shear.header.nbins * shear.header.nrays, shear.bins.length);
  assert.ok([...rhohv.bins].some((byte) => byte >= 2), "the coefficient has readings");
});
