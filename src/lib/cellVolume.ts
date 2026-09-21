import { ellipseRing4326, KM_PER_DEGREE_LAT } from "./cellGeometry";
import type { CellLayer } from "../api";

/**
 * A storm cell as a volume, rather than as a stack of boxes standing on the ground.
 *
 * Radar reports, for each reflectivity threshold from 30 dBZ up, three numbers:
 * the ground area exceeding it, the height the echo reaches, and the volume
 * enclosed. The first two alone can only describe a column rooted at the
 * surface, which is why the earlier extruded-shell model drew every threshold
 * from the echo base upwards -- and so could not tell a storm already raining
 * out apart from a cloud holding its water several kilometres up, which is
 * exactly the difference worth seeing.
 *
 * The volume closes that gap. km3 over km2 is a thickness: the mean depth of
 * that threshold's echo over the ground it covers. A 55 dBZ core of 4 km2 and
 * 12 km3 is three kilometres thick, and if its top is at 6.1 km then it hangs
 * between roughly 3 and 6 km with clear air beneath it. The same area reaching
 * the same height with a third of the volume is a thin sheet near the top.
 *
 * What is still not measured is the outline at any given height -- only the
 * area. Two assumptions bridge that, and both are worth knowing before reading
 * detail into a shape:
 *
 *   - every horizontal slice reuses the measured ground outline, scaled about
 *     the cell centroid to that slice's area, so the silhouette is inherited;
 *   - the way the cross-section varies with height follows one profile shape,
 *     sharpened or fattened per threshold until the solid's volume matches the
 *     reported one. A storm carrying a lot of volume for its depth comes out a
 *     fat column, one carrying little comes out a tapering spire, and that
 *     difference is measured even though the profile it is applied to is not.
 *
 * ## Why two rings a band, and not nested solids
 *
 * The obvious rendering is one solid per threshold, nested like an onion, the
 * outer ones translucent so the core shows through. That is what the previous
 * model did and it fights with itself: coincident walls wherever two
 * thresholds report the same area, coincident floors because every solid
 * started at the same base, and -- the real killer -- `fill-extrusion` writes
 * depth even when it is translucent, so an outer shell drawn first simply
 * erases the core inside it. The result flickers with the camera and hides the
 * one thing the map exists to show.
 *
 * Nor does more glass fix it. Seven nested shells at any opacity that still
 * leaves an object looking solid pass perhaps a sixth of the light through to
 * the middle, and the middle is where the small numbers live: a 1 km2 hail
 * core inside a 120 km2 storm is a tenth of the radius, so by the time it is
 * seen through six tinted walls it is a grey smudge a few pixels wide.
 *
 * So the cell is decomposed into pieces that do not overlap at all, and into
 * as few as will carry the reading. Horizontal bands stack up its depth, and
 * each band holds at most two: an opaque column of whatever intensity actually
 * dominates at that height, and one sheet of glass around it for the rest of
 * the echo. Every piece is disjoint from every other in all three dimensions,
 * nothing is coplanar with anything (a hair of radial clearance separates the
 * two), and there is exactly one translucent surface between the eye and the
 * core.
 *
 * Reading it: the coloured column is the storm's core, and its colour changing
 * with height is the core weakening or strengthening up through the cloud. The
 * glass around it is how far the weaker echo spreads. A column that stops well
 * below the top is a core capped by an anvil; one that starts well above the
 * ground is a storm that has not yet rained out.
 *
/** One concentric piece of a band: the storm between two radii at one height. */
export interface VolumeRing {
  /** The threshold this piece is at or above. */
  dbz: number;
  /** Linear factor on the ground outline for the outer edge. */
  outer: number;
  /** ...and for the inner edge; 0 when this ring is the solid core. */
  inner: number;
  /** 0 for the opaque core column, 1 for the glass around it. */
  tier: number;
  /** What that tier is drawn at. */
  alpha: number;
}

/** One horizontal slice of a cell, split into rings by reflectivity. */
export interface VolumeBand {
  /** Metres above sea level. */
  base: number;
  top: number;
  rings: VolumeRing[];
}

export interface CellVolumeModel {
  code: string;
  /** The cell centroid, which every ring shrinks towards. */
  centre: [number, number];
  /** The ground outline in lon/lat, decimated, not closed. */
  outline: [number, number][];
  /** The same outline as east/north kilometres from the centroid. */
  outlineKm: [number, number][];
  /** Its area, the reference every ring scale is a factor of. */
  outlineAreaKm2: number;
  bands: VolumeBand[];
  /** Metres above sea level, over the whole cell. */
  base: number;
  top: number;
  /** Furthest the outline reaches from the centroid, for framing a view of it. */
  radiusKm: number;
}

/**
 * A box to draw a storm inside: half-width and the height band, both in km.
 *
 * Separated from the model because a picture is not always framed on the cell
 * in it -- the detail view frames every member of a family on the same box, so
 * that a cell half the size of its parent is drawn half the size of its
 * parent. Lives here rather than in the component that draws it because the
 * component that *computes* it is a different one again.
 */
export interface ModelFrame {
  radiusKm: number;
  /** Ground, or the echo base when that hangs below sea level. */
  lowKm: number;
  highKm: number;
}

/** The box a single cell needs, which is the frame when nothing wider applies. */
export function frameOf(volume: CellVolumeModel): ModelFrame {
  return {
    radiusKm: volume.radiusKm,
    lowKm: Math.min(volume.base / 1000, 0),
    highKm: volume.top / 1000,
  };
}

/** The smallest box that holds both. */
export function unionFrame(a: ModelFrame, b: ModelFrame): ModelFrame {
  return {
    radiusKm: Math.max(a.radiusKm, b.radiusKm),
    lowKm: Math.min(a.lowKm, b.lowKm),
    highKm: Math.max(a.highKm, b.highKm),
  };
}

/**
 * Reflectivity ramp, matching the radar overlay's own reading of intensity so
 * a core that looks severe on the flat map looks severe here too.
 */
export const DBZ_RAMP: Array<[number, string]> = [
  [30, "#2f8f5b"], [35, "#6fb52e"], [40, "#d9c22b"], [45, "#e8901f"],
  [50, "#d8402f"], [55, "#a01f3c"], [60, "#d13ec4"], [65, "#ece4ff"],
];

/** The ramp, interpolated, for renderers that cannot take a MapLibre expression. */
export function dbzColour(dbz: number): [number, number, number] {
  const rgb = (hex: string): [number, number, number] => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  if (dbz <= DBZ_RAMP[0][0]) return rgb(DBZ_RAMP[0][1]);
  for (let i = 1; i < DBZ_RAMP.length; i += 1) {
    const [stop, hex] = DBZ_RAMP[i];
    if (dbz > stop) continue;
    const [prevStop, prevHex] = DBZ_RAMP[i - 1];
    const t = (dbz - prevStop) / (stop - prevStop);
    const a = rgb(prevHex);
    const b = rgb(hex);
    return [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * t)) as [number, number, number];
  }
  return rgb(DBZ_RAMP[DBZ_RAMP.length - 1][1]);
}

/** Whatever a cell needs to carry to be turned into a volume. */
export interface VolumeInput {
  code: string;
  lon: number;
  lat: number;
  echo_bottom_m?: number | null;
  polygon?: number[][] | null;
  structure?: CellLayer[] | null;
}

/** A floor for bodies whose volume works out thinner than this. */
const MIN_BODY_M = 300;

/** How tall one band is, before the count is clamped. */
const BAND_M = 600;
const MIN_BANDS = 4;
const MAX_BANDS = 16;

/**
 * How solid each of the two rings is drawn.
 *
 * The glass is fainter than it looks like it ought to be, because a band's
 * roof is glass too: from a low camera the terraces in front of the core stack
 * up, and five sheets at a comfortable-looking opacity put the core behind
 * seventy percent of green. At this value five of them still pass half the
 * light, and the envelope reads from the accumulation rather than from any one
 * sheet.
 *
 * Tiers rather than a per-feature value because `fill-extrusion-opacity` takes
 * no expression: each tier is one MapLibre layer, and the opaque one is added
 * first so the glass blends over a core that is already in the depth buffer
 * rather than erasing it.
 */
export const RING_ALPHAS = [1, 0.2];

/**
 * How much of a level a threshold has to cover to be called its core.
 *
 * Five percent of the area is a bit over a fifth of the radius, which is a
 * column wide enough to see at the size these models are drawn. Picking the
 * strongest threshold that clears it, rather than the strongest present, is
 * what stops a handful of 60 dBZ pixels painting an entire storm magenta.
 */
const CORE_SHARE = 0.05;

/** Rings thinner than this fraction of the radius are a sliver, not a ring. */
const RING_MIN_WIDTH = 0.06;

/** Radial clearance between a ring and its neighbour, so no wall is coplanar. */
const WALL_GAP = 0.004;

/** Below this a threshold contributes nothing at a height but a stray pixel. */
const MIN_RING_AREA_KM2 = 0.05;

/** An outline this detailed is already more than a scaled silhouette deserves. */
const MAX_OUTLINE_POINTS = 22;

const clamp = (value: number, low: number, high: number): number => (
  Math.min(Math.max(value, low), high)
);

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * The cross-section at a height, as a fraction of the body's widest.
 *
 * Widest at the base and tapering to almost nothing at the top: a dome, not a
 * box. `exponent` decides how sharply -- see `exponentForMean`.
 *
 * Monotonic on purpose. An earlier version bulged a third of the way up, which
 * is a fair description of a cumulonimbus but reads as a brim once the solid is
 * cut into bands: each band above the base juts out past the one below it, and
 * with the outermost ring drawn see-through the storm ends up wearing a stack
 * of pale flying saucers. A body that really is widest aloft shows that by
 * floating -- its base is above the ground -- which is the honest signal and
 * the one the data actually carries.
 */
const TOP_FRACTION = 0.05;

function shape(u: number): number {
  if (u <= 0) return 1;
  if (u >= 1) return TOP_FRACTION;
  return 1 + (TOP_FRACTION - 1) * smoothstep(u);
}

export function profile(u: number, exponent: number): number {
  return shape(u) ** exponent;
}

const SAMPLES = 160;
const SHAPE_SAMPLES = Array.from({ length: SAMPLES }, (_, k) => shape((k + 0.5) / SAMPLES));

/** How full of storm a body of this profile is, averaged over its height. */
const meanFor = (exponent: number): number => (
  SHAPE_SAMPLES.reduce((sum, value) => sum + value ** exponent, 0) / SAMPLES
);

/**
 * The fills the profile can actually reach.
 *
 * A dome tapering to a point cannot average less than about a twelfth of its
 * widest however hard it is sharpened -- past `MAX_EXPONENT` it is a needle
 * and the mean stops falling. Asking for less than it can reach silently
 * returns the needle, so `LIFT_FILL` has to stay comfortably above this or
 * bodies lifted off the base would be drawn fuller than their volume allows.
 */
const MIN_FILL = 0.1;
const MAX_FILL = 0.97;
const MAX_EXPONENT = 40;

/**
 * The thinnest a body can be spread over its column before it must be floating.
 *
 * A threshold whose volume would leave its column this empty is not a wispy
 * pillar standing on the deck -- it is a sheet or a lump somewhere up inside
 * the storm, and drawing it from the echo base upwards is exactly the lie the
 * extruded-shell model told.
 */
const LIFT_FILL = 0.14;

const exponentCache = new Map<number, number>();

/**
 * The exponent whose profile averages `wanted` over its height.
 *
 * This is where the reported volume enters the shape. Mean fill falls
 * monotonically as the exponent rises -- the profile is everywhere at most 1 --
 * so a bisection finds it, and the answers are cached because a few hundred
 * bodies per run mostly want the same handful of values.
 */
export function exponentForMean(wanted: number): number {
  const key = Math.round(clamp(wanted, MIN_FILL, MAX_FILL) * 200);
  const hit = exponentCache.get(key);
  if (hit !== undefined) return hit;

  const target = key / 200;
  let low = 0.12;
  let high = MAX_EXPONENT;
  let answer: number;
  if (target >= meanFor(low)) answer = low;
  else if (target <= meanFor(high)) answer = high;
  else {
    for (let i = 0; i < 16; i += 1) {
      const mid = (low + high) / 2;
      if (meanFor(mid) > target) low = mid;
      else high = mid;
    }
    answer = (low + high) / 2;
  }
  exponentCache.set(key, answer);
  return answer;
}

/** One threshold's echo as a solid: where it sits and how it tapers. */
interface Body {
  dbz: number;
  areaKm2: number;
  base: number;
  top: number;
  exponent: number;
}

function bodies(cell: VolumeInput): Body[] {
  const raw = (cell.structure ?? [])
    .filter((layer) => layer.area_km2 > 0 && layer.top_m > 0)
    .slice()
    .sort((a, b) => a.dbz - b.dbz);
  if (!raw.length) return [];

  // Nesting is physics, not something the feed promises: a stronger threshold
  // cannot cover more ground, nor reach higher, than a weaker one. A run that
  // says otherwise is noise, and left alone it draws a core bulging out
  // through the storm around it.
  let area = Infinity;
  let ceiling = Infinity;
  const nested = raw.map((layer) => {
    area = Math.min(area, layer.area_km2);
    ceiling = Math.min(ceiling, layer.top_m);
    return { dbz: layer.dbz, areaKm2: area, top: ceiling, volumeKm3: layer.volume_km3 ?? null };
  });

  const floor = Math.min(cell.echo_bottom_m ?? 0, nested[0].top - MIN_BODY_M);
  const out: Body[] = [];
  nested.forEach((layer, index) => {
    // km3 over km2 is a thickness in km, so metres after the scaling: the mean
    // depth of this threshold's echo over the ground it covers.
    const depthM = layer.volumeKm3 && layer.areaKm2 > 0
      ? (layer.volumeKm3 / layer.areaKm2) * 1000
      : null;
    const previous = out[index - 1];

    /*
     * Rooted, unless the volume says it cannot be.
     *
     * A threshold's echo reaching down to the cell's echo base is the ordinary
     * case, and then its volume is spent entirely on the taper: `depthM` over
     * the height of that column is the fill the profile has to average, and
     * `exponentForMean` finds the shape that does. Only when that fill comes
     * out implausibly low -- there is nowhere near enough echo to fill the
     * column even as a spire -- is the body lifted off the base and hung under
     * its own top instead.
     *
     * Deriving the extent from the volume in every case, which is what this
     * did first, cascades: one threshold whose reported volume runs thin
     * floats, the nesting clamp below drags every stronger threshold up to
     * meet it, and a storm's hail core ends up a coloured cap sitting on the
     * anvil instead of a column through the middle of it.
     */
    const rooted = Math.max(layer.top - floor, MIN_BODY_M);
    let base = depthM === null || depthM / rooted >= LIFT_FILL
      ? floor
      : layer.top - depthM / LIFT_FILL;
    // Nesting again: a stronger threshold cannot reach below a weaker one.
    base = Math.max(base, previous ? previous.base : floor);
    base = Math.min(base, layer.top - MIN_BODY_M);

    const height = Math.max(layer.top - base, MIN_BODY_M);
    const exponent = depthM === null ? 1 : exponentForMean(depthM / height);
    out.push({
      dbz: layer.dbz, areaKm2: layer.areaKm2, base, top: layer.top, exponent,
    });
  });
  return out;
}

/**
 * The outline to slice.
 *
 * A cell always has a centroid and an area, but only sometimes a polygon -- one
 * detected at the edge of radar coverage can arrive without one. Falling back
 * to a circle of the right area keeps it on the map as a plain shape rather
 * than dropping a storm because its outline was missing.
 */
function footprint(cell: VolumeInput, areaKm2: number): [number, number][] {
  const ring = cell.polygon && cell.polygon.length >= 3
    ? cell.polygon.map(([lon, lat]) => [lon, lat] as [number, number])
    : null;
  if (!ring) {
    const radiusKm = Math.sqrt(Math.max(areaKm2, 0.1) / Math.PI);
    return ellipseRing4326(cell.lon, cell.lat, radiusKm, radiusKm, 0).slice(0, -1);
  }
  // A closed ring repeats its first point; the renderers here close their own.
  const open = ring.length > 3
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  if (open.length <= MAX_OUTLINE_POINTS) return open;
  const step = open.length / MAX_OUTLINE_POINTS;
  return Array.from(
    { length: MAX_OUTLINE_POINTS },
    (_, i) => open[Math.floor(i * step)],
  );
}

/** Signed area of a ring in whatever units it is expressed in. */
export function shoelace(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Degrees to east/north kilometres about a point, which is where areas live. */
function toLocalKm(
  ring: [number, number][],
  centre: [number, number],
): [number, number][] {
  const lonScale = KM_PER_DEGREE_LAT * Math.cos((centre[1] * Math.PI) / 180);
  return ring.map(([lon, lat]) => [
    (lon - centre[0]) * lonScale,
    (lat - centre[1]) * KM_PER_DEGREE_LAT,
  ]);
}

/**
 * The point every ring shrinks towards.
 *
 * The cell's own centroid, normally: a storm's core sits where the tracker says
 * the cell is, not at the centre of a polygon that may be lopsided. But the two
 * are separate fields and nothing guarantees they agree -- a centroid that has
 * drifted outside its own outline would send every inner ring off the edge of
 * the storm and, at the limit, collapse the model into a sliver pointing at
 * empty air. When they disagree that badly the outline is the one to trust.
 */
function shrinkCentre(cell: VolumeInput, outline: [number, number][]): [number, number] {
  const lons = outline.map(([lon]) => lon);
  const lats = outline.map(([, lat]) => lat);
  const inside = cell.lon >= Math.min(...lons) && cell.lon <= Math.max(...lons)
    && cell.lat >= Math.min(...lats) && cell.lat <= Math.max(...lats);
  if (inside) return [cell.lon, cell.lat];
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

/** The whole cell as disjoint bands of rings, or null if it has no structure. */
export function cellVolume(cell: VolumeInput): CellVolumeModel | null {
  const solids = bodies(cell);
  if (!solids.length) return null;

  const outline = footprint(cell, solids[0].areaKm2);
  const centre = shrinkCentre(cell, outline);
  const outlineKm = toLocalKm(outline, centre);
  const outlineAreaKm2 = Math.abs(shoelace(outlineKm));
  if (!(outlineAreaKm2 > 0)) return null;

  const base = solids[0].base;
  const top = solids[0].top;
  const span = Math.max(top - base, MIN_BODY_M);
  const count = clamp(Math.round(span / BAND_M), MIN_BANDS, MAX_BANDS);
  const height = span / count;

  const bands: VolumeBand[] = [];
  for (let k = 0; k < count; k += 1) {
    const bandBase = base + k * height;
    const bandTop = bandBase + height;
    const middle = bandBase + height / 2;

    // What each threshold measures across, here. Clamped to the one outside it
    // so a sharper taper on a strong threshold cannot poke through a weak one.
    let widest = Infinity;
    const stops: Array<{ dbz: number; scale: number }> = [];
    solids.forEach((body) => {
      if (middle <= body.base || middle >= body.top) return;
      const area = Math.min(
        body.areaKm2 * profile((middle - body.base) / (body.top - body.base), body.exponent),
        widest,
      );
      widest = area;
      if (area < MIN_RING_AREA_KM2) return;
      stops.push({ dbz: body.dbz, scale: Math.sqrt(area / outlineAreaKm2) });
    });
    if (!stops.length) continue;

    // The level's core: the strongest threshold that is more than a token part
    // of it. `stops` runs weakest first, so this walks inwards and stops at
    // the last one still wide enough to be worth drawing as a column.
    const envelope = stops[0];
    let core = stops[0];
    for (let i = 1; i < stops.length; i += 1) {
      if (stops[i].scale ** 2 < envelope.scale ** 2 * CORE_SHARE) break;
      core = stops[i];
    }

    const rings: VolumeRing[] = [];
    if (core !== envelope && core.scale < envelope.scale * (1 - RING_MIN_WIDTH)) {
      rings.push({
        dbz: envelope.dbz,
        outer: envelope.scale,
        // A hair wider than the column it sits around, so the two walls are
        // near each other rather than in the same plane. Coplanar walls are
        // what makes a stack of extrusions flicker.
        inner: core.scale * (1 + WALL_GAP),
        tier: 1,
        alpha: RING_ALPHAS[1],
      });
    }
    rings.push({
      dbz: core.dbz,
      outer: rings.length ? core.scale : envelope.scale,
      inner: 0,
      tier: 0,
      alpha: RING_ALPHAS[0],
    });

    bands.push({ base: bandBase, top: bandTop, rings });
  }

  if (!bands.length) return null;

  const radiusKm = Math.max(...outlineKm.map(([x, y]) => Math.hypot(x, y)));
  return {
    code: cell.code,
    centre,
    outline,
    outlineKm,
    outlineAreaKm2,
    bands,
    base,
    top,
    radiusKm,
  };
}
