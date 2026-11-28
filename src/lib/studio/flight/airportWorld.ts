/**
 * The airports round the aircraft, kept up as it flies: the basemap's
 * tiles about it are fetched, what they hold of airports is taken out
 * (airports.ts), and the tiles themselves are let go of again.
 *
 * At one zoom, whatever the map itself is drawing the ground from: the
 * coarsest whose tiles carry every runway, a tile some 25 km across in
 * central Europe. The nine about the aircraft are held, so every airport
 * within a tile's width of it is known, and its lights are there to be seen
 * long before it is reached; a few more are kept behind it, and the
 * furthest dropped. What is kept of a tile is a few hundred numbers.
 *
 * One of these for the page (`airportWorld`): the layer that draws the
 * airports and the flight deck that names the nearest read the same.
 */
import { mapEndpoint } from "../../../layers/protomaps";
import { airportsInTile, airportsOf } from "./airports";
import type { Airport, TileAirports } from "./airports";

/** The zoom the airports are read at. */
export const AIRPORT_ZOOM = 10;
/** How many tiles' airports are kept: the nine about the aircraft, and those last flown over. */
const KEPT_TILES = 16;
/** How many tiles are fetched at once. */
const AT_ONCE = 2;
/** How long a tile that would not load is left alone, ms. */
const RETRY_MS = 30_000;

/** The tile a place is in, at `zoom`: across and down, fractional. */
function tileAt(lon: number, lat: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const down = ((1 - Math.asinh(Math.tan((Math.min(Math.max(lat, -89), 89) * Math.PI) / 180)) / Math.PI) / 2) * n;
  return [((lon + 180) / 360) * n, Math.min(Math.max(down, 0), n - 1e-6)];
}

/**
 * The tile a place is in and the eight round it, the nearest to the place
 * first: round the earth east and west, and none past its top or bottom.
 */
export function tilesRound(lon: number, lat: number, zoom = AIRPORT_ZOOM): Array<[number, number]> {
  const n = 2 ** zoom;
  const [fx, fy] = tileAt(lon, lat, zoom);
  const found: Array<{ tile: [number, number]; distance: number }> = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const [x, y] = [Math.floor(fx) + dx, Math.floor(fy) + dy];
      if (y < 0 || y >= n) continue;
      found.push({ tile: [((x % n) + n) % n, y], distance: Math.hypot(x + 0.5 - fx, y + 0.5 - fy) });
    }
  }
  return found.sort((a, b) => a.distance - b.distance).map(({ tile }) => tile);
}

/** A tile's bytes, or null for a tile there is none of. Throws if it could not be had. */
export type TileLoader = (zoom: number, x: number, y: number) => Promise<ArrayBuffer | null>;

const fetchTile: TileLoader = async (zoom, x, y) => {
  const response = await fetch(`${mapEndpoint}/${zoom}/${x}/${y}.mvt`);
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(`basemap tile ${zoom}/${x}/${y}: ${response.status}`);
  return response.arrayBuffer();
};

interface Held {
  x: number;
  y: number;
  /** What it holds; null while it is being fetched, or after it would not load. */
  found: TileAirports | null;
  /** When it may be asked for again, ms on the page's clock, after it would not load. */
  retryAt: number;
  loading: boolean;
}

export class AirportWorld {
  /** Every airport known now. A new array whenever it changes, and `version` one more. */
  airports: Airport[] = [];
  version = 0;
  private readonly tiles = new Map<string, Held>();
  private loading = 0;
  private wanted: Array<[number, number]> = [];

  private readonly load: TileLoader;
  private readonly now: () => number;

  /** The tiles from the basemap, on the page's clock; or from wherever a test says. */
  constructor(load: TileLoader = fetchTile, now: () => number = () => performance.now()) {
    this.load = load;
    this.now = now;
  }

  /** The aircraft is here: fetch what is not yet known of the airports round it, and forget those far behind. */
  look(lon: number, lat: number): void {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    this.wanted = tilesRound(lon, lat);
    this.forget(lon, lat);
    this.fetchNext();
  }

  private fetchNext(): void {
    for (const [x, y] of this.wanted) {
      if (this.loading >= AT_ONCE) return;
      const key = `${x}/${y}`;
      let held = this.tiles.get(key);
      if (held && (held.found || held.loading || this.now() < held.retryAt)) continue;
      if (!held) {
        held = { x, y, found: null, retryAt: 0, loading: false };
        this.tiles.set(key, held);
      }
      const tile = held;
      tile.loading = true;
      this.loading += 1;
      this.load(AIRPORT_ZOOM, x, y).then((bytes) => {
        tile.found = bytes ? airportsInTile(bytes, AIRPORT_ZOOM, x, y) : { runways: [], taxiways: [], names: [] };
        // Dropped while it was on its way: not wanted any more.
        if (this.tiles.get(key) === tile && (tile.found.runways.length || tile.found.names.length)) this.gather();
      }, () => {
        tile.retryAt = this.now() + RETRY_MS;
      }).finally(() => {
        tile.loading = false;
        this.loading -= 1;
        this.fetchNext();
      });
    }
  }

  /** Drop the tiles furthest from the aircraft, down to as many as are kept. */
  private forget(lon: number, lat: number): void {
    if (this.tiles.size <= KEPT_TILES) return;
    const n = 2 ** AIRPORT_ZOOM;
    const [fx, fy] = tileAt(lon, lat, AIRPORT_ZOOM);
    const away = ({ x, y }: Held) => {
      const dx = Math.abs(x + 0.5 - fx);
      return Math.hypot(Math.min(dx, n - dx), y + 0.5 - fy);
    };
    const furthest = [...this.tiles.entries()].sort((a, b) => away(b[1]) - away(a[1]));
    let changed = false;
    for (const [key, held] of furthest.slice(0, this.tiles.size - KEPT_TILES)) {
      this.tiles.delete(key);
      if (held.found?.runways.length) changed = true;
    }
    if (changed) this.gather();
  }

  private gather(): void {
    const found: TileAirports[] = [];
    for (const held of this.tiles.values()) if (held.found) found.push(held.found);
    this.airports = airportsOf(found);
    this.version += 1;
  }
}

/** The page's airports. */
export const airportWorld = new AirportWorld();
