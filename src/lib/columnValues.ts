/**
 * Echo tops and VIL as value tiles: a byte a pixel in a unit of its own,
 * coloured here.
 *
 * The backend reads, up the same tilts as its column maximum of every
 * network and in the same pass, how high the echo reaches 18, 45 and 50 dBZ
 * and how much liquid water the column holds. Each is a frame of its own
 * whose `values.encoding` names its bytes: `height-250m-u8`, a top in 250 m
 * steps above sea level, and `vil-0.5kg-u8`, VIL in half kilograms a square
 * metre, 1 to 254 either way. 0 draws nothing (no echo reached the
 * threshold, under 0.25 kg, or no radar), and so does 255, should a tile
 * ever carry the backend's own "no radar".
 *
 * Each is drawn in a palette of its own, whatever the reader's reflectivity
 * palette is: a height or a weight in dBZ's colours would read as an echo's
 * strength. Both are matplotlib's perceptually even, colour-blind-safe
 * sequential maps, darker for less and brighter for more, and they share no
 * hue past their first tenth, so neither is taken for the other: viridis for
 * the tops, plasma for VIL. Like reflectivity's (lib/rvp6.ts), the 256-entry
 * table the GPU draws with and the legend are built from the same stops, so a
 * colour on the map is the value the legend gives it.
 */
import type { Rgba } from "../colormaps";

/** `values.encoding` of an echo top's frame: pixel × 250 m above sea level. */
export const ECHO_TOP_ENCODING = "height-250m-u8";

/** `values.encoding` of a VIL frame: pixel × 0.5 kg m⁻². */
export const VIL_ENCODING = "vil-0.5kg-u8";

export type ColumnEncoding = typeof ECHO_TOP_ENCODING | typeof VIL_ENCODING;

/** A byte for every value a tile can hold, as RVP6's table has. */
const ENTRIES = 256;

/** The backend's "no radar"; a tile carries 0 there instead, and either draws nothing. */
const NOT_COVERED = 255;

/** One value and its colour on a scale. */
type Stop = readonly [value: number, colour: Rgba];

/** How an encoding's bytes read, and how they are drawn. */
export interface ColumnScale {
  /** What one step of the byte is, in `unit`. */
  step: number;
  /** What the legend's last number is followed by. */
  unit: string;
  /**
   * The colours, each at its value, spaced evenly along the legend: a value
   * between two is coloured between them, one past either end as that end.
   */
  stops: readonly Stop[];
  /** The values the legend names, each one of `stops`'. */
  ticks: readonly number[];
}

const hex = (colour: string, alpha = 255): Rgba => [
  parseInt(colour.slice(1, 3), 16), parseInt(colour.slice(3, 5), 16), parseInt(colour.slice(5, 7), 16), alpha,
];

/**
 * An echo top, 0 to 16 km, in viridis from its second tenth: one tenth every
 * 2 km, linear in height. The three thresholds share it, so one height is
 * one colour whichever top it is. The usual storm's 18 dBZ top, about 4 km,
 * is a teal that stands on either basemap; a deep one's, past 12 km, is
 * light green to yellow. Viridis' first tenth, a violet near black, is left
 * out: it was lost on the dark basemap. The lowest 2 km fade in, as every
 * reflectivity palette's lowest values do: a top that low is a shallow
 * shower or the edge of one. Higher than 16 km, which a very wet day
 * reached once (16.5 km at most, 10 km its 99th percentile), is the top
 * colour.
 */
export const ECHO_TOP_SCALE: ColumnScale = {
  step: 0.25,
  unit: "km",
  stops: [
    [0, hex("#414487", 128)],
    [2, hex("#355f8d")],
    [4, hex("#2a788e")],
    [6, hex("#21918c")],
    [8, hex("#22a884")],
    [10, hex("#44bf70")],
    [12, hex("#7ad151")],
    [14, hex("#bddf26")],
    [16, hex("#fde725")],
  ],
  ticks: [0, 4, 8, 12, 16],
};

/**
 * VIL, 0.5 to 70 kg m⁻², in plasma: its eleven tenths, one at each stop,
 * and the stops closest at the low end. Most of any rain is under 2 kg (a
 * very wet day's median was 0.5), and the difference between 1 and 4 is
 * the one most often read, so the colour changes quickly there and slowly
 * past 20, which only a strong core reaches (13 was that day's 99.9th
 * percentile, 45 its maximum). The lowest values fade in, as for the tops.
 */
export const VIL_SCALE: ColumnScale = {
  step: 0.5,
  unit: "kg/m²",
  stops: [
    [0.5, hex("#0d0887", 128)],
    [1, hex("#41049d", 200)],
    [2, hex("#6a00a8")],
    [4, hex("#8f0da4")],
    [7, hex("#b12a90")],
    [10, hex("#cc4778")],
    [15, hex("#e16462")],
    [20, hex("#f2844b")],
    [30, hex("#fca636")],
    [45, hex("#fcce25")],
    [70, hex("#f0f921")],
  ],
  ticks: [1, 4, 10, 20, 45, 70],
};

const SCALES: Record<ColumnEncoding, ColumnScale> = {
  [ECHO_TOP_ENCODING]: ECHO_TOP_SCALE,
  [VIL_ENCODING]: VIL_SCALE,
};

/** Whether a frame's encoding is an echo top's or VIL's. */
export function isColumnEncoding(encoding: string | null | undefined): encoding is ColumnEncoding {
  return encoding === ECHO_TOP_ENCODING || encoding === VIL_ENCODING;
}

/** An encoding's scale. */
export function columnScale(encoding: ColumnEncoding): ColumnScale {
  return SCALES[encoding];
}

/**
 * A byte as what it measures, in its scale's unit (km for a top, kg m⁻² for
 * VIL); null where nothing is drawn: 0, 255 and anything that is no byte.
 */
export function columnValue(encoding: ColumnEncoding, byte: number): number | null {
  if (!Number.isInteger(byte) || byte <= 0 || byte >= NOT_COVERED) return null;
  return byte * SCALES[encoding].step;
}

/** Where a value falls between two stops: the first stop's index, and how far on to the next, 0 to 1. */
function segment(stops: readonly Stop[], value: number): [number, number] {
  if (value <= stops[0][0]) return [0, 0];
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) return [i - 1, (value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])];
  }
  return [stops.length - 2, 1];
}

/** A value's colour on a scale, between its two stops' and clamped at either end. */
export function colourAt(scale: ColumnScale, value: number): Rgba {
  const [i, f] = segment(scale.stops, value);
  const [from, to] = [scale.stops[i][1], scale.stops[i + 1][1]];
  return [0, 1, 2, 3].map((c) => Math.round(from[c] + f * (to[c] - from[c]))) as Rgba;
}

/** Where a value falls along the legend, 0 at its left end and 1 at its right: the stops evenly spaced. */
export function legendPosition(scale: ColumnScale, value: number): number {
  const [i, f] = segment(scale.stops, value);
  return (i + f) / (scale.stops.length - 1);
}

const tables = new Map<ColumnEncoding, Rgba[]>();

/** Byte to RGBA for an encoding; 0 and 255 are transparent. */
export function columnTable(encoding: ColumnEncoding): Rgba[] {
  let table = tables.get(encoding);
  if (!table) {
    const scale = SCALES[encoding];
    table = [];
    for (let byte = 0; byte < ENTRIES; byte++) {
      const value = columnValue(encoding, byte);
      table.push(value === null ? [0, 0, 0, 0] : colourAt(scale, value));
    }
    tables.set(encoding, table);
  }
  return table;
}

/**
 * The WebGLTile style that draws an echo top's or VIL's value tile.
 *
 * The same lookup as reflectivity's (`rvp6Style`): band 1 times 255 is the
 * byte, `palette` an exact step per byte, faded by band 4 where a cut has
 * left part of a pixel. Not the reader's palette: the encoding's own table,
 * or that table in grey under an open radar's sweep (`valueStyle` in
 * lib/rvp6.ts).
 */
export function columnStyle(encoding: ColumnEncoding, table: Rgba[] = columnTable(encoding)) {
  const colours = table.map(([r, g, b, a]) => [r, g, b, a / 255]);
  return {
    color: [
      "*",
      ["palette", ["*", ["band", 1], 255], colours],
      ["color", 255, 255, 255, ["band", 4]],
    ],
  };
}

const toHex = (c: number) => c.toString(16).padStart(2, "0");

/**
 * The legend's strip and the values it names: the strip as ScaleLine takes
 * it, `index:rrggbbaa` pairs sampled evenly along it, and each tick where it
 * falls (`legendPosition`).
 */
export function columnLegend(encoding: ColumnEncoding, samples = 64): {
  palette: string;
  ticks: { value: number; at: number }[];
  min: number;
  max: number;
  unit: string;
} {
  const scale = SCALES[encoding];
  const { stops } = scale;
  const entries: string[] = [];
  for (let i = 0; i <= samples; i++) {
    // Along the strip, back to a value: the stops are evenly spaced on it.
    const along = (i / samples) * (stops.length - 1);
    const at = Math.min(Math.floor(along), stops.length - 2);
    const value = stops[at][0] + (along - at) * (stops[at + 1][0] - stops[at][0]);
    entries.push(`${i}:${colourAt(scale, value).map(toHex).join("")}`);
  }
  return {
    palette: entries.join(";"),
    ticks: scale.ticks.map((value) => ({ value, at: legendPosition(scale, value) })),
    min: scale.step,
    max: stops[stops.length - 1][0],
    unit: scale.unit,
  };
}
