/**
 * A sky full of aircraft that are not there, for measuring what drawing
 * them costs on a real device without an airspace to fly in: `?traffic=300`
 * on a build with a board (never production's). They are heard as the
 * airspace would send them, snapshots and all (wire.ts's `writeSnapshot`),
 * so they go the whole way the real ones do: decoded, placed between their
 * states, chosen by the budget and drawn.
 *
 * A few circle near the aircraft, a few more within some tens of
 * kilometres, and most fly straight lines hundreds of kilometres off; some
 * of the near ones burn, and one blows up again and again. The airspace's
 * clock starts half a minute short of its wrap, so that is gone through
 * too.
 */
import { encodeLook, INTACT } from "./look";
import type { Look } from "./look";
import type { Traffic } from "./traffic";
import { GEAR_DOWN, writeSnapshot } from "./wire";
import type { OwnState } from "./wire";

const METRES_PER_DEGREE = 111_195;
/** As the airspace sends: the nearest this many within so far five times a second, and every two seconds the rest within reach. */
const NEAR = 32;
const NEAR_M = 25_000;
const FAR = 200;
const EVERY_MS = 200;
const ALL_EVERY = 10;
/** One near aircraft blows up this often, s. */
const BLAST_EVERY_S = 20;

interface Simulated {
  id: number;
  /** Near ones: a place round the eye's aircraft, turning round it; far ones: a start and a heading. */
  near: boolean;
  radius: number;
  bearing: number;
  turn: number;
  rise: number;
  lon: number;
  lat: number;
  heading: number;
  speed: number;
  altitude: number;
  look: Look | null;
  blasts: boolean;
}

/** A number from 0 to 1, always the same for the same `n`. */
const chance = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** `count` aircraft round the eye's: how to make the next snapshot of them, and to stop. */
export function syntheticSky(
  count: number, traffic: Traffic, own: () => OwnState | null, now: () => number, every: (run: () => void, ms: number) => () => void,
): () => void {
  const fleet: Simulated[] = [];
  const near = Math.min(10, Math.max(1, Math.ceil(count * 0.04)));
  const middle = Math.ceil(count * 0.12);
  const names: Record<string, string> = {};
  let origin: OwnState | null = null;
  const startedAt = now();
  const clockStart = 2 ** 32 - 30_000;
  let turns = 0;

  const make = (start: OwnState) => {
    for (let i = 0; i < count; i += 1) {
      const id = i + 1;
      const c = (k: number) => chance(id * 13.1 + k);
      const isNear = i < near + middle;
      const radius = i < near ? 400 + 3500 * c(1) : 4500 + 17_000 * c(1);
      const bearing = c(2) * 360;
      const far = 25_000 + 330_000 * Math.sqrt(c(3));
      const lat = start.lat + (Math.cos((bearing * Math.PI) / 180) * far) / METRES_PER_DEGREE;
      const lon = start.lon + (Math.sin((bearing * Math.PI) / 180) * far) / (METRES_PER_DEGREE * Math.cos((start.lat * Math.PI) / 180));
      const burning = isNear && i % 7 === 3 && i < 30;
      let look: Look | null = null;
      if (burning) look = { ...INTACT, lost: { ...INTACT.lost, rightWing: i % 2 === 1 }, crash: "broke", burning: 0b0010101, strength: 0.9, blast: null };
      fleet.push({
        id, near: isNear, radius, bearing, turn: (8 + 20 * c(4)) / radius * (c(5) < 0.5 ? -1 : 1) * (180 / Math.PI),
        rise: (c(6) - 0.5) * 3000, lon, lat, heading: c(7) * 360, speed: 200 + 50 * c(8), altitude: 8000 + 4500 * c(9),
        look, blasts: i === 0 && count >= 2,
      });
      names[String(id)] = `SIM-${String(id).padStart(3, "0")}`;
    }
    traffic.name(names);
  };

  const state: OwnState = { flags: 0, lon: 0, lat: 0, altitude: 0, east: 0, north: 0, up: 0, heading: 0, pitch: 0, roll: 0, look: new Uint8Array(8) };
  const stateOf = (plane: Simulated, at: OwnState, seconds: number): OwnState => {
    const out: OwnState = { ...state, look: new Uint8Array(8) };
    if (plane.near) {
      // Round the eye's aircraft, going as it goes, and round it too.
      const bearing = plane.bearing + plane.turn * seconds;
      const b = (bearing * Math.PI) / 180;
      const north = Math.cos(b) * plane.radius;
      const east = Math.sin(b) * plane.radius;
      out.lat = at.lat + north / METRES_PER_DEGREE;
      out.lon = at.lon + east / (METRES_PER_DEGREE * Math.cos((at.lat * Math.PI) / 180));
      out.altitude = Math.max(300, at.altitude + plane.rise);
      const around = (plane.turn * Math.PI) / 180;
      out.north = at.north - east * around;
      out.east = at.east + north * around;
      out.heading = ((Math.atan2(out.east, out.north) * 180) / Math.PI + 360) % 360;
      out.roll = Math.max(-35, Math.min(35, plane.turn * 4));
      out.pitch = 2;
    } else {
      const h = (plane.heading * Math.PI) / 180;
      const gone = plane.speed * seconds;
      out.lat = plane.lat + (Math.cos(h) * gone) / METRES_PER_DEGREE;
      out.lon = plane.lon + (Math.sin(h) * gone) / (METRES_PER_DEGREE * Math.cos((plane.lat * Math.PI) / 180));
      out.altitude = plane.altitude;
      out.north = Math.cos(h) * plane.speed;
      out.east = Math.sin(h) * plane.speed;
      out.heading = plane.heading;
      out.pitch = 2;
    }
    out.flags = plane.id % 11 === 0 ? GEAR_DOWN : 0;
    let look = plane.look;
    if (plane.blasts) {
      const ago = seconds % BLAST_EVERY_S;
      look = { ...INTACT, crash: "blew", burning: 0b11, strength: 1, blast: { seed: Math.floor(seconds / BLAST_EVERY_S) & 0xff, size: 26, ago } };
    }
    if (look) encodeLook(look, out.look);
    else encodeLook(INTACT, out.look);
    return out;
  };

  const tick = () => {
    const at = own();
    if (!at) return;
    if (!origin) {
      origin = { ...at };
      make(origin);
    }
    const ms = now() - startedAt;
    const seconds = ms / 1000;
    const all = turns % ALL_EVERY === 0;
    turns += 1;
    const placed = fleet.map((plane) => {
      const s = stateOf(plane, at, seconds);
      const dn = (s.lat - at.lat) * METRES_PER_DEGREE;
      const de = (s.lon - at.lon) * METRES_PER_DEGREE * Math.cos((at.lat * Math.PI) / 180);
      return { id: plane.id, ageMs: 40, state: s, far: Math.hypot(dn, de) };
    }).sort((a, b) => a.far - b.far);
    const nearest = placed.filter((each) => each.far < NEAR_M).slice(0, NEAR);
    const sent = all ? [...nearest, ...placed.filter((each) => !nearest.includes(each)).slice(0, FAR)] : nearest;
    traffic.hear(writeSnapshot((clockStart + ms) >>> 0, sent), now());
  };
  return every(tick, EVERY_MS);
}
