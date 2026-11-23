/**
 * A link that opens straight into a flight: where it starts, which way, how
 * high and how fast, and where it is seen from.
 *
 *   meteoair.html?fly=43.3012,4.6001&hdg=045&alt=FL180&spd=300kt&view=outside
 *
 * `fly` is the start, latitude first as a map link writes it, and the only
 * part a link needs. The rest is optional and read as a crew would say it:
 * the heading in degrees (none: at the next storm on the radar), the level
 * (`FL180`, or feet, `18000ft`), the speed (`300kt` indicated, or a Mach
 * number, `M0.78`), and `view=outside` for the view from outside the
 * aircraft. Whatever is left out is chosen for the storm the flight finds
 * (lib/studio/flight/plan.ts, `planHere`).
 *
 * A link fixes only the start. The weather is always the radar's now: the
 * storm the sender flew at may have moved or gone, and the one ahead of the
 * receiver is the one they get. Only a flight over the demo's recorded
 * storm, in place of a live radar with none (src/weatherSource.ts), says so
 * in its link, which then opens on that storm too.
 *
 * A link shared in flight carries more: the whole moment it was shared,
 * as `s`, a JSON object in base64url (`FlightSnapshot`). The aircraft's
 * state as it was (attitude, speed, the levers, the gear, what has come
 * off it), where the reader was looking, the storm they had looked into
 * and how (cut open where the cut stood, or peeled so far;
 * flight/inspection.ts), and the real time and the radar
 * scan it was flown through, so a page that can replay that scan one day
 * can put the receiver in the same sky. The keys above are still written
 * beside it, for whatever reads only those. Nothing in `s` is promised to
 * a later version: what a page does not know, it leaves out.
 *
 * Pure and free of the flight's code, so the page can read a link before
 * any of that is fetched.
 */
import { demoWeather, WEATHER_KEY } from "../../weatherSource";
import { readSnapshot, SNAPSHOT_KEY, writeSnapshot } from "./snapshot";
import type { FlightSnapshot } from "./snapshot";

export { readSnapshot, SNAPSHOT_KEY, writeSnapshot };
export type { FlightSnapshot };

/** A flight's start, as a link has it. */
export interface FlightStart {
  lat: number;
  lon: number;
  /** Degrees true; null to aim at the next storm. */
  heading: number | null;
  /** Metres above the sea; null for a level chosen for the storm. */
  altitude: number | null;
  /** The speed as it is set: indicated knots, or a Mach number; null for one chosen for the level. */
  speed: { knots: number } | { mach: number } | null;
  view: "cockpit" | "outside";
  /** The moment a link shared in flight was taken at (`s`); none for a start alone. */
  snapshot?: FlightSnapshot;
}


/** The page a flight's link opens on. */
export const FLIGHT_LINK_PAGE = "meteoair.html";

/** The query's keys, all of them: what a page reading the link takes out of its address once the flight is over. */
export const FLIGHT_LINK_KEYS = ["fly", "hdg", "alt", "spd", "view", SNAPSHOT_KEY] as const;

const FEET = 3.28084;

/** What a link may ask for: levels FL001 to FL600, speeds from a slow approach to past the barber pole (the flight holds them to its own). */
const LEVEL_FT: [number, number] = [100, 60_000];
const KNOTS: [number, number] = [80, 450];
const MACH: [number, number] = [0.2, 0.95];

const inside = (value: number, [low, high]: readonly [number, number]) => Number.isFinite(value) && value >= low && value <= high;

/** The level: `FL180`, `18000ft` or `18000` (feet). Null for anything else. */
function readLevel(text: string): number | null {
  const level = /^fl(\d{1,3})$/i.exec(text);
  const feet = level ? Number(level[1]) * 100 : /^(\d{1,5})(ft)?$/i.test(text) ? Number(text.replace(/ft$/i, "")) : NaN;
  return inside(feet, LEVEL_FT) ? feet / FEET : null;
}

/** The speed: `300kt` or `300` (knots), `M0.78`, `M.78` or `0.78` (Mach). Null for anything else. */
function readSpeed(text: string): FlightStart["speed"] {
  const mach = /^m?(0?\.\d{1,3})$/i.exec(text);
  if (mach) return inside(Number(mach[1]), MACH) ? { mach: Number(mach[1]) } : null;
  const knots = /^(\d{2,3})(kts?)?$/i.exec(text);
  if (knots) return inside(Number(knots[1]), KNOTS) ? { knots: Number(knots[1]) } : null;
  return null;
}

/** The start a page's query asks for; null where it asks for none, or for nowhere a flight can start. */
export function readFlightLink(search: string): FlightStart | null {
  const query = new URLSearchParams(search);
  const at = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec((query.get("fly") ?? "").trim());
  if (!at) return null;
  const [lat, lon] = [Number(at[1]), Number(at[2])];
  // As far north and south as the map goes.
  if (!inside(lat, [-85, 85]) || !inside(lon, [-180, 180])) return null;
  const hdg = (query.get("hdg") ?? "").trim();
  const heading = /^\d{1,3}(\.\d+)?$/.test(hdg) && Number(hdg) <= 360 ? Number(hdg) % 360 : null;
  const alt = (query.get("alt") ?? "").trim();
  const spd = (query.get("spd") ?? "").trim();
  const snapshot = readSnapshot(query.get(SNAPSHOT_KEY));
  return {
    lat, lon, heading,
    altitude: alt ? readLevel(alt) : null,
    speed: spd ? readSpeed(spd) : null,
    view: query.get("view")?.trim().toLowerCase() === "outside" ? "outside" : "cockpit",
    ...(snapshot ? { snapshot } : {}),
  };
}

/** The query for a start, shortest first: `fly=43.3012,4.6001&hdg=045&alt=FL180&spd=300kt`. */
export function flightLinkQuery(start: FlightStart): string {
  const parts = [`fly=${start.lat.toFixed(4)},${start.lon.toFixed(4)}`];
  if (start.heading !== null) parts.push(`hdg=${String(Math.round(((start.heading % 360) + 360) % 360) % 360).padStart(3, "0")}`);
  if (start.altitude !== null) parts.push(`alt=FL${String(Math.round((start.altitude * FEET) / 100)).padStart(3, "0")}`);
  if (start.speed) {
    parts.push(`spd=${"mach" in start.speed ? `M${start.speed.mach.toFixed(2)}` : `${Math.round(start.speed.knots)}kt`}`);
  }
  if (start.view === "outside") parts.push("view=outside");
  if (start.snapshot) parts.push(`${SNAPSHOT_KEY}=${writeSnapshot(start.snapshot)}`);
  return parts.join("&");
}

/**
 * The site a flight's link is made on: the page's own, but on production
 * always app.meteocool.com, whichever of its hostnames the page is on. That
 * is the host the apps claim, so a link sent from meteocool.com opens a
 * flight in the app of whoever has it, and the same flight in the browser
 * for whoever has not. On next and demo, the deployment it was made on.
 */
export function flightLinkOrigin(here: string, production = import.meta.env?.MODE === "production" && !import.meta.env?.DEV): string {
  return production ? APP_ORIGIN : here;
}
const APP_ORIGIN = "https://app.meteocool.com";

/** The whole link, on the site at `origin`. */
export function flightLinkUrl(origin: string, start: FlightStart, demo = demoWeather): string {
  // A flight over the demo's storm is over it again from the link, on whatever site it was flown (src/weatherSource.ts).
  return `${origin.replace(/\/+$/, "")}/${FLIGHT_LINK_PAGE}?${flightLinkQuery(start)}${demo ? `&${WEATHER_KEY}=demo` : ""}`;
}

/** A query with a flight's keys taken out of it, for the address once that flight is over: "" where nothing else is left. */
export function withoutFlightLink(search: string): string {
  // Part by part, so what is left keeps its own spelling: a view's commas stay commas.
  const rest = search.replace(/^\?/, "").split("&").filter((part) => {
    const key = part.split("=")[0].toLowerCase();
    return part !== "" && !(FLIGHT_LINK_KEYS as readonly string[]).includes(key);
  });
  return rest.length ? `?${rest.join("&")}` : "";
}
