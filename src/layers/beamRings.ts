import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import Fill from "ol/style/Fill";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import { isDarkBasemap, watchBasemap } from "./casing";
import { beamHeightRings, EARTH_RADIUS_M } from "../lib/sweepGeometry";
import type { SweepGeometry } from "../lib/sweepGeometry";

/**
 * Rings of beam height round the open radar: where the chosen tilt's beam
 * centre is one, two, three kilometres above sea level.
 *
 * What a sweep shows is the sky at a height that grows with range, which is
 * the first thing a reader forgets: a couplet 150 km out at 0.5 degrees is
 * three kilometres up, not at the ground. The rings say so on the map itself,
 * labelled at the top of each, and move with the tilt.
 */

/** Points on each ring: smooth at any zoom a sweep is read at. */
const SEGMENTS = 128;

const LIGHT = { line: "rgba(17, 20, 26, 0.45)", text: "#11141a", halo: "rgba(255, 255, 255, 0.85)" };
const DARK = { line: "rgba(255, 255, 255, 0.45)", text: "#f2f4f7", halo: "rgba(17, 20, 26, 0.85)" };
let palette = LIGHT;

/** A circle of `groundM` round a point, on the sphere, as map coordinates. */
function circle(lon: number, lat: number, groundM: number): number[][] {
  const rad = Math.PI / 180;
  const phi1 = lat * rad;
  const lambda1 = lon * rad;
  const delta = groundM / EARTH_RADIUS_M;
  const points: number[][] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (2 * Math.PI * i) / SEGMENTS;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
    points.push(fromLonLat([lambda2 / rad, phi2 / rad]));
  }
  return points;
}

function ringStyle(feature: FeatureLike): Style {
  const label = feature.get("label") as string | undefined;
  if (label) {
    return new Style({
      text: new Text({
        text: label,
        font: "600 11px -apple-system, system-ui, sans-serif",
        fill: new Fill({ color: palette.text }),
        stroke: new Stroke({ color: palette.halo, width: 3 }),
      }),
    });
  }
  return new Style({ stroke: new Stroke({ color: palette.line, width: 1, lineDash: [4, 4] }) });
}

export interface BeamRings {
  layer: VectorLayer<VectorSource>;
  show(sweep: SweepGeometry): void;
  clear(): void;
}

export default function makeBeamRings(): BeamRings {
  const source: VectorSource = new VectorSource({ features: [] });
  const layer = new VectorLayer({ source, zIndex: 86, style: ringStyle, declutter: "beam-rings" });
  let shownKey = "";

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    layer.changed();
  });

  return {
    layer,
    show(sweep) {
      const key = `${sweep.lat}:${sweep.lon}:${sweep.elevation_deg}:${sweep.nbins * sweep.range_step_m}`;
      if (key === shownKey) return;
      shownKey = key;
      source.clear(true);
      for (const ring of beamHeightRings(sweep)) {
        const points = circle(sweep.lon, sweep.lat, ring.groundM);
        source.addFeature(new Feature({ geometry: new LineString(points) }));
        // Labelled at the ring's northernmost point.
        source.addFeature(new Feature({ geometry: new Point(points[0]), label: `${ring.heightM / 1000} km` }));
      }
    },
    clear() {
      shownKey = "";
      source.clear(true);
    },
  };
}
