/**
 * Precipitation types as value tiles: a byte per DWD HG class, coloured here.
 *
 * HG's class codes run to 2^24, so the backend gives each class a byte and
 * publishes the frame with `values.encoding` `hg-class-u8` (`HG_CLASS_BYTES`
 * in meteocool/ng's worker-radar `tiling.py`, and the API's `ClassTiles`). A
 * byte keeps its class for good; a new class takes a new byte, and has to be
 * added here to be drawn.
 */
import type { Rgba } from "../colormaps";
import { RVP6_ENTRIES } from "./rvp6";

/** `values.encoding` of a precipitation-type frame whose tiles hold class bytes. */
export const HG_CLASS_ENCODING = "hg-class-u8";

/** Each class's colour, by its byte; 0 and anything unlisted draw nothing. The colours DWD's classes always had. */
export const HG_CLASS_COLOURS: Rgba[] = [
  [0, 0, 0, 0],
  [0x78, 0x78, 0x78, 255], // 1 not classifiable
  [0x87, 0xcf, 0xeb, 255], // 2 drizzle
  [0, 0, 255, 255], // 3 rain
  [255, 255, 0, 255], // 4 snow
  [0, 255, 0, 255], // 5 sleet
  [255, 0x99, 0, 255], // 6 graupel
  [255, 0, 0, 255], // 7 hail
];

/**
 * The WebGLTile style that draws a class tile.
 *
 * A `palette` lookup, as for reflectivity: an exact step per byte, so no
 * pixel is ever a blend of two classes. Every byte past the last class is
 * transparent, so a class the backend adds before this table learns it is
 * not drawn as another.
 */
export function hgClassStyle() {
  const colours = Array.from({ length: RVP6_ENTRIES }, (_, i) => {
    const [r, g, b, a] = HG_CLASS_COLOURS[i] ?? [0, 0, 0, 0];
    return [r, g, b, a / 255];
  });
  return { color: ["palette", ["*", ["band", 1], 255], colours] };
}
