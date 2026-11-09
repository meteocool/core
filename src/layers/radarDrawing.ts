import type Map from "ol/Map";
import type { Extent } from "ol/extent";
import TileLayer from "./webglTile";
import type ValueTileSource from "./valueTiles";
import { staleOnlyWhileLoading } from "./valueTiles";
import { radarFrames } from "./radarFrames";
import { valueStyle } from "../lib/rvp6";
import type { Ink } from "../lib/rvp6";
import { radarTileCache } from "../lib/gpuBudget";

/**
 * How one radar source of the flat map is drawn: DWD's, a network's, a
 * product of all of theirs, a nowcast.
 *
 * Where the browser has WebGL2, every one of them is a slot of the map's one
 * frame layer (layers/radarFrames.ts), which switches each to its next frame
 * whole and keeps the loop's tiles on the GPU. Elsewhere, or with the
 * `radarRenderer` setting at "tiles", each is an OpenLayers WebGL tile layer
 * of its own, as before the frame layer (`TileDrawing`). The source behind
 * either is the same `ValueTileSource`, and the tiles the same jobs.
 */
export interface RadarDrawing {
  /** How strongly it is drawn, 0 to 1. */
  setOpacity(opacity: number): void;
  getOpacity(): number;
  setVisible(visible: boolean): void;
  /** What the bytes mean and the palette they are drawn in; in grey with an ink. Reloads nothing. */
  setLook(encoding: string, palette: string, ink: Ink | null): void;
  getLook(): Look;
  /** The rectangle it is drawn within, if any. */
  getExtent(): Extent | undefined;
  /** Whether it was taken off its map (`destroy`). */
  readonly disposed: boolean;
  /** Off the map for good. */
  destroy(): void;
}

/** What a source's bytes mean, and the palette they are drawn in: in grey with an ink. */
export interface Look {
  encoding: string;
  palette: string;
  ink: Ink | null;
}

/** How a source is drawn, from the start. */
export interface DrawingOptions extends Look {
  /** Which is drawn over which: the order OpenLayers' z-index gave the layers, higher on top. */
  order: number;
  /** A rectangle it is drawn within: a cheap first cut, the tiles' own cut being the real edge. */
  extent?: Extent;
  opacity: number;
  /** How many tiles an OpenLayers layer keeps on a desktop (`radarTileCache`). */
  cacheSize?: number;
}

/** A source drawn by an OpenLayers WebGL tile layer of its own. */
class TileDrawing implements RadarDrawing {
  private readonly layer: TileLayer;

  private readonly map: Map;

  private gone = false;

  private look: Look;

  constructor(map: Map, source: ValueTileSource, options: DrawingOptions) {
    this.map = map;
    this.look = { encoding: options.encoding, palette: options.palette, ink: options.ink };
    this.layer = staleOnlyWhileLoading(new TileLayer({
      source,
      style: valueStyle(options.encoding, options.palette, options.ink),
      zIndex: options.order,
      opacity: options.opacity,
      cacheSize: radarTileCache(options.cacheSize),
      extent: options.extent,
    }));
    map.addLayer(this.layer);
  }

  setOpacity(opacity: number) {
    this.layer.setOpacity(opacity);
  }

  getOpacity(): number {
    return this.layer.getOpacity();
  }

  setVisible(visible: boolean) {
    this.layer.setVisible(visible);
  }

  setLook(encoding: string, palette: string, ink: Ink | null) {
    this.look = { encoding, palette, ink };
    this.layer.setStyle(valueStyle(encoding, palette, ink));
  }

  getLook(): Look {
    return this.look;
  }

  getExtent(): Extent | undefined {
    return this.layer.getExtent();
  }

  get disposed(): boolean {
    return this.gone;
  }

  destroy() {
    this.gone = true;
    this.map.removeLayer(this.layer);
    this.layer.dispose();
  }
}

/** Draw `source` on `map`: as a slot of the map's frame layer where there is one, else a tile layer. */
export function radarDrawing(map: Map, source: ValueTileSource, options: DrawingOptions): RadarDrawing {
  return radarFrames(map)?.slot(source, options) ?? new TileDrawing(map, source, options);
}
