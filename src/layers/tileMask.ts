/**
 * Erasing part of a tile image, or keeping only part of it, by polygon.
 *
 * The flat map and the 3D map draw the same radar in two renderers --
 * OpenLayers and MapLibre -- and neither can clip a raster layer to a polygon
 * on the GPU. What both can do is cut a tile's values before the renderer
 * sees them, by how much of each pixel a polygon drawn on a 2D canvas
 * leaves. This is that step, free of either renderer so `networkHoles.ts`
 * (OpenLayers) and `maskedTiles.ts` (MapLibre) make the same cut from the
 * same rings.
 *
 * Rings are web mercator (EPSG:3857) coordinates, as `extents.ts` holds
 * them; only tiles whose extent meets a polygon's bounding box need the
 * canvas, which `overlaps` decides cheaply first.
 */

/** Web mercator's half-extent in metres, which is also tile 0's half-width. */
const MERCATOR_LIMIT = 20037508.34;

export type Extent = [number, number, number, number];

/** One polygon: its rings, wound to nest, and their bounding box for a cheap first test. */
export interface MaskPath {
  rings: number[][][];
  bbox: Extent;
}

export const bboxOf = (rings: number[][][]): Extent => {
  const xs = rings.flat().map(([x]) => x);
  const ys = rings.flat().map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

export const maskPath = (rings: number[][][]): MaskPath => ({ rings, bbox: bboxOf(rings) });

export const overlaps = (a: Extent, b: Extent): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** The web-mercator extent of one XYZ tile. */
export function tileExtent(z: number, x: number, y: number): Extent {
  const span = (2 * MERCATOR_LIMIT) / 2 ** z;
  const west = -MERCATOR_LIMIT + x * span;
  const north = MERCATOR_LIMIT - y * span;
  return [west, north - span, west + span, north];
}

/**
 * How much of each pixel of a tile is left once every `erase` polygon is cut
 * out of it and, when `keep` is given, everything outside that polygon: 0 to
 * 255 a pixel, the antialiased edge in between. Drawn on `context`'s canvas,
 * a page's or a worker's (packTiles.worker.ts), which is the tile's size.
 *
 * Only the cut is drawn, never the tile: a canvas is free to colour-manage
 * what is drawn on it, and a value one off is another value
 * (lib/valuePng.ts). Its alpha it leaves alone.
 */
export function maskCoverage(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
): Uint8Array {
  const { width, height } = context.canvas;
  context.globalCompositeOperation = "copy";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  cutTile(context, extent, erase, keep);
  const rgba = context.getImageData(0, 0, width, height).data;
  const coverage = new Uint8Array(width * height);
  for (let pixel = 0; pixel < coverage.length; pixel++) coverage[pixel] = rgba[pixel * 4 + 3];
  return coverage;
}

/**
 * The cut, made on whatever is drawn in `context` already.
 *
 * `erase` is one path per polygon: the rings of one are wound to nest
 * correctly, and two networks' borders merely touch. `keep` is one polygon,
 * applied last so that erasing never brings anything back.
 */
export function cutTile(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
): void {
  const { width, height } = context.canvas;
  const [west, south, east, north] = extent;
  const trace = (rings: number[][][]) => {
    context.beginPath();
    for (const ring of rings) {
      ring.forEach(([mx, my], index) => {
        const px = ((mx - west) / (east - west)) * width;
        const py = ((north - my) / (north - south)) * height;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
    }
  };

  context.globalCompositeOperation = "destination-out";
  for (const { rings } of erase) {
    trace(rings);
    context.fill();
  }
  if (keep) {
    context.globalCompositeOperation = "destination-in";
    trace(keep.rings);
    context.fill();
  }
}
