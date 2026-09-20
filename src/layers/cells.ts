import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Circle from "ol/style/Circle";
import Text from "ol/style/Text";
import type { FeatureLike } from "ol/Feature";

/**
 * Tracked thunderstorm cells: where each one has been, and where it is going.
 *
 * Five kinds of feature make up one cell, drawn from the same source so they
 * share a visibility toggle and a z-order: the path it has taken, its current
 * position, its outline, and the forecast centroids with the uncertainty
 * ellipse around each.
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
  return cached(`path:${severity}:${opacity}`, () => new Style({
    stroke: new Stroke({
      color: rgba(severityColour(severity), opacity),
      width: 2 + Math.min(severity, 3),
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
  return cached(`cell:${severity}:${opacity}:${hail}:${mark}`, () => new Style({
    image: new Circle({
      radius: 6 + 2 * Math.min(severity, 3),
      fill: new Fill({ color: rgba(colour, 0.75 * opacity) }),
      stroke: new Stroke({
        color: hail ? rgba("#e03131", opacity) : rgba("#ffffff", opacity),
        width: hail ? 3 : 1.5,
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

function forecastStyle(feature: FeatureLike): Style {
  const severity = feature.get("max_severity") ?? 0;
  return cached(`forecast:${severity}`, () => new Style({
    image: new Circle({ radius: 2, fill: new Fill({ color: rgba(severityColour(severity), 0.5) }) }),
  }));
}

/**
 * The cone of uncertainty, as an outline only.
 *
 * Filled, several overlapping cones turn a region of the map into a flat wash
 * and hide the radar under them, which is the one thing a chaser is comparing
 * the track against.
 */
function ellipseStyle(feature: FeatureLike): Style {
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

const STYLES: Record<CellFeatureKind, (feature: FeatureLike) => Style> = {
  path: pathStyle,
  cell: cellStyle,
  outline: outlineStyle,
  forecast: forecastStyle,
  ellipse: ellipseStyle,
};

/** The feature source, and the layer that draws it. */
export default function makeCellLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  return [
    source,
    new VectorLayer({
      source,
      // Above the mesocyclone markers at 201: a tracked cell carries the same
      // rotation information with the storm's history attached.
      zIndex: 202,
      style: (feature: FeatureLike) => {
        const style = STYLES[feature.get("kind") as CellFeatureKind];
        return style ? style(feature) : undefined;
      },
    }),
  ];
}

export { severityColour, ageOpacity };
