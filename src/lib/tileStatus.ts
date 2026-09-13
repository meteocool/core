import type TileSource from "ol/source/Tile";
import { tileStatus } from "../stores";

/**
 * When tiles last arrived, so the connection banner can say how stale the map
 * is rather than only that the network is down.
 *
 * This hangs off OpenLayers' own source events rather than a custom
 * `tileLoadFunction`. A custom loader would have to be threaded through every
 * source and reimplement image loading to learn the same thing.
 */
export function trackTileLoads<T extends TileSource>(source: T): T {
  source.on("tileloadend", () => {
    tileStatus.update((s) => ({ ...s, lastSuccessAt: Date.now() }));
  });
  return source;
}
