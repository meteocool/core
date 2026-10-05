/**
 * A value tile's RGBA pixels, cut down to the bytes that mean something.
 *
 * A decoded value tile is four bytes a pixel, and only the red one is the
 * value (layers/valueTiles.ts). Kept like that, every tile cost a megabyte
 * in the page and another on the GPU, and the radar layers keep hundreds of
 * them so playback can loop without fetching again. Packed, the GPU takes
 * the value alone as a one-channel texture -- a quarter of the size -- and
 * reads band 4 of it as opaque.
 *
 * Where a pixel is transparent its value is written as 0, which every value
 * palette draws as nothing (lib/rvp6.ts, lib/hgClasses.ts) -- the same
 * reading `paintValuePixels` gives it. Only a tile with partial coverage,
 * the antialiased edge of a network's ground (tileMask.ts), keeps its alpha,
 * as a second byte a pixel. OpenLayers works out which from the length.
 */
export function packPixels(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const count = rgba.length / 4;
  let partial = false;
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] !== 0 && rgba[at] !== 255) {
      partial = true;
      break;
    }
  }
  if (!partial) {
    const values = new Uint8Array(count);
    for (let pixel = 0, at = 0; pixel < count; pixel++, at += 4) values[pixel] = rgba[at + 3] ? rgba[at] : 0;
    return values;
  }
  const pairs = new Uint8Array(count * 2);
  for (let pixel = 0, at = 0; pixel < count; pixel++, at += 4) {
    pairs[pixel * 2] = rgba[at];
    pairs[pixel * 2 + 1] = rgba[at + 3];
  }
  return pairs;
}
