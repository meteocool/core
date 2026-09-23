import ImageTileSource from "ol/source/ImageTile";
import { chBorders } from "./extents";

/**
 * DWD tiles with Switzerland cut out of them.
 *
 * Inside Swiss borders the Swiss layer is the one that should be on screen, and
 * it cannot simply be stacked on top: its palette is part transparent, so DWD
 * underneath would blend through into colours neither radar measured. The
 * overlap has to actually go away, and it cannot go away by clipping the DWD
 * layer -- both of its variants are `ol/layer/WebGLTile`, whose render events
 * carry a `WebGLRenderingContext` and no 2D context to call `clip()` on.
 *
 * So the hole is punched into the tile images themselves, before OpenLayers
 * ever sees them. That works whichever renderer draws them.
 *
 * Only tiles that actually meet Switzerland are touched; the rest are handed
 * back exactly as loaded, so this costs nothing for the vast majority of the
 * German grid.
 */

/** Web mercator's half-extent in metres, which is also tile 0's half-width. */
const MERCATOR_LIMIT = 20037508.34;

type Extent = [number, number, number, number];

const bboxOf = (rings: number[][][]): Extent => {
  const xs = rings.flat().map(([x]) => x);
  const ys = rings.flat().map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

const SWITZERLAND_BBOX = bboxOf(chBorders);

const overlaps = (a: Extent, b: Extent) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** The web-mercator extent of one XYZ tile. */
function tileExtent(z: number, x: number, y: number): Extent {
  const span = (2 * MERCATOR_LIMIT) / 2 ** z;
  const west = -MERCATOR_LIMIT + x * span;
  const north = MERCATOR_LIMIT - y * span;
  return [west, north - span, west + span, north];
}

/**
 * The tile URL, with the template filled in.
 *
 * `{-y}` is TMS numbering, counting rows from the south, which is how the tiles
 * are published; OpenLayers hands the loader XYZ coordinates, counting from the
 * north. Getting this backwards mirrors the map vertically.
 */
function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{-y}", String(2 ** z - 1 - y))
    .replace("{y}", String(y));
}

function loadImage(url: string, crossOrigin: string | null): Promise<HTMLImageElement> {
  const image = new Image();
  if (crossOrigin !== null) image.crossOrigin = crossOrigin;
  image.src = url;
  return image.decode().then(() => image);
}

/** Erase Switzerland from one loaded tile, returning a canvas in its place. */
function withHole(image: HTMLImageElement, extent: Extent): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);

  const [west, south, east, north] = extent;
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  for (const ring of chBorders) {
    ring.forEach(([mx, my], index) => {
      const px = ((mx - west) / (east - west)) * canvas.width;
      const py = ((north - my) / (north - south)) * canvas.height;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.closePath();
  }
  context.fill();
  return canvas;
}

/** The bucket holding observations; the forecast lives in another. */
const OBSERVATION_BUCKET = "/meteoradar/";

/**
 * An `ImageTileSource` whose observation tiles have Switzerland erased.
 *
 * `setUrl` is where the radar capability re-points this at every playback step,
 * so the hole has to be re-applied there and not just at construction -- the
 * base class builds a plain loader from the URL, and this puts the masking one
 * back over it.
 *
 * Crucially the decision is made per URL, not once per source. Playback walks
 * a single source across both buckets, so a source that decided at
 * construction that it was the observation would go on cutting Switzerland out
 * of the forecast too -- and MeteoSwiss publishes no forecast to put there, so
 * that would leave the country blank for every step after t+0.
 */
export default class SwissHoleTileSource extends ImageTileSource {
  private readonly crossOriginValue: string | null;

  constructor(options: ConstructorParameters<typeof ImageTileSource>[0] & { url: string }) {
    const { url, ...rest } = options;
    super(rest);
    this.crossOriginValue = options.crossOrigin ?? null;
    this.setUrl(url);
  }

  setUrl(url: string) {
    super.setUrl(url);
    if (!url.includes(OBSERVATION_BUCKET)) return; // the forecast keeps Switzerland
    const crossOrigin = this.crossOriginValue;
    this.setLoader(async (z: number, x: number, y: number) => {
      const extent = tileExtent(z, x, y);
      const image = await loadImage(fillTemplate(url, z, x, y), crossOrigin);
      return overlaps(extent, SWITZERLAND_BBOX) ? withHole(image, extent) : image;
    });
  }
}
