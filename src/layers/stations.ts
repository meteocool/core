import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import Text from "ol/style/Text";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import CircleStyle from "ol/style/Circle";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import { dwdAttribution } from "./attributions";
import { DARK_CASING, DARK_INK, LIGHT_CASING, LIGHT_INK, isDarkBasemap, watchBasemap } from "./casing";
import { windBarb } from "../lib/windBarb";
import type { BarbShape } from "../lib/windBarb";
import {
  formatValue, isWind, precipitationDbz, temperatureColour, thinToGrid, valueOf, windOf,
} from "../lib/stations";
import type { ObservedProperties, PlacedStation, StationChoice } from "../lib/stations";
import { dbz2color } from "../lib/cmap_utils";
import type { ObservedFeature } from "../api";

/**
 * The weather stations over the radar map: a WMO wind barb at each for the wind
 * and the gusts (lib/windBarb.ts), a number for everything else.
 *
 * Barbs are drawn once per speed, direction and basemap into a canvas and
 * kept, so a map of three hundred costs a few dozen drawings. They turn with
 * the map, whose north they point by. Numbers carry a halo so they read over
 * the radar under them; temperature and rain are coloured by value, rain in
 * the radar's own palette.
 *
 * Thinned to one per screen-space cell further out than zoom 8 (`thin`),
 * rather than decluttered, so the ones left are spread evenly.
 */

/** A barb's ink and the casing that keeps it legible on whatever is under it. */
interface Palette {
  ink: string;
  casing: string;
}

const LIGHT: Palette = { ink: DARK_INK, casing: LIGHT_CASING };
const DARK: Palette = { ink: LIGHT_INK, casing: DARK_CASING };

/** The halo under a coloured number: dark on any basemap, so the colour is what reads. */
const COLOUR_HALO = "rgba(12, 16, 22, 0.85)";

const FONT = "700 14px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

/** Room around a barb's furthest point on its canvas, for the casing. */
const MARGIN = 3;

export interface StationLayer {
  layer: VectorLayer<VectorSource>;
  /** Draw the stations of an answer, for a choice; none clears the map. */
  show(stations: ObservedFeature[], choice: StationChoice): void;
  /** Thin the stations for the map at this zoom and resolution, one per `cell` pixels. */
  thin(cell: number, resolution: number): void;
  /** Rain is drawn in the radar's palette. */
  setPalette(palette: string): void;
}

/** Draw a barb (or the calm circle) into a canvas of its own, the station in its middle. */
function drawBarb(shape: BarbShape, palette: Palette, ratio: number): HTMLCanvasElement {
  const reach = shape.kind === "calm"
    ? shape.radius
    : Math.max(...[shape.shaft, ...shape.feathers, ...shape.pennants].flat().flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  const half = Math.ceil(reach + MARGIN);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = half * 2 * ratio;
  const context = canvas.getContext("2d")!;
  context.scale(ratio, ratio);
  context.translate(half, half);
  context.lineCap = "round";
  context.lineJoin = "round";

  // Twice: the casing wide underneath, then the ink.
  for (const [colour, width] of [[palette.casing, 3.4], [palette.ink, 1.5]] as const) {
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = width;
    context.beginPath();
    if (shape.kind === "calm") {
      context.arc(0, 0, shape.radius, 0, Math.PI * 2);
      context.stroke();
      continue;
    }
    for (const [[x0, y0], [x1, y1]] of [shape.shaft, ...shape.feathers]) {
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
    }
    context.stroke();
    for (const [a, b, c] of shape.pennants) {
      context.beginPath();
      context.moveTo(...a);
      context.lineTo(...b);
      context.lineTo(...c);
      context.closePath();
      context.fill();
      context.stroke();
    }
    // The station itself, where the shaft starts.
    context.beginPath();
    context.arc(0, 0, width === 1.5 ? 2 : 3, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

export default function makeStationLayer(): StationLayer {
  const source = new VectorSource({ attributions: dwdAttribution });
  let palette = LIGHT;
  let choice: StationChoice = "wind";
  let radarPalette = "classic";
  const barbs = new Map<string, Style>();
  const labels = new Map<string, Style>();

  const barbStyle = (knots: number, fromDeg: number): Style => {
    const shape = windBarb(knots, fromDeg);
    const key = shape.kind === "calm" ? "calm" : `${shape.knots}:${Math.round(fromDeg)}`;
    let style = barbs.get(key);
    if (!style) {
      const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
      style = new Style({
        image: new Icon({ img: drawBarb(shape, palette, ratio), scale: 1 / ratio, rotateWithView: true }),
      });
      barbs.set(key, style);
    }
    return style;
  };

  const labelStyle = (text: string, colour: string | null): Style => {
    const key = `${text}:${colour}`;
    let style = labels.get(key);
    if (!style) {
      style = new Style({
        text: new Text({
          text,
          font: FONT,
          fill: new Fill({ color: colour ?? palette.ink }),
          stroke: new Stroke({ color: colour ? COLOUR_HALO : palette.casing, width: 3.5 }),
          overflow: true,
        }),
      });
      labels.set(key, style);
    }
    return style;
  };

  /** A gauge that measured nothing: a small ring, so the gauge network still shows. */
  let dryGauge: Style | null = null;
  const dryStyle = (): Style => {
    dryGauge ??= new Style({
      image: new CircleStyle({
        radius: 2.5,
        fill: new Fill({ color: palette.casing }),
        stroke: new Stroke({ color: palette.ink, width: 1 }),
      }),
    });
    return dryGauge;
  };

  const style = (feature: FeatureLike): Style | undefined => {
    if (feature.get("thinned")) return undefined;
    const station = feature.get("observed") as ObservedProperties;
    if (isWind(choice)) {
      const wind = windOf(choice, station);
      return wind ? barbStyle(wind.knots, wind.fromDeg) : undefined;
    }
    const value = valueOf(choice, station);
    if (value === null) return undefined;
    let colour: string | null = null;
    if (choice === "temperature") colour = temperatureColour(value);
    if (choice === "precipitation") {
      const dbz = precipitationDbz(value);
      if (dbz === null) return dryStyle();
      const [r, g, b] = dbz2color(dbz, radarPalette);
      colour = `rgb(${r}, ${g}, ${b})`;
    }
    return labelStyle(formatValue(choice, value), colour);
  };

  const layer = new VectorLayer({
    source,
    // Over the radar and the lightning (90 to 120), under the storm marks
    // from 200 up: a storm is what is tapped where both are.
    zIndex: 150,
    visible: false,
    style,
    updateWhileAnimating: true,
    updateWhileInteracting: true,
  });

  const restyle = () => {
    barbs.clear();
    labels.clear();
    dryGauge = null;
    layer.changed();
  };

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    restyle();
  });

  /** The thinning last asked for, so a new answer is thinned the same way. */
  let thinning = { cell: 0, resolution: 1 };

  const applyThinning = () => {
    const { cell, resolution } = thinning;
    const placed: PlacedStation[] = [];
    for (const feature of source.getFeatures()) {
      const [x, y] = (feature.getGeometry() as Point).getCoordinates();
      const station = feature.get("observed") as ObservedProperties;
      // Only what is drawn takes a cell: a wind station with no direction
      // would otherwise leave a gap where its neighbour could have been.
      const drawn = isWind(choice) ? windOf(choice, station) !== null : valueOf(choice, station) !== null;
      if (!drawn) continue;
      const rank = choice === "precipitation" ? (valueOf(choice, station) ?? 0) : 0;
      placed.push({ id: String(feature.getId()), x: x / resolution, y: -y / resolution, rank });
    }
    const kept = thinToGrid(placed, cell);
    for (const feature of source.getFeatures()) feature.set("thinned", !kept.has(String(feature.getId())), true);
    layer.changed();
  };

  return {
    layer,
    show(stations, nextChoice) {
      choice = nextChoice;
      source.clear(true);
      source.addFeatures(stations.map((station) => {
        const [lon, lat] = station.geometry.coordinates;
        const feature = new Feature({ geometry: new Point(fromLonLat([lon, lat])), observed: station.properties });
        feature.setId(station.id);
        return feature;
      }));
      applyThinning();
    },
    thin(cell, resolution) {
      if (cell === thinning.cell && (cell === 0 || resolution === thinning.resolution)) return;
      thinning = { cell, resolution };
      applyThinning();
    },
    setPalette(next) {
      if (next === radarPalette) return;
      radarPalette = next;
      labels.clear();
      layer.changed();
    },
  };
}
