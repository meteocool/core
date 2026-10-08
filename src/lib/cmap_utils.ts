import {
  DIFF_HOMEYER,
  DIFF_LANG,
  DIFF_NWS,
  DIFF_PYART_STEPSEQ,
  DIFF_VIRIDIS, RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD,
  RVP6_HOMEYER,
  RVP6_HOMEYER_LEFTPAD,
  RVP6_LANG,
  RVP6_LANG_LEFTPAD,
  RVP6_NWS,
  RVP6_NWS_LEFTPAD,
  RVP6_PYART_STEPSEQ,
  RVP6_PYART_STEPSEQ_LEFTPAD,
  RVP6_VIRIDIS,
  RVP6_VIRIDIS_LEFTPAD,
} from "../colormaps";
import type { ColorDiff, Rgba } from "../colormaps";

/** A colormap: the RGBA ramp, its left padding, and the classic-map diff. */
export type ColorMap = [Rgba[], number, ColorDiff | never[]];

function rvp6ToPalette(cmap: Rgba[], offset: number) {
  return cmap.map((color, index) => {
    const [r, g, b, a] = color;
    return `${offset + index}:${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a.toString(16).padStart(2, "0")}`;
  }).join(";");
}

export function cmapFromString(cmapStr: string): ColorMap {
  switch (cmapStr) {
    case "nws":
      return [RVP6_NWS, RVP6_NWS_LEFTPAD, DIFF_NWS];
    case "viridis":
      return [RVP6_VIRIDIS, RVP6_VIRIDIS_LEFTPAD, DIFF_VIRIDIS];
    case "pyart_stepseq":
      return [RVP6_PYART_STEPSEQ, RVP6_PYART_STEPSEQ_LEFTPAD, DIFF_PYART_STEPSEQ];
    case "homeyer":
      return [RVP6_HOMEYER, RVP6_HOMEYER_LEFTPAD, DIFF_HOMEYER];
    case "lang":
      return [RVP6_LANG, RVP6_LANG_LEFTPAD, DIFF_LANG];
    case "classic":
    // fallthrough
    default:
      return [RVP6_CLASSIC, RVP6_CLASSIC_LEFTPAD, []];
  }
}

export function cmapDiffFromString(cmapString: string) {
  return cmapFromString(cmapString)[2];
}

export function getPalette(cmapStr: string) {
  const [cmap, offset] = cmapFromString(cmapStr);
  return rvp6ToPalette(cmap, offset);
}

/** An RVP6 byte as dBZ: half a dBZ a step, 0 at -32.5. */
export const rvp6ToDbz = (value: number): number => value / 2 - 32.5;

/**
 * Where round dBZ values fall on a palette's colour strip, 0 at its left end
 * and 1 at its right: every `step` dBZ the palette covers. Where they fall,
 * not spread evenly, since a palette need not start on a round value.
 */
export function dbzTicks(palette: string, step = 10): { dbz: number; at: number }[] {
  const values = palette.split(";").filter(Boolean).map((entry) => Number(entry.split(":")[0]));
  if (values.length < 2) return [];
  const [low, high] = [rvp6ToDbz(values[0]), rvp6ToDbz(values[values.length - 1])];
  const ticks: { dbz: number; at: number }[] = [];
  // `|| 0`: ceil of a small negative is -0.
  for (let dbz = Math.ceil(low / step) * step || 0; dbz <= high; dbz += step) {
    ticks.push({ dbz, at: (dbz - low) / (high - low) });
  }
  return ticks;
}

export function dbz2color(dbz: number, cmapStr: string): Rgba {
  const index = Math.round((dbz + 32.5) * 2);
  const [cmap, lpad] = cmapFromString(cmapStr);
  if (index < lpad) return [0, 0, 0, 0];
  let source = index - lpad;
  if (source > cmap.length - 1) {
    source = cmap.length - 1;
  }
  return cmap[source];
}
