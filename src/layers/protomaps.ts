import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
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
 * used to come from, and the Nextzen tiles the label overlay used to come from
 * -- Nextzen now answers every request with "An API key is required" and no
 * longer issues keys, so that overlay had gone blank.
 */
const MAP_VERSION = import.meta.env.VITE_MAP_VERSION ?? "20260104";

/** The tileset stops here; OpenLayers overzooms past it. */
export const MAP_MAX_ZOOM = 15;

export const mapEndpoint = `https://map.meteocool.com/${MAP_VERSION}`;

/**
 * One source per layer set. MVT's `layers` option drops everything else before
 * it reaches the style function, which matters: a basemap that never draws
 * place labels should not be decoding them either.
 */
export function protomapsSource(layers: string[], attributions: string[]) {
  return new VectorTileSource({
    url: `${mapEndpoint}/{z}/{x}/{y}.mvt`,
    format: new MVT({ layers }),
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
}

/**
 * Road widths grow with zoom rather than staying pinned to one pixel value,
 * which is what made the first pass look like a wireframe at z12.
 */
function roadWidth(base: number, zoom: number): number {
  if (zoom <= 6) return base * 0.5;
  if (zoom >= 14) return base * 2.2;
  return base * (0.5 + ((zoom - 6) / 8) * 1.7);
}

/**
 * Builds a style function for one theme. Styles are memoised per
 * (layer, kind, zoom bucket): OpenLayers calls this once per feature per frame,
 * and allocating a Style each time is the difference between a smooth pan and a
 * stuttering one.
 */
export function themeStyleFunction(theme: BasemapTheme) {
  const cache = new Map<string, unknown>();

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
        return remember("earth", () => fillStyle(theme.earth, 0));

      case "water": {
        // Rivers and canals arrive as lines at high zoom and polygons below.
        const geometry = feature.getGeometry()?.getType();
        if (geometry === "LineString" || geometry === "MultiLineString") {
          const bucket = Math.round(zoom);
          return remember(`waterway:${bucket}`, () => strokeStyle(theme.waterway, roadWidth(1.2, zoom), 2));
        }
        return remember("water", () => fillStyle(theme.water, 2));
      }

      case "landcover": {
        const color = kind ? theme.landcover[kind] : undefined;
        if (!color) return undefined;
        return remember(`landcover:${kind}`, () => fillStyle(color, 1));
      }

      case "landuse": {
        const color = kind ? theme.landuse[kind] : undefined;
        if (!color) return undefined;
        return remember(`landuse:${kind}`, () => fillStyle(color, 1));
      }

      case "buildings": {
        // Buildings are noise under a radar overlay until you are well zoomed in.
        if (zoom < 14) return undefined;
        return remember("buildings", () => fillStyle(theme.buildingFill, 3, theme.buildingStroke));
      }

      case "roads": {
        if (!kind || !theme.roadKinds.includes(kind)) return undefined;
        const spec = theme.roads[kind];
        if (!spec) return undefined;
        const bucket = Math.round(zoom);
        return remember(`road:${kind}:${bucket}`, () => strokeStyle(spec.color, roadWidth(spec.width, zoom), 4));
      }

      case "boundaries": {
        if (kind === "country" || kind === "unrecognized_country") {
          return remember("boundary:country", () => strokeStyle(theme.boundaryCountry, 1.2, 5, [6, 4]));
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

/** Builds a basemap layer for one theme. */
export function basemapLayer(theme: BasemapTheme) {
  const layer = new VectorTileLayer({
    source: protomapsSource(
      ["earth", "water", "landcover", "landuse", "buildings", "roads", "boundaries"],
      [osmAttribution, protomapsAttribution, imprintAttribution],
    ),
    style: themeStyleFunction(theme),
    zIndex: 1,
  });
  // LayerManager reads this back with get("base") to find the basemap it should
  // swap; `base: true` as a constructor option would be dropped silently.
  layer.set("base", true);
  return layer;
}

/* -- style constructors, kept out of the hot path by the memo above -- */

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
