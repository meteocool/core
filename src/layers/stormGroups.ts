import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import type { FeatureLike } from "ol/Feature";
import { DARK_CASING, LIGHT_CASING, isDarkBasemap, watchBasemap } from "./casing";

/**
 * Storms that are one system, as one outline round the area they share
 * (lib/stormGroups.ts).
 *
 * Content on the map, not chrome, and the quietest thing about a storm: a
 * thin line in the app's accent with a wash of it a few percent strong. The
 * radar's ramp runs from green through yellow and red to purple, and the
 * storms' marks are drawn in it; a blue that is none of those stays apart
 * from both without competing with either. The light map's accent and the
 * dark map's own, so it reads on both.
 *
 * Under the storm marks and the lightning, over the radar and the radar's
 * sweeps: it says which of the echoes belong together, and nothing on it is
 * tapped. Hidden with the storm marks, which it belongs to, and on its own
 * from the map key (StormKey, `system`).
 *
 * An outline that is not the radar frame's on screen (a newer scan than its
 * systems on the live step, or a frame earlier than it while playing back)
 * is drawn dashed, with a fainter wash: the shape is where the echoes were,
 * not where they are on the image under it. Its dashes are bolder than the
 * solid line and cased in the map's own colour, as the forecast cone's are:
 * a thin broken line on red and purple echoes is lost.
 */

/** The accent, light and dark (glass.css `--mc-accent`). */
export const GROUP_ACCENT = { light: "#007aff", dark: "#0a84ff" };

/** The dash of an outline that is another frame's, in pixels. */
export const STALE_DASH = [8, 6];

/** Over the radar (80) and its sweeps (85, 86), under the lightning (90 up) and the storms (200 up). */
export const GROUP_Z_INDEX = 88;

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/** A casing's colour, faded with what it backs. */
const fadeCasing = (colour: string, fade: number): string => (
  colour.replace(/[\d.]+\)$/, (alpha) => `${parseFloat(alpha) * fade})`)
);

/**
 * The style for the basemap, whether the outline is another frame's, and a
 * fade: one changing shape or look cross-fades, old out and new in
 * (lib/stormEasing.ts), through `fade`, in tenths.
 */
const styleFor = (dark: boolean, stale: boolean, fade: number): Style[] => {
  const accent = dark ? GROUP_ACCENT.dark : GROUP_ACCENT.light;
  const wash = new Fill({ color: rgba(accent, (dark ? 0.07 : 0.05) * (stale ? 0.5 : 1) * fade) });
  if (!stale) {
    return [new Style({
      stroke: new Stroke({ color: rgba(accent, (dark ? 0.8 : 0.7) * fade), width: 1.5, lineJoin: "round" }),
      fill: wash,
    })];
  }
  const dash = { lineDash: STALE_DASH, lineCap: "butt" as const, lineJoin: "round" as const };
  return [
    new Style({ stroke: new Stroke({ color: fadeCasing(dark ? DARK_CASING : LIGHT_CASING, fade), width: 4, ...dash }), fill: wash }),
    new Style({ stroke: new Stroke({ color: rgba(accent, 0.95 * fade), width: 2, ...dash }) }),
  ];
};

const tenthsOf = (dark: boolean, stale: boolean): Style[][] => (
  Array.from({ length: 11 }, (_, tenth) => styleFor(dark, stale, tenth / 10))
);

/** By basemap, then current or stale, then by fade in tenths. */
const STYLES = {
  light: { current: tenthsOf(false, false), stale: tenthsOf(false, true) },
  dark: { current: tenthsOf(true, false), stale: tenthsOf(true, true) },
};

const tenthOf = (feature: FeatureLike): number => Math.min(Math.max(Math.round((feature.get("fade") ?? 1) * 10), 0), 10);

/** The feature source, and the layer that draws it. */
export default function makeStormGroupLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  let styles = STYLES.light;
  const layer = new VectorLayer({
    source,
    zIndex: GROUP_Z_INDEX,
    style: (feature) => (feature.get("stale") ? styles.stale : styles.current)[tenthOf(feature)],
  });
  watchBasemap(isDarkBasemap, (dark) => {
    styles = dark ? STYLES.dark : STYLES.light;
    layer.changed();
  });
  return [source, layer];
}
