/**
 * Radar tiles in the reader's palette.
 *
 * Every radar product is rendered in the classic palette -- DWD's frames, the
 * four EUMETNET networks', the merged European composite -- and nothing else:
 * a tile holds only classic colours, so its colours *are* its reflectivities.
 * A palette is therefore one table, classic colour to the palette's colour at
 * the same dBZ, and every way a tile reaches the screen applies the same one:
 * DWD's WebGL layer as a `match` in its style (dwd.ts), the networks' canvas
 * layers and the 3D map's drape as a pass over the decoded pixels.
 *
 * The same dBZ, not the same position in the list. The palettes start at
 * different reflectivities (their `_LEFTPAD`), and DWD's WebGL layer used to
 * map classic colour *i* to the palette's colour *i*, which drew the map up to
 * 13.5 dBZ off its own legend; the table is built with `dbz2color`, the one the
 * legend, the timeline and the 3D map read, so all of them agree.
 */
import { RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD } from "../colormaps";
import type { Rgba } from "../colormaps";
import { dbz2color } from "../lib/cmap_utils";

/** Classic colour, as `0xRRGGBB`, to the palette's RGBA at the same reflectivity. */
export type Recolouring = ReadonlyMap<number, Rgba>;

const rgbKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

const tables = new Map<string, Recolouring | null>();

/**
 * The table for a palette, by the name the settings store it under; null for
 * the classic palette, which the tiles are already in.
 */
export function recolouringFor(name: string): Recolouring | null {
  if (!tables.has(name)) {
    if (name === "classic") {
      tables.set(name, null);
    } else {
      const table = new Map<number, Rgba>();
      RVP6_CLASSIC.forEach(([r, g, b], index) => {
        // The reflectivity classic colour `index` stands for; see dbz2color.
        const dbz = (index + RVP6_CLASSIC_LEFTPAD) / 2 - 32.5;
        table.set(rgbKey(r, g, b), dbz2color(dbz, name));
      });
      tables.set(name, table);
    }
  }
  return tables.get(name) ?? null;
}

/**
 * Recolour RGBA pixels in place. A transparent pixel stays so, and a colour
 * the table does not know -- none should reach here -- is left as it is.
 */
export function recolourPixels(pixels: Uint8ClampedArray, table: Recolouring): void {
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] === 0) continue;
    const to = table.get(rgbKey(pixels[at], pixels[at + 1], pixels[at + 2]));
    if (!to) continue;
    pixels[at] = to[0];
    pixels[at + 1] = to[1];
    pixels[at + 2] = to[2];
    pixels[at + 3] = to[3];
  }
}

/** A decoded tile, or a canvas already drawn on, recoloured onto a canvas of its own. */
export function recolourImage(
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number },
  table: Recolouring,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth ?? image.width;
  canvas.height = image.naturalHeight ?? image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  recolourPixels(data.data, table);
  context.putImageData(data, 0, 0);
  return canvas;
}
