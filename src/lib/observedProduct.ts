/**
 * Which product the radar map draws its observed frames from.
 *
 * Pictures of the same weather, each a trade the reader makes:
 *
 * - `hx`, the default: DWD's HX over Germany, the lowest scan of every radar,
 *   with each EUMETNET network's own lowest-tilt composite around it.
 * - `merged`: meteocool's composite of all sixteen networks' lowest scans on
 *   one grid, drawn whole in place of HX and the networks' own composites.
 * - `colmax`: meteocool's column maximum of all sixteen networks, every tilt of
 *   every radar evened out across them, drawn whole like `merged`. Built once
 *   a cycle when the slowest network's volume is in, so a cycle or two
 *   behind HX.
 * - `dmax`: DWD's column maximum over Germany, the strongest echo over every
 *   tilt, with `colmax` around it where the other networks draw, so the
 *   picture is a column maximum throughout; the networks' composites stand
 *   in on a step `colmax` has no frame for. A cycle behind HX, because it
 *   needs the whole volume scan.
 * - `echotop18`, `echotop45`, `echotop50` and `vil`: how high each column's
 *   echo reaches 18, 45 and 50 dBZ, and how much liquid water it holds, read
 *   up the same tilts in the same pass as `colmax` and drawn whole like it. Heights and kilograms rather than dBZ, so they are drawn
 *   in palettes of their own (lib/columnValues.ts).
 *
 * The choice holds on every observed step. A forecast step is WN's whatever
 * was chosen: none of the others forecasts.
 *
 * Pure, with no store and no clock: RadarCapability holds the frames, and the
 * picker in the tray reads what it publishes.
 */

/** What the column maximum of every network's pass reads up each column besides it; see `PRODUCT_GROUPS`. */
export type ColumnProduct = "echotop18" | "echotop45" | "echotop50" | "vil";

export type ObservedProduct = "hx" | "merged" | "colmax" | "dmax" | ColumnProduct;

/** The products other than the default, as `/v3/radar/timeseries?products=` names them. */
export type AlternativeProduct = Exclude<ObservedProduct, "hx">;

/**
 * The picker's three kinds of picture. The first two each have DWD's own
 * first and meteocool's merge of all sixteen networks second: the lowest
 * scans, the rain nearest the ground, and the column maxima, the strongest
 * echo at any height. The third is meteocool's alone, read up the column
 * maximum's own tilts: how high the echo reaches and how much water the
 * column holds, a storm's height and its load rather than how strong its
 * echo is. After the column maxima, since it is read from the same tilts and
 * asks the most of the reader.
 */
export type ProductGroup = "lowest" | "column" | "tops";

/**
 * The echo tops upward through the storm, then VIL: the 18 dBZ top, its
 * precipitation's whole height, first, as the one that reads on any rain;
 * the 45 and 50 dBZ tops, how high its core reaches, which only a strong
 * storm has; and VIL, the water summed up the whole column, last.
 */
export const PRODUCT_GROUPS: readonly { group: ProductGroup; products: readonly ObservedProduct[] }[] = [
  { group: "lowest", products: ["hx", "merged"] },
  { group: "column", products: ["dmax", "colmax"] },
  { group: "tops", products: ["echotop18", "echotop45", "echotop50", "vil"] },
];

/**
 * The products of every network at once, each one frame over all of Europe
 * drawn whole in place of HX and the networks' composites: not DMAX, which
 * keeps Germany's own radar and draws on HX's grid.
 */
export const WHOLE_PRODUCTS = [
  "merged", "colmax", "echotop18", "echotop45", "echotop50", "vil",
] as const satisfies readonly AlternativeProduct[];

export type WholeProduct = (typeof WHOLE_PRODUCTS)[number];

/** Whether a product is one of every network's, drawn whole (`WHOLE_PRODUCTS`). */
export function isWholeProduct(product: ObservedProduct): product is WholeProduct {
  return (WHOLE_PRODUCTS as readonly ObservedProduct[]).includes(product);
}

/** In the order the picker lists them. */
export const OBSERVED_PRODUCTS: readonly ObservedProduct[] = PRODUCT_GROUPS.flatMap(({ products }) => products);

export const DEFAULT_PRODUCT: ObservedProduct = "hx";

/**
 * The product a forecast step is, whatever was chosen: WN is DWD's lowest
 * scan carried forward, the same quantity as HX, so the picker shows HX there
 * and offers nothing else.
 */
export const FORECAST_PRODUCT: ObservedProduct = "hx";

/** Each product's newest scan, unix seconds; null where it has no fresh frame to draw. */
export type NewestScans = Record<ObservedProduct, number | null>;

/**
 * How far a product's newest scan may trail the default's before the default
 * is drawn in its place.
 *
 * DMAX trails HX by up to a cycle in the ordinary run of things, and by two
 * when DWD skips one; a picture that is three cycles behind is no longer the
 * weather the reader asked to see more of, it is a stalled feed. The merged
 * composite is usually level with HX or ahead of it.
 */
export const FALLBACK_BEHIND_S = 10 * 60;

/**
 * The column maximum of every network is a cycle further back than DMAX: it
 * is built seven minutes into the cycle after its own, on a background
 * worker, so for a minute or two of every five it trails HX by two cycles,
 * and by three when one pass is late. The echo tops and VIL are built in the
 * same pass, from the same tilts, and trail HX as far.
 */
const COLUMN_PASS_BEHIND_S = FALLBACK_BEHIND_S + 5 * 60;

const BEHIND_ALLOWED_S: Record<AlternativeProduct, number> = {
  merged: FALLBACK_BEHIND_S,
  dmax: FALLBACK_BEHIND_S,
  colmax: COLUMN_PASS_BEHIND_S,
  echotop18: COLUMN_PASS_BEHIND_S,
  echotop45: COLUMN_PASS_BEHIND_S,
  echotop50: COLUMN_PASS_BEHIND_S,
  vil: COLUMN_PASS_BEHIND_S,
};

/** The value a setting holds, as a product: anything unknown is the default. */
export function parseObservedProduct(value: unknown): ObservedProduct {
  return OBSERVED_PRODUCTS.includes(value as ObservedProduct) ? (value as ObservedProduct) : DEFAULT_PRODUCT;
}

/**
 * Whether a product is not worth drawing now: it has nothing fresh, or its
 * newest scan trails the default's by more than it may (`BEHIND_ALLOWED_S`).
 *
 * Measured against the default rather than the clock: when every feed is
 * late together, which is a sleeping tab or a stalled backend, the default is
 * no better, and the map's own staleness warning is the one that applies.
 */
export function fallsBehind(product: ObservedProduct, scans: NewestScans): boolean {
  if (product === DEFAULT_PRODUCT) return false;
  const scan = scans[product];
  if (scan === null) return true;
  const reference = scans[DEFAULT_PRODUCT];
  return reference !== null && reference - scan > BEHIND_ALLOWED_S[product];
}

/** What the map draws: the reader's choice, or the default while the choice falls behind. */
export function drawnProduct(chosen: ObservedProduct, scans: NewestScans): ObservedProduct {
  return fallsBehind(chosen, scans) ? DEFAULT_PRODUCT : chosen;
}

/**
 * The drawn product's own frame for one step, or null where the default
 * stands there.
 *
 * Only on an observed step: none of them forecasts. On the live step, its own
 * newest frame, which its socket event keeps current between two timeseries;
 * elsewhere the one the timeseries matched onto the step. A step it has no
 * frame for (a gap in its ingest) shows the default, as a gap in a
 * network's history does.
 */
export function stepFrame<F>(
  product: AlternativeProduct,
  drawn: ObservedProduct,
  step: { observed: boolean; live: boolean; key: number },
  history: Record<number, F> | undefined,
  liveFrame: F | null,
): F | null {
  if (drawn !== product || !step.observed) return null;
  if (step.live) return liveFrame ?? history?.[step.key] ?? null;
  return history?.[step.key] ?? null;
}

/** Whole minutes since a scan, for the picker; null where there is none. */
export function ageMinutes(scan: number | null, nowS: number): number | null {
  if (scan === null) return null;
  return Math.max(0, Math.floor((nowS - scan) / 60));
}

/** The freshest and the stalest scan in what a product draws, unix seconds. */
export type ScanRange = readonly [freshest: number, stalest: number];

/**
 * The scans a product's picture is made of, freshest to stalest, given its
 * own newest, the newest of each network's composite, and the scan of the
 * `colmax` frame drawn around DMAX (null where the networks' are drawn there
 * instead). Null where the product has nothing fresh of its own.
 *
 * HX and DMAX cover Germany only, and the map draws every other country
 * beside them on its own clock: the picture runs from its freshest part to
 * its stalest, either of which may be a neighbour's (Czechia's composite is
 * often out before HX). Every network's products, the merged composite, the
 * column maximum and what its pass reads up the column, are one frame each,
 * stamped with their own newest scan.
 */
export function scanRange(
  product: ObservedProduct,
  own: number | null,
  networks: readonly number[],
  around: number | null,
): ScanRange | null {
  if (own === null) return null;
  if (isWholeProduct(product)) return [own, own];
  const parts = product === "dmax" && around !== null ? [own, around] : [own, ...networks];
  return [Math.max(...parts), Math.min(...parts)];
}

/** The products whose past the timeseries is asked for with: the choice's own, and for DMAX what is drawn around it. */
export function timeseriesProducts(chosen: ObservedProduct): AlternativeProduct[] {
  if (chosen === "hx") return [];
  return chosen === "dmax" ? ["dmax", "colmax"] : [chosen];
}

/**
 * The `colmax` frame drawn around DMAX on a step, where the networks'
 * composites otherwise are; null where DMAX is not drawn, or `colmax` has no
 * frame for the step; the networks' are drawn around it then, as for HX.
 * On the live step, its own newest only while that is not too far behind
 * (`fallsBehind`), as when it is chosen.
 */
export function aroundFrame<F>(
  drawn: ObservedProduct,
  step: { observed: boolean; live: boolean; key: number },
  history: Record<number, F> | undefined,
  liveFrame: F | null,
  scans: NewestScans,
): F | null {
  if (drawn !== "dmax") return null;
  if (step.live && fallsBehind("colmax", scans)) return null;
  return stepFrame("colmax", "colmax", step, history, liveFrame);
}

/**
 * Whether the reader's choice is to be given up for the default: one of the
 * EU products, which stand in for every network at once, with no fresh frame
 * at all once its feed has answered. Not DMAX, which keeps Germany's own
 * radar under it, and not one merely behind, which the default only stands
 * in for until it catches up (`drawnProduct`).
 */
export function givesUpChoice(chosen: ObservedProduct, scans: NewestScans, answered: boolean): boolean {
  return isWholeProduct(chosen) && answered && scans[chosen] === null;
}

/** How long ago a product's freshest and stalest scans were, in whole minutes; null where it has none. */
export function ageSpan(range: ScanRange | null, nowS: number): readonly [number, number] | null {
  if (range === null) return null;
  return [ageMinutes(range[0], nowS)!, ageMinutes(range[1], nowS)!];
}
