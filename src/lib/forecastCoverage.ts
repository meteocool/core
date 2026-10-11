/**
 * How much of the screen a forecast step has nothing for.
 *
 * The forecast is DWD's alone, so on a forecast step everywhere outside DWD's
 * reach is washed out, even where another network shows the present. Over
 * France or Poland that reads as "no rain coming" when the truth is "no
 * forecast here". Past this share of the screen, the player says so.
 */
export const FORECAST_UNCOVERED_SHARE = 0.5;

const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latitude = (y: number): number => (Math.atan(Math.exp(y)) - Math.PI / 4) * (360 / Math.PI);

/**
 * The share of a lon/lat extent that `covered` says no to, from a grid of
 * `samples` × `samples` points spread evenly over the screen: even in
 * Web Mercator, which is what the screen is, not in degrees, which would
 * crowd the samples towards the top of a tall viewport.
 */
export function uncoveredShare(
  [minLon, minLat, maxLon, maxLat]: [number, number, number, number],
  covered: (lon: number, lat: number) => boolean,
  samples = 12,
): number {
  const bottom = mercatorY(Math.max(minLat, -85));
  const top = mercatorY(Math.min(maxLat, 85));
  let outside = 0;
  for (let row = 0; row < samples; row++) {
    const lat = latitude(bottom + ((row + 0.5) / samples) * (top - bottom));
    for (let column = 0; column < samples; column++) {
      const lon = minLon + ((column + 0.5) / samples) * (maxLon - minLon);
      if (!covered(lon, lat)) outside++;
    }
  }
  return outside / (samples * samples);
}
