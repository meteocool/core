import type { SourceTile } from "./tileIndex";

/**
 * A value tile's bytes, cut down to what the GPU needs.
 *
 * The radar layers keep hundreds of tiles -- a frame's worth for every step
 * of playback, for each network -- so a tile is handed to the GPU as its
 * values alone (lib/valuePng.ts), a one-channel texture whose band 4 reads
 * as opaque, rather than as four bytes a pixel.
 *
 * Where a pixel is cut away its value is written as 0, which every value
 * palette draws as nothing (lib/rvp6.ts, lib/hgClasses.ts). Only a tile with
 * partial coverage, the antialiased edge of a network's ground
 * (tileMask.ts), keeps it, as a second byte a pixel. OpenLayers works out
 * which from the length.
 *
 * `coverage` is how much of each pixel the cut leaves, 0 to 255, or null
 * where nothing was cut.
 */
export function packValues(values: Uint8Array, coverage: Uint8Array | null): Uint8Array {
  if (!coverage) return values;
  if (coverage.every((kept) => kept === 0 || kept === 255)) {
    return values.map((value, pixel) => (coverage[pixel] ? value : 0));
  }
  const pairs = new Uint8Array(values.length * 2);
  for (let pixel = 0; pixel < values.length; pixel++) {
    pairs[pixel * 2] = values[pixel];
    pairs[pixel * 2 + 1] = coverage[pixel];
  }
  return pairs;
}

/**
 * One part of a square tile's values, at the tile's full size.
 *
 * Nearest-neighbour, as every radar layer here draws: a 1 km pixel magnified
 * stays a square of its own value rather than a blend into its neighbours.
 */
export function magnifyValues(
  values: Uint8Array,
  size: number,
  { scale, column, row }: Pick<SourceTile, "scale" | "column" | "row">,
): Uint8Array {
  if (scale === 1) return values;
  const part = size / scale;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const from = (row * part + Math.floor(y / scale)) * size + column * part;
    for (let x = 0; x < size; x++) out[y * size + x] = values[from + Math.floor(x / scale)];
  }
  return out;
}
