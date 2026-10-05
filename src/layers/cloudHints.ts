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
import { isVolumeBehind } from "../lib/scans";
import type { RadarScans } from "../lib/scans";

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
 * overlapping pills is neither readable nor tappable. At a wide zoom they are
 * thinned further, to one per neighbourhood; see `SPACING_PX`.
 *
 * One per storm, not one per tile: a storm is boxed by every map tile it
 * covers, and a squall line would otherwise carry a pill on each. The pill
 * goes on the strongest of its tiles, which opens there.
 *
 * Only for a core as new as the radar under it. The 3D map draws one from an
 * older scan grey, a scan upwind of the echo, which is no place to send
 * anyone: the tag is taken off when the radar moves on and put back when that
 * scan's volumes land. See lib/scans.ts.
 */

/** Where the pill sits relative to the core, in pixels right and up. */
const DISPLACEMENT: [number, number] = [8, 8];

/** Drawn at twice its size and scaled down, so it stays crisp on a retina screen. */
const RENDER_SCALE = 2;

/** Peaks are bucketed so the cache holds a handful of styles, not one per core. */
const DBZ_STEP = 5;

/** Below this the pills are more clutter than signal: the whole country is on screen. */
const MIN_ZOOM = 5;

/**
 * How far apart the pills are kept at a wide zoom, in pixels, by whole zoom
 * level; closer than that, only the stronger core keeps its pill.
 *
 * Not overlapping is too little there. At zoom 6 a field of showers over the
 * German Bight is 150 pixels across and twenty pills that merely do not touch
 * tile it solid, saying "these have volumes" twenty times. One per
 * neighbourhood says it once, and the 3D map shows the rest. From zoom 9 the
 * cores stand far enough apart that overlap is the only rule.
 *
 * Measured on the map, at the level's own scale, so the same pills stay put
 * while the map pans and change only as it crosses a level.
 */
const SPACING_PX: Record<number, number> = { 5: 128, 6: 96, 7: 67, 8: 42 };

/** The resolution of zoom 0 in OpenLayers' default grid, which every View here uses. */
const ZOOM0_RESOLUTION = 156543.03392804097;

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
 * reads as a smudge. The 3D map has none: every storm on it stands in 3D.
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

const peakOf = (feature: FeatureLike): number => feature.get("peak_dbz") ?? 0;

/**
 * The strongest tile of each storm, by its `system`; each volume from before
 * tiles is a storm of its own. In the order given, bar the tiles left out.
 */
export function onePerStorm(clouds: RadarVolume[]): RadarVolume[] {
  const strongest = new Map<string, RadarVolume>();
  for (const cloud of clouds) {
    const storm = cloud.system ?? cloud.path;
    const held = strongest.get(storm);
    if (!held || (cloud.peak_dbz ?? 0) > (held.peak_dbz ?? 0)) strongest.set(storm, cloud);
  }
  const kept = new Set(strongest.values());
  return clouds.filter((cloud) => kept.has(cloud));
}

/**
 * The pills a whole zoom level keeps: strongest first, each one at least that
 * level's spacing from every stronger one kept. Null where every pill is kept.
 */
function thin(features: Feature[], zoom: number): Set<Feature> | null {
  const spacingPx = SPACING_PX[Math.max(zoom, MIN_ZOOM)];
  if (!spacingPx) return null;
  const spacing = spacingPx * (ZOOM0_RESOLUTION / 2 ** zoom);
  const kept: Array<[number, number]> = [];
  const keep = new Set<Feature>();
  for (const feature of [...features].sort((a, b) => peakOf(b) - peakOf(a))) {
    const [x, y] = (feature.getGeometry() as Point).getCoordinates();
    if (kept.some(([kx, ky]) => Math.hypot(x - kx, y - ky) < spacing)) continue;
    kept.push([x, y]);
    keep.add(feature);
  }
  return keep;
}

export interface CloudHints {
  layer: VectorLayer<VectorSource>;
  /** Replace the cores with the newest list's. */
  setClouds(clouds: RadarVolume[]): void;
  /** The radar the flat map draws, which a core must be as new as to be tagged. */
  setRadar(radar: RadarScans): void;
}

/** The layer, and the way to keep its tags up with the volumes and the radar. */
export default function makeCloudHints(): CloudHints {
  const source: VectorSource = new VectorSource({ features: [] });
  let clouds: RadarVolume[] = [];
  let radar: RadarScans = { scan: null, networks: {} };

  /*
   * Off the source rather than merely not drawn, so a core from an older scan
   * neither takes a fresh one's place in the thinning nor answers a tap. Each
   * feature carries its core for the tap.
   */
  const fill = () => {
    source.clear(true);
    source.addFeatures(onePerStorm(clouds.filter((cloud) => !isVolumeBehind(cloud, radar))).map((cloud) => new Feature({
      geometry: new Point(fromLonLat([cloud.lon, cloud.lat])),
      peak_dbz: cloud.peak_dbz ?? null,
      cloud,
    })));
  };

  /*
   * Thinned once per level and per set of cores, not per frame: the style
   * runs for every pill on every frame of a zoom. Keyed on the level, so a
   * zoom within it changes nothing; on the source's revision, so a new scan's
   * cores are thinned afresh.
   */
  let thinned: { zoom: number; revision: number; keep: Set<Feature> | null } | null = null;
  const keepsAt = (resolution: number): Set<Feature> | null => {
    const zoom = Math.floor(Math.log2(ZOOM0_RESOLUTION / resolution) + 1e-6);
    const revision = source.getRevision();
    if (thinned?.zoom !== zoom || thinned.revision !== revision) {
      thinned = { zoom, revision, keep: thin(source.getFeatures(), zoom) };
    }
    return thinned.keep;
  };

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
    renderOrder: (a, b) => peakOf(b) - peakOf(a),
    // Thinned away is not drawn, and so not tappable either.
    style: (feature, resolution) => {
      const keep = keepsAt(resolution);
      return !keep || keep.has(feature as Feature) ? hintStyle(feature) : undefined;
    },
  });

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    layer.changed();
  });
  radarColormap.subscribe((name) => {
    colormap = name;
    layer.changed();
  });

  return {
    layer,
    setClouds(next) {
      clouds = next;
      fill();
    },
    setRadar(next) {
      radar = next;
      fill();
    },
  };
}
