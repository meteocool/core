import ImageTileSource from "ol/source/ImageTile";
import { chBorders, frBordersNearDwd } from "./extents";

/**
 * DWD tiles with the EUMETNET networks' countries cut out of them.
 *
 * Inside Swiss and French borders those networks' own layers are the ones that
 * should be on screen, and they cannot simply be stacked on top: every palette
 * here is part transparent, so DWD underneath would blend through into colours
 * neither radar measured. The overlap has to actually go away, and it cannot
 * go away by clipping the DWD layer -- both of its variants are
 * `ol/layer/WebGLTile`, whose render events carry a `WebGLRenderingContext`
 * and no 2D context to call `clip()` on.
 *
 * So the holes are punched into the tile images themselves, before OpenLayers
 * ever sees them. That works whichever renderer draws them.
 *
 * Only tiles that actually meet a hole are touched; the rest are handed back
 * exactly as loaded, so this costs nothing for the vast majority of the grid.
 */

/** Web mercator's half-extent in metres, which is also tile 0's half-width. */
const MERCATOR_LIMIT = 20037508.34;

type Extent = [number, number, number, number];

const bboxOf = (rings: number[][][]): Extent => {
  const xs = rings.flat().map(([x]) => x);
  const ys = rings.flat().map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Every network's hole, with its bounding box for a cheap first test. */
const HOLES = [chBorders, frBordersNearDwd].map((rings) => ({ rings, bbox: bboxOf(rings) }));

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

/** Erase every hole this tile meets, returning a canvas in its place. */
function withHoles(image: HTMLImageElement, extent: Extent, holes: typeof HOLES): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);

  const [west, south, east, north] = extent;
  context.globalCompositeOperation = "destination-out";
  for (const { rings } of holes) {
    // One path per network: the rings of one are wound to nest correctly, and
    // two networks' borders merely touch.
    context.beginPath();
    for (const ring of rings) {
      ring.forEach(([mx, my], index) => {
        const px = ((mx - west) / (east - west)) * canvas.width;
        const py = ((north - my) / (north - south)) * canvas.height;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
    }
    context.fill();
  }
  return canvas;
}

/**
 * An `ImageTileSource` whose tiles have the networks' countries erased -- but
 * only while it shows the live observation.
 *
 * The EUMETNET layers are one frame each, the newest: they have no history
 * and no forecast. So they are shown only while the map is on the live frame
 * (see `RadarCapability`), and for every other step DWD has to be whole again,
 * or scrubbing back an hour would leave Switzerland and France blank, and
 * scrubbing forward would leave them without the only forecast there is.
 *
 * `setUrl` is where the radar capability re-points this at every playback step,
 * so the decision is made there, per URL, against `liveUrl` -- which the
 * capability keeps on the newest observation. Deciding once per source would
 * be wrong in both directions: playback walks a single source across every
 * step, observations and forecasts alike.
 */
export default class NetworkHoleTileSource extends ImageTileSource {
  private readonly crossOriginValue: string | null;

  private url = "";

  private live = "";

  constructor(options: ConstructorParameters<typeof ImageTileSource>[0] & { url: string }) {
    const { url, ...rest } = options;
    super(rest);
    this.crossOriginValue = options.crossOrigin ?? null;
    // Built for the newest observation, which is what every caller hands it.
    this.live = url;
    this.setUrl(url);
  }

  /** Which URL is the live frame's, and so the one to cut holes into. */
  setLiveUrl(url: string) {
    if (url === this.live) return;
    this.live = url;
    // Re-decide for the URL already on screen: it may just have become, or
    // stopped being, the live one.
    if (this.url) this.setUrl(this.url);
  }

  setUrl(url: string) {
    this.url = url;
    super.setUrl(url);
    if (url !== this.live) return; // any other step: DWD is the only radar drawn
    const crossOrigin = this.crossOriginValue;
    this.setLoader(async (z: number, x: number, y: number) => {
      const extent = tileExtent(z, x, y);
      const image = await loadImage(fillTemplate(url, z, x, y), crossOrigin);
      const met = HOLES.filter((hole) => overlaps(extent, hole.bbox));
      return met.length ? withHoles(image, extent, met) : image;
    });
    // A key of their own for holed tiles. OpenLayers caches tiles by key, and
    // the key `super.setUrl` gave is the bare URL -- so without this, the frame
    // that was live a minute ago would go on serving its holes from the cache
    // after it had become history, and vice versa.
    this.setKey(`${url}#holes`);
  }
}
