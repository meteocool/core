/**
 * A value tile's PNG, read to its bytes here rather than by the browser.
 *
 * Every value tile is an 8-bit greyscale PNG (meteocool/ng's worker-radar,
 * `encode_value_tile`), and a byte one off is another value: half a dBZ in
 * reflectivity, another class in precipitation types. WebKit colour-manages
 * greyscale PNGs on every way in -- `createImageBitmap` even with
 * `colorSpaceConversion: "none"`, an `<img>`, a WebGL upload, with or without
 * an sRGB chunk -- and gives back about a quarter of a tile's bytes one off
 * (measured on iOS 18.4): rain read as snow, drizzle as unclassifiable, and
 * nothing as unclassifiable, which strewed grey over every tile's whole square.
 * Chrome gives them back exactly; nothing guarantees either.
 *
 * So the PNG is inflated and unfiltered here, which no browser can get wrong.
 * Only an 8-bit, non-interlaced greyscale PNG is: what the backend writes. A
 * PNG of any other kind, or a browser with no `DecompressionStream` (Safari
 * before 16.4), goes through the browser's decoder as before.
 */

/** One decoded tile: a byte a pixel, row major from the top left. */
export interface ValueRaster {
  width: number;
  height: number;
  values: Uint8Array;
}

/** How the browser is asked to decode a tile it is left to: its bytes as they are, if it will. */
const BROWSER_DECODE: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const GREYSCALE = 0;

/** A PNG's image header and its compressed image data, or null for a kind not read here. */
function parse(png: Uint8Array): { width: number; height: number; data: Uint8Array[] } | null {
  if (SIGNATURE.some((byte, at) => png[at] !== byte)) throw new Error("not a PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const data: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  for (let at = SIGNATURE.length; at + 8 <= png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colour !== GREYSCALE || interlace !== 0) return null;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height || !data.length) throw new Error("PNG has no image");
  return { width, height, data };
}

/** PNG's Paeth predictor. */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * Undo the filters of a one-byte-a-pixel image: each row is its filter type,
 * then the row as differences from its neighbours. A Uint8Array wraps sums
 * modulo 256, which is the arithmetic PNG asks for.
 */
export function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  if (raw.length < height * (width + 1)) throw new Error("PNG image data is short");
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    const from = y * (width + 1) + 1;
    const row = y * width;
    const above = row - width;
    for (let x = 0; x < width; x++) {
      const left = x ? out[row + x - 1] : 0;
      const up = y ? out[above + x] : 0;
      let predicted: number;
      if (filter === 0) predicted = 0;
      else if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, x && y ? out[above + x - 1] : 0);
      else throw new Error(`PNG row filter ${filter}`);
      out[row + x] = raw[from + x] + predicted;
    }
  }
  return out;
}

async function inflate(chunks: Uint8Array[]): Promise<Uint8Array> {
  // "deflate" is zlib's format, which is what a PNG's image data is in.
  const stream = new Blob(chunks as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The browser's decoder, for a tile this module does not read: red where opaque, else 0. */
async function decodedByBrowser(png: ArrayBuffer): Promise<ValueRaster> {
  const bitmap = await createImageBitmap(new Blob([png]), BROWSER_DECODE);
  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas === "undefined"
    ? Object.assign(document.createElement("canvas"), { width, height })
    : new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("no 2D canvas to decode a tile on");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const values = new Uint8Array(width * height);
  for (let pixel = 0, at = 0; pixel < values.length; pixel++, at += 4) values[pixel] = rgba[at + 3] ? rgba[at] : 0;
  return { width, height, values };
}

/** A value tile's bytes, exactly as the PNG holds them wherever this can read it. */
export async function decodeValuePng(png: ArrayBuffer): Promise<ValueRaster> {
  const parsed = typeof DecompressionStream === "undefined" ? null : parse(new Uint8Array(png));
  if (!parsed) return decodedByBrowser(png);
  const { width, height, data } = parsed;
  return { width, height, values: unfilter(await inflate(data), width, height) };
}
