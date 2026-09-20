import { mapEndpoint, MAP_MAX_ZOOM } from "./protomaps";
import { imprintAttribution, osmAttribution, protomapsAttribution } from "./attributions";
import type { BasemapTheme } from "./protomaps";
import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from "maplibre-gl";

/**
 * The same basemap, described for MapLibre instead of OpenLayers.
 *
 * Both renderers read meteocool's own Protomaps tiles, and both take their
 * colours from the same `BasemapTheme` objects, so the 3D map is the flat map
 * seen from a different angle rather than a second basemap that drifts away
 * from it. What differs is only the dialect: OpenLayers calls a style function
 * per feature, MapLibre wants the whole thing declared up front.
 */

const SOURCE = "basemap";

/** Matches `roadWidth` in protomaps.ts: half weight at z6, 2.2x at z14. */
function widthByZoom(base: number): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 6, base * 0.5, 14, base * 2.2];
}

/**
 * Protomaps tags features with the zoom they are meant to appear at, and a
 * tile carries features for deeper zooms than it is drawn at. Honouring the
 * tag is what stops a z6 view drawing every hamlet in the tile.
 */
const ABOVE_MIN_ZOOM: ExpressionSpecification = [
  "any",
  ["!", ["has", "min_zoom"]],
  [">=", ["zoom"], ["get", "min_zoom"]],
];

/** A `kind` -> colour map becomes one `match` expression over that property. */
function matchKind(kinds: Record<string, string>, fallback: string): ExpressionSpecification | string {
  const entries = Object.entries(kinds);
  if (!entries.length) return fallback;
  // A `match` of arbitrary length is built at runtime, so its shape cannot be
  // checked against the spec's fixed-arity tuple; the pairs are strings either way.
  return [
    "match",
    ["get", "kind"],
    ...entries.flatMap(([kind, colour]) => [kind, colour]),
    fallback,
  ] as unknown as ExpressionSpecification;
}

export function basemapStyle(theme: BasemapTheme): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": theme.earth } },
    {
      id: "earth",
      type: "fill",
      source: SOURCE,
      "source-layer": "earth",
      paint: { "fill-color": theme.earth },
    },
  ];

  if (Object.keys(theme.landcover).length) {
    layers.push({
      id: "landcover",
      type: "fill",
      source: SOURCE,
      "source-layer": "landcover",
      paint: { "fill-color": matchKind(theme.landcover, "transparent"), "fill-antialias": false },
    });
  }

  if (Object.keys(theme.landuse).length) {
    layers.push({
      id: "landuse",
      type: "fill",
      source: SOURCE,
      "source-layer": "landuse",
      paint: { "fill-color": matchKind(theme.landuse, "transparent"), "fill-antialias": false },
    });
  }

  layers.push(
    {
      id: "water",
      type: "fill",
      source: SOURCE,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": theme.water },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": theme.waterway, "line-width": widthByZoom(1.2) },
    },
  );

  // Roads, weakest class first so a motorway is drawn over a track.
  const ordered = ["ferry", "rail", "path", "minor_road", "major_road", "highway"];
  ordered
    .filter((kind) => theme.roadKinds.includes(kind) && theme.roads[kind])
    .forEach((kind) => {
      const spec = theme.roads[kind];
      layers.push({
        id: `road-${kind}`,
        type: "line",
        source: SOURCE,
        "source-layer": "roads",
        filter: ["all", ["==", ["get", "kind"], kind], ABOVE_MIN_ZOOM],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": spec.color, "line-width": widthByZoom(spec.width) },
      });
    });

  // Flat, as on the 2D map: under a radar overlay they are texture, and
  // extruding them would compete with the storms this map exists to show.
  layers.push({
    id: "buildings",
    type: "fill",
    source: SOURCE,
    "source-layer": "buildings",
    minzoom: 14,
    paint: {
      "fill-color": theme.buildingFill,
      ...(theme.buildingStroke ? { "fill-outline-color": theme.buildingStroke } : {}),
    },
  });

  layers.push({
    id: "boundary-country",
    type: "line",
    source: SOURCE,
    "source-layer": "boundaries",
    filter: ["any", ["==", ["get", "kind"], "country"], ["==", ["get", "kind"], "unrecognized_country"]],
    paint: { "line-color": theme.boundaryCountry, "line-width": 1.2, "line-dasharray": [6, 4] },
  });

  if (theme.boundaryRegion) {
    layers.push({
      id: "boundary-region",
      type: "line",
      source: SOURCE,
      "source-layer": "boundaries",
      minzoom: 5,
      filter: ["==", ["get", "kind"], "region"],
      paint: { "line-color": theme.boundaryRegion, "line-width": 0.8, "line-dasharray": [4, 4] },
    });
  }

  return {
    version: 8,
    // No glyph or sprite endpoint: this style draws no text or icons, and
    // pointing at one meteocool does not host would fail on every tile.
    sources: {
      [SOURCE]: {
        type: "vector",
        tiles: [`${mapEndpoint}/{z}/{x}/{y}.mvt`],
        maxzoom: MAP_MAX_ZOOM,
        attribution: [osmAttribution, protomapsAttribution, imprintAttribution].join(" "),
      },
    },
    layers,
  };
}
