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
import { CLOUD_STYLES } from "../../cloudStyle";
import type { CloudStyle } from "../../cloudStyle";
import type { FlightSnapshot, FlightStart } from "../flightLink";
import { indicatedFromTrue, machOf, speedOfSound, trueFromIndicated } from "./atmosphere";
import { freezingLevel, USUAL_BASE_KM } from "./cloudBase";
import { bearingDeg, destination, distanceM, offsetM, wrap180, wrap360 } from "./geo";
import { approachTo, edgeKm, MOUNTAINS, SHOWER_DBZ, stormLevel, SUN_BEARING, terrainFloor } from "./spawn";

/** How far back the plan counts a storm's lightning, minutes: what the briefing says the count is over. */
export const STRIKE_WINDOW_MIN = 15;

export { stormLevel };
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
  /** Whether the radar's picture is painted on the ground under the storms. */
  radarOnGround: boolean;
  /** Whether the storms ahead carry a mark in the view. */
  marks: boolean;
  /** The moment of another flight this one takes off from, from a link shared in flight (`resumedPlan`); none for a flight of its own. */
  resume?: FlightSnapshot;
}

const FEET = 3.28084;
const KNOTS = 1.943844;
const NM = 1852;

/**
 * As low and as high as a flight starts, metres: FL050 to FL350. Higher, the
 * airliner as it is flown here (clean, heavy, no autothrust) cannot hold its
 * height at any speed for long: it sinks hundreds of metres a minute, short
 * of thrust or of wing.
 */
export const ALTITUDE_RANGE: [number, number] = [5000 / FEET, 35_000 / FEET];

/**
 * The speeds a flight starts at, as a crew holds them: no slower than 220 kt
 * indicated, the clean wing's own manoeuvring speed with a margin over the
 * stall for the storms' gusts; no faster than 340 kt, ten under the limit
 * (VMO), nor Mach 0.80, two hundredths under the other (MMO), past which the
 * control surfaces start to flutter off (damage.ts).
 */
const LEAST_KNOTS = 220;
const MOST_KNOTS = 340;
const MOST_MACH = 0.8;

/** The indicated speeds a flight starts at, at a level, knots: what the speeds above leave of 220 to 340 there. */
export function knotsRange(altitude: number): [number, number] {
  const mostMach = indicatedFromTrue(MOST_MACH * speedOfSound(altitude), altitude) * KNOTS;
  return [LEAST_KNOTS, Math.max(LEAST_KNOTS, Math.min(MOST_KNOTS, mostMach))];
}

/** The Mach numbers a flight starts at, at a level: what the speeds above make of it there. */
export function machRange(altitude: number): [number, number] {
  const machAt = (knots: number) => machOf(trueFromIndicated(knots / KNOTS, altitude), altitude);
  return [machAt(LEAST_KNOTS), Math.min(MOST_MACH, machAt(MOST_KNOTS))];
}

const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);

/** A true airspeed held to what a flight starts at, at a level, m/s. */
const startable = (tas: number, altitude: number) => clamp(machOf(tas, altitude), machRange(altitude)) * speedOfSound(altitude);

/** The plan the flight would fly unasked. */
export function planFrom(approach: Approach, style: CloudStyle): FlightPlan {
  return {
    aircraft: "a320",
    lon: approach.lon,
    lat: approach.lat,
    heading: approach.heading,
    altitude: clamp(approach.altitude, ALTITUDE_RANGE),
    // Rather fast for the level (`cruiseSpeed`): low down a fixed true speed would be close to the limit.
    tas: startable(cruiseSpeed(clamp(approach.altitude, ALTITUDE_RANGE)), clamp(approach.altitude, ALTITUDE_RANGE)),
    target: approach.target,
    aimed: true,
    view: "cockpit",
    style,
    radarOnGround: false,
    marks: true,
  };
}

/** The plan as an approach, which is what the flight starts from and goes back to. */
export const approachOf = (plan: FlightPlan): Approach => ({
  lon: plan.lon, lat: plan.lat, heading: plan.heading, altitude: plan.altitude, target: plan.target,
});

/** A snapshot's object under `key`, or an empty one. */
export const snapshotPart = (snapshot: FlightSnapshot, key: string): Record<string, unknown> => {
  const part = snapshot[key];
  return part !== null && typeof part === "object" && !Array.isArray(part) ? (part as Record<string, unknown>) : {};
};
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** As high as a resumed flight is put, metres: past the airliner's ceiling, so nothing a link says sends it to space. */
const RESUME_CEILING_M = 15_000;

/**
 * The plan for a flight taken off from a moment of another (lib/studio/flightLink.ts,
 * `FlightSnapshot`): where that one was, which way it pointed, how high and
 * how fast, seen as it was seen and its storms drawn as they were. The rest
 * of that moment, the attitude and the levers and the damage, the pilot
 * takes from `resume` at take-off. A flight started again (`next`, `restart`)
 * starts from the same place, level.
 */
export function resumedPlan(plan: FlightPlan, snapshot: FlightSnapshot, systems: readonly StormSystem[] = []): FlightPlan {
  const state = snapshotPart(snapshot, "state");
  // The storm that one was flown at, where it is still on the radar: the nearest system to where it was.
  const aimed = snapshotPart(snapshot, "target");
  const [aimedLon, aimedLat] = [finite(aimed.lon), finite(aimed.lat)];
  const near = aimedLon === null || aimedLat === null ? [] : systems
    .map((system) => ({ system, away: distanceM(aimedLon, aimedLat, system.lon, system.lat) }))
    .filter(({ away }) => away < SAME_STORM_KM * 1000)
    .sort((one, other) => one.away - other.away);
  const [lon, lat, heading, altitude, tas] = ["lon", "lat", "heading", "altitude", "tas"].map((key) => finite(state[key]));
  const style = CLOUD_STYLES.find((one) => one === snapshot.style);
  return {
    ...plan,
    lon: lon ?? plan.lon,
    lat: lat ?? plan.lat,
    heading: heading === null ? plan.heading : wrap360(heading),
    altitude: altitude === null ? plan.altitude : Math.min(Math.max(altitude, 0), RESUME_CEILING_M),
    tas: tas === null ? plan.tas : Math.max(tas, 0),
    target: near[0]?.system ?? plan.target,
    aimed: false,
    view: snapshot.view === "outside" || snapshot.view === "clean" ? "outside" : snapshot.view === "cockpit" ? "cockpit" : plan.view,
    style: style ?? plan.style,
    radarOnGround: typeof snapshot.radarOnGround === "boolean" ? snapshot.radarOnGround : plan.radarOnGround,
    marks: typeof snapshot.marks === "boolean" ? snapshot.marks : plan.marks,
    resume: snapshot,
  };
}

/**
 * The plan of a flight flown before, for the reader to change and fly again:
 * where that one took off, which way it pointed, how high and how fast, seen
 * and drawn as it was, at its storm where that still stands. A plan like any
 * other: nothing else of that flight's moment goes into the new one, and its
 * level and speed are ones a flight starts at.
 */
export function againPlan(plan: FlightPlan, snapshot: FlightSnapshot, systems: readonly StormSystem[] = []): FlightPlan {
  const again = resumedPlan(plan, snapshot, systems);
  delete again.resume;
  const altitude = clamp(again.altitude, ALTITUDE_RANGE);
  return { ...again, altitude, tas: startable(again.tas, altitude) };
}

/**
 * Starts chosen by hand for a recorded storm the demo replays, so that the
 * first flight anyone takes in it is the good one: a storm system this near
 * `near` (lon, lat) is flown at from `lon`, `lat`, at a level in feet and an
 * indicated speed in knots, nose on it.
 *
 * Fitted to that one storm, on purpose. The rules that choose a start
 * (spawn.ts) are for any weather at all; this is a showcase. Lombardy,
 * 8 October 2026: the cells over the Po south of Milan, flown at from over
 * the Alps north of them, the Valtellina and Lake Como on the way down.
 */
export const SHOWCASE_STARTS: ReadonlyArray<{
  near: readonly [number, number]; withinKm: number; lon: number; lat: number; feet: number; knots: number;
}> = [
  { near: [9.4, 45.3], withinKm: 150, lon: 10.24, lat: 46.31, feet: 13_000, knots: 256 },
];

/** The hand-chosen start for a storm system (`SHOWCASE_STARTS`), if it has one; null for any other. */
export function showcasePlan(target: StormSystem, style: CloudStyle): FlightPlan | null {
  const chosen = SHOWCASE_STARTS.find(({ near, withinKm }) => distanceM(near[0], near[1], target.lon, target.lat) <= withinKm * 1000);
  if (!chosen) return null;
  const altitude = clamp(chosen.feet / FEET, ALTITUDE_RANGE);
  return {
    ...planFrom({
      lon: chosen.lon, lat: chosen.lat, altitude, target,
      heading: bearingDeg(chosen.lon, chosen.lat, target.lon, target.lat),
    }, style),
    tas: startable(trueFromIndicated(chosen.knots / KNOTS, altitude), altitude),
  };
}

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

/**
 * Another level, the Mach number kept: what a crew would mean by it. Where
 * that Mach number is too fast or too slow at the new level, the nearest one
 * that is not.
 */
/**
 * At another level, at the same indicated speed: the speed a crew sets, and
 * what the plan's speed is set in, so the one does not move as the other
 * does. Where that speed is past Mach 0.80 up high, as fast as that allows.
 */
export function levelled(plan: FlightPlan, altitude: number): FlightPlan {
  const level = clamp(altitude, ALTITUDE_RANGE);
  return atKnots({ ...plan, altitude: level }, indicatedFromTrue(plan.tas, plan.altitude) * KNOTS);
}

export function atKnots(plan: FlightPlan, knots: number): FlightPlan {
  return { ...plan, tas: trueFromIndicated(clamp(knots, knotsRange(plan.altitude)) / KNOTS, plan.altitude) };
}

/**
 * A start put where the reader asked, the plan from then on theirs: flown
 * at the storm the nose already points most nearly at, of those offered, and
 * turned onto it; where there is none, the way it pointed.
 */
export function startedAt(plan: FlightPlan, lon: number, lat: number, systems: readonly StormSystem[]): FlightPlan {
  const turn = (system: StormSystem) => Math.abs(wrap180(bearingDeg(lon, lat, system.lon, system.lat) - plan.heading));
  const ahead = systems.reduce<StormSystem | null>((best, system) => (!best || turn(system) < turn(best) ? system : best), null);
  if (!ahead) return { ...plan, lon, lat };
  return { ...plan, lon, lat, target: ahead, aimed: true, heading: bearingDeg(lon, lat, ahead.lon, ahead.lat) };
}

/* A flight from a place, chosen for the reader: from a point on the map
   ("Fly from here"), or from a link that fixes some of it. */


/**
 * The next storm from a place: the system it stands in, if any (the one
 * whose core is nearest, where several overlap), or the one whose rain is
 * nearest, of those worth flying at where there are any. Null with no
 * weather on the radar.
 *
 * Standing in one is standing in one of its tiles, not inside the circle
 * round it: a system can be a line of storms hundreds of kilometres long,
 * and a place beside the line is not in it.
 */
export function nextStorm(lon: number, lat: number, systems: readonly StormSystem[]): StormSystem | null {
  /* How far from its nearest tile, km, square as the tiles are; 0 or under in one. */
  const gap = (system: StormSystem) => {
    const [east, north] = offsetM(system.lon, system.lat, lon, lat).map((metres) => metres / 1000);
    return Math.min(...system.extent.map((tile) => Math.max(Math.abs(east - tile.east), Math.abs(north - tile.north)) - tile.half));
  };
  const nearest = (pool: readonly StormSystem[], by: (system: StormSystem) => number) => (
    pool.reduce<StormSystem | null>((best, system) => (!best || by(system) < by(best) ? system : best), null)
  );
  const around = systems.filter((system) => gap(system) <= 0);
  if (around.length) return nearest(around, (system) => distanceM(lon, lat, system.lon, system.lat));
  const worth = systems.filter((system) => system.peakDbz >= SHOWER_DBZ);
  return nearest(worth.length ? worth : systems, gap);
}


/**
 * How fast a flight goes that the reader wants rather fast: 300 kt
 * indicated low down, turning into Mach 0.78 higher up, where the same
 * indicated speed would be ever more of the speed of sound; whichever is
 * slower at the level, as an airliner's climb and cruise speeds are flown.
 * They cross at about FL270. Both well short of the limits (350 kt, Mach
 * 0.82), past which the airframe is strained (damage.ts), with room for the
 * gusts in a storm.
 */
export const CRUISE_KNOTS = 300;
export const CRUISE_MACH = 0.78;

/** The true airspeed the cruise schedule flies at a level, m/s. */
export function cruiseSpeed(altitude: number): number {
  return Math.min(trueFromIndicated(CRUISE_KNOTS / KNOTS, altitude), CRUISE_MACH * speedOfSound(altitude));
}

/** Whether a level is flown by its indicated speed in knots, or above the crossing by its Mach number. */
const flownInKnots = (altitude: number) => trueFromIndicated(CRUISE_KNOTS / KNOTS, altitude) <= CRUISE_MACH * speedOfSound(altitude);

/**
 * The plan for a flight from a place, chosen for the reader where the start
 * leaves it open (lib/studio/flightLink.ts): at the next storm, nose on its
 * core, in its cloud at the level its strength asks for, and rather fast.
 * `bearing` is the way the map looks, which a flight with no storm to aim
 * at, or one starting in its very core, flies.
 *
 * The level chosen for a storm is raised over the ground ahead as an
 * approach's is (spawn.ts, `terrainFloor`): 3,000 m over the highest of it
 * in the first 60 km. Where the map has none of that ground loaded, over the
 * highest summit of a range on the way, by the 2,000 ft a safe level keeps
 * over mountains. A level the start names is the reader's, and kept.
 */
export function planHere(
  start: FlightStart, systems: readonly StormSystem[], groundAt: (lon: number, lat: number) => number | null,
  bearing: number, style: CloudStyle,
): FlightPlan {
  const { lon, lat } = start;
  const target = nextStorm(lon, lat, systems);
  // In its core already, the bearing to it is any way at all.
  const onCore = target ? distanceM(lon, lat, target.lon, target.lat) < 2000 : true;
  const heading = start.heading !== null ? wrap360(start.heading)
    : target && !onCore ? bearingDeg(lon, lat, target.lon, target.lat) : wrap360(bearing);
  let altitude: number;
  if (start.altitude !== null) {
    altitude = clamp(start.altitude, ALTITUDE_RANGE);
  } else {
    const floor = terrainFloor(lon, lat, heading, groundAt)
      ?? ((highGround({ lon, lat, heading }, 60)?.summit ?? -Infinity) + TERRAIN_MARGIN_M);
    // Up to the next thousand feet over the ground, as the level for the storm is.
    const cleared = Math.ceil((floor * FEET) / 1000) * 1000 / FEET;
    altitude = clamp(Math.max(stormLevel(target?.peakDbz ?? null), cleared), ALTITUDE_RANGE);
  }
  let tas = cruiseSpeed(altitude);
  if (start.speed) {
    tas = "mach" in start.speed ? start.speed.mach * speedOfSound(altitude) : trueFromIndicated(start.speed.knots / KNOTS, altitude);
  }
  tas = startable(tas, altitude);
  return {
    aircraft: "a320", lon, lat, heading, altitude, tas, target,
    aimed: start.heading === null && target !== null && !onCore,
    view: start.view, style, radarOnGround: false, marks: true,
  };
}

/** A system this near where the one aimed at stood is that one, in a newer list (a scan or two on, it has moved), km. */
const SAME_STORM_KM = 30;

/**
 * A plan's start as a link has it. The heading is left out, as "at the next
 * storm", where the plan's nose is on the storm a link opened there would
 * aim at anyway (`systems` is the radar's list now: the storm will have
 * moved on since the flight took off); written out where the reader has
 * turned it or chosen another storm. The speed is said in knots or as a
 * Mach number, whichever the level is flown by.
 */
export function startOf(plan: FlightPlan, systems: readonly StormSystem[]): FlightStart {
  const next = plan.aimed && plan.target ? nextStorm(plan.lon, plan.lat, systems) : null;
  const aimedAtNext = next !== null && plan.target !== null
    && distanceM(next.lon, next.lat, plan.target.lon, plan.target.lat) < SAME_STORM_KM * 1000;
  const speed = flownInKnots(plan.altitude)
    ? { knots: Math.round(indicatedFromTrue(plan.tas, plan.altitude) * KNOTS) }
    : { mach: Math.round(machOf(plan.tas, plan.altitude) * 100) / 100 };
  return {
    lat: plan.lat, lon: plan.lon, heading: aimedAtNext ? null : Math.round(wrap360(plan.heading)) % 360,
    altitude: Math.round((plan.altitude * FEET) / 100) * 100 / FEET, speed, view: plan.view,
  };
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
  "Scandinavian mountains": 2469, "Sierra Nevada": 3479, "Cantabrian Mountains": 2650, Corsica: 2706,
  "Balkan Mountains": 2925, "Massif Central": 1885, "Vosges and Black Forest": 1493, "Scottish Highlands": 1345,
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
      text: `${weather.text} · MAX ${Math.round(target.peakDbz)} DBZ · ${across} NM ACROSS`
        + (target.strikes ? ` · LTG ${target.strikes} STRIKES/${STRIKE_WINDOW_MIN} MIN` : ""),
      caution: weather.severe || target.strikes > 0,
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
  lines.push({ item: "inside", text: "IN ECHO: IMC, RAIN ON THE GLASS, TURB RISING WITH DBZ · SEAT BELTS", caution: Boolean(target) });
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
