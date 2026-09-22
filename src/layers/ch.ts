import ImageTileSource from "ol/source/ImageTile";
import TileLayer from "ol/layer/WebGLTile";
import type { Map } from "ol";
import { meteoSwissAttribution } from "./attributions";
import { chRadarExtent } from "./extents";
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

  private layer: TileLayer | null = null;

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
      // Just under DWD's 80: the two networks barely overlap, and where they
      // do, near the border, Germany's own layer should win.
      zIndex: 79,
      opacity: NOWCAST_OPACITY,
      cacheSize: 512,
      extent: chRadarExtent,
    });
    this.map.addLayer(this.layer);
  }

  destroy() {
    if (this.layer) {
      this.map.removeLayer(this.layer);
      this.layer = null;
    }
  }
}
