import TileLayer from "ol/layer/Tile";
import LayerGroup from "ol/layer/Group";
import VectorTileLayer from "ol/layer/VectorTile";
import XYZ from "ol/source/XYZ";
import TileState from "ol/TileState";
import type ImageTile from "ol/ImageTile";
import type Tile from "ol/Tile";
import { imprintAttribution, osmAttribution, protomapsAttribution, versatilesAttribution } from "./attributions";
import { RAISED_Z_INDEX, protomapsSource, themeStyleFunction } from "./protomaps";
import type { BasemapTheme } from "./protomaps";
import { darkTheme } from "./base";

/**
 * The satellite basemap: VersaTiles' merged imagery, Sentinel-2 cloudless
 * worldwide and national orthophotos over a growing part of Europe.
 *
 * 512 px WebP tiles. Everywhere has them to zoom 12; past that only the
 * orthophoto countries do, to zoom 17 (about 0.4 m a pixel). Elsewhere a tile past
 * 12 is a 404, so a missing tile is cut out of the nearest ancestor that
 * exists (see satelliteTile) instead of leaving a hole in the map.
 */
const SATELLITE_TILES = "https://tiles.versatiles.org/tiles/satellite-raster";

/** Nothing is served past this, though the TileJSON says 19; both maps overzoom instead. */
export const SATELLITE_MAX_ZOOM = 17;

/** The zoom every place on Earth has imagery to. */
export const SATELLITE_GLOBAL_ZOOM = 12;

const TILE_SIZE = 512;

const tileUrl = (z: number, x: number, y: number) => `${SATELLITE_TILES}/${z}/${x}/${y}`;

/**
 * Where tile (z, x, y) sits inside its ancestor `levels` zooms up: the
 * ancestor's coordinates, and the square of its pixels the tile covers.
 */
export function ancestorCrop(z: number, x: number, y: number, levels: number) {
  const scale = 2 ** levels;
  const size = TILE_SIZE / scale;
  return {
    z: z - levels,
    x: Math.floor(x / scale),
    y: Math.floor(y / scale),
    sx: (x % scale) * size,
    sy: (y % scale) * size,
    size,
  };
}

async function fetchImage(url: string, signal?: AbortSignal): Promise<Blob | null> {
  const response = await fetch(url, { signal });
  if (response.ok) return response.blob();
  if (response.status === 404) return null;
  throw new Error(`${response.status} for ${url}`);
}

/**
 * Tile (z, x, y), or where the imagery ends a crop of its nearest ancestor
 * scaled up to a whole tile; null if not even zoom 12 has it.
 *
 * Both maps need the fallback. OpenLayers and MapLibre alike draw a cached
 * parent over a missing tile, but only one they happen to hold: open the map
 * at zoom 14 over Warsaw and no zoom 12 tile was ever fetched, so the map
 * stayed blank. Walking up one zoom at a time, since how deep the
 * orthophotos go differs from country to country.
 */
export async function satelliteTile(
  z: number, x: number, y: number, signal?: AbortSignal,
): Promise<Blob | HTMLCanvasElement | null> {
  const own = await fetchImage(tileUrl(z, x, y), signal);
  if (own) return own;
  for (let levels = 1; z - levels >= 0; levels++) {
    const crop = ancestorCrop(z, x, y, levels);
    const blob = await fetchImage(tileUrl(crop.z, crop.x, crop.y), signal);
    if (!blob) {
      if (crop.z <= SATELLITE_GLOBAL_ZOOM) return null;
      continue;
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TILE_SIZE;
    canvas.getContext("2d")!.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, TILE_SIZE, TILE_SIZE);
    bitmap.close();
    return canvas;
  }
  return null;
}

/** The flat map's tiles, through satelliteTile. */
function loadSatelliteTile(tile: Tile) {
  const imageTile = tile as ImageTile;
  const [z, x, y] = imageTile.getTileCoord();
  satelliteTile(z, x, y).then((found) => {
    if (!found) {
      imageTile.setState(TileState.ERROR);
    } else if (found instanceof Blob) {
      const image = imageTile.getImage() as HTMLImageElement;
      const url = URL.createObjectURL(found);
      const revoke = () => URL.revokeObjectURL(url);
      image.addEventListener("load", revoke, { once: true });
      image.addEventListener("error", revoke, { once: true });
      // OpenLayers is already listening on this image, and takes it from here.
      image.src = url;
    } else {
      imageTile.setImage(found);
    }
  }).catch(() => imageTile.setState(TileState.ERROR));
}

/** The URL scheme the 3D map reads the imagery through; see installSatelliteProtocol. */
export const SATELLITE_SCHEME = "satellite";

/** The 3D map's tile template, answered by installSatelliteProtocol. */
export const SATELLITE_PROTOCOL_TILES = `${SATELLITE_SCHEME}://{z}/{x}/{y}`;

let protocolInstalled = false;

/** Teach MapLibre `satellite://z/x/y`, once, so its tiles get the same fallback. */
export function installSatelliteProtocol(maplibre: {
  addProtocol(scheme: string, load: (params: { url: string }, abort: AbortController) => Promise<{ data: unknown }>): void;
}): void {
  if (protocolInstalled) return;
  protocolInstalled = true;
  maplibre.addProtocol(SATELLITE_SCHEME, async (params, abort) => {
    const [z, x, y] = params.url.slice(`${SATELLITE_SCHEME}://`.length).split("/").map(Number);
    const found = await satelliteTile(z, x, y, abort.signal);
    if (!found) throw new Error(`no imagery for ${params.url}`);
    return { data: found instanceof Blob ? await found.arrayBuffer() : await createImageBitmap(found) };
  });
}

/**
 * The lines raised over the weather, as the dark basemap raises its own: the
 * coast, the borders and the motorways. The imagery shows all three until
 * radar covers it. No rivers: the imagery has them, and over an echo a line
 * for every river is clutter.
 */
export const satelliteTheme: BasemapTheme = {
  ...darkTheme,
  roadKinds: ["highway"],
  boundaryRegion: null,
  raised: {
    coastline: "rgba(150, 190, 220, 0.6)",
    waterway: null,
    boundaryCountry: "rgba(255, 255, 255, 0.55)",
    roads: {
      highway: "rgba(255, 255, 255, 0.22)",
    },
  },
};

/**
 * The same lines for the 3D map. There they lie on the imagery, under the
 * weather like everything else on that map, so they take the raised colours:
 * the dark theme's own would vanish into a forest.
 */
export const satelliteTheme3d: BasemapTheme = {
  ...satelliteTheme,
  roads: { highway: { ...darkTheme.roads.highway, color: satelliteTheme.raised!.roads.highway } },
  boundaryCountry: satelliteTheme.raised!.boundaryCountry,
  raised: undefined,
};

export function satellite() {
  const imagery = new TileLayer({
    source: new XYZ({
      url: `${SATELLITE_TILES}/{z}/{x}/{y}`,
      tileSize: TILE_SIZE,
      maxZoom: SATELLITE_MAX_ZOOM,
      crossOrigin: "anonymous",
      tileLoadFunction: loadSatelliteTile,
      attributions: [versatilesAttribution, imprintAttribution],
    }),
    zIndex: 1,
  });
  const lines = new VectorTileLayer({
    source: protomapsSource(["water", "roads", "boundaries"], [osmAttribution, protomapsAttribution]),
    style: themeStyleFunction(satelliteTheme, "lines"),
    zIndex: RAISED_Z_INDEX,
  });
  const layer = new LayerGroup({ layers: [imagery, lines] });
  // LayerManager finds the basemap to swap by this; see basemapLayer.
  layer.set("base", true);
  return layer;
}
