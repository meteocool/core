/**
 * Where the radar sees little: the storms there are drawn from the edges of
 * the neighbours' radars, thin and late, and a flight into them is a flight
 * into weather that is not there. The plan steers clear of them, as far as
 * it can: it neither offers a storm in one first nor points the way in
 * through one.
 *
 * Austria, for now, as a rough outline (lon, lat), a few kilometres either
 * side of its border: enough to weigh a storm or a bearing, not a map.
 */
import { destination } from "./geo";

const AUSTRIA: ReadonlyArray<readonly [number, number]> = [
  [9.53, 47.27], [9.6, 47.06], [9.88, 47.02], [10.1, 46.85], [10.47, 46.86], [11.1, 46.92], [11.5, 47.0],
  [12.1, 47.0], [12.3, 46.83], [12.73, 46.65], [13.35, 46.56], [13.72, 46.52], [14.55, 46.42], [14.85, 46.6],
  [15.35, 46.63], [15.99, 46.69], [16.11, 46.86], [16.5, 47.0], [16.45, 47.4], [16.62, 47.62], [17.05, 47.7],
  [17.16, 48.01], [16.95, 48.62], [16.1, 48.75], [15.55, 48.9], [15.0, 49.0], [14.7, 48.58], [13.8, 48.78],
  [13.44, 48.57], [13.03, 48.26], [12.75, 48.1], [12.98, 47.8], [12.8, 47.67], [12.48, 47.68], [12.17, 47.6],
  [11.75, 47.58], [11.1, 47.4], [10.7, 47.57], [10.45, 47.58], [10.1, 47.37], [9.73, 47.5],
];

export const RADAR_GAPS: ReadonlyArray<{ name: string; outline: ReadonlyArray<readonly [number, number]> }> = [
  { name: "Austria", outline: AUSTRIA },
];

/** Whether a point is inside an outline (ray casting). */
function inside(lon: number, lat: number, outline: ReadonlyArray<readonly [number, number]>): boolean {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** Whether the radar sees little at a point. */
export const inRadarGap = (lon: number, lat: number): boolean => RADAR_GAPS.some(({ outline }) => inside(lon, lat, outline));

/** How much of a straight way, from a point on a bearing for so many kilometres, runs where the radar sees little, 0 to 1. */
export function radarGapAlong(lon: number, lat: number, bearing: number, km: number, stepKm = 10): number {
  const steps = Math.max(1, Math.round(km / stepKm));
  let blind = 0;
  for (let i = 0; i <= steps; i += 1) {
    const [x, y] = destination(lon, lat, bearing, ((i * km) / steps) * 1000);
    if (inRadarGap(x, y)) blind += 1;
  }
  return blind / (steps + 1);
}
