/**
 * The captain's tablet on the left console (an electronic flight bag): a
 * moving map of the storms round the aircraft, north up, and what is known
 * of one of them, chosen on it.
 *
 * What it shows and how a hand uses it is worked out here, in the tablet's
 * own pixels: where its parts are, where a place on the earth is on its
 * map and back, which storms it lists and which one is chosen, and what a
 * tap or a drag on it does. Drawing it is the flight deck's
 * (components/studio/flight/efbChart.ts).
 *
 * The map is Web Mercator, as the app's maps and the 3D map are: a basemap
 * drawn for it lines up with the storms drawn over it.
 */
import { bearingDeg, distanceM, EARTH_RADIUS_M, wrap180 } from "./geo";
import { MARK_APART_KM, MARK_DBZ } from "./marks";
import type { StormMark } from "./marks";
import type { StormTile } from "./spawn";

/** The tablet's picture, pixels: 4:3, as its screen is. */
export const EFB_WIDTH = 640;
export const EFB_HEIGHT = 480;

export interface Rect { x: number; y: number; width: number; height: number }

/** Its parts: a bar along the top, the map under it, and the chosen storm's page beside the map. */
export const EFB_LAYOUT: Record<"header" | "map" | "panel", Rect> = {
  header: { x: 0, y: 0, width: EFB_WIDTH, height: 40 },
  map: { x: 0, y: 40, width: 392, height: 440 },
  panel: { x: 392, y: 40, width: 248, height: 440 },
};

export type EfbButton = "zoomIn" | "zoomOut" | "centre" | "previous" | "next";

/**
 * Its buttons, as large as a finger on a tablet that size needs: the
 * range's two and the one that brings the map back to the aircraft down
 * the map's right edge, and the storm before and after the chosen one
 * either side of its name.
 */
export const EFB_BUTTONS: Record<EfbButton, Rect> = {
  zoomIn: { x: 330, y: 52, width: 52, height: 48 },
  zoomOut: { x: 330, y: 106, width: 52, height: 48 },
  centre: { x: 330, y: 420, width: 52, height: 48 },
  previous: { x: 400, y: 48, width: 52, height: 48 },
  next: { x: 580, y: 48, width: 52, height: 48 },
};

/** The ranges the map is set to, NM from the aircraft to the outer ring; and the one it starts at. */
export const EFB_RANGES_NM = [10, 20, 40, 80, 160, 320];
export const EFB_START_RANGE = 3;

/** The outer ring's radius, pixels: the map's half height, short of its edge. */
export const RING_PX = Math.min(EFB_LAYOUT.map.width, EFB_LAYOUT.map.height) / 2 - 10;

/** How far a storm is listed from the aircraft, km, and how many at most: the nearest. */
export const CHART_REACH_KM = 600;
export const CHART_STORMS = 40;
/** A tap this near a storm's mark chooses it, pixels. */
export const TAP_PX = 26;
/** The chosen storm is the same storm in a newer list this near where it was, km. */
const FOLLOW_KM = 20;

const NM = 1852;
const RADIANS = Math.PI / 180;
/** Web Mercator's sphere, metres: what the maps' coordinates are counted on. */
const MERCATOR_R = 6378137;

/** A place as Web Mercator has it, metres east and north. */
export function mercator(lon: number, lat: number): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  return [MERCATOR_R * lon * RADIANS, MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (clamped * RADIANS) / 2))];
}

export function fromMercator(x: number, y: number): [number, number] {
  return [x / MERCATOR_R / RADIANS, (2 * Math.atan(Math.exp(y / MERCATOR_R)) - Math.PI / 2) / RADIANS];
}

/** Where the map is looked at: its middle, in Web Mercator metres, and how many of them a pixel is. */
export interface ChartFrame { x: number; y: number; resolution: number }

/**
 * The map round `lon`, `lat` at a range: the outer ring that many NM of
 * ground from its middle. Mercator stretches with the latitude, so a pixel
 * is more of its metres the further from the equator: as many as make the
 * range true at `scaleLat`, the aircraft's, where the rings are drawn.
 */
export function chartFrame(lon: number, lat: number, rangeNm: number, scaleLat = lat): ChartFrame {
  const [x, y] = mercator(lon, lat);
  const groundPerPx = (rangeNm * NM) / RING_PX;
  return { x, y, resolution: (groundPerPx * MERCATOR_R) / (EARTH_RADIUS_M * Math.cos(scaleLat * RADIANS)) };
}

/** The middle of the map, in the tablet's pixels. */
export const MAP_MIDDLE: [number, number] = [EFB_LAYOUT.map.x + EFB_LAYOUT.map.width / 2, EFB_LAYOUT.map.y + EFB_LAYOUT.map.height / 2];

/** Where a place is on the tablet, pixels from its top left. */
export function onChart(frame: ChartFrame, lon: number, lat: number): [number, number] {
  const [x, y] = mercator(lon, lat);
  return [MAP_MIDDLE[0] + (x - frame.x) / frame.resolution, MAP_MIDDLE[1] - (y - frame.y) / frame.resolution];
}

/** The place at a point of the tablet. */
export function offChart(frame: ChartFrame, x: number, y: number): [number, number] {
  return fromMercator(frame.x + (x - MAP_MIDDLE[0]) * frame.resolution, frame.y - (y - MAP_MIDDLE[1]) * frame.resolution);
}

export const within = (rect: Rect, x: number, y: number) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** The button at a point of the tablet, if one is there. */
export function buttonAt(x: number, y: number): EfbButton | null {
  for (const [name, rect] of Object.entries(EFB_BUTTONS) as Array<[EfbButton, Rect]>) if (within(rect, x, y)) return name;
  return null;
}

/**
 * The storms the tablet lists: those marked in the view first (what has
 * been measured of them, their tops and their lightning, comes with them),
 * then the cells the radar tracks, then the cores of the storms its volumes
 * list where no cell stands; the nearest `CHART_STORMS` within reach,
 * nearest first.
 */
export function chartStorms(
  marked: readonly StormMark[], cells: readonly StormMark[], cores: readonly StormMark[], lon: number, lat: number,
): StormMark[] {
  const taken: StormMark[] = [...marked];
  const near = (a: StormMark, b: StormMark, km: number) => distanceM(a.lon, a.lat, b.lon, b.lat) < km * 1000;
  // A marked storm is one of the cells again, or one of the cores: the same place.
  for (const cell of cells) if (cell.peakDbz >= MARK_DBZ && !taken.some((other) => near(cell, other, 1))) taken.push(cell);
  for (const core of cores) if (!taken.some((other) => near(core, other, MARK_APART_KM))) taken.push(core);
  return taken
    .map((storm) => ({ storm, km: distanceM(lon, lat, storm.lon, storm.lat) / 1000 }))
    .filter(({ km }) => km <= CHART_REACH_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, CHART_STORMS)
    .map(({ storm }) => storm);
}

/**
 * How much echo each storm has round it, km²: the listed areas of the finer
 * tiles nearer it than any other storm and within a storm's breadth of it.
 * Null where none of them says its area.
 */
export function echoAreas(storms: readonly StormMark[], tiles: readonly StormTile[]): Array<number | null> {
  const areas: Array<number | null> = storms.map(() => null);
  const fine = tiles.filter((tile) => !tile.coarse);
  for (const tile of fine.length ? fine : tiles) {
    if (tile.areaKm2 === null || (tile.peakDbz ?? 0) < MARK_DBZ - 10) continue;
    let best = -1;
    let bestM = MARK_APART_KM * 1000;
    storms.forEach((storm, index) => {
      const metres = distanceM(storm.lon, storm.lat, tile.lon, tile.lat);
      if (metres < bestM) [best, bestM] = [index, metres];
    });
    if (best >= 0) areas[best] = (areas[best] ?? 0) + tile.areaKm2;
  }
  return areas;
}

/** The aircraft, as the tablet needs it. */
export interface EfbAircraft { lon: number; lat: number; heading: number }

/** The storm system flown at: where its middle is and how far its tiles reach, km. */
export interface EfbTarget { lon: number; lat: number; radiusKm: number }

/**
 * A storm this near the middle of the system flown at is where the flight
 * is going, km: as the marks in the view have it. A system can reach
 * hundreds of kilometres; its middle is what the route is drawn to.
 */
export const TARGET_KM = 45;

/** Whether a storm is where the flight is going. */
export const atTarget = (storm: StormMark, target: EfbTarget | null) => (
  target !== null && distanceM(target.lon, target.lat, storm.lon, storm.lat) <= TARGET_KM * 1000
);

/**
 * The storm the tablet chooses itself: the strongest where the flight is
 * going, or with none there, the nearest ahead, or the nearest. -1 for no
 * storm.
 */
export function defaultStorm(storms: readonly StormMark[], aircraft: EfbAircraft, target: EfbTarget | null): number {
  if (!storms.length) return -1;
  let best = -1;
  storms.forEach((storm, index) => {
    if (atTarget(storm, target) && (best < 0 || storm.peakDbz > storms[best].peakDbz)) best = index;
  });
  if (best >= 0) return best;
  const ahead = storms.findIndex((storm) => (
    Math.abs(wrap180(bearingDeg(aircraft.lon, aircraft.lat, storm.lon, storm.lat) - aircraft.heading)) < 90
  ));
  return ahead >= 0 ? ahead : 0;
}

/** The storm in a list at a place, the one there before: the nearest within `FOLLOW_KM`, -1 where none is. */
export function stormNear(storms: readonly StormMark[], lon: number, lat: number): number {
  let best = -1;
  let bestM = FOLLOW_KM * 1000;
  storms.forEach((storm, index) => {
    const metres = distanceM(lon, lat, storm.lon, storm.lat);
    if (metres < bestM) [best, bestM] = [index, metres];
  });
  return best;
}

/**
 * What the tablet shows and the hand has done to it: the range, where the
 * map is (with the aircraft, or where a drag left it), and the storm chosen.
 * `update` hands it the storms of the moment; a tap or a drag on it, in
 * its own pixels, changes it, and `version` counts the changes for a
 * picture to be drawn again at once.
 */
export class EfbState {
  range = EFB_START_RANGE;
  /** Where the map's middle is, where a drag put it; null while it is with the aircraft. */
  centre: [number, number] | null = null;
  storms: StormMark[] = [];
  /** The chosen storm's place in `storms`, -1 for none; and whether the reader chose it, not the tablet. */
  selected = -1;
  chosen = false;
  version = 0;
  private aircraft: EfbAircraft = { lon: 0, lat: 0, heading: 0 };
  private dragging: { from: [number, number]; frame: ChartFrame } | null = null;

  get rangeNm(): number {
    return EFB_RANGES_NM[this.range];
  }

  /** The map as it is now looked at. */
  frame(): ChartFrame {
    const [lon, lat] = this.centre ?? [this.aircraft.lon, this.aircraft.lat];
    return chartFrame(lon, lat, this.rangeNm, this.aircraft.lat);
  }

  /** The storms of the moment, and the aircraft: the chosen storm is looked for again among them. */
  update(storms: StormMark[], aircraft: EfbAircraft, target: EfbTarget | null): void {
    const was = this.storms[this.selected];
    this.storms = storms;
    this.aircraft = aircraft;
    const again = was && this.chosen ? stormNear(storms, was.lon, was.lat) : -1;
    // A storm the reader chose stays chosen for as long as it is there; otherwise the tablet's own choice, now.
    this.chosen = again >= 0;
    this.selected = again >= 0 ? again : defaultStorm(storms, aircraft, target);
  }

  /** A tap at a point of the tablet, pixels. Returns whether it did anything. */
  tap(x: number, y: number): boolean {
    const button = buttonAt(x, y);
    if (button) {
      this.press(button);
    } else if (within(EFB_LAYOUT.map, x, y)) {
      const frame = this.frame();
      let best = -1;
      let bestPx = TAP_PX;
      this.storms.forEach((storm, index) => {
        const [sx, sy] = onChart(frame, storm.lon, storm.lat);
        const px = Math.hypot(sx - x, sy - y);
        if (px < bestPx) [best, bestPx] = [index, px];
      });
      if (best < 0) return false;
      this.selected = best;
      this.chosen = true;
    } else {
      return false;
    }
    this.version += 1;
    return true;
  }

  /** What a button does. */
  press(button: EfbButton): void {
    const count = this.storms.length;
    if (button === "zoomIn") this.range = Math.max(0, this.range - 1);
    else if (button === "zoomOut") this.range = Math.min(EFB_RANGES_NM.length - 1, this.range + 1);
    else if (button === "centre") this.centre = null;
    else if (count) {
      this.selected = ((this.selected < 0 ? 0 : this.selected + (button === "next" ? 1 : -1)) + count) % count;
      this.chosen = true;
      // A storm off the map is brought onto it.
      const storm = this.storms[this.selected];
      const [x, y] = onChart(this.frame(), storm.lon, storm.lat);
      if (!within(EFB_LAYOUT.map, x, y)) this.centre = [storm.lon, storm.lat];
    }
    this.version += 1;
  }

  /** A drag that began on the map moves it with the hand: from where it began to where it is now, pixels. */
  drag(from: [number, number], to: [number, number]): void {
    if (!this.dragging || this.dragging.from[0] !== from[0] || this.dragging.from[1] !== from[1]) {
      if (!within(EFB_LAYOUT.map, from[0], from[1]) || buttonAt(from[0], from[1])) return;
      this.dragging = { from, frame: this.frame() };
    }
    const { frame } = this.dragging;
    const [x, y] = [frame.x - (to[0] - from[0]) * frame.resolution, frame.y + (to[1] - from[1]) * frame.resolution];
    this.centre = fromMercator(x, y);
    this.version += 1;
  }

  release(): void {
    this.dragging = null;
  }
}
