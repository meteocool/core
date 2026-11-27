/**
 * Metres of the sky round the flight, as the 3D map draws it: east and
 * north on its flat map from a place near the aircraft (marks.ts's
 * `flatOffset`, a Mercator's), and heights over the sea drawn
 * `VERTICAL_SCALE` tall. What is drawn of the other aircraft, and the
 * contrails they leave where they have been, is placed in these, so a
 * contrail stays where it was made as the aircraft goes on.
 *
 * The place they are measured from (the anchor) moves with the flight
 * once it is far from it: a Mercator's scale is its latitude's, and a few
 * hundred kilometres off it is a few kilometres out. `version` counts the
 * moves, so whatever was measured from the last anchor knows to measure
 * again.
 */
import { EARTH_RADIUS_M } from "../geo";
import { VERTICAL_SCALE } from "../../../../layers/terrain";

const RADIANS = Math.PI / 180;
/** Further than this from the anchor, the anchor moves to the aircraft, metres. */
const MOVE_ANCHOR_M = 40_000;

const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.min(Math.max(lat, -85), 85) * RADIANS) / 2));
const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export class Sky {
  lon = 0;
  lat = 0;
  version = 0;
  private scale = EARTH_RADIUS_M;
  private y0 = 0;

  constructor(lon = 0, lat = 0) {
    this.anchor(lon, lat);
  }

  private anchor(lon: number, lat: number): void {
    this.lon = lon;
    this.lat = lat;
    this.scale = EARTH_RADIUS_M * Math.cos(lat * RADIANS);
    this.y0 = mercator(lat);
    this.version += 1;
  }

  /** The anchor moved to the aircraft at `lon`, `lat`, where it is far from it; whether it moved. */
  follow(lon: number, lat: number): boolean {
    const [east, north] = [this.east(lon), this.north(lat)];
    if (Math.hypot(east, north) < MOVE_ANCHOR_M) return false;
    this.anchor(lon, lat);
    return true;
  }

  east(lon: number): number {
    return wrap180(lon - this.lon) * RADIANS * this.scale;
  }

  north(lat: number): number {
    return (mercator(lat) - this.y0) * this.scale;
  }

  /** A height over the sea as the sky draws it. */
  up(altitude: number): number {
    return altitude * VERTICAL_SCALE;
  }
}
