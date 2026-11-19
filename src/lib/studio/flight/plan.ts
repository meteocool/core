/**
 * A flight's plan: what the reader settles before taking off, and the
 * briefing that reads it back.
 *
 * The plan starts as the approach the flight would have chosen by itself
 * (spawn.ts) and is the reader's from there: another storm, another place to
 * start, a level, a speed. The briefing is what a dispatcher would hand a
 * crew for it, in a dispatcher's clipped English: the route, the level, the
 * weather at the far end, the high ground on the way.
 *
 * No map and no stores here; the page that shows it is
 * components/studio/flight/Preflight.svelte.
 */
import type { CloudStyle } from "../../cloudStyle";
import { indicatedFromTrue, machOf, speedOfSound } from "./atmosphere";
import { freezingLevel, USUAL_BASE_KM } from "./cloudBase";
import { bearingDeg, destination, distanceM, wrap180, wrap360 } from "./geo";
import { approachTo, edgeKm, MOUNTAINS, START_TAS, SUN_BEARING } from "./spawn";
import type { Approach, StormSystem, StormTile } from "./spawn";

/** The aircraft there are to fly. One, so far; the page is laid out for more. */
export const AIRCRAFT = [
  {
    id: "a320",
    name: "Airbus A320",
    /** Metres, and the Mach number and level it cruises at. */
    length: 37.57,
    span: 35.8,
    cruise: 0.78,
    ceiling: 39_000,
    seats: "150–180",
  },
] as const;
export type AircraftId = typeof AIRCRAFT[number]["id"];

export interface FlightPlan {
  aircraft: AircraftId;
  /** Where the flight starts, and which way it points. */
  lon: number;
  lat: number;
  heading: number;
  /** True metres above the sea, and true airspeed, m/s. */
  altitude: number;
  tas: number;
  /** The storm system flown at; null with no weather on the radar, or none chosen. */
  target: StormSystem | null;
  /** Whether the nose follows the target as the start is moved, or stays where the reader turned it. */
  aimed: boolean;
  /** Where the flight is first seen from. */
  view: "cockpit" | "outside";
  /** How the storms are drawn in it. */
  style: CloudStyle;
  /** Whether the storms shake the aircraft. */
  turbulence: boolean;
  /** Whether the radar's picture is painted on the ground under the storms. */
  radarOnGround: boolean;
  /** Whether the storms ahead carry a mark in the view. */
  marks: boolean;
}

const FEET = 3.28084;
const KNOTS = 1.943844;
const NM = 1852;

/** As low and as high as a flight starts, metres: FL050 to FL410. */
export const ALTITUDE_RANGE: [number, number] = [5000 / FEET, 41_000 / FEET];
/** As slow and as fast, Mach: slow enough to look, and short of the barber pole. */
export const MACH_RANGE: [number, number] = [0.45, 0.82];

const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);

/** The plan the flight would fly unasked. */
export function planFrom(approach: Approach, style: CloudStyle): FlightPlan {
  return {
    aircraft: "a320",
    lon: approach.lon,
    lat: approach.lat,
    heading: approach.heading,
    altitude: clamp(approach.altitude, ALTITUDE_RANGE),
    tas: START_TAS,
    target: approach.target,
    aimed: true,
    view: "cockpit",
    style,
    turbulence: true,
    radarOnGround: false,
    marks: true,
  };
}

/** The plan as an approach, which is what the flight starts from and goes back to. */
export const approachOf = (plan: FlightPlan): Approach => ({
  lon: plan.lon, lat: plan.lat, heading: plan.heading, altitude: plan.altitude, target: plan.target,
});

/** Another storm: the best way in to it, at the level and speed already chosen. */
export function retargeted(plan: FlightPlan, system: StormSystem, tiles: readonly StormTile[]): FlightPlan {
  const { lon, lat, heading } = approachTo(system, tiles);
  return { ...plan, lon, lat, heading, target: system, aimed: true };
}

/** The start moved; the nose with it, where it follows the target. */
export function movedTo(plan: FlightPlan, lon: number, lat: number): FlightPlan {
  const heading = plan.aimed && plan.target ? bearingDeg(lon, lat, plan.target.lon, plan.target.lat) : plan.heading;
  return { ...plan, lon, lat, heading };
}

/** The nose turned by hand, or handed back to the target. */
export function headed(plan: FlightPlan, heading: number | null): FlightPlan {
  if (heading !== null) return { ...plan, heading: wrap360(heading), aimed: false };
  return {
    ...plan, aimed: true,
    heading: plan.target ? bearingDeg(plan.lon, plan.lat, plan.target.lon, plan.target.lat) : plan.heading,
  };
}

/** Another level, the Mach number kept: what a crew would mean by it. */
export function levelled(plan: FlightPlan, altitude: number): FlightPlan {
  const level = clamp(altitude, ALTITUDE_RANGE);
  return { ...plan, altitude: level, tas: machOf(plan.tas, plan.altitude) * speedOfSound(level) };
}

export function atMach(plan: FlightPlan, mach: number): FlightPlan {
  return { ...plan, tas: clamp(mach, MACH_RANGE) * speedOfSound(plan.altitude) };
}

/** The level as a crew says it: FL240. */
export const flightLevel = (altitude: number): string => `FL${String(Math.round((altitude * FEET) / 100)).padStart(3, "0")}`;

/** A place as a chart writes it: N43°01' E002°37'. */
export function position(lon: number, lat: number): string {
  const part = (value: number, positive: string, negative: string, width: number) => {
    const minutes = Math.round(Math.abs(value) * 60);
    return `${value >= 0 ? positive : negative}${String(Math.floor(minutes / 60)).padStart(width, "0")}°${String(minutes % 60).padStart(2, "0")}'`;
  };
  return `${part(lat, "N", "S", 2)} ${part(lon, "E", "W", 3)}`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (bearing: number) => COMPASS[Math.round(wrap360(bearing) / 45) % 8];
const degrees = (bearing: number) => `${String(Math.round(wrap360(bearing)) % 360).padStart(3, "0")}°`;
const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} MIN`;

/** The highest ground of each range, metres: what a level is safe over. */
const SUMMITS: Record<string, number> = {
  Alps: 4810, Pyrenees: 3404, Carpathians: 2655, Apennines: 2912, "Dinaric Alps": 2694,
  "Scandinavian mountains": 2469, "Massif Central": 1885, "Scottish Highlands": 1345,
};

/** How far over the highest ground a level is called safe, metres: 2,000 ft, as over mountains. */
const TERRAIN_MARGIN_M = 610;

/** The range a track crosses with the highest ground, if any: sampled every ten kilometres. */
export function highGround(plan: Pick<FlightPlan, "lon" | "lat" | "heading">, km: number): { name: string; summit: number } | null {
  let found: { name: string; summit: number } | null = null;
  for (let at = 0; at <= km; at += 10) {
    const [lon, lat] = destination(plan.lon, plan.lat, plan.heading, at * 1000);
    for (const { name, box: [west, south, east, north] } of MOUNTAINS) {
      if (lon < west || lon > east || lat < south || lat > north) continue;
      const summit = SUMMITS[name] ?? 0;
      if (!found || summit > found.summit) found = { name, summit };
    }
  }
  return found;
}

/** What a system's strongest echo means for an aircraft, as a forecaster abbreviates it. */
export function weatherOf(peakDbz: number): { text: string; severe: boolean } {
  if (peakDbz >= 55) return { text: "SEV TS · HAIL LIKELY · SEV TURB", severe: true };
  if (peakDbz >= 45) return { text: "TS · HVY RAIN · MOD/SEV TURB", severe: true };
  if (peakDbz >= 35) return { text: "SHRA · MOD RAIN · MOD TURB", severe: false };
  return { text: "LGT PCPN · LGT TURB", severe: false };
}

/** One line of a briefing: which it is (its label is the page's to word), what it says, and whether to mind it. */
export interface BriefingLine {
  item: "route" | "level" | "time" | "weather" | "base" | "freezing" | "inside" | "others" | "terrain" | "sun" | "radar" | "remark";
  text: string;
  caution?: boolean;
}

/**
 * The briefing for a plan: over `systems`, every storm system on the radar,
 * the target among them. `scan` is when the radar saw them, epoch seconds.
 */
export function briefing(
  plan: FlightPlan, systems: readonly StormSystem[], scan: number | null,
  /** Where the clouds begin, km above the sea, how many stations said so (none for the usual base), and how much warmer than standard the air is. */
  base: { km: number; stations: number; warmer?: number } = { km: USUAL_BASE_KM, stations: 0 },
  warp = 4,
): BriefingLine[] {
  const lines: BriefingLine[] = [];
  const { target } = plan;
  const mach = machOf(plan.tas, plan.altitude);
  const speed = `${Math.round(indicatedFromTrue(plan.tas, plan.altitude) * KNOTS)} KT IAS · M${mach.toFixed(2).slice(1)} · TAS ${Math.round(plan.tas * KNOTS)} KT`;
  let trackKm = 100;
  if (target) {
    const distance = distanceM(plan.lon, plan.lat, target.lon, target.lat);
    const bearing = bearingDeg(plan.lon, plan.lat, target.lon, target.lat);
    const off = wrap180(plan.heading - bearing);
    trackKm = distance / 1000;
    lines.push({
      item: "route",
      text: `${position(plan.lon, plan.lat)} DCT CB ${position(target.lon, target.lat)} · TRK ${degrees(bearing)} · ${Math.round(distance / NM)} NM`
        + (Math.abs(off) > 5 ? ` · HDG ${degrees(plan.heading)} (${Math.abs(Math.round(off))}° ${off > 0 ? "R" : "L"} OF TRK)` : ""),
      caution: Math.abs(off) > 45,
    });
    lines.push({ item: "level", text: `${flightLevel(plan.altitude)} · ${speed}` });
    // To the near edge of its rain, which is where the flight becomes one.
    const edge = Math.max(0, distance - edgeKm(target, bearing + 180) * 1000);
    lines.push({
      item: "time",
      text: `${minutes(edge / plan.tas)} TO FIRST ECHO · ${minutes(distance / plan.tas)} TO CORE · ${minutes(distance / plan.tas / warp)} AT ×${warp}`,
    });
    const weather = weatherOf(target.peakDbz);
    const across = Math.round((target.radiusKm * 2 * 1000) / NM);
    lines.push({
      item: "weather",
      text: `${weather.text} · MAX ${Math.round(target.peakDbz)} DBZ · ${across} NM ACROSS`,
      caution: weather.severe,
    });
  } else {
    lines.push({ item: "route", text: `${position(plan.lon, plan.lat)} · HDG ${degrees(plan.heading)} · NO DESTINATION` });
    lines.push({ item: "level", text: `${flightLevel(plan.altitude)} · ${speed}` });
    lines.push({ item: "weather", text: "NIL SIG WX ON RADAR · FREE FLIGHT" });
  }
  const baseFeet = Math.round((base.km * 1000 * FEET) / 100) * 100;
  lines.push({
    item: "base",
    text: `${baseFeet} FT`
      + (base.stations ? ` · FROM ${base.stations} ${base.stations === 1 ? "STATION" : "STATIONS"}` : " · ASSUMED, NO STATIONS IN REACH")
      + (plan.altitude < base.km * 1000 ? ` · ${flightLevel(plan.altitude)} IS UNDER IT, IN THE RAIN` : ""),
  });
  // Where rain turns to ice, and where ice builds on an aircraft in cloud: from freezing to twenty below.
  const freezing = freezingLevel(base.warmer);
  const icingTop = freezing + (20 / 6.5) * 1000;
  const inIce = plan.altitude > freezing && plan.altitude < icingTop;
  lines.push({
    item: "freezing",
    text: `${flightLevel(freezing)} · ICE IN CLD TO ${flightLevel(icingTop)}`
      + (inIce ? ` · ${flightLevel(plan.altitude)} IS IN IT` : "")
      + (base.stations ? "" : " · STD ATMOS"),
    caution: inIce,
  });
  lines.push(plan.turbulence
    ? { item: "inside", text: "IN ECHO: IMC, RAIN ON THE GLASS, TURB RISING WITH DBZ · SEAT BELTS", caution: Boolean(target) }
    : { item: "inside", text: "IN ECHO: IMC, RAIN ON THE GLASS · TURB OFF" });
  const others = systems.filter((system) => system !== target
    && distanceM(plan.lon, plan.lat, system.lon, system.lat) <= 150 * NM);
  if (others.length) {
    const nearest = others.reduce((a, b) => (
      distanceM(plan.lon, plan.lat, a.lon, a.lat) <= distanceM(plan.lon, plan.lat, b.lon, b.lat) ? a : b
    ));
    lines.push({
      item: "others",
      text: `${others.length} OTHER ${others.length === 1 ? "SYSTEM" : "SYSTEMS"} WITHIN 150 NM · NEAREST `
        + `${Math.round(distanceM(plan.lon, plan.lat, nearest.lon, nearest.lat) / NM)} NM ${compass(bearingDeg(plan.lon, plan.lat, nearest.lon, nearest.lat))}`,
    });
  }
  const ground = highGround(plan, trackKm);
  if (ground) {
    const low = plan.altitude < ground.summit + TERRAIN_MARGIN_M;
    lines.push({
      item: "terrain",
      text: `${ground.name.toUpperCase()} ON TRACK · HIGHEST GROUND ${Math.round((ground.summit * FEET) / 100) * 100} FT`
        + (low ? ` · ${flightLevel(plan.altitude)} IS BELOW SAFE LEVEL` : ` · ${flightLevel(plan.altitude)} CLEARS IT`),
      caution: low,
    });
  } else {
    lines.push({ item: "terrain", text: "NO HIGH GROUND ON TRACK" });
  }
  const sun = wrap180(plan.heading - (SUN_BEARING + 180));
  lines.push({
    item: "sun",
    text: Math.abs(sun) < 60 ? "BEHIND · TOWERS AHEAD ARE LIT" : Math.abs(sun) > 120 ? "AHEAD · TOWERS IN SILHOUETTE" : `ON THE ${sun > 0 ? "LEFT" : "RIGHT"}`,
  });
  if (scan !== null) {
    const at = new Date(scan * 1000);
    lines.push({
      item: "radar",
      text: `SCAN ${String(at.getUTCHours()).padStart(2, "0")}${String(at.getUTCMinutes()).padStart(2, "0")}Z · HELD FOR THE FLIGHT`,
    });
  }
  lines.push({ item: "remark", text: "NOT FOR NAVIGATION" });
  return lines;
}
