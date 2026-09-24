/**
 * The geometry behind the storm cell layer, in degrees.
 *
 * Kept free of OpenLayers so it can be tested directly, the way `apiHealth` and
 * `degraded` are: the projection is applied by the caller, at the edge. Two
 * things here are easy to get wrong and impossible to see wrong -- a bearing
 * read as a maths angle still draws a plausible ellipse pointing the wrong way,
 * and the viewport padding decides how often a pan costs a request.
 */

const ELLIPSE_POINTS = 36;
export const KM_PER_DEGREE_LAT = 111.32;

/** A viewport as [minLon, minLat, maxLon, maxLat], matching `mapExtent4326`. */
export type Extent = [number, number, number, number];

/**
 * A ring approximating one uncertainty ellipse, as [lon, lat] pairs.
 *
 * DWD gives the axes in kilometres and the angle as a bearing -- clockwise from
 * north -- rather than the counter-clockwise-from-east convention the maths
 * wants, which is why north and east are built from cos and sin the way round
 * they are. A degree of longitude also shrinks with latitude, so the east
 * offset is scaled by the cosine; without that an ellipse over Hamburg comes
 * out visibly wider than the same one over the Alps.
 */
export function ellipseRing4326(
  lon: number,
  lat: number,
  majorKm: number,
  minorKm: number,
  angleDeg: number,
): [number, number][] {
  const bearing = (angleDeg * Math.PI) / 180;
  const lonScale = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= ELLIPSE_POINTS; i += 1) {
    const t = (2 * Math.PI * i) / ELLIPSE_POINTS;
    const along = majorKm * Math.cos(t);
    const across = minorKm * Math.sin(t);
    const north = along * Math.cos(bearing) - across * Math.sin(bearing);
    const east = along * Math.sin(bearing) + across * Math.cos(bearing);
    ring.push([lon + east / lonScale, lat + north / KM_PER_DEGREE_LAT]);
  }
  return ring;
}

/**
 * The end of a ring's major axis that points away from `from`.
 *
 * `ellipseRing4326` starts at one end of the major axis and reaches the other
 * half a turn later, so the two ends are the ring's first and middle points.
 * Which of them is the far one depends on the bearing DWD reports, and that is
 * a compass bearing rather than a direction of travel -- an ellipse pointing
 * 294 degrees and one pointing 114 are the same ellipse, and the ring is built
 * from whichever the feed happened to send.
 *
 * That matters because this is where a lead-time label goes. The near end is
 * the side the storm has come from, where every ring is bunched on top of the
 * cell and its own history; the far end is the leading edge, where successive
 * rings are furthest apart and a row of labels reads as a sequence.
 */
export function leadingTip(
  ring: [number, number][],
  from: [number, number],
): [number, number] {
  const opposite = ring[Math.floor((ring.length - 1) / 2)];
  return distanceKm(from, ring[0]) >= distanceKm(from, opposite) ? ring[0] : opposite;
}

/** Great-circle-enough distance between two [lon, lat] points, in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot(
    (b[0] - a[0]) * KM_PER_DEGREE_LAT * Math.cos(lat),
    (b[1] - a[1]) * KM_PER_DEGREE_LAT,
  );
}

/**
 * Faster than any storm travels, by a wide margin.
 *
 * The quickest convective systems on record move at something like
 * 110-130 km/h; in a real run the 99th percentile step is around 90 and the
 * fastest genuine one seen is 144. The errors this separates out are not near
 * that line -- they imply 430 to 2300 km/h -- so the ceiling is set high enough
 * that no real storm can reach it and a mis-stitched track cannot miss it.
 */
export const MAX_STORM_KMH = 200;

/**
 * Where the track stops being one storm.
 *
 * DWD's cell number is reused across unrelated cells -- the schema says so --
 * and the stitcher upstream sometimes glues a stale detection onto a new cell
 * that happens to inherit its number. The result is a track whose first step
 * teleports: 12:10 near Stuttgart, 13:10 near Dresden, with the identifier
 * changing across the jump. Drawn as a path it is a line hundreds of
 * kilometres long joining two storms that have nothing to do with each other,
 * and everything derived from the glued history -- how old the cell is, what
 * its reflectivity has been doing -- is wrong with it.
 *
 * So the track is cut at any step a storm could not physically have made, and
 * only the run of steps after the last such cut is treated as this cell. An
 * earlier run belonged to a different storm; if that storm is still being
 * detected it arrives under its own code and is drawn in its own right.
 *
 * Returns the index the surviving run starts at, which is 0 for the ordinary
 * case of a track that never jumps.
 */
export function lastRunStart(
  steps: Array<{ t: string; lon: number; lat: number }>,
): number {
  let start = 0;
  for (let i = 1; i < steps.length; i += 1) {
    const hours = (new Date(steps[i].t).getTime() - new Date(steps[i - 1].t).getTime()) / 3_600_000;
    // Out-of-order or duplicate timestamps say nothing about speed; a jump
    // with no time between the ends of it cannot be judged this way.
    if (hours <= 0) continue;
    const step = distanceKm(
      [steps[i - 1].lon, steps[i - 1].lat],
      [steps[i].lon, steps[i].lat],
    );
    if (step / hours > MAX_STORM_KMH) start = i;
  }
  return start;
}

/**
 * How far apart lead-time labels have to be, in minutes, at a given scale.
 *
 * The rings come every five minutes for an hour, and labelling all twelve is
 * only readable when the map is zoomed in far enough that the storm's own
 * motion has spread them out. Zoomed out they converge on the cell and a
 * complete set is a stack of overlapping text.
 *
 * Deciding it from the resolution -- metres per pixel -- rather than leaving
 * it to OpenLayers' declutter: declutter is a layer-wide setting, and this
 * layer also draws the rotation and hail badges, which are the marks least
 * worth dropping to make room for a number. Thinning by a fixed step also
 * keeps the labels a sequence -- +15, +30, +45, +60 -- rather than whichever
 * ones happened to survive a collision pass, which changes as the map moves.
 *
 * Every step divides the full hour, so the outermost ring is labelled at every
 * scale and the horizon of the forecast is always stated.
 */
export function labelStepMinutes(resolution: number): number {
  if (resolution > 600) return 20;
  if (resolution > 300) return 15;
  if (resolution > 150) return 10;
  return 5;
}

/**
 * What a forecast ring's label says, or null when it should not carry one.
 *
 * Two clocks meet here, and keeping them apart is the whole of it.
 *
 * `leadMinutes` is the ring's lead over the detection it was forecast from.
 * That is the forecast's own frame: the rings are five minutes apart in it,
 * always, so it is what `labelStepMinutes` can thin evenly and what keeps the
 * labelled set stable as the map moves.
 *
 * `forecastAt` is the moment the ring is for. That is what the label says,
 * because a reader is asking how long they have and the answer has to count
 * down while they watch. Nothing reaches the map when it happens -- the scan,
 * DWD's run behind it, the ingest behind that, then however long the popup has
 * been open -- so a ring forecast fifteen minutes past the scan is routinely
 * eight minutes from the reader.
 *
 * The consequence is that the sequence stops being round: +8, +23, +38 rather
 * than +15, +30, +45. That looks like a bug and is the correction.
 *
 * Null once the moment has passed. The ring keeps its outline -- the cone is
 * one shape, and punching holes in it would say the forecast had gaps.
 */
export function leadLabel(
  forecastAt: number,
  leadMinutes: number,
  resolution: number,
  now = Date.now(),
): string | null {
  if (!Number.isFinite(forecastAt) || !Number.isFinite(leadMinutes)) return null;
  if (leadMinutes <= 0) return null;
  if (leadMinutes % labelStepMinutes(resolution) !== 0) return null;
  const remaining = Math.round((forecastAt - now) / 60_000);
  return remaining > 0 ? `+${remaining} min` : null;
}

/** Minutes since a track was last detected, which is what drives its fading. */
export function ageMinutes(lastSeen: string, now = Date.now()): number {
  return (now - new Date(lastSeen).getTime()) / 60_000;
}

/**
 * How long a cell stays on the map once it stops being detected.
 *
 * The tracks endpoint answers with a three-hour window, so most of what comes
 * back is storms that have already gone. Fading them was not enough: a map
 * left open through an afternoon still filled up with pale paths and dots for
 * cells that dissipated hours ago, and read as weather that was not there.
 * Half an hour keeps a storm that has just been missed for a scan or two, and
 * lets one that has really gone out disappear.
 */
export const TRACK_MAX_MINUTES = 30;

/** Whether a cell last detected this many minutes ago is still drawn at all. */
export function trackIsCurrent(minutes: number): boolean {
  return minutes <= TRACK_MAX_MINUTES;
}

/**
 * How long an outline keeps describing the storm it was drawn around.
 *
 * Unlike the path and the centroid, the outline does not travel: it is the
 * shape DWD contoured at one detection, pinned where that detection was. A
 * storm doing 60 km/h has left a half-hour-old outline fifteen kilometres
 * behind it, over radar with nothing in it.
 */
export const OUTLINE_MAX_MINUTES = 30;

/**
 * Whether a cell's outline still says something true about where it is.
 *
 * The tracks endpoint answers with a three-hour window, so most of what comes
 * back has stopped being detected; the outlines among it used to be drawn at
 * full strength anyway, which put confident rings over empty map beside storms
 * that had moved on. Fading covers the first half hour of that. Past it the
 * shape is an outline of where the cell used to be, which no amount of
 * transparency reads as, so it is dropped.
 */
export function outlineIsCurrent(minutes: number): boolean {
  return minutes <= OUTLINE_MAX_MINUTES;
}

/**
 * Grow an extent by a fraction of its own size.
 *
 * Panning within the padding then costs no request, and a storm just off the
 * edge is already drawn by the time it comes into view.
 */
export function padExtent(extent: Extent, fraction: number): Extent {
  const [west, south, east, north] = extent;
  const padX = (east - west) * fraction;
  const padY = (north - south) * fraction;
  return [west - padX, south - padY, east + padX, north + padY];
}

/**
 * Scale a ring about a point so it encloses `ratio` times the area.
 *
 * Area grows with the square of a linear factor, so the factor is its root.
 * Getting that wrong does not throw and does not look obviously broken -- every
 * storm core just comes out far too small, which reads as a weak storm.
 */
export function scaleRing(
  ring: number[][],
  centre: [number, number],
  ratio: number,
): [number, number][] {
  const k = Math.sqrt(Math.max(ratio, 0));
  return ring.map(([lon, lat]) => [
    centre[0] + (lon - centre[0]) * k,
    centre[1] + (lat - centre[1]) * k,
  ]);
}

/** Close a ring if the source did not; GeoJSON requires first === last. */
export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Whether `inner` is entirely inside `outer`: nothing new has come into view. */
export function covers(outer: Extent | null, inner: Extent): boolean {
  if (!outer) return false;
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}
