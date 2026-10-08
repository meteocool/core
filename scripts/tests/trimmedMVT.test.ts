import assert from "node:assert/strict";
import test from "node:test";
import MVT from "ol/format/MVT.js";
import Projection from "ol/proj/Projection.js";

const { default: TrimmedMVT, trimTile } = await import("../../src/layers/trimmedMVT.ts");

/**
 * Layers cut out of a vector tile before OpenLayers reads it, so it does not
 * spend the parse on tables it is about to throw away. Whatever is read must
 * be what OpenLayers' own layer filter would have kept.
 */

/* ---- a minimal MVT encoder: varints, length-delimited fields, point features ---- */
const varint = (n: number): number[] => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return out; };
const field = (tag: number, payload: number[]) => [...varint((tag << 3) | 2), ...varint(payload.length), ...payload];
const uint = (tag: number, n: number) => [...varint(tag << 3), ...varint(n)];
const text = (s: string) => [...new TextEncoder().encode(s)];
const zigzag = (n: number) => (n << 1) ^ (n >> 31);
const point = (x: number, y: number, tags: number[]) => [
  ...field(2, tags.flatMap(varint)), ...uint(3, 1), ...field(4, [9, zigzag(x), zigzag(y)].flatMap(varint)),
];
/** A layer of points, each with a `name`; `versionFirst` puts field 15 before the name, which is legal. */
function layer(name: string, names: string[], versionFirst = false) {
  const body = [
    ...(versionFirst ? uint(15, 2) : []),
    ...field(1, text(name)),
    ...names.flatMap((_, i) => field(2, point(100 + i * 10, 200, [0, i]))),
    ...field(3, text("name")),
    ...names.flatMap((n) => field(4, field(1, text(n)))),
    ...uint(5, 4096),
    ...(versionFirst ? [] : uint(15, 2)),
  ];
  return field(3, body);
}
const tile = (...layers: number[][]) => new Uint8Array(layers.flat()).buffer;

const tilePixels = new Projection({ code: "", units: "tile-pixels", extent: [0, 0, 4096, 4096] });
const read = (format: MVT, buffer: ArrayBuffer) => format.readFeatures(buffer, { dataProjection: tilePixels, featureProjection: tilePixels })
  .map((f) => `${f.get("layer")}:${f.get("name")}:${f.getFlatCoordinates().join(",")}`);

test("it reads what OpenLayers' own layer filter keeps", () => {
  const buffer = tile(layer("landuse", Array.from({ length: 30 }, (_, i) => `field ${i}`)), layer("places", ["Essen", "Bochum"]), layer("roads", ["A40"]));
  for (const keep of [["places"], ["roads", "landuse"], ["places", "roads"]]) {
    assert.deepEqual(read(new TrimmedMVT({ layers: keep }), buffer), read(new MVT({ layers: keep }), buffer));
  }
});

test("the layers left out are not in what OpenLayers is handed", () => {
  const buffer = tile(layer("landuse", Array.from({ length: 50 }, (_, i) => `field ${i}`)), layer("places", ["Essen"]));
  const trimmed = trimTile(buffer, new Set(["places"]));
  assert.ok(trimmed.byteLength < buffer.byteLength / 4);
  assert.deepEqual(read(new MVT(), trimmed), ["places:Essen:100,200"]);
});

test("a layer that names itself after its version field is still recognised", () => {
  const buffer = tile(layer("landuse", ["a", "b", "c", "d"], true), layer("places", ["Köln"], true));
  assert.deepEqual(read(new TrimmedMVT({ layers: ["places"] }), buffer), ["places:Köln:100,200"]);
});

test("a tile with little to cut is handed over as it came, without a copy", () => {
  const buffer = tile(layer("places", ["Bonn"]));
  assert.equal(trimTile(buffer, new Set(["places"])), buffer);
  const mostlyKept = tile(layer("roads", Array.from({ length: 40 }, (_, i) => `road ${i}`)), layer("pois", ["kiosk"]));
  assert.equal(trimTile(mostlyKept, new Set(["roads"])), mostlyKept);
});

test("a tile that cannot be walked goes to OpenLayers whole", () => {
  const buffer = new Uint8Array([0x1a, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00]).buffer; // a layer claiming 4 GB
  assert.equal(trimTile(buffer, new Set(["places"])), buffer);
});
