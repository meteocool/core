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
 * orthophoto countries do, to zoom 16 for most of them. Elsewhere a tile past
 * 12 is a 404, so a missing tile is cut out of the nearest ancestor that
 * exists (see loadSatelliteTile) instead of leaving a hole in the map.
 */
const SATELLITE_TILES = "https://tiles.versatiles.org/tiles/satellite-raster";

/** Past this the server answers 503 or nothing; OpenLayers overzooms instead. */
export const SATELLITE_MAX_ZOOM = 16;

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

async function fetchImage(url: string): Promise<Blob | null> {
  const response = await fetch(url);
  if (response.ok) return response.blob();
  if (response.status === 404) return null;
  throw new Error(`${response.status} for ${url}`);
}

/**
 * Loads one tile, falling back to a crop of its nearest ancestor where the
 * imagery ends.
 *
 * OpenLayers would draw a cached parent over an errored tile, but only one it
 * happens to hold: open the map at zoom 14 over Warsaw and no zoom 12 tile was
 * ever fetched, so the map stayed blank. Walking up one zoom at a time, since
 * how deep the orthophotos go differs from country to country.
 */
function loadSatelliteTile(tile: Tile, src: string) {
  const imageTile = tile as ImageTile;
  const [z, x, y] = imageTile.getTileCoord();
  (async () => {
    const own = await fetchImage(src);
    if (own) {
      const image = imageTile.getImage() as HTMLImageElement;
      const url = URL.createObjectURL(own);
      const revoke = () => URL.revokeObjectURL(url);
      image.addEventListener("load", revoke, { once: true });
      image.addEventListener("error", revoke, { once: true });
      // OpenLayers is already listening on this image, and takes it from here.
      image.src = url;
      return;
    }
    for (let levels = 1; z - levels >= 0; levels++) {
      const crop = ancestorCrop(z, x, y, levels);
      const blob = await fetchImage(tileUrl(crop.z, crop.x, crop.y));
      if (!blob) {
        if (crop.z <= SATELLITE_GLOBAL_ZOOM) break;
        continue;
      }
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = TILE_SIZE;
      canvas.getContext("2d")!.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, TILE_SIZE, TILE_SIZE);
      bitmap.close();
      imageTile.setImage(canvas);
      return;
    }
    imageTile.setState(TileState.ERROR);
  })().catch(() => imageTile.setState(TileState.ERROR));
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
