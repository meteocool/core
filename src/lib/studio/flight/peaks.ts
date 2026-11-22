/**
 * The mountain peaks of a flight, charted as a flight map has them: a small
 * triangle with the peak's name and its height in feet, the unit the
 * instruments read altitude in.
 *
 * Out of VersaTiles' OpenStreetMap tiles (the Shortbread schema), where a
 * peak comes with a name, its translations, a kind (peak, volcano, saddle)
 * and its height in metres, from zoom 10.
 *
 * They stand on the ground and are added under the storms, so a storm in
 * front of a peak veils its name as it would the mountain. The 3D map adds
 * them as it takes off (`Stage.setFlying`), again with every new style, and
 * takes them away on landing; it hands over its palette and the reader's
 * language each time, the letters being drawn from local fonts as its place
 * names are (layers/maplibreStyle.ts `placeLabels`).
 */
import type { ExpressionSpecification, FilterSpecification, Map as GlMap } from "maplibre-gl";
import { osmAttribution } from "../../../layers/attributions";
import { LABEL_FAMILY } from "../../../layers/labels";
import { FEET } from "../../../components/studio/flight/instruments";

const SOURCE = "flight-peaks-osm";
const PEAKS = "flight-peaks";
const PEAK_ICON = "flight-peak";

/** What the map is drawn over: its scheme, and whether that is the satellite imagery. */
export interface ChartLook {
  dark: boolean;
  satellite: boolean;
  /** The name properties to try in turn, as the map's place names have them (`name:de`, …). */
  nameKeys: string[];
}

interface ChartPalette {
  ink: string;
  halo: string;
  haloPx: number;
}

/**
 * A step quieter than the place names (layers/labels.ts), which are the
 * map's, and well under the storms: an ink short of the place names' and a
 * smaller size. The imagery is busy at every scale, light snow beside dark
 * forest, so over it the ink is white and the halo wider and darker.
 */
const PALETTES: Record<"light" | "dark" | "satellite", ChartPalette> = {
  light: { ink: "#2a2f36", halo: "rgba(246, 244, 240, 0.9)", haloPx: 1.2 },
  dark: { ink: "#ccd3dc", halo: "rgba(28, 31, 36, 0.9)", haloPx: 1.2 },
  satellite: { ink: "#f4f6f8", halo: "rgba(10, 12, 16, 0.8)", haloPx: 1.6 },
};

/**
 * Which peaks get a name. The tiles carry no prominence, only the height,
 * and the Alps have a few hundred named summits to a tile at zoom 10, so the
 * thinning is by height twice over. Each peak is placed after every higher
 * one in its tile and kept out of the room left round them, so only the
 * highest of a crowd shows, whatever the view: a stand-in for prominence,
 * worked out on the screen. And the coarser the tile, which under a flight's
 * tilt is the further off, the higher a peak has to be at all, so the
 * horizon is not a fringe of hilltops.
 */
const PEAK_FILTER = [
  "all",
  ["in", ["get", "kind"], ["literal", ["peak", "volcano"]]],
  ["==", ["typeof", ["get", "name"]], "string"],
  ["==", ["typeof", ["get", "ele"]], "number"],
  [">=", ["get", "ele"], ["step", ["zoom"], 2000, 11, 1200, 12, 600, 13, 0]],
] as unknown as FilterSpecification;

/** The room round a peak's name no other may take, px; as wide as the flight's place names' (Cells3DCapability). */
const PEAK_ROOM_PX = 30;

/** The first of these name properties that is a string and not empty, in the tiles' spelling (`name_de`). */
function peakName(nameKeys: string[]): ExpressionSpecification {
  const keys = [...new Set([...nameKeys.map((key) => key.replace(":", "_")), "name"])];
  return [
    "case",
    ...keys.flatMap((key) => [
      ["all", ["==", ["typeof", ["get", key]], "string"], ["!=", ["get", key], ""]], ["get", key],
    ]),
    "",
  ] as unknown as ExpressionSpecification;
}

/**
 * The peak's triangle as a signed distance field, so one image takes any
 * palette's ink and halo (`icon-color`, `icon-halo-color`). MapLibre's
 * convention: 0.75 at the edge, falling a quarter for every `RADIUS`
 * pixels out. Drawn at twice the size it is shown at.
 */
function peakIcon(): { width: number; height: number; data: Uint8Array } {
  const RADIUS = 6;
  const side = 16;
  const size = side + 2 * RADIUS;
  const tall = (side * Math.sqrt(3)) / 2;
  const top = (size - tall) / 2 + 1;
  const corners: Array<[number, number]> = [[size / 2, top], [RADIUS, top + tall], [size - RADIUS, top + tall]];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let nearest = Infinity;
      let inside = true;
      for (let i = 0; i < 3; i += 1) {
        const [ax, ay] = corners[i];
        const [bx, by] = corners[(i + 1) % 3];
        const ex = bx - ax;
        const ey = by - ay;
        const along = Math.min(Math.max(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey), 0), 1);
        nearest = Math.min(nearest, Math.hypot(px - ax - along * ex, py - ay - along * ey));
        // Wound anticlockwise as seen, rows running down: inside, every edge's cross product is negative.
        if (ex * (py - ay) - ey * (px - ax) > 0) inside = false;
      }
      const distance = inside ? -nearest : nearest;
      const value = Math.round(Math.min(Math.max(0.75 - distance / RADIUS / 4, 0), 1) * 255);
      data.set([255, 255, 255, value], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

function remove(gl: GlMap): void {
  if (gl.getLayer(PEAKS)) gl.removeLayer(PEAKS);
  if (gl.getSource(SOURCE)) gl.removeSource(SOURCE);
  if (gl.hasImage(PEAK_ICON)) gl.removeImage(PEAK_ICON);
}

/**
 * Put the peaks on the map, under `before` (the first of what the
 * map draws over the ground), in `look`'s palette. Anything left of an
 * earlier call goes first, so a new style or palette is simply added again.
 */
function add(gl: GlMap, look: ChartLook, before?: string): void {
  remove(gl);
  const palette = PALETTES[look.satellite ? "satellite" : look.dark ? "dark" : "light"];
  gl.addSource(SOURCE, {
    type: "vector",
    tiles: ["https://tiles.versatiles.org/tiles/osm-vector/{z}/{x}/{y}"],
    // No peaks below 10, and the far ground a tilt draws from coarser tiles is left without them.
    minzoom: 10,
    maxzoom: 14,
    attribution: osmAttribution,
  });
  gl.addImage(PEAK_ICON, peakIcon(), { pixelRatio: 2, sdf: true });
  gl.addLayer({
    id: PEAKS,
    type: "symbol",
    source: SOURCE,
    "source-layer": "mountain_peaks",
    filter: PEAK_FILTER,
    layout: {
      "icon-image": PEAK_ICON,
      "text-field": [
        "format",
        peakName(look.nameKeys), {},
        "\n", {},
        ["concat", ["to-string", ["round", ["*", ["get", "ele"], FEET]]], " ft"],
        { "font-scale": 0.92, "text-font": ["literal", [`${LABEL_FAMILY} Bold`, "sans-serif"]] },
      ] as unknown as ExpressionSpecification,
      "text-font": ["literal", [LABEL_FAMILY, "sans-serif"]] as unknown as string[],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.55],
      "text-max-width": 30,
      "text-padding": PEAK_ROOM_PX,
      "symbol-sort-key": ["-", ["get", "ele"]],
    },
    paint: {
      "icon-color": palette.ink,
      "icon-halo-color": palette.halo,
      "icon-halo-width": palette.haloPx,
      "text-color": palette.ink,
      "text-halo-color": palette.halo,
      "text-halo-width": palette.haloPx,
    },
  }, before);
}

/** Handed to the 3D map with the rest of the flight's code (support.ts). */
export const peaks = { add, remove };
