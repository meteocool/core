/**
 * Value tiles: radar tiles that carry the reflectivity rather than its colour.
 *
 * The backend writes each tile as a single-band 8-bit PNG whose pixels are
 * RVP6, `(dBZ + 32.5) * 2`, with 0 for nothing drawn. A frame says so with `values`. Frames rendered in RGBA,
 * before the backend switched on 2026-10-04, are no longer drawn: the
 * backends this frontend reads publish none.
 *
 * The palette is then applied here, in the browser: one 256-entry table per
 * palette, built from `dbz2color` like the legend and the timeline, so the
 * drawn pixel and the API's point value are the same byte.
 *
 * Not every value tile is reflectivity: an echo top's and VIL's bytes are a
 * height and a weight (lib/columnValues.ts), and a frame is drawn by what its
 * own `values.encoding` says (`valueStyle`).
 */
import type { Rgba } from "../colormaps";
import { dbz2color } from "./cmap_utils";
import {
  columnScale, columnStyle, columnTable, columnValue, isColumnEncoding, legendPosition,
} from "./columnValues";
import type { ColumnEncoding } from "./columnValues";

/** `values.encoding` of a frame whose tiles hold RVP6 bytes. */
export const RVP6_ENCODING = "rvp6-u8";

export const RVP6_ENTRIES = 256;

/** A frame's statement of what its tile set's bytes mean, as the API publishes it. */
export interface ValueTiles {
  tile_id: string;
  encoding: string;
}

/** Whether a frame's tiles hold values this client draws, RVP6 or a column product's, rather than colours. */
export function carriesValues(frame: { values?: ValueTiles | null } | null | undefined): boolean {
  const encoding = frame?.values?.encoding;
  return encoding === RVP6_ENCODING || isColumnEncoding(encoding);
}

/**
 * What a frame's bytes mean: its `values.encoding`, or RVP6 for a frame that
 * does not say, as every frame drawn before the column products was.
 */
export function encodingOf(frame: { values?: ValueTiles | null }): string {
  return frame.values?.encoding ?? RVP6_ENCODING;
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

/**
 * What the composites are drawn in under an open radar's own sweep: grey, so
 * their colours do not mix with the sweep's. Black ink on a light basemap,
 * white on a dark one, so the strongest echo stands out of either.
 */
export type Ink = "black" | "white";

/** The dBZ the grey runs between: from its faintest at the first to full ink at the second. */
const GREY_FROM_DBZ = 5;
const GREY_TO_DBZ = 50;
/** The grey at the faint end, by ink: far enough from the basemap to be seen. */
const GREY_FAINT: Record<Ink, number> = { black: 160, white: 120 };
const GREY_FULL: Record<Ink, number> = { black: 0, white: 255 };

/** The grey `t` of the way from an ink's faintest, 0, to full ink, 1. */
function inkGrey(t: number, ink: Ink): number {
  return Math.round(GREY_FAINT[ink] + (GREY_FULL[ink] - GREY_FAINT[ink]) * t);
}

/**
 * The palette's table in grey: each class's alpha kept, so drizzle fades in
 * as it does in colour, and its grey running with dBZ, not with the colour's
 * lightness, which in most palettes goes up and down again.
 */
export function greyTable(palette: string, ink: Ink): Rgba[] {
  return rvp6Table(palette).map(([, , , a], i) => {
    const t = Math.min(1, Math.max(0, (i / 2 - 32.5 - GREY_FROM_DBZ) / (GREY_TO_DBZ - GREY_FROM_DBZ)));
    const grey = inkGrey(t, ink);
    return [grey, grey, grey, a];
  });
}

/**
 * An echo top's or VIL's table in grey, as `greyTable` is reflectivity's, for
 * the same reason: under an open radar's sweep its own colours would mix with
 * the sweep's as reflectivity's would. Each byte's alpha kept, its grey
 * running along its legend from the ink's faintest to full ink, so a higher
 * top or more water is the stronger grey.
 */
export function columnGreyTable(encoding: ColumnEncoding, ink: Ink): Rgba[] {
  const scale = columnScale(encoding);
  return columnTable(encoding).map(([, , , a], byte) => {
    const value = columnValue(encoding, byte);
    const grey = inkGrey(value === null ? 0 : legendPosition(scale, value), ink);
    return [grey, grey, grey, a];
  });
}

/** The same, as the colours an OpenLayers `palette` expression takes (alpha 0..1); in grey with an ink. */
export function rvp6PaletteColours(palette: string, ink: Ink | null = null): number[][] {
  return (ink ? greyTable(palette, ink) : rvp6Table(palette)).map(([r, g, b, a]) => [r, g, b, a / 255]);
}

/**
 * The WebGLTile style that draws a value tile in a palette.
 *
 * `['band', 1]` is the texture's red channel as 0..1; times 255 it is the
 * byte again, and `palette` is a texture lookup on it, a step function with
 * no blending between neighbouring classes. The colour's alpha is then
 * scaled by the tile's own, band 4: opaque everywhere but where a network's
 * hole was cut (networkHoles.ts), whose antialiased edge fades out exactly
 * as an RGBA tile's does. With an ink, the palette in grey (`greyTable`).
 */
export function rvp6Style(palette: string, ink: Ink | null = null) {
  return {
    color: [
      "*",
      ["palette", ["*", ["band", 1], 255], rvp6PaletteColours(palette, ink)],
      ["color", 255, 255, 255, ["band", 4]],
    ],
  };
}

/** A style that draws nothing, for an encoding this client cannot read. */
const NOTHING = { color: [0, 0, 0, 0] };

/**
 * The WebGLTile style that draws a frame's value tiles by what its encoding
 * says they are: reflectivity in the reader's palette (`rvp6Style`), an echo
 * top or VIL in its own (lib/columnValues.ts), whatever the palette. With an
 * ink, under an open radar's sweep, either in grey (`greyTable`,
 * `columnGreyTable`). An encoding this client does not know draws nothing
 * rather than be read as dBZ.
 */
export function valueStyle(encoding: string, palette: string, ink: Ink | null = null) {
  if (encoding === RVP6_ENCODING) return rvp6Style(palette, ink);
  if (!isColumnEncoding(encoding)) return NOTHING;
  return columnStyle(encoding, ink ? columnGreyTable(encoding, ink) : columnTable(encoding));
}

/**
 * RGBA pixels for a tile's values (lib/valuePng.ts) in a palette.
 *
 * `coverage` is what a cut left of each pixel (tileMask.ts), null for all of
 * it: nothing where it was cut away, and part of a pixel on the cut's
 * antialiased edge, which fades the colour as `rvp6Style` does.
 */
export function paintValues(values: Uint8Array, coverage: Uint8Array | null, table: Rgba[]): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(values.length * 4);
  for (let pixel = 0, at = 0; pixel < values.length; pixel++, at += 4) {
    const kept = coverage ? coverage[pixel] : 255;
    const [r, g, b, a] = table[kept === 0 ? 0 : values[pixel]];
    pixels[at] = r;
    pixels[at + 1] = g;
    pixels[at + 2] = b;
    pixels[at + 3] = kept === 255 ? a : Math.round((a * kept) / 255);
  }
  return pixels;
}
