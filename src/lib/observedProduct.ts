/**
 * Which product the radar map draws its observed frames from (ng ADRs 0016, 0019).
 *
 * Four pictures of the same weather, each a trade the reader makes:
 *
 * - `hx`, the default: DWD's HX over Germany, the lowest scan of every radar,
 *   with each EUMETNET network's own lowest-tilt composite around it.
 * - `merged`: meteocool's composite of all five networks' lowest scans on
 *   one grid, drawn whole in place of the six.
 * - `colmax`: meteocool's column maximum of all five networks, every tilt of
 *   every radar evened out across them, drawn whole like `merged`. Built once
 *   a cycle when the slowest network's volume is in, so a cycle or two
 *   behind HX.
 * - `dmax`: DWD's column maximum over Germany, the strongest echo over every
 *   tilt, with the networks' composites around it as for HX. A cycle behind
 *   HX, because it needs the whole volume scan.
 *
 * The choice holds on every observed step. A forecast step is WN's whatever
 * was chosen: none of the others forecasts.
 *
 * Pure, with no store and no clock: RadarCapability holds the frames, and the
 * picker in the tray reads what it publishes.
 */

export type ObservedProduct = "hx" | "merged" | "colmax" | "dmax";

/** The products other than the default, as `/v3/radar/timeseries?products=` names them. */
export type AlternativeProduct = Exclude<ObservedProduct, "hx">;

/** In the order the picker lists them. */
export const OBSERVED_PRODUCTS: readonly ObservedProduct[] = ["hx", "merged", "colmax", "dmax"];

export const DEFAULT_PRODUCT: ObservedProduct = "hx";

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
 * and by three when one pass is late.
 */
const BEHIND_ALLOWED_S: Record<AlternativeProduct, number> = {
  merged: FALLBACK_BEHIND_S,
  dmax: FALLBACK_BEHIND_S,
  colmax: FALLBACK_BEHIND_S + 5 * 60,
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
 * frame for -- a gap in its ingest -- shows the default, as a gap in a
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
