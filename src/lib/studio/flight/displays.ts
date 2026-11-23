/**
 * What the flight deck's screens and lights show for a moment of the
 * flight: the engines' numbers, the warnings and memos of the engine and
 * warning display, the autopilot's windows on the glareshield, the landing
 * gear's lights, the pages of the flight management keyboards.
 *
 * Only the numbers and words, none of the drawing
 * (components/studio/flight/), so each can be checked against the state it
 * comes from. Everything is read off the pilot's telemetry: the screens show
 * the numbers the flight uses, never numbers of their own.
 */
import { MMO, VMO_MS } from "./physics";
import { pressureRatio, temperatureK } from "./atmosphere";
import { kindOf, lostSurface } from "./alarms";

const KNOTS = 1.943844;
const FEET = 3.28084;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** N1, the fan's speed, per cent: at idle, and with the thrust levers fully forward. */
export const N1_IDLE = 20;
export const N1_MAX = 100;

/** N1 for the engines' spool (0 to 1, what they give so far of what the levers ask): it follows the levers with the engines' own lag. */
export function n1Of(spool: number): number {
  return N1_IDLE + (N1_MAX - N1_IDLE) * clamp01(spool);
}

/** The exhaust gas temperature, °C, for an N1: hotter the harder the engine runs, short of the red line. */
export const EGT_RED = 950;
export function egtOf(n1: number): number {
  return 390 + ((n1 - N1_IDLE) / (N1_MAX - N1_IDLE)) * 500;
}

/** One engine's fuel flow, kg an hour: with the thrust, and less in the thin air up high, where an engine gives less of it. */
export function fuelFlowOf(spool: number, altitude: number): number {
  return (300 + 3000 * clamp01(spool) ** 1.4) * (0.35 + 0.65 * pressureRatio(Math.max(altitude, 0)));
}

/** The outside air, °C: static, and total (warmed by the ram of the air the probe meets at this Mach). */
export function airTemperatures(altitude: number, mach: number): { sat: number; tat: number } {
  const sat = temperatureK(altitude);
  return { sat: sat - 273.15, tat: sat * (1 + 0.2 * mach * mach) - 273.15 };
}

/** How much of the aircraft's climb the cabin's altitude follows, and the highest it goes, ft. */
const CABIN_SHARE = 0.2;
const CABIN_CEILING_FT = 8000;

/**
 * The cabin's pressure as it is kept: its altitude, ft, climbing a fifth as
 * fast as the aircraft to 8,000 ft at most; how fast, ft/min, for the
 * aircraft's climb, m/s; and the difference to the air outside, PSI.
 */
export function cabinOf(altitude: number, verticalSpeed: number): { altitude: number; verticalSpeed: number; deltaP: number } {
  const free = Math.max(altitude, 0) * CABIN_SHARE * FEET;
  const cabin = Math.min(free, CABIN_CEILING_FT);
  const deltaP = (pressureRatio(cabin / FEET) - pressureRatio(Math.max(altitude, 0))) * 14.696;
  return {
    altitude: cabin,
    verticalSpeed: free < CABIN_CEILING_FT ? verticalSpeed * CABIN_SHARE * FEET * 60 : 0,
    deltaP: Math.max(0, deltaP),
  };
}

/** A line of the engine and warning display, in its colour. */
export type EcamColour = "red" | "amber" | "green" | "cyan" | "white";
export interface EcamLine {
  text: string;
  colour: EcamColour;
  /** The alarms a warning's or a caution's title is for (`FlightStatus.alarms`): what silencing them puts its master light out. */
  alarms?: string[];
}

/** What the warnings are made of: the flight's own, and what of the moment calls for a memo. */
export interface EcamInput {
  /** The flight's alarms by name (`FlightStatus.alarms`): its warnings, and each surface lost; and those of them silenced. */
  warnings: readonly string[];
  silenced?: readonly string[];
  /** The speed brake out, and where the thrust levers are, 0 to 1. */
  brake: boolean;
  throttle: number;
  /** Rough air, 0 to 1, and how high, true metres. */
  turbulence: number;
  altitude: number;
  /** The height over the ground, m; null where there is none. */
  radarAltitude: number | null;
  /** The landing gear: 0 up, 1 down and locked. */
  gear: number;
  /** The autopilot let go of in the last few seconds. */
  autopilotLost: boolean;
  /** Where the flap lever is, 0 to 4; in where not said. */
  flaps?: number;
  /** Every spoiler up, after a landing; the engines' thrust turned back; the engines held at full thrust for the angle of attack, and after it. */
  groundSpoilers?: boolean;
  reverse?: boolean;
  alphaFloor?: boolean;
  thrustLocked?: boolean;
}

export interface Ecam {
  /** The warnings and cautions, the worst first: on the left of the display's lower part. */
  warnings: EcamLine[];
  /** The memos: on the right, in green. */
  memo: EcamLine[];
  /** The two lights on the glareshield in front of each pilot: red for a warning, amber for a caution. */
  masterWarning: boolean;
  masterCaution: boolean;
}

/** The flap lever's places, as the display names them. */
const FLAP_PLACES = ["0", "1", "2", "3", "FULL"];
/** Above this rough air the seat belt signs are on. */
const BELTS_TURBULENCE = 0.1;
/** Below this the seat belt signs are on whatever the air, m: 10,000 ft. */
const BELTS_BELOW_M = 3048;
/** Below this over the ground the landing memo shows, m: 2,000 ft. */
const LANDING_MEMO_M = 610;

/**
 * A lost surface's place in a flight control title, and its side: the
 * display's own short names, "L AIL", "R ELEV", "RUD". The two sides of
 * one surface gone are one title, "L+R ELEV".
 */
const SURFACES: Record<string, string> = {
  Aileron: "AIL", Elevator: "ELEV", rudder: "RUD", Spoiler: "SPLR", Flap: "FLAP", Slat: "SLAT",
};
function surfaceTitles(lost: string[]): EcamLine[] {
  const titles = new Map<string, { sides: string[]; alarms: string[] }>();
  for (const alarm of lost) {
    const surface = lostSurface(alarm) ?? "";
    const [, side, part] = /^(left|right)?(.*)$/.exec(surface)!;
    const name = SURFACES[part] ?? part.toUpperCase();
    const title = titles.get(name) ?? { sides: [], alarms: [] };
    if (side) title.sides.push(side === "left" ? "L" : "R");
    title.alarms.push(alarm);
    titles.set(name, title);
  }
  return [...titles].map(([name, { sides, alarms }]) => {
    const side = sides.length === 2 ? "L+R " : sides.length === 1 ? `${sides[0]} ` : "";
    return { text: `F/CTL ${side}${name} LOST`, colour: "red", alarms };
  });
}

/** The engine and warning display's lower part for a moment of the flight. */
export function ecamOf(input: EcamInput): Ecam {
  const warnings: EcamLine[] = [];
  const cautions: EcamLine[] = [];
  if (input.autopilotLost) warnings.push({ text: "AUTO FLT AP OFF", colour: "red" });
  // The surfaces gone first: what the rest of the flight has to do without.
  warnings.push(...surfaceTitles(input.warnings.filter((alarm) => lostSurface(alarm) !== null)));
  for (const warning of input.warnings) {
    // A title, in the colour of the alarm's level, for that alarm.
    const title = (text: string) => {
      const red = kindOf(warning).level === "warning";
      (red ? warnings : cautions).push({ text, colour: red ? "red" : "amber", alarms: [warning] });
    };
    switch (warning) {
      case "stall":
        title("STALL");
        break;
      case "overspeed":
        title("OVER SPEED");
        warnings.push({ text: `-VMO/MMO......${Math.round(VMO_MS * KNOTS)}/.${Math.round(MMO * 100)}`, colour: "white" });
        break;
      case "terrain":
        title("GPWS TERRAIN AHEAD");
        warnings.push({ text: "-PULL UP", colour: "white" });
        break;
      case "ice":
        title("A.ICE SEVERE ICE DETECTED");
        break;
      case "gear":
        title("L/G GEAR NOT DOWN");
        break;
      case "sink":
        title("GPWS SINK RATE");
        break;
      case "flapsJammed":
        title("F/CTL FLAPS LOCKED");
        break;
      case "gearJammed":
        title(input.gear >= 1 ? "L/G GEAR NOT UPLOCKED" : "L/G GEAR NOT DOWNLOCKED");
        break;
      // The bank angle is called out, and not written.
      case "bank":
        break;
      default:
        if (lostSurface(warning) === null) title(warning.toUpperCase());
    }
  }
  if (input.alphaFloor) cautions.push({ text: "A.FLOOR", colour: "amber" });
  else if (input.thrustLocked) cautions.push({ text: "TOGA LK", colour: "amber" });
  const memo: EcamLine[] = [];
  const low = input.radarAltitude !== null && input.radarAltitude < LANDING_MEMO_M;
  const flaps = input.flaps ?? 0;
  if (low) {
    memo.push({ text: input.gear >= 1 ? "LDG LDG GEAR DN" : "LDG LDG GEAR....DN", colour: input.gear >= 1 ? "green" : "cyan" });
    // The flaps for a landing: the last two places of the lever.
    memo.push({ text: flaps >= 3 ? `    FLAPS ${FLAP_PLACES[flaps]}` : "    FLAPS.....FULL", colour: flaps >= 3 ? "green" : "cyan" });
  } else if (flaps > 0) {
    memo.push({ text: `FLAPS ${FLAP_PLACES[flaps]}`, colour: "green" });
  }
  if (input.groundSpoilers) memo.push({ text: "GND SPLRS", colour: "green" });
  if (input.reverse) memo.push({ text: "REV", colour: "green" });
  if (input.turbulence > BELTS_TURBULENCE || input.altitude < BELTS_BELOW_M) memo.push({ text: "SEAT BELTS", colour: "green" });
  memo.push({ text: "NO SMOKING", colour: "green" });
  // The speed brake with thrust on is a waste the display points out.
  if (input.brake && !input.groundSpoilers) memo.push({ text: "SPEED BRK", colour: input.throttle > 0.1 ? "amber" : "green" });
  const silenced = (line: EcamLine) => Boolean(line.alarms?.length) && line.alarms!.every((alarm) => input.silenced?.includes(alarm));
  return {
    warnings: [...warnings, ...cautions],
    memo,
    // Each master light for a title of its colour, but for one whose alarms are all silenced; A.FLOOR is the thrust's mode, no caution.
    masterWarning: warnings.some((line) => line.colour === "red" && !silenced(line)),
    masterCaution: cautions.some((line) => line.alarms !== undefined && !silenced(line)),
  };
}

/** A light that flashes: on for the first half of each period, s. */
export function flashOn(time: number, period = 0.5): boolean {
  return ((time % period) + period) % period < period / 2;
}

/** The landing gear's three lights each: red UNLK while a leg moves, a green triangle once it is down and locked; dark when up. */
export function gearLights(gear: number): { unlocked: boolean; down: boolean } {
  return { unlocked: gear > 0.001 && gear < 0.999, down: gear >= 0.999 };
}

/** Above this the speed window shows a Mach number: about where 300 knots and Mach .78 cross, ft. */
export const MACH_ABOVE_FT = 29_000;

/** The autopilot's windows on the glareshield: speed, heading, altitude, vertical speed. */
export interface FcuWindows {
  speed: string;
  /** Whether the speed window shows a Mach number. */
  mach: boolean;
  heading: string;
  altitude: string;
  /** Thousands and hundreds of ft/min with a sign; dashes while an altitude is held. */
  verticalSpeed: string;
}

/**
 * What the windows show: what the autopilot holds while it is on, and the
 * current values otherwise, as they are read on the primary flight display:
 * the same speed, the same heading.
 */
export function fcuOf(input: {
  ias: number; mach: number; heading: number; altitude: number; verticalSpeed: number; held: number | null;
}): FcuWindows {
  const feet = input.altitude * FEET;
  const mach = feet >= MACH_ABOVE_FT;
  const fpm = input.verticalSpeed * FEET * 60;
  const hundreds = Math.round(Math.abs(fpm) / 100);
  return {
    mach,
    speed: mach
      ? `.${String(Math.round(input.mach * 1000)).padStart(3, "0").slice(0, 2)}`
      : String(Math.round(input.ias * KNOTS)).padStart(3, "0"),
    heading: String(Math.round(input.heading) % 360).padStart(3, "0"),
    altitude: input.held !== null
      ? String(Math.max(0, Math.round((input.held * FEET) / 10) * 10)).padStart(5, "0")
      : String(Math.max(0, Math.round(feet / 100) * 100)).padStart(5, "0"),
    verticalSpeed: input.held !== null ? "-----" : `${fpm < -50 ? "-" : "+"}${String(hundreds).padStart(2, "0")}00`,
  };
}

/** The altimeters' pressure setting: standard up high, the sea level's own in the standard day below the transition altitude. */
export const TRANSITION_FT = 5000;
export function baroOf(altitude: number): string {
  return altitude * FEET >= TRANSITION_FT ? "Std" : "1013";
}

/** A row of a flight management keyboard's page: a small label over a line, each split left and right, in colours. */
export interface McduRow {
  label: [string, string];
  line: [string, string];
  colour: [EcamColour | "magenta", EcamColour | "magenta"];
}
export interface McduPage {
  title: string;
  rows: McduRow[];
}

/** Hours and minutes of a clock, UTC. */
export function utc(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** Minutes and seconds of a span, s. */
export function minutesSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A flight level, of an altitude, m. */
export function flightLevel(altitude: number): string {
  return `FL${String(Math.max(0, Math.round((altitude * FEET) / 100))).padStart(3, "0")}`;
}

/**
 * The captain's flight plan page: from here to the storm flown at, its
 * bearing, distance and time, and the radar scan it is seen in.
 */
export function flightPlanPage(input: {
  altitude: number; ias: number; target: { bearing: number; distance: number; seconds: number; peakDbz: number } | null;
  now: number; scan: number | null;
}): McduPage {
  const { target } = input;
  const level = flightLevel(input.altitude);
  const speed = String(Math.round(input.ias * KNOTS));
  const rows: McduRow[] = [
    { label: ["FROM", ""], line: ["PPOS", `${speed}/${level}`], colour: ["green", "green"] },
  ];
  if (target) {
    const nm = target.distance / 1852;
    rows.push(
      { label: [`BRG${String(Math.round(target.bearing) % 360).padStart(3, "0")}°`, "TIME"], line: [`WX ${Math.round(target.peakDbz)}DBZ`, utc(input.now + target.seconds * 1000)], colour: ["magenta", "magenta"] },
      { label: ["DIST", "ETE"], line: [`${nm.toFixed(nm < 10 ? 1 : 0)}NM`, minutesSeconds(target.seconds)], colour: ["green", "green"] },
    );
  } else {
    rows.push({ label: ["", ""], line: ["NO WX AHEAD", ""], colour: ["cyan", "cyan"] });
  }
  rows.push({ label: ["SCAN", "UTC"], line: [input.scan === null ? "----" : utc(input.scan), utc(input.now)], colour: ["green", "white"] });
  return { title: "F-PLN", rows };
}

/** The first officer's progress page: the level, the speeds over the ground and through the air, the air outside. */
export function progressPage(input: {
  altitude: number; tas: number; groundSpeed: number; mach: number; fuelUsed: number;
}): McduPage {
  const { sat, tat } = airTemperatures(input.altitude, input.mach);
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}`;
  return {
    title: "PROG",
    rows: [
      { label: ["CRZ", "MACH"], line: [flightLevel(input.altitude), `.${String(Math.round(input.mach * 1000)).padStart(3, "0").slice(0, 3)}`], colour: ["green", "green"] },
      { label: ["GS", "TAS"], line: [String(Math.round(input.groundSpeed * KNOTS)), String(Math.round(input.tas * KNOTS))], colour: ["green", "green"] },
      { label: ["SAT", "TAT"], line: [`${signed(sat)}°C`, `${signed(tat)}°C`], colour: ["green", "green"] },
      { label: ["F.USED", ""], line: [`${Math.round(input.fuelUsed / 10) * 10}KG`, ""], colour: ["green", "green"] },
    ],
  };
}
