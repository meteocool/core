import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { decodeSweep, readBin, velocityByte } from "../../src/lib/sweep.ts";

/** An object as worker-analysis `sweeps.encode` writes it, before the browser has gunzipped it. */
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
