import VectorTileLayer from "ol/layer/VectorTile";
import LayerGroup from "ol/layer/Group";
import VectorTileSource from "ol/source/VectorTile";
import TrimmedMVT from "./trimmedMVT";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import type { FeatureLike } from "ol/Feature";
import { imprintAttribution, osmAttribution, protomapsAttribution } from "./attributions";

/**
 * meteocool's own vector basemap: Protomaps-schema MVT served out of
 * Cloudflare at map.meteocool.com, versioned by build date.
 *
 * It replaces the third-party raster CDNs (CARTO, OSM, CyclOSM) the basemaps
 * used to come from, and the Nextzen tiles the label overlay used to come
 * from. Nextzen now answers every request with "An API key is required" and
 * no longer issues keys, so that overlay had gone blank.
 */
const MAP_VERSION = import.meta.env?.VITE_MAP_VERSION ?? "20260104";

/** The tileset stops here; OpenLayers overzooms past it. */
export const MAP_MAX_ZOOM = 15;

export const mapEndpoint = `https://map.meteocool.com/${MAP_VERSION}`;

/**
 * One source per layer set. Everything else is cut out of the tile before it
 * is read (./trimmedMVT), so a basemap that never draws place labels does not
 * decode them either.
 */
export function protomapsSource(layers: string[], attributions: string[]) {
  return new VectorTileSource({
    url: `${mapEndpoint}/{z}/{x}/{y}.mvt`,
    format: new TrimmedMVT({ layers }),
    attributions,
    maxZoom: MAP_MAX_ZOOM,
  });
}

/** Web Mercator resolution at zoom 0, for turning a resolution back into a zoom. */
const RESOLUTION_Z0 = 156543.03392804097;

/** The fractional zoom a render resolution corresponds to. */
export function zoomFromResolution(resolution: number): number {
  return Math.log2(RESOLUTION_Z0 / resolution);
}

/**
 * Protomaps tags most features with the zoom they are meant to appear at.
 * Honouring it is what keeps a z6 tile from drawing every hamlet in it.
 */
export function belowMinZoom(feature: FeatureLike, zoom: number): boolean {
  const minZoom = feature.get("min_zoom");
  return typeof minZoom === "number" && zoom < minZoom;
}

/** A basemap theme: flat colours plus the road/boundary weights drawn from them. */
export interface BasemapTheme {
  earth: string;
  water: string;
  /** `landcover` kinds, e.g. forest, farmland, grassland. Omit a kind to skip it. */
  landcover: Record<string, string>;
  /** `landuse` kinds, e.g. residential, industrial, park-like things. */
  landuse: Record<string, string>;
  buildingFill: string;
  buildingStroke?: string;
  /** Road casing/fill per `kind`; width is scaled by zoom. */
  roads: Record<string, { color: string; width: number; casing?: string }>;
  /** The smallest road class this theme draws at all. */
  roadKinds: string[];
  boundaryCountry: string;
  boundaryRegion: string | null;
  waterway: string;
  /**
   * The theme's lines (roads, borders, rivers and the coast) drawn over
   * the weather instead of under it with the fills, in these colours; see
   * `basemapLayer`. The colours above are then the 3D map's alone.
   */
  raised?: RaisedLines;
}

/**
 * A theme's lines as drawn over the radar. Their own colours, because what
 * reads on the bare ground vanishes over a radar echo: they are picked to show
 * over both.
 */
export interface RaisedLines {
  /** The water's edge. Under the weather the fills make the coast; over it, only a line can. */
  coastline: string;
  waterway: string;
  boundaryCountry: string;
  /** By road `kind`, for the kinds the theme draws. */
  roads: Record<string, string>;
}

/**
 * Which of a theme's features a layer draws: all of them, or, for a theme
 * that raises its lines, the fills under the weather and the lines over it.
 */
export type BasemapPart = "all" | "fills" | "lines";

/**
 * Where raised lines are drawn: over every radar layer (the networks' 79 and
 * 81, DWD's 80) and under the strikes, place names, storms and the wash over
 * where no radar reaches.
 */
const RAISED_Z_INDEX = 85;

/**
 * Road widths grow with zoom. Pinned to one pixel value, they looked like a
 * wireframe at z12.
 */
function roadWidth(base: number, zoom: number): number {
  if (zoom <= 6) return base * 0.5;
  if (zoom >= 14) return base * 2.2;
  return base * (0.5 + ((zoom - 6) / 8) * 1.7);
}

/**
 * Builds a style function for one theme. Styles are memoised per
 * (layer, kind, zoom bucket): OpenLayers calls this once per feature per frame,
 * and allocating a Style each time makes a pan stutter.
 */
export function themeStyleFunction(theme: BasemapTheme, part: BasemapPart = "all") {
  const cache = new Map<string, unknown>();
  const fills = part !== "lines";
  const lines = part !== "fills";
  const raised = part === "lines" ? theme.raised : undefined;

  const remember = <T>(key: string, make: () => T): T => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as T;
    const made = make();
    cache.set(key, made);
    return made;
  };

  return (feature: FeatureLike, resolution: number) => {
    const layer = feature.get("layer") as string;
    const zoom = zoomFromResolution(resolution);
    if (belowMinZoom(feature, zoom)) return undefined;

    const kind = feature.get("kind") as string | undefined;

    switch (layer) {
      case "earth":
        if (!fills) return undefined;
        return remember("earth", () => fillStyle(theme.earth, 0));

      case "water": {
        // Rivers and canals arrive as lines at high zoom and polygons below.
        const geometry = feature.getGeometry()?.getType();
        if (geometry === "LineString" || geometry === "MultiLineString") {
          if (!lines) return undefined;
          const bucket = Math.round(zoom);
          return remember(`waterway:${bucket}`, () => strokeStyle(raised?.waterway ?? theme.waterway, roadWidth(1.2, zoom), 2));
        }
        if (!fills) {
          // Only the edge: a fill over the weather would cover the radar
          // over every sea and lake.
          if (!raised) return undefined;
          return remember("coastline", () => strokeStyle(raised.coastline, 1, 2));
        }
        return remember("water", () => fillStyle(theme.water, 2));
      }

      case "landcover": {
        if (!fills) return undefined;
        const color = kind ? theme.landcover[kind] : undefined;
        if (!color) return undefined;
        return remember(`landcover:${kind}`, () => fillStyle(color, 1));
      }

      case "landuse": {
        if (!fills) return undefined;
        const color = kind ? theme.landuse[kind] : undefined;
        if (!color) return undefined;
        return remember(`landuse:${kind}`, () => fillStyle(color, 1));
      }

      case "buildings": {
        // Buildings are noise under a radar overlay until you are well zoomed in.
        if (!fills || zoom < 14) return undefined;
        return remember("buildings", () => fillStyle(theme.buildingFill, 3, theme.buildingStroke));
      }

      case "roads": {
        if (!lines || !kind || !theme.roadKinds.includes(kind)) return undefined;
        const spec = theme.roads[kind];
        if (!spec) return undefined;
        const bucket = Math.round(zoom);
        const color = raised?.roads[kind] ?? spec.color;
        return remember(`road:${kind}:${bucket}`, () => strokeStyle(color, roadWidth(spec.width, zoom), 4));
      }

      case "boundaries": {
        if (!lines) return undefined;
        if (kind === "country" || kind === "unrecognized_country") {
          return remember("boundary:country", () => strokeStyle(raised?.boundaryCountry ?? theme.boundaryCountry, 1.2, 5, [6, 4]));
        }
        if (kind === "region" && theme.boundaryRegion) {
          if (zoom < 5) return undefined;
          return remember("boundary:region", () => strokeStyle(theme.boundaryRegion!, 0.8, 5, [4, 4]));
        }
        return undefined;
      }

      default:
        return undefined;
    }
  };
}

/**
 * The tile layers a theme draws from. Landuse is the heavy one (1,400 to
 * 2,600 features a tile from z7 to z10, several times the cost of decoding
 * everything else in it), and light and dark draw none of it, so a theme
 * with no landuse colours does not decode it at all.
 */
export function themeLayers(theme: BasemapTheme): string[] {
  return [
    "earth",
    "water",
    ...(Object.keys(theme.landcover).length ? ["landcover"] : []),
    ...(Object.keys(theme.landuse).length ? ["landuse"] : []),
    "buildings",
    "roads",
    "boundaries",
  ];
}

/**
 * Builds a basemap layer for one theme.
 *
 * A theme that raises its lines is two layers over one source: the fills at
 * the bottom of the map, and the lines over the radar (RAISED_Z_INDEX). Under
 * the dark theme's radar, at three quarters opacity over a near-black ground,
 * the coast, the borders and the motorways were all gone, and a storm over
 * the Wadden Sea could have been anywhere. Sharing the source, the tiles are
 * fetched and decoded once for both.
 */
export function basemapLayer(theme: BasemapTheme) {
  const source = protomapsSource(
    themeLayers(theme),
    [osmAttribution, protomapsAttribution, imprintAttribution],
  );
  const layer = theme.raised
    ? new LayerGroup({
      layers: [
        new VectorTileLayer({ source, style: themeStyleFunction(theme, "fills"), zIndex: 1 }),
        new VectorTileLayer({ source, style: themeStyleFunction(theme, "lines"), zIndex: RAISED_Z_INDEX }),
      ],
    })
    : new VectorTileLayer({ source, style: themeStyleFunction(theme), zIndex: 1 });
  // LayerManager reads this back with get("base") to find the basemap it should
  // swap; `base: true` as a constructor option would be dropped silently.
  layer.set("base", true);
  return layer;
}

/* Style constructors, kept out of the hot path by the memo above. */

function fillStyle(color: string, zIndex: number, strokeColor?: string) {
  return new Style({
    fill: new Fill({ color }),
    stroke: strokeColor ? new Stroke({ color: strokeColor, width: 0.5 }) : undefined,
    zIndex,
  });
}

function strokeStyle(color: string, width: number, zIndex: number, lineDash?: number[]) {
  return new Style({
    stroke: new Stroke({ color, width, lineDash }),
    zIndex,
  });
}
