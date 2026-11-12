import type Tile from "ol/Tile";
import TileState from "ol/TileState";
import type TileSource from "ol/source/Tile";
import type { TileSourceEvent } from "ol/source/Tile";
import { tileStatus } from "../stores";

/**
 * When tiles last arrived, so the connection banner can say how stale the map
 * is and not only that the network is down, and which tiles failed, so they
 * can be asked for again.
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

/** A tile arrived: now is the last time one did. */
export function tileArrived(): void {
  tileStatus.update((s) => ({ ...s, lastSuccessAt: Date.now() }));
}

export function trackTileLoads<T extends TileSource>(source: T): T {
  source.on("tileloadend", tileArrived);
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
 * and one it is no longer drawing is never asked for. The caller
 * renders the maps, which is what has the renderer look.
 */
export function retryFailedTiles(): boolean {
  let any = false;
  for (const retry of retries) any = retry() || any;
  for (const tile of failed) {
    if (tile.getState() !== TileState.ERROR) continue;
    tile.setState(TileState.IDLE);
    any = true;
  }
  failed.clear();
  return any;
}

/** How far back the radar's tile outcomes are counted, for the `tile-errors` criterion (lib/degraded.ts). */
export const TILE_WINDOW_MS = 120_000;

/** When each radar tile asked for landed or failed, oldest first, within `TILE_WINDOW_MS`. */
const outcomes: { at: number; ok: boolean }[] = [];

/** A radar tile asked for has landed (`ok`) or failed (layers/radarFrames.ts). */
export function radarTileOutcome(ok: boolean, now: number = Date.now()): void {
  outcomes.push({ at: now, ok });
  while (outcomes.length && outcomes[0].at < now - TILE_WINDOW_MS) outcomes.shift();
}

/** How many radar tiles were asked for in the window, and how many of them failed. */
export function radarTileCounts(now: number = Date.now()): { asked: number; failed: number } {
  const recent = outcomes.filter((outcome) => outcome.at >= now - TILE_WINDOW_MS);
  return { asked: recent.length, failed: recent.filter((outcome) => !outcome.ok).length };
}

/** What loads tiles past OpenLayers' sources, asked to retry its failures with theirs. */
const retries = new Set<() => boolean>();

/**
 * Be asked by `retryFailedTiles` to retry the tiles that failed, answering
 * whether there was one: the radar's frame layer (layers/radarFrames.ts)
 * loads its own. The returned function stops it.
 */
export function onRetry(retry: () => boolean): () => void {
  retries.add(retry);
  return () => retries.delete(retry);
}
