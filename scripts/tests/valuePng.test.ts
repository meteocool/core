import assert from "node:assert/strict";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { decodeValuePng, unfilter } from "../../src/lib/valuePng.ts";

/**
 * Value tiles decoded by meteocool rather than by the browser (lib/valuePng.ts).
 *
 * The PNGs are written here, with each of PNG's five row filters, so a
 * decoder that gets one of them wrong cannot pass by reading only the one
 * Pillow happened to pick.
 */

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, tail]);
}

/** PNG's filters, the other way round: what a row is written as, given the rows decoded so far. */
function filtered(values: Uint8Array, width: number, filters: number[]): Uint8Array {
  const at = (x: number, y: number) => (x < 0 || y < 0 ? 0 : values[y * width + x]);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const height = values.length / width;
  const out = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length];
    out[y * (width + 1)] = filter;
    for (let x = 0; x < width; x++) {
      const [left, up, upLeft] = [at(x - 1, y), at(x, y - 1), at(x - 1, y - 1)];
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      out[y * (width + 1) + 1 + x] = (at(x, y) - predicted) & 255;
    }
  }
  return out;
}

function png(values: Uint8Array, width: number, { colour = 0, filters = [0, 1, 2, 3, 4], split = 1 } = {}): ArrayBuffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(values.length / width, 4);
  header.set([8, colour, 0, 0, 0], 8);
  const data = deflateSync(filtered(values, width, filters));
  // Image data may come in several chunks, cut anywhere.
  const step = Math.ceil(data.length / split);
  const idat = Array.from({ length: split }, (_, i) => chunk("IDAT", data.subarray(i * step, (i + 1) * step)));
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...idat,
    chunk("IEND", new Uint8Array(0)),
  ]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** Every byte value, in an order that makes each filter's arithmetic wrap. */
const ramp = (width: number, height: number) =>
  Uint8Array.from({ length: width * height }, (_, i) => (i * 37 + Math.floor(i / width) * 101) & 255);

test("every byte comes back as it was written, through each of the five row filters", async () => {
  const values = ramp(64, 40);
  for (const filter of [0, 1, 2, 3, 4]) {
    const decoded = await decodeValuePng(png(values, 64, { filters: [filter] }));
    assert.deepEqual(decoded, { width: 64, height: 40, values }, `filter ${filter}`);
  }
});

test("filters may change from row to row, and the image data may span chunks", async () => {
  const values = ramp(512, 512);
  const decoded = await decodeValuePng(png(values, 512, { split: 7 }));
  assert.equal(decoded.width, 512);
  assert.deepEqual(decoded.values, values);
});

test("class bytes stay their classes: none of rain read as snow or nothing as unclassifiable", async () => {
  // The bytes WebKit's own decoder gave back one off (lib/hgClasses.ts).
  const values = Uint8Array.from({ length: 16 * 16 }, (_, i) => [0, 1, 2, 3, 4, 5, 6, 7][i % 8]);
  assert.deepEqual((await decodeValuePng(png(values, 16))).values, values);
});

test("what is not a PNG is refused rather than drawn", async () => {
  await assert.rejects(decodeValuePng(new TextEncoder().encode("<html>").buffer as ArrayBuffer), /not a PNG/);
});

test("a row filter PNG does not define is refused", () => {
  assert.throws(() => unfilter(new Uint8Array([5, 1, 2]), 2, 1), /filter 5/);
});

test("image data shorter than the header promises is refused", () => {
  assert.throws(() => unfilter(new Uint8Array([0, 1, 2, 0]), 2, 2), /short/);
});

test("a kind of PNG the backend does not write is left to the browser's decoder", async (t) => {
  const asked: unknown[] = [];
  const saved = globalThis.createImageBitmap;
  t.after(() => Object.assign(globalThis, { createImageBitmap: saved }));
  Object.assign(globalThis, {
    createImageBitmap: async (...args: unknown[]) => {
      asked.push(args[1]);
      throw new Error("decoded by the browser");
    },
  });
  // Colour type 2, RGB: never written as a value tile.
  await assert.rejects(decodeValuePng(png(new Uint8Array(12), 4, { colour: 2 })), /decoded by the browser/);
  assert.deepEqual(asked, [{ colorSpaceConversion: "none", premultiplyAlpha: "none" }]);
});
