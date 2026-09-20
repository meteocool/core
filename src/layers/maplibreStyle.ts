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

/** #rrggbb to its three channels. */
function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const hex = (rgb: number[]): string => (
  `#${rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 255)).toString(16).padStart(2, "0")).join("")}`
);

/**
 * One colour, drained towards a backdrop.
 *
 * Desaturated first, then mixed towards `into`. Doing both matters: mixing
 * alone leaves a pale version of the same hue, and the hues are the problem --
 * the 3D map's storms are green through magenta and so is a basemap with
 * forests, farmland and motorways on it.
 */
function drain(colour: string, into: [number, number, number], amount: number): string {
  if (!colour.startsWith("#") || colour.length !== 7) return colour;
  const rgb = channels(colour);
  const grey = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return hex(rgb.map((c, i) => {
    const flat = c + (grey - c) * DESATURATE;
    return flat + (into[i] - flat) * amount;
  }));
}

/**
 * How much of each colour's own hue is given up before it is mixed away.
 *
 * Lowered along with the mix below, for the reason spelled out on `muteTheme`.
 * At 0.72 this flattened the theme to near-greyscale before the mix even ran,
 * which is why raising the mix alone changed almost nothing: forest came out
 * #eeefeb against an earth of #f6f4f0, a difference of four values, so the
 * only thing left distinguishing a map from a blank sheet was the dashed
 * borders. Enough hue survives now to tell water from farmland from forest.
 */
const DESATURATE = 0.35;

/**
 * The same theme with some of the life drained out of it.
 *
 * The 3D map is the one view where the basemap is not the subject. Its storms
 * are coloured by reflectivity -- a ramp that runs green, yellow, orange, red
 * -- and they stand on a map whose forests are green, whose farmland is
 * yellow, and whose motorways are orange. At a tilt, with a translucent
 * envelope over it, the two are genuinely hard to tell apart.
 *
 * Draining the theme rather than dropping the basemap's opacity, because the
 * fills overlap: landcover over earth over background, all semi-transparent,
 * comes out blotchy where they stack and lets the sky through where they do
 * not. Mixing the colours leaves every surface opaque and evenly quiet.
 *
 * The first version of this drained 0.55 of every surface into the earth
 * colour and went too far in the wrong place. What actually competes with the
 * storms there is the flat reflectivity raster under them, which covers the
 * same ground in the same ramp; the basemap was being quietened to make room
 * for a layer that was itself the problem. With the raster down to
 * RADAR_OPACITY in Cells3DCapability the extrusions are the only saturated
 * thing left, and the map can be a map again -- towns, water and roads legible
 * enough to say where a storm actually is, which is what the view is for.
 */
export function muteTheme(theme: BasemapTheme, amount = 0.2): BasemapTheme {
  const into = channels(theme.earth);
  const one = (colour: string) => drain(colour, into, amount);
  const each = (kinds: Record<string, string>) => Object.fromEntries(
    Object.entries(kinds).map(([kind, colour]) => [kind, one(colour)]),
  );
  return {
    ...theme,
    earth: theme.earth,
    water: one(theme.water),
    landcover: each(theme.landcover),
    landuse: each(theme.landuse),
    buildingFill: one(theme.buildingFill),
    buildingStroke: theme.buildingStroke ? one(theme.buildingStroke) : undefined,
    roads: Object.fromEntries(Object.entries(theme.roads).map(([kind, road]) => [kind, {
      ...road,
      color: one(road.color),
      casing: road.casing ? one(road.casing) : undefined,
    }])),
    // Borders stay as they are. They are thin dashed lines in a colour nothing
    // else on this map uses, and they are the only thing left telling you
    // which country a storm is over.
    boundaryCountry: theme.boundaryCountry,
    boundaryRegion: theme.boundaryRegion,
    waterway: one(theme.waterway),
  };
}


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
