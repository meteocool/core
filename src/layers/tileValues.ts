import { decodeValuePng } from "../lib/valuePng";
import { magnifyValues } from "../lib/packPixels";
import { maskCoverage } from "./tileMask";
import type { Extent, MaskPath } from "./tileMask";
import type { SourceTile } from "../lib/tileIndex";

/**
 * A fetched value tile as values: decoded (lib/valuePng.ts), the part `from`
 * names magnified past the frame's deepest zoom (lib/tileIndex.ts), and what
 * the cut leaves of each pixel (tileMask.ts). Shared by the flat map's
 * sources, in a worker or on the page (packTiles.ts), and the 3D map's
 * (maskedTiles.ts).
 */

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** One tile's values, a byte a pixel, `size` square, and how much of each the cut left: null for all of it. */
export interface TileValues {
  size: number;
  values: Uint8Array;
  coverage: Uint8Array | null;
}

/**
 * `png` as `TileValues`, or null where there is a cut to make and `canvas`
 * has no 2D canvas of the tile's size to make it on.
 */
export async function tileValues(
  png: ArrayBuffer,
  from: Pick<SourceTile, "scale" | "column" | "row">,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
  canvas: (size: number) => Context2D | null,
): Promise<TileValues | null> {
  const { width, height, values } = await decodeValuePng(png);
  if (width !== height) throw new Error(`a value tile is square, not ${width}x${height}`);
  const magnified = magnifyValues(values, width, from);
  if (!erase.length && !keep) return { size: width, values: magnified, coverage: null };
  const context = canvas(width);
  if (!context) return null;
  return { size: width, values: magnified, coverage: maskCoverage(context, extent, erase, keep) };
}

let pageContext: CanvasRenderingContext2D | null = null;

/** The page's one canvas to cut tiles on, at `size`. */
export function pageCanvas(size: number): CanvasRenderingContext2D | null {
  if (!pageContext) pageContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (pageContext && pageContext.canvas.width !== size) {
    pageContext.canvas.width = size;
    pageContext.canvas.height = size;
  }
  return pageContext;
}
