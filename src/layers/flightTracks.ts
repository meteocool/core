import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Icon from "ol/style/Icon";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import { faPlane } from "@fortawesome/free-solid-svg-icons/faPlane";
import { isDarkBasemap, watchBasemap } from "./casing";
import {
  firstPoint, flightTracks, lastPoint, pruneTracks, selectedFlightTrack, shownFraction, startFrom,
} from "../lib/studio/flightTracks";
import type { FlightTrack, TrackPoint } from "../lib/studio/flightTracks";

/**
 * The reader's own meteoair flights over the radar map (lib/studio/flightTracks.ts),
 * for two hours after they were flown.
 *
 * Drawn in an aircraft's magenta, the colour a flight deck draws the route
 * being flown in, and one the radar's ramps leave to their rarest echoes:
 * cased in the map's own background so it holds over any rain. A ring where
 * the flight took off, and the aircraft where it left off (after a crash,
 * where it was a moment before, which is where it is resumed from),
 * pointing the way it was going, so the track reads as a journey with both
 * of its ends.
 *
 * Each part of a track fades as it ages, its oldest first, and is gone two
 * hours after it was flown; the whole track is tappable, for its card
 * (components/FlightTrackCard.svelte). The one tapped is drawn wider.
 */

/** How many points go into each drawn piece of a track: each piece fades on its own, so a long track fades from its start. */
const PIECE = 12;
/** How finely the fade is stepped, for a cache of styles rather than one per piece. */
const FADE_STEPS = 20;
/** How often the fade moves on, ms, with nothing else changing. */
const REFRESH_MS = 60_000;
/** The faintest anything is drawn: below this a part is as good as gone. */
const FAINTEST = 0.08;

const MAGENTA: [number, number, number] = [236, 64, 214];

const rgba = ([r, g, b]: readonly number[], alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;

/** The aircraft at a track's end, drawn once per palette onto a canvas, pointing east as Font Awesome's does. */
function drawAircraft(dark: boolean, ratio: number): HTMLCanvasElement {
  const [width, height, , , path] = faPlane.icon;
  const size = 22;
  const pad = 3;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = (size + 2 * pad) * ratio;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const scale = (size * ratio) / Math.max(width, height);
  context.translate(pad * ratio + (size * ratio - width * scale) / 2, pad * ratio + (size * ratio - height * scale) / 2);
  context.scale(scale, scale);
  const shape = new Path2D(Array.isArray(path) ? path.join(" ") : path);
  context.lineJoin = "round";
  context.lineWidth = (2.5 * ratio) / scale;
  context.strokeStyle = dark ? "rgba(12, 16, 22, 0.85)" : "rgba(255, 255, 255, 0.95)";
  context.stroke(shape);
  context.fillStyle = rgba(MAGENTA, 1);
  context.fill(shape);
  return canvas;
}

export interface FlightTrackLayer {
  layer: VectorLayer<VectorSource>;
  /** Stop following the tracks and the basemap. */
  dispose(): void;
}

export default function makeFlightTrackLayer(): FlightTrackLayer {
  const source = new VectorSource();
  let dark = false;
  let selected: string | null = null;
  const styles = new Map<string, Style[]>();
  const aircraft = new Map<string, HTMLCanvasElement>();

  const step = (fraction: number) => Math.round(Math.min(Math.max(fraction, 0), 1) * FADE_STEPS) / FADE_STEPS;

  const lineStyle = (alpha: number, wide: boolean): Style[] => {
    const key = `line:${alpha}:${wide}:${dark}`;
    let style = styles.get(key);
    if (!style) {
      const casing = dark ? [12, 16, 22] : [255, 255, 255];
      style = [
        new Style({ stroke: new Stroke({ color: rgba(casing, 0.75 * alpha), width: wide ? 8 : 5.5, lineCap: "round", lineJoin: "round" }), zIndex: wide ? -1 : -2 }),
        new Style({ stroke: new Stroke({ color: rgba(MAGENTA, alpha), width: wide ? 4.5 : 2.5, lineCap: "round", lineJoin: "round" }), zIndex: wide ? 0 : -1 }),
      ];
      styles.set(key, style);
    }
    return style;
  };

  const startStyle = (alpha: number, wide: boolean): Style[] => {
    const key = `start:${alpha}:${wide}:${dark}`;
    let style = styles.get(key);
    if (!style) {
      const casing = dark ? [12, 16, 22] : [255, 255, 255];
      style = [new Style({
        image: new CircleStyle({
          radius: wide ? 6 : 5,
          fill: new Fill({ color: rgba(casing, 0.85 * alpha) }),
          stroke: new Stroke({ color: rgba(MAGENTA, alpha), width: wide ? 3 : 2.5 }),
        }),
      })];
      styles.set(key, style);
    }
    return style;
  };

  const endStyle = (alpha: number, wide: boolean, heading: number): Style[] => {
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const paletteKey = `${dark}:${ratio}`;
    let img = aircraft.get(paletteKey);
    if (!img) {
      img = drawAircraft(dark, ratio);
      aircraft.set(paletteKey, img);
    }
    // Not cached: one per track, each at its own heading.
    return [new Style({
      image: new Icon({
        img, scale: (wide ? 1.25 : 1) / ratio, opacity: alpha, rotateWithView: true,
        rotation: ((heading - 90) * Math.PI) / 180,
      }),
      zIndex: 1,
    })];
  };

  const style = (feature: FeatureLike): Style[] | undefined => {
    const now = Date.now();
    const alpha = step(shownFraction(feature.get("at") as number, now));
    if (alpha < FAINTEST) return undefined;
    const wide = feature.get("flightTrack") === selected;
    switch (feature.get("kind")) {
      case "start": return startStyle(alpha, wide);
      case "end": return endStyle(alpha, wide, (feature.get("heading") as number | null) ?? 90);
      default: return lineStyle(alpha, wide);
    }
  };

  const layer = new VectorLayer({
    source,
    style,
    // Over the radar, its labels, the lightning and the motion arrows; under the stations and the storms' own marks.
    zIndex: 145,
    // Drawn while the map moves, so the track never lags behind the radar under it.
    updateWhileAnimating: true,
    updateWhileInteracting: true,
    properties: { name: "flightTracks" },
  });

  const featuresOf = (track: FlightTrack): Feature[] => {
    const features: Feature[] = [];
    for (const leg of track.legs) {
      for (let from = 0; from < leg.length - 1; from += PIECE) {
        const piece: TrackPoint[] = leg.slice(from, from + PIECE + 1);
        if (piece.length < 2) continue;
        features.push(new Feature({
          geometry: new LineString(piece.map(([lon, lat]) => fromLonLat([lon, lat]))),
          flightTrack: track.id,
          kind: "line",
          // Each piece as old as its middle.
          at: piece[Math.floor(piece.length / 2)][3],
        }));
      }
    }
    const first = firstPoint(track);
    const last = lastPoint(track);
    if (first) {
      features.push(new Feature({ geometry: new Point(fromLonLat([first[0], first[1]])), flightTrack: track.id, kind: "start", at: first[3] }));
    }
    if (last) {
      // Where a resumed flight takes off: the end, or, after a crash, the moment before it.
      const resumed = startFrom(track.last);
      const at = resumed ? [resumed.lon, resumed.lat] : [last[0], last[1]];
      features.push(new Feature({
        geometry: new Point(fromLonLat(at)), flightTrack: track.id, kind: "end", at: last[3], heading: resumed?.heading ?? null,
      }));
    }
    return features;
  };

  const unsubscribeTracks = flightTracks.subscribe((tracks) => {
    source.clear(true);
    source.addFeatures(tracks.flatMap(featuresOf));
  });
  const unsubscribeSelected = selectedFlightTrack.subscribe((value) => {
    selected = value?.id ?? null;
    layer.changed();
  });
  const unsubscribeBasemap = watchBasemap(isDarkBasemap, (value) => {
    dark = value;
    layer.changed();
  });
  // The fade moves on with the clock, and what has faded is let go.
  const timer = window.setInterval(() => {
    pruneTracks();
    layer.changed();
  }, REFRESH_MS);

  return {
    layer,
    dispose() {
      unsubscribeTracks();
      unsubscribeSelected();
      unsubscribeBasemap();
      window.clearInterval(timer);
    },
  };
}
