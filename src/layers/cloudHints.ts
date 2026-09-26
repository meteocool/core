import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import { isDarkBasemap, watchBasemap } from "./casing";
import { dbzColour } from "../lib/cellVolume";
import { radarColormap } from "../stores";
import type { RadarVolume } from "../api";

/**
 * A "3D" tag beside every storm core the 3D map can cut open.
 *
 * The flat map gives no sign that a shower has a volume behind it: the 3D map
 * is a tile in the layer switcher, and nothing on the radar says which of the
 * blobs on screen it could show standing up. This is that sign, and tapping it
 * is the way there -- App.svelte switches to the 3D map with the core open.
 *
 * ## What it looks like
 *
 * A small pill rather than a ring or a dot, because the flat map is already
 * full of dots and rings -- cell centroids, the live pulse, mesocyclones --
 * and a mark in the same language would read as one more of them. Beside the
 * core rather than on it, so it never covers the centroid a cell tap is aimed
 * at, and with a cube coloured by the core's peak on the radar's own ramp, so
 * a strong core stands out before it is opened.
 *
 * Decluttered among themselves only, strongest first: a line of showers can
 * put a dozen cores within a finger's width at a wide zoom, and a stack of
 * overlapping pills is neither readable nor tappable.
 */

/** Where the pill sits relative to the core, in pixels right and up. */
const DISPLACEMENT: [number, number] = [8, 8];

/** Drawn at twice its size and scaled down, so it stays crisp on a retina screen. */
const RENDER_SCALE = 2;

/** Peaks are bucketed so the cache holds a handful of styles, not one per core. */
const DBZ_STEP = 5;

/** Below this the pills are more clutter than signal: the whole country is on screen. */
const MIN_ZOOM = 5;

interface Palette {
  fill: string;
  edge: string;
  text: string;
}

const LIGHT: Palette = { fill: "rgba(255, 255, 255, 0.94)", edge: "rgba(17, 20, 26, 0.18)", text: "#11141a" };
const DARK: Palette = { fill: "rgba(24, 28, 36, 0.92)", edge: "rgba(255, 255, 255, 0.22)", text: "#f2f4f7" };

let palette = LIGHT;
let colormap = "classic";
const styleCache = new Map<string, Style>();

/**
 * The pill as an SVG, 34x18 at 1x.
 *
 * The cube is a filled hexagon with its three inner edges drawn in the pill's
 * own colour, which reads as a solid block at this size where a wireframe
 * reads as a smudge.
 */
function pillSvg(core: string): string {
  const { fill, edge, text } = palette;
  const s = RENDER_SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${34 * s}" height="${18 * s}" viewBox="0 0 34 18">`
    + `<rect x="0.5" y="0.5" width="33" height="17" rx="8.5" fill="${fill}" stroke="${edge}"/>`
    + `<path d="M10 4 L14.5 6.5 L14.5 11.5 L10 14 L5.5 11.5 L5.5 6.5 Z" fill="${core}"/>`
    + `<path d="M5.5 6.5 L10 9 L14.5 6.5 M10 9 L10 14" fill="none" stroke="${fill}" stroke-width="1" stroke-linejoin="round"/>`
    + `<text x="23.5" y="12.6" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" `
    + `font-size="9.5" font-weight="700" fill="${text}">3D</text>`
    + "</svg>";
}

function hintStyle(feature: FeatureLike): Style {
  const dbz = Math.round((feature.get("peak_dbz") ?? 40) / DBZ_STEP) * DBZ_STEP;
  const key = `${palette.fill}:${colormap}:${dbz}`;
  let style = styleCache.get(key);
  if (!style) {
    const [r, g, b] = dbzColour(dbz, colormap);
    style = new Style({
      image: new Icon({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pillSvg(`rgb(${r}, ${g}, ${b})`))}`,
        scale: 1 / RENDER_SCALE,
        anchor: [0, 1],
        displacement: DISPLACEMENT,
      }),
    });
    styleCache.set(key, style);
  }
  return style;
}

/** The feature source, and the layer that draws it. */
export default function makeCloudHintLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  const layer = new VectorLayer({
    source,
    // Over the tracked cells at 202: the pill is beside a centroid, never on
    // it, and where the two do touch it is the smaller target.
    zIndex: 203,
    minZoom: MIN_ZOOM,
    // A name of its own, so the pills give way to each other and not to the
    // place labels, which declutter together under `true`.
    declutter: "cloud-hints",
    // Earlier features win the declutter, so the strongest core keeps its pill.
    renderOrder: (a, b) => (b.get("peak_dbz") ?? 0) - (a.get("peak_dbz") ?? 0),
    style: hintStyle,
  });

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    layer.changed();
  });
  radarColormap.subscribe((name) => {
    colormap = name;
    layer.changed();
  });

  return [source, layer];
}

/** Replace the tagged cores with the newest scan's. Each feature carries its core for the tap. */
export function setCloudHints(source: VectorSource, clouds: RadarVolume[]): void {
  source.clear(true);
  source.addFeatures(clouds.map((cloud) => new Feature({
    geometry: new Point(fromLonLat([cloud.lon, cloud.lat])),
    peak_dbz: cloud.peak_dbz ?? null,
    cloud,
  })));
}
