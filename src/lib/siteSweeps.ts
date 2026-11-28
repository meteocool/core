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
import type { BinReading } from "./sweep";

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
  /** The correlation coefficient and differential reflectivity: the lowest tilt alone, where the radar measures them. */
  rhohv?: ListedTilt[];
  zdr?: ListedTilt[];
  /** The velocity's azimuthal shear and radial divergence: only the tilts whose velocity unfolds far enough for them. */
  shear?: ListedTilt[];
  divergence?: ListedTilt[];
}

/** What site mode can draw of a radar. */
export type Quantity = "reflectivity" | "velocity" | "srv" | "rhohv" | "zdr" | "shear" | "divergence";

/** A listing's arrays, by the quantity drawn from each. */
type Listed = "reflectivity" | "velocity" | "rhohv" | "zdr" | "shear" | "divergence";

/**
 * Every quantity, in the order the tray offers them: the listing each is
 * drawn from, and how its tilts are offered. `lowest` is a quantity of the
 * radar's lowest tilt alone; `perTilt` one offered only at a tilt it is
 * listed for, the velocity's others falling back to velocity.
 */
export const QUANTITIES: readonly { quantity: Quantity; listed: Listed; tilts: "all" | "lowest" | "perTilt" }[] = [
  { quantity: "reflectivity", listed: "reflectivity", tilts: "all" },
  { quantity: "velocity", listed: "velocity", tilts: "all" },
  { quantity: "srv", listed: "velocity", tilts: "all" },
  { quantity: "rhohv", listed: "rhohv", tilts: "lowest" },
  { quantity: "zdr", listed: "zdr", tilts: "lowest" },
  { quantity: "shear", listed: "shear", tilts: "perTilt" },
  { quantity: "divergence", listed: "divergence", tilts: "perTilt" },
];

const entryOf = (quantity: Quantity) => QUANTITIES.find((entry) => entry.quantity === quantity) ?? QUANTITIES[0];

/** Whether a quantity is of the radar's lowest tilt alone, so the tray shows that tilt rather than a choice of one. */
export const lowestOnly = (quantity: Quantity): boolean => entryOf(quantity).tilts === "lowest";

/**
 * What the reader has open: one site, what to draw of it, and at which tilt.
 * `returnTo` is the tilt they had before a quantity of the lowest tilt
 * alone took them there, and go back to on leaving it.
 */
export interface SiteMode {
  site: string;
  quantity: Quantity;
  elevation: number;
  returnTo?: number;
}

/** A sweep this much older than the step it would be shown on is not shown: two cycles. */
export const MAX_AGE_S = 600;

/** Two tilts this close are one: Meteo-France's lowest is 0.39 on one cycle and 0.4 on the next. */
export const SAME_TILT_DEG = 0.2;

/** The listing a quantity is drawn from: SRV is the velocity sweep, less the storm's motion. */
export function listedFor(site: ListedSite, quantity: Quantity): ListedTilt[] {
  return site[entryOf(quantity).listed] ?? [];
}

/** The listed tilt within `SAME_TILT_DEG` of an elevation, or null. */
function tiltAt(tilts: ListedTilt[], elevation: number): ListedTilt | null {
  return tilts.find((tilt) => Math.abs(tilt.elevation_deg - elevation) <= SAME_TILT_DEG) ?? null;
}

/** The tilt the reader chose, whatever a quantity of the lowest tilt alone has drawn meanwhile. */
const chosenTilt = (mode: SiteMode) => mode.returnTo ?? mode.elevation;

/**
 * Whether shear or divergence is listed at an elevation, taken as the
 * velocity tilt it draws (`tiltNear`): a link with no tilt says 0 for the
 * lowest, and Denmark's lowest is 0.483 in one listing and 0.648 in the next.
 */
function perTiltAt(site: ListedSite, quantity: Quantity, elevation: number): boolean {
  const drawn = tiltNear(listedFor(site, "velocity"), elevation)?.elevation_deg ?? elevation;
  return tiltAt(listedFor(site, quantity), drawn) !== null;
}

/**
 * The quantities the tray offers for a site, in order: reflectivity always;
 * velocity and SRV where it publishes velocity; the coefficient and ZDR
 * where it publishes them; shear and divergence where they are listed at the
 * tilt the reader chose.
 */
export function offeredQuantities(site: ListedSite, mode: SiteMode): Quantity[] {
  return QUANTITIES.filter(({ quantity, tilts }) => {
    if (quantity === "reflectivity") return true;
    if (tilts === "perTilt") return perTiltAt(site, quantity, chosenTilt(mode));
    return listedFor(site, quantity).length > 0;
  }).map(({ quantity }) => quantity);
}

/**
 * The mode after the reader picks a quantity: a quantity of the lowest tilt
 * alone takes them to that tilt, keeping the one they had to go back to,
 * and leaving one goes back to it.
 */
export function withQuantity(site: ListedSite, mode: SiteMode, quantity: Quantity): SiteMode {
  const from = chosenTilt(mode);
  if (lowestOnly(quantity)) {
    const tilt = listedFor(site, quantity)[0];
    return { site: mode.site, quantity, elevation: tilt?.elevation_deg ?? mode.elevation, returnTo: from };
  }
  return { site: mode.site, quantity, elevation: from };
}

/** The mode after the reader picks a tilt: shear or divergence at a tilt without them falls back to velocity. */
export function withTilt(site: ListedSite, mode: SiteMode, elevation: number): SiteMode {
  return settledMode(site, { site: mode.site, quantity: mode.quantity, elevation });
}

/**
 * A mode the listing can draw. The listing changes under an open radar (a
 * new cycle, another radar opened with the quantity kept, a link): shear or
 * divergence no longer listed at the tilt falls back to velocity, a quantity
 * of the lowest tilt alone the site no longer has back to reflectivity at
 * the tilt the reader had, and one it has is moved to its tilt. Anything
 * else is returned as it is.
 */
export function settledMode(site: ListedSite, mode: SiteMode): SiteMode {
  const { tilts } = entryOf(mode.quantity);
  const listed = listedFor(site, mode.quantity);
  if (tilts === "perTilt" && !perTiltAt(site, mode.quantity, mode.elevation)) {
    const fallback: Quantity = listedFor(site, "velocity").length ? "velocity" : "reflectivity";
    return { site: mode.site, quantity: fallback, elevation: mode.elevation };
  }
  if (tilts === "lowest") {
    if (!listed.length) return { site: mode.site, quantity: "reflectivity", elevation: chosenTilt(mode) };
    if (listed[0].elevation_deg !== mode.elevation) return { ...mode, elevation: listed[0].elevation_deg };
  }
  return mode;
}

/** Whether two modes are the same. */
export const sameMode = (a: SiteMode | null, b: SiteMode | null): boolean => (
  a === b || (!!a && !!b && a.site === b.site && a.quantity === b.quantity && a.elevation === b.elevation && a.returnTo === b.returnTo)
);

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
 * The timeline steps an open radar has a sweep for, oldest first: what
 * playback steps through while it is open, rather than over steps that would
 * say "no sweep". Observed steps only: a sweep is a scan, and on a forecast
 * step it would be the newest scan under a later label. `latest` is the live
 * step, judged as `sweepAt` judges it.
 */
export function stepsWithSweep(scans: ListedScan[], steps: number[], latest: number): number[] {
  return steps.filter((stepS) => stepS <= latest && sweepAt(scans, stepS, stepS === latest) !== null);
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

/** The steps the velocity legend may label in m/s, finest first. */
const VELOCITY_TICK_STEPS = [5, 10, 20];
/**
 * The strip each label needs, in px: about three characters of it and a gap
 * as wide. The end labels are aligned to the strip's ends rather than centred,
 * and at 5 m/s on a phone the last ran into the one before it.
 */
const VELOCITY_TICK_ROOM_PX = 40;

/**
 * Where the velocity legend puts its labels across ±`span` m/s, on a strip
 * `widthPx` wide: every 5 m/s where there is room, else every 10 or 20, the
 * finest that has it. 0 is always one.
 */
export function velocityTicks(span: number, widthPx: number): { value: number; at: number }[] {
  const step = VELOCITY_TICK_STEPS.find((candidate) => (widthPx * candidate) / (2 * span) >= VELOCITY_TICK_ROOM_PX)
    ?? VELOCITY_TICK_STEPS[VELOCITY_TICK_STEPS.length - 1];
  const each = Math.floor(span / step);
  return Array.from({ length: 2 * each + 1 }, (_value, i) => (i - each) * step)
    .map((value) => ({ value, at: (value + span) / (2 * span) }));
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
  /** What the tray offers of the site, in order (`offeredQuantities`). */
  quantities: Quantity[];
  /** What the radar called the drawn moment (`URHOHV`, an unfiltered coefficient), as its header says. */
  sourceQuantity: string | null;
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

/** A signed number as a reading writes it: "+1.6", "-0.4", "0.0". */
const signed = (value: number, digits: number) => {
  const text = Math.abs(value).toFixed(digits);
  return Number(text) === 0 ? text : `${value > 0 ? "+" : "-"}${text}`;
};

/**
 * A bin's reading in words. `t` is the app's translate; units are SI, as the
 * radar measures them: dBZ, m/s, dB, degrees, kilometres; shear and
 * divergence per second, in thousandths.
 */
export function describeReading(
  reading: BinReading,
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
  const say = (key: string, value: string | number) => ({ value: t(`site.read.${key}`, { values: { value } }), where });
  const v = reading.value;
  switch (quantity) {
    case "reflectivity": return say("dbz", v.toFixed(1));
    case "rhohv": return say("cc", v.toFixed(2));
    case "zdr": return say("zdr", signed(v, 1));
    case "shear":
    case "divergence": {
      const perMille = Math.abs(v * 1000).toFixed(1);
      if (Number(perMille) === 0) return say("rate_zero", perMille);
      const key = quantity === "shear" ? (v > 0 ? "cyclonic" : "anticyclonic") : (v > 0 ? "divergent" : "convergent");
      return say(key, perMille);
    }
    default: {
      const speed = Math.abs(v).toFixed(1);
      const key = v > 0 ? "away" : v < 0 ? "toward" : "calm";
      return say(key, speed);
    }
  }
}

/**
 * The legend of a quantity drawn from a palette of stops: `knots` spaced
 * evenly along the strip, the value interpolated linearly between two, so a
 * range that matters can be given more of the strip; and the values labelled,
 * in the legend's own unit (`scale` times the value).
 */
export interface SweepLegend {
  knots: number[];
  ticks: number[];
  scale: number;
  /** Signed labels, "+2": a scale diverging about 0. */
  signed: boolean;
}

export const SWEEP_LEGENDS: Partial<Record<Quantity, SweepLegend>> = {
  // Most of what matters sits between 0.8 and 1.
  rhohv: { knots: [0.2, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05], ticks: [0.2, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0], scale: 1, signed: false },
  zdr: { knots: [-4, 8], ticks: [-2, -1, 0, 1, 2, 3, 4, 5, 6], scale: 1, signed: true },
  shear: { knots: [-7e-3, 7e-3], ticks: [-5e-3, -3e-3, 0, 3e-3, 5e-3], scale: 1000, signed: true },
  divergence: { knots: [-1.3e-2, 1.3e-2], ticks: [-1e-2, -5e-3, 0, 5e-3, 1e-2], scale: 1000, signed: true },
};

/** Where a value falls along a legend's strip, 0 to 1, clamped to its ends. */
export function legendPosition(knots: number[], value: number): number {
  if (value <= knots[0]) return 0;
  const last = knots.length - 1;
  for (let i = 1; i <= last; i++) {
    if (value <= knots[i]) return (i - 1 + (value - knots[i - 1]) / (knots[i] - knots[i - 1])) / last;
  }
  return 1;
}

/** The value at a place along a legend's strip, 0 to 1: `legendPosition` the other way. */
export function legendValue(knots: number[], at: number): number {
  const last = knots.length - 1;
  const scaled = Math.min(Math.max(at, 0), 1) * last;
  const i = Math.min(Math.floor(scaled), last - 1);
  return knots[i] + (scaled - i) * (knots[i + 1] - knots[i]);
}

/** The room a legend's label needs, in px: four characters of it and a gap. */
const SWEEP_TICK_ROOM_PX = 30;

/**
 * A legend's labels on a strip `widthPx` wide, where each falls: all of them
 * where there is room, else every second one, then every fourth, kept
 * centred on the middle label so a diverging scale keeps its 0.
 */
export function sweepLegendTicks(legend: SweepLegend, widthPx: number): { value: number; at: number; label: string }[] {
  const all = legend.ticks.map((value) => ({ value, at: legendPosition(legend.knots, value) }));
  const middle = Math.floor((all.length - 1) / 2);
  let every = 1;
  const roomy = (step: number) => {
    const kept = all.filter((_tick, i) => (i - middle) % step === 0);
    return kept.every((tick, i) => i === 0 || (tick.at - kept[i - 1].at) * widthPx >= SWEEP_TICK_ROOM_PX);
  };
  while (every < all.length && !roomy(every)) every *= 2;
  return all.filter((_tick, i) => (i - middle) % every === 0).map(({ value, at }) => {
    const shown = Number((value * legend.scale).toFixed(2));
    return { value, at, label: legend.signed && shown > 0 ? `+${shown}` : `${shown}` };
  });
}
