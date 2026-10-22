/**
 * Site mode's decisions: which sweep a timeline step shows, which tilts to
 * offer, and what to say when there is none.
 *
 * Sites scan on their own clocks: a German tilt is filed under its cycle's
 * minute, a French one under its own, a Polish volume under the minute it
 * began. So a step does not have "its" sweep; it shows the newest sweep
 * scanned by then, unless that is older than `MAX_AGE_S`, which is then "no
 * sweep" rather than old weather under a newer label.
 *
 * Pure: plain values in and out, so the unit tests can hold it.
 */
import type { SrvMotion } from "./srvMotion";

/** A sweep as `/sweeps` lists it: when it was scanned, and where its object is. */
export interface ListedScan {
  scanned_at: string;
  started_at?: string | null;
  path: string;
  bytes?: number;
  nyquist_m_s?: number | null;
  dealiased?: boolean;
}

/** One tilt as `/sweeps` lists it. */
export interface ListedTilt {
  elevation_deg: number;
  scans: ListedScan[];
}

/** One site as `/sweeps` lists it. */
export interface ListedSite {
  site: string;
  network: string;
  lat: number;
  lon: number;
  newest: string;
  reflectivity?: ListedTilt[];
  velocity?: ListedTilt[];
}

export type Quantity = "reflectivity" | "velocity" | "srv";

/** What the reader has open: one site, what to draw of it, and at which tilt. */
export interface SiteMode {
  site: string;
  quantity: Quantity;
  elevation: number;
}

/** A sweep this much older than the step it would be shown on is not shown: two cycles. */
export const MAX_AGE_S = 600;

/** Two tilts this close are one: Meteo-France's lowest is 0.39 on one cycle and 0.4 on the next. */
export const SAME_TILT_DEG = 0.2;

/** The listing a quantity is drawn from: SRV is the velocity sweep, less the storm's motion. */
export function listedFor(site: ListedSite, quantity: Quantity): ListedTilt[] {
  return (quantity === "reflectivity" ? site.reflectivity : site.velocity) ?? [];
}

/** The tilt nearest an elevation, within `SAME_TILT_DEG`; else the lowest, so a change of quantity keeps its place. */
export function tiltNear(tilts: ListedTilt[], elevation: number): ListedTilt | null {
  if (!tilts.length) return null;
  const nearest = tilts.reduce((best, tilt) => (
    Math.abs(tilt.elevation_deg - elevation) < Math.abs(best.elevation_deg - elevation) ? tilt : best
  ));
  if (Math.abs(nearest.elevation_deg - elevation) <= SAME_TILT_DEG) return nearest;
  return tilts.reduce((lowest, tilt) => (tilt.elevation_deg < lowest.elevation_deg ? tilt : lowest));
}

/**
 * The sweep a timeline step shows: the newest scanned at or before it and not
 * older than `MAX_AGE_S`, or null. `stepS` is the step's unix seconds; the
 * live step is the newest observation's, and its sweep may be scanned a few
 * minutes after it -- a site files a cycle whole -- so on the live step the
 * newest sweep there is wins whatever its stamp.
 */
export function sweepAt(scans: ListedScan[], stepS: number, live: boolean): ListedScan | null {
  let best: ListedScan | null = null;
  let bestAt = -Infinity;
  for (const scan of scans) {
    const at = Date.parse(scan.scanned_at) / 1000;
    if (!live && at > stepS) continue;
    if (at > bestAt) {
      best = scan;
      bestAt = at;
    }
  }
  if (!best) return null;
  if (!live && stepS - bestAt > MAX_AGE_S) return null;
  return best;
}

/**
 * The sweeps to fetch ahead of the one shown: the next `count` scanned after
 * it, oldest first, as playback steps forward; from the oldest again past the
 * newest, as playback wraps round.
 */
export function aheadOf(scans: ListedScan[], shown: ListedScan | null, count = 3): ListedScan[] {
  const ordered = [...scans].sort((a, b) => Date.parse(a.scanned_at) - Date.parse(b.scanned_at));
  const from = shown ? ordered.indexOf(shown) : -1;
  const ahead: ListedScan[] = [];
  for (let i = 1; i <= ordered.length && ahead.length < count; i++) {
    const scan = ordered[(from + i + ordered.length) % ordered.length];
    if (scan !== shown && !ahead.includes(scan)) ahead.push(scan);
  }
  return ahead;
}

/**
 * A tilt's label: its elevation, and how high its beam is 100 km out, which
 * is what a reader choosing a tilt actually wants to know.
 */
export function tiltLabel(elevationDeg: number, beamKmAt100: number): string {
  return `${tiltAngle(elevationDeg)}${tiltBeam(beamKmAt100)}`;
}

/** The label's two halves, for a tray that has no room for the second. */
export function tiltAngle(elevationDeg: number): string {
  return `${elevationDeg.toFixed(1)}°`;
}
export function tiltBeam(beamKmAt100: number): string {
  return ` · ${beamKmAt100.toFixed(1)} km`;
}

/** One tilt as the tray offers it. */
export interface OfferedTilt {
  elevation: number;
  /** The beam's height 100 km out, above sea level: what the tilt sees. */
  beamKmAt100: number;
}

/** What site mode is showing, for the tray. */
export interface SiteSweepView {
  site: ListedSite;
  tilts: OfferedTilt[];
  /** Whether the site published velocity lately, so V and SRV are offered. */
  hasVelocity: boolean;
  /** "loading" while the sweep for the step is fetched; "none" when the step has none. */
  status: "loading" | "shown" | "none" | "failed";
  /** The drawn sweep's own scan, Nyquist and dealiasing, as its header says. */
  startedAt: string | null;
  scannedAt: string | null;
  nyquist: number | null;
  dealiased: boolean | null;
  dealiaser: string | null;
  /** The motion SRV takes out, and whose: the selected storm's, or the one set by hand (lib/srvMotion.ts). */
  srv: SrvMotion;
  /** Whether a storm is selected that says how it moves, so the tray can offer its motion. */
  stormMoves: boolean;
}

/** What a reading says, as the long press shows it: the value, then where the bin is. */
export interface ReadingParts {
  value: string;
  where: string;
}

/**
 * A bin's reading in words. `t` is the app's translate; units are SI, as the
 * radar measures them: dBZ, m/s, degrees, kilometres.
 */
export function describeReading(
  reading: { kind: "unmeasured" | "no_echo" | "unresolved" } | { kind: "value"; value: number },
  quantity: Quantity,
  bin: { azimuthDeg: number; groundM: number; heightM: number },
  t: (key: string, options?: { values?: Record<string, string | number> }) => string,
): ReadingParts {
  const where = t("site.read.where", {
    values: {
      azimuth: Math.round(bin.azimuthDeg),
      range: (bin.groundM / 1000).toFixed(1),
      height: (bin.heightM / 1000).toFixed(1),
    },
  });
  if (reading.kind !== "value") return { value: t(`site.read.${reading.kind}`), where };
  if (quantity === "reflectivity") return { value: t("site.read.dbz", { values: { value: reading.value.toFixed(1) } }), where };
  const speed = Math.abs(reading.value).toFixed(1);
  const key = reading.value > 0 ? "site.read.away" : reading.value < 0 ? "site.read.toward" : "site.read.calm";
  return { value: t(key, { values: { value: speed } }), where };
}
