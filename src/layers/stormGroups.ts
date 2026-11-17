import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import type { FeatureLike } from "ol/Feature";
import { isDarkBasemap, watchBasemap } from "./casing";

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
 * tapped. Hidden with the storm marks, which it belongs to.
 */

/** The accent, light and dark (glass.css `--mc-accent`). */
export const GROUP_ACCENT = { light: "#007aff", dark: "#0a84ff" };

/** Over the radar (80) and its sweeps (85, 86), under the lightning (90 up) and the storms (200 up). */
export const GROUP_Z_INDEX = 88;

const rgba = (hex: string, alpha: number): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * The one style, for the basemap and a fade: every outline looks the same,
 * and one changing shape cross-fades, old out and new in (lib/stormEasing.ts),
 * through `fade`, in tenths.
 */
const styleFor = (dark: boolean, fade: number): Style => {
  const accent = dark ? GROUP_ACCENT.dark : GROUP_ACCENT.light;
  return new Style({
    stroke: new Stroke({ color: rgba(accent, (dark ? 0.8 : 0.7) * fade), width: 1.5, lineJoin: "round" }),
    fill: new Fill({ color: rgba(accent, (dark ? 0.07 : 0.05) * fade) }),
  });
};

/** By basemap, then by fade in tenths. */
const STYLES = {
  light: Array.from({ length: 11 }, (_, tenth) => styleFor(false, tenth / 10)),
  dark: Array.from({ length: 11 }, (_, tenth) => styleFor(true, tenth / 10)),
};

const tenthOf = (feature: FeatureLike): number => Math.min(Math.max(Math.round((feature.get("fade") ?? 1) * 10), 0), 10);

/** The feature source, and the layer that draws it. */
export default function makeStormGroupLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const source = new VectorSource({ features: [] });
  let styles = STYLES.light;
  const layer = new VectorLayer({
    source,
    zIndex: GROUP_Z_INDEX,
    style: (feature) => styles[tenthOf(feature)],
  });
  watchBasemap(isDarkBasemap, (dark) => {
    styles = dark ? STYLES.dark : STYLES.light;
    layer.changed();
  });
  return [source, layer];
}
