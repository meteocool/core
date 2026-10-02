import type Tile from "ol/Tile";
import TileState from "ol/TileState";
import type TileSource from "ol/source/Tile";
import type { TileSourceEvent } from "ol/source/Tile";
import { tileStatus } from "../stores";

/**
 * When tiles last arrived, so the connection banner can say how stale the map
 * is rather than only that the network is down -- and which ones did not, so
 * they can be asked for again.
 *
 * This hangs off OpenLayers' own source events rather than a custom
 * `tileLoadFunction`. A custom loader would have to be threaded through every
 * source and reimplement image loading to learn the same thing.
 */

/** Failed tiles kept for `retryFailedTiles`; past this the oldest go. */
const FAILED_KEPT = 400;

/**
 * Tiles that failed to load, until the next `retryFailedTiles`.
 *
 * OpenLayers never asks for a failed tile again. Its renderer queues only
 * tiles that have not been tried, so one lost while the network was down
 * stayed a hole in the radar until the map moved off it or the frame changed.
 */
const failed = new Set<Tile>();

export function trackTileLoads<T extends TileSource>(source: T): T {
  source.on("tileloadend", () => {
    tileStatus.update((s) => ({ ...s, lastSuccessAt: Date.now() }));
  });
  source.on("tileloaderror", (event: TileSourceEvent) => {
    if (failed.size >= FAILED_KEPT) failed.delete(failed.values().next().value!);
    failed.add(event.tile);
  });
  return source;
}

/**
 * Put every tile that failed back in line; true when there was one.
 *
 * Made idle rather than loaded here: the renderer queues an idle tile it is
 * drawing and loads it with the map watching, so it is drawn when it lands,
 * and one it is no longer drawing is simply never asked for. The caller
 * renders the maps, which is what has the renderer look.
 */
export function retryFailedTiles(): boolean {
  let any = false;
  for (const tile of failed) {
    if (tile.getState() !== TileState.ERROR) continue;
    tile.setState(TileState.IDLE);
    any = true;
  }
  failed.clear();
  return any;
}
