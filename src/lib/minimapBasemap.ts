/**
 * Coasts and borders for the radar minimap, out of the basemap's own tiles.
 *
 * The minimap is a sketch, but a sketch with no ground under it leaves a
 * reader guessing which way the sea is. The flat map's Protomaps tiles carry
 * exactly the lines it needs -- the water, country and region borders -- and
 * at zoom 5 one tile spans most of a radar network, so two to four of them
 * cover any storm's radars. They are the tiles the basemap itself asks for
 * zoomed out, so they usually come from the browser's cache.
 *
 * Kept in degrees, so one decoded tile serves every storm under it.
 */
import TrimmedMVT from "../layers/trimmedMVT";
import { mapEndpoint } from "../layers/protomaps";

/** A line or ring as [lon, lat, lon, lat, ...]. */
export type Line = number[];

export interface Outlines {
  /** Ocean, sea and lake polygons' rings, for filling: holes wind the other way, so a nonzero fill leaves islands out. */
  water: Line[];
  /** The water's edge: the same rings, less where a tile cut them. */
  coast: Line[];
  country: Line[];
  /** States, regions and the like, `region` and `macroregion` in Protomaps. */
  region: Line[];
}

/** Coarse on purpose: country and region borders are already in at 5, and the coast is detailed enough at the minimap's scale. */
const ZOOM = 5;
const HALF_WORLD_M = 20037508.342789244;
const EARTH_RADIUS_M = 6378137;
/** Decoded tiles kept: about a network's worth, for flicking between storms. */
const CACHE_TILES = 24;

const format = new TrimmedMVT({ layers: ["boundaries", "water"] });
const cache = new Map<string, Promise<Outlines>>();

function tileExtent(x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF_WORLD_M) / 2 ** ZOOM;
  const west = -HALF_WORLD_M + x * size;
  const north = HALF_WORLD_M - y * size;
  return [west, north - size, west + size, north];
}

const lonOf = (mx: number) => (mx / EARTH_RADIUS_M) * (180 / Math.PI);
const latOf = (my: number) => (2 * Math.atan(Math.exp(my / EARTH_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);

/**
 * A tile's lines run on into a buffer round it, where they are clipped to the
 * buffer's edge. Filled, the overlap is harmless; stroked, the clip shows as a
 * square round every tile and the buffer is drawn twice. So for lines only
 * the stretches that touch the tile itself are kept: a neighbour has the rest.
 */
function insideRuns(flat: number[], from: number, to: number, extent: number[], out: Line[]) {
  const [w, s, e, n] = extent;
  const inside = (i: number) => flat[i] >= w && flat[i] <= e && flat[i + 1] >= s && flat[i + 1] <= n;
  let run: Line | null = null;
  for (let i = from; i < to - 2; i += 2) {
    if (inside(i) || inside(i + 2)) {
      if (!run) run = [lonOf(flat[i]), latOf(flat[i + 1])];
      run.push(lonOf(flat[i + 2]), latOf(flat[i + 3]));
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
}

function decode(buffer: ArrayBuffer, extent: [number, number, number, number]): Outlines {
  const outlines: Outlines = { water: [], coast: [], country: [], region: [] };
  for (const feature of format.readFeatures(buffer, { extent })) {
    const type = feature.getType();
    const flat = feature.getFlatCoordinates();
    const ends = (feature.getEnds() as number[] | null) ?? [flat.length];
    const layer = feature.get("layer");
    const kind = feature.get("kind");
    if (layer === "water" && type === "Polygon") {
      let start = 0;
      for (const end of ends) {
        const ring: Line = [];
        for (let i = start; i < end; i += 2) ring.push(lonOf(flat[i]), latOf(flat[i + 1]));
        outlines.water.push(ring);
        insideRuns(flat, start, end, extent, outlines.coast);
        start = end;
      }
    } else if (layer === "boundaries" && (type === "LineString" || type === "MultiLineString")) {
      const target = kind === "country" || kind === "unrecognized_country" ? outlines.country : outlines.region;
      let start = 0;
      for (const end of ends) {
        insideRuns(flat, start, end, extent, target);
        start = end;
      }
    }
  }
  return outlines;
}

/*
 * No abort: a tile is shared by whoever asks for it while it loads, and is
 * worth having for the next storm even if the one that asked has closed.
 */
function tile(x: number, y: number): Promise<Outlines> {
  const key = `${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = fetch(`${mapEndpoint}/${ZOOM}/${x}/${y}.mvt`)
    .then((response) => {
      if (!response.ok) throw new Error(`basemap tile ${key}: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((buffer) => decode(buffer, tileExtent(x, y)));
  // A failed tile is not kept: the next storm asks again.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Every outline in a box of degrees, from however many tiles it spans. */
export async function outlinesWithin(
  west: number, south: number, east: number, north: number,
): Promise<Outlines> {
  const n = 2 ** ZOOM;
  const column = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const row = (lat: number) => {
    const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
  };
  const jobs: Promise<Outlines>[] = [];
  for (let x = column(west); x <= column(east); x++) {
    for (let y = row(north); y <= row(south); y++) jobs.push(tile(x, y));
  }
  const tiles = await Promise.all(jobs);
  return {
    water: tiles.flatMap((t) => t.water),
    coast: tiles.flatMap((t) => t.coast),
    country: tiles.flatMap((t) => t.country),
    region: tiles.flatMap((t) => t.region),
  };
}
