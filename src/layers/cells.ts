import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Circle from "ol/style/Circle";
import Text from "ol/style/Text";
import type { FeatureLike } from "ol/Feature";
import { selectedCell } from "../stores";

/**
 * Tracked thunderstorm cells: where each one has been, and where it is going.
 *
 * Five kinds of feature make up one cell, drawn from the same source so they
 * share a visibility toggle and a z-order: the path it has taken, its current
 * position, its outline, and the forecast centroids with the uncertainty
 * ellipse around each.
 *
 * ## What is drawn, and when
 *
 * The forecast is the loudest thing a cell owns and the least often wanted.
 * Each one carries a dozen predicted centroids and a nested ellipse per step,
 * and a busy afternoon over Germany puts two hundred cells on screen: the
 * result was some two and a half thousand dots and a couple of hundred large
 * dashed ellipses laid over each other, which buried the radar the tracks are
 * there to be compared against.
 *
 * So a cell at rest draws only what it has actually done -- where it has been,
 * where it is, and its outline -- and the whole predicted sequence appears for
 * the one cell whose popup is open. The map stays readable, and the detail is
 * a tap away rather than permanently spread across every storm at once.
 */

/** DWD's severity classes, in the colours their own charts use. */
const SEVERITY_COLOURS = ["#2f9e44", "#f0b429", "#e03131", "#9c36b5"];

export type CellFeatureKind = "path" | "cell" | "outline" | "forecast" | "ellipse";

const severityColour = (severity: number): string => SEVERITY_COLOURS[Math.min(Math.max(severity, 0), 3)];

/**
 * A track fades once its cell stops being detected.
 *
 * Without this a map left open through an afternoon fills up with storms that
 * dissipated an hour ago, all drawn as confidently as the live ones.
 */
const ageOpacity = (minutes: number): number => {
  if (minutes < 20) return 1;
  if (minutes < 40) return 0.6;
  if (minutes < 60) return 0.35;
  return 0.15;
};

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * The one thing about a cell worth seeing from across the map.
 *
 * Rotation first: a mesocyclone is the signature that separates a severe storm
 * from a heavy shower, and it is rarer than hail.
 */
const badge = (feature: FeatureLike): string => {
  if (feature.get("meso_ever")) return "↻";
  if (feature.get("hail_ever")) return "✦";
  return "";
};

const styleCache = new Map<string, Style>();

/**
 * The cell whose popup is open, or null.
 *
 * Held here rather than passed in because OpenLayers calls a style function
 * per feature per frame and has nowhere to thread state through it. The
 * subscription that maintains it also has to tell the layer to redraw --
 * nothing else changes when a selection does, so without that the map keeps
 * the styles it last worked out.
 */
let selectedCode: string | null = null;

/** Styles are shared by every feature that looks the same, as the other layers do. */
function cached(key: string, build: () => Style): Style {
  let style = styleCache.get(key);
  if (!style) {
    style = build();
    styleCache.set(key, style);
  }
  return style;
}

/** Opacity is bucketed so the cache has a handful of entries rather than one per cell. */
const bucket = (opacity: number): number => Math.round(opacity * 10) / 10;

function pathStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(feature.get("age_minutes") ?? 0));
  const picked = isSelected(feature);
  return cached(`path:${severity}:${opacity}:${picked}`, () => new Style({
    stroke: new Stroke({
      color: rgba(severityColour(severity), picked ? 1 : opacity),
      width: (picked ? 3 : 2) + Math.min(severity, 3),
      lineCap: "round",
      lineJoin: "round",
    }),
  }));
}

function cellStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  const opacity = bucket(ageOpacity(feature.get("age_minutes") ?? 0));
  const hail = Boolean(feature.get("hail_ever"));
  const mark = badge(feature);
  const colour = severityColour(severity);
  const picked = isSelected(feature);
  return cached(`cell:${severity}:${opacity}:${hail}:${mark}:${picked}`, () => new Style({
    image: new Circle({
      radius: (picked ? 8 : 6) + 2 * Math.min(severity, 3),
      fill: new Fill({ color: rgba(colour, (picked ? 1 : 0.75) * opacity) }),
      stroke: new Stroke({
        // The open popup's own cell, ringed so it is findable among the rest.
        color: hail ? rgba("#e03131", opacity) : rgba("#ffffff", opacity),
        width: picked ? 3.5 : (hail ? 3 : 1.5),
      }),
    }),
    text: mark
      ? new Text({
        text: mark,
        font: "bold 13px sans-serif",
        offsetY: -16,
        fill: new Fill({ color: rgba(colour, opacity) }),
        stroke: new Stroke({ color: rgba("#ffffff", opacity), width: 3 }),
      })
      : undefined,
  }));
}

/** Whether this feature belongs to the cell whose popup is open. */
const isSelected = (feature: FeatureLike): boolean => (
  selectedCode !== null && feature.get("code") === selectedCode
);

function forecastStyle(feature: FeatureLike): Style | undefined {
  if (!isSelected(feature)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  return cached(`forecast:${severity}`, () => new Style({
    image: new Circle({ radius: 2.5, fill: new Fill({ color: rgba(severityColour(severity), 0.75) }) }),
  }));
}

/**
 * The cone of uncertainty, as an outline only.
 *
 * Filled, several overlapping cones turn a region of the map into a flat wash
 * and hide the radar under them, which is the one thing a chaser is comparing
 * the track against.
 */
function ellipseStyle(feature: FeatureLike): Style | undefined {
  if (!isSelected(feature)) return undefined;
  const severity = feature.get("max_severity") ?? 0;
  return cached(`ellipse:${severity}`, () => new Style({
    stroke: new Stroke({
      color: rgba(severityColour(severity), 0.45),
      width: 1,
      lineDash: [4, 4],
    }),
  }));
}

function outlineStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  return cached(`outline:${severity}`, () => new Style({
    stroke: new Stroke({ color: rgba(severityColour(severity), 0.6), width: 1.5 }),
  }));
}

const STYLES: Record<CellFeatureKind, (feature: FeatureLike) => Style | undefined> = {
  path: pathStyle,
  cell: cellStyle,
  outline: outlineStyle,
  forecast: forecastStyle,
  ellipse: ellipseStyle,
};

/** The feature source, and the layer that draws it. */
export default function makeCellLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  const layer = new VectorLayer({
    source,
    // Above the mesocyclone markers at 201: a tracked cell carries the same
    // rotation information with the storm's history attached.
    zIndex: 202,
    style: (feature: FeatureLike) => {
      const style = STYLES[feature.get("kind") as CellFeatureKind];
      return style ? style(feature) : undefined;
    },
  });

  selectedCell.subscribe((track) => {
    const code = track?.code ?? null;
    if (code === selectedCode) return;
    selectedCode = code;
    layer.changed();
  });

  return [source, layer];
}

export { severityColour, ageOpacity };
