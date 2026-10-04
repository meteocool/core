/**
 * Value tiles: radar tiles that carry the reflectivity rather than its colour.
 *
 * The backend writes each tile as a single-band 8-bit PNG whose pixels are
 * RVP6, `(dBZ + 32.5) * 2`, with 0 for nothing drawn (ADR 0010 in
 * meteocool/ng). A frame says so with `values`; a frame without it was
 * rendered in RGBA, in the classic palette, and draws as it always has.
 *
 * The palette is then applied here, in the browser: one 256-entry table per
 * palette, built from `dbz2color` like the legend and the timeline, so the
 * drawn pixel and the API's point value are the same byte.
 */
import type { Rgba } from "../colormaps";
import { dbz2color } from "./cmap_utils";

/** `values.encoding` of a frame whose tiles hold RVP6 bytes. */
export const RVP6_ENCODING = "rvp6-u8";

export const RVP6_ENTRIES = 256;

/** A frame's statement of what its tile set's bytes mean, as the API publishes it. */
export interface ValueTiles {
  tile_id: string;
  encoding: string;
}

/** Whether a frame's tiles hold RVP6 values rather than colours. */
export function carriesValues(frame: { values?: ValueTiles | null } | null | undefined): boolean {
  return frame?.values?.encoding === RVP6_ENCODING;
}

/** The tile set a client draws for a frame: its value tiles where it has them. */
export function drawnTileId(frame: { tile_id: string; values?: ValueTiles | null }): string {
  return carriesValues(frame) ? frame.values!.tile_id : frame.tile_id;
}

const tables = new Map<string, Rgba[]>();

/**
 * RVP6 index to RGBA in the named palette; index 0 is transparent. Past the
 * palette's last colour every index is that colour, as the backend's
 * `MOST_INTENSE` was: `dbz2color` clamps.
 */
export function rvp6Table(palette: string): Rgba[] {
  let table = tables.get(palette);
  if (!table) {
    table = [];
    for (let i = 0; i < RVP6_ENTRIES; i++) table.push(i === 0 ? [0, 0, 0, 0] : dbz2color(i / 2 - 32.5, palette));
    tables.set(palette, table);
  }
  return table;
}

/** The same, as the colours an OpenLayers `palette` expression takes (alpha 0..1). */
export function rvp6PaletteColours(palette: string): number[][] {
  return rvp6Table(palette).map(([r, g, b, a]) => [r, g, b, a / 255]);
}

/**
 * The WebGLTile style that draws a value tile in a palette.
 *
 * `['band', 1]` is the texture's red channel as 0..1; times 255 it is the
 * byte again, and `palette` is a texture lookup on it, a step function with
 * no blending between neighbouring classes. The colour's alpha is then
 * scaled by the tile's own, band 4: opaque everywhere but where a network's
 * hole was cut (networkHoles.ts), whose antialiased edge fades out exactly
 * as an RGBA tile's does.
 */
export function rvp6Style(palette: string) {
  return {
    color: [
      "*",
      ["palette", ["*", ["band", 1], 255], rvp6PaletteColours(palette)],
      ["color", 255, 255, 255, ["band", 4]],
    ],
  };
}

/**
 * Colour RGBA pixels that hold RVP6 in their red channel, in place.
 *
 * What a canvas reads back from a decoded value tile: R = G = B = the value
 * and alpha opaque, except where a polygon was cut (tileMask.ts): nothing
 * there, and part of a pixel on the cut's antialiased edge, which fades the
 * colour as `rvp6Style` does.
 */
export function paintValuePixels(pixels: Uint8ClampedArray, table: Rgba[]): void {
  for (let at = 0; at < pixels.length; at += 4) {
    const coverage = pixels[at + 3];
    const [r, g, b, a] = table[coverage === 0 ? 0 : pixels[at]];
    pixels[at] = r;
    pixels[at + 1] = g;
    pixels[at + 2] = b;
    pixels[at + 3] = coverage === 255 ? a : Math.round((a * coverage) / 255);
  }
}
