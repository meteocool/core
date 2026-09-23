import ImageTileSource from "ol/source/ImageTile";
import TileLayer from "ol/layer/Tile";
import { getRenderPixel } from "ol/render";
import type { Map } from "ol";
import type RenderEvent from "ol/render/Event";
import { meteoSwissAttribution } from "./attributions";
import { chExclusiveCoverage, chRadarExtent } from "./extents";
import { tileSourceUrl } from "./dwd";
import { trackTileLoads } from "../lib/tileStatus";
import { NOWCAST_OPACITY } from "./ui";
import { fetchSwissRadar } from "../api";
import type { Progress } from "../api";

const commonChParameters = {
  attributions: [meteoSwissAttribution],
  crossOrigin: "anonymous" as const,
  minZoom: 3,
  maxZoom: 8,
  tileSize: 512,
  transition: 0,
  interpolate: false,
};

/**
 * An independent tile layer for MeteoSwiss's reflectivity composite.
 *
 * Deliberately not part of `RadarCapability`'s DWD grid/`GridStep` scrubbing:
 * Switzerland has no forecast timesteps to scrub through, just one composite
 * replaced every capture, so the two layers only share the tile-URL format
 * (`tileSourceUrl`, the same one DWD's layer builds from) and the map they
 * both render onto -- the same shape `processSnowOverlay` already uses for a
 * second, unrelated overlay next to the main radar layer.
 */
export default class SwissRadarLayer {
  private readonly map: Map;

  private layer: TileLayer<ImageTileSource> | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  /** Fetch the newest composite and show it, creating the layer on first use. */
  async refresh(nanobar?: Progress) {
    const frame = await fetchSwissRadar(nanobar).catch(() => null);
    if (!frame) return; // nothing captured yet, or the request failed

    const url = tileSourceUrl("meteoradar", frame.tile_id);
    if (this.layer) {
      (this.layer.getSource() as ImageTileSource | null)?.setUrl(url);
      return;
    }

    const source = trackTileLoads(new ImageTileSource({ ...commonChParameters, url }));
    this.layer = new TileLayer({
      source,
      // Just under DWD's 80. The clip below means they never cover the same
      // pixel, so this only settles which draws first.
      zIndex: 79,
      opacity: NOWCAST_OPACITY,
      cacheSize: 512,
      // The rectangle is a cheap first pass; `chExclusiveCoverage` is the real
      // edge, and an extent cannot describe it because it is not a rectangle.
      extent: chRadarExtent,
    });
    this.clipToExclusiveCoverage(this.layer);
    this.map.addLayer(this.layer);
  }

  /**
   * Draw this layer only where DWD does not reach.
   *
   * A canvas clip rather than opacity or a z-order: both networks colour dBZ
   * on their own scale, so wherever two of them are drawn over each other the
   * result is a blend that reads as a third intensity that neither measured.
   * Clipping keeps exactly one network's colours on any given pixel.
   *
   * This is why the layer is an `ol/layer/Tile` and not the `WebGLTile` its
   * DWD counterpart uses: the clip is a `CanvasRenderingContext2D` path, and
   * a WebGL layer's render events hand out no such context.
   */
  private clipToExclusiveCoverage(layer: TileLayer<ImageTileSource>) {
    layer.on("prerender", (event: RenderEvent) => {
      const context = event.context as CanvasRenderingContext2D | undefined;
      if (!context) return;
      context.save();
      context.beginPath();
      for (const ring of chExclusiveCoverage) {
        ring.forEach((coordinate, index) => {
          const [x, y] = getRenderPixel(event, this.map.getPixelFromCoordinate(coordinate));
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
      }
      context.clip();
    });
    // Paired with the save() above; without it the clip leaks onto whatever
    // the map draws next.
    layer.on("postrender", (event: RenderEvent) => {
      (event.context as CanvasRenderingContext2D | undefined)?.restore();
    });
  }

  destroy() {
    if (this.layer) {
      this.map.removeLayer(this.layer);
      this.layer = null;
    }
  }
}
