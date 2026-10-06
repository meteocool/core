import { closeRing, scaleRing } from "./cellGeometry";
import { cellVolume, shoelace, toLocalKm } from "./cellVolume";
import type { CellVolumeModel, VolumeRing } from "./cellVolume";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { CellCurrent } from "../api";

/**
 * The volumetric cell model, in the shape MapLibre wants to read it.
 *
 * `cellVolume` does the meteorology and the geometry; this file only turns its
 * bands of rings into GeoJSON polygons with the heights attached as properties,
 * so `fill-extrusion` can raise each one to where it belongs.
 */

export interface CellVolumeProperties {
  code: string;
  dbz: number;
  /** Metres above sea level. */
  base: number;
  top: number;
  /** Which opacity tier it belongs to, 0 = opaque core; see `RING_ALPHAS`. */
  tier: number;
}

export type CellVolumeFeature = Feature<Polygon, CellVolumeProperties>;

/** Rings below this are a speck at any zoom this map allows. */
const MIN_SCALE = 0.02;

/**
 * GeoJSON asks for a counter-clockwise exterior and clockwise holes.
 *
 * MapLibre's tiler is forgiving about the exterior but not about the hole: a
 * hole wound the same way as its exterior is triangulated as part of the fill,
 * and the ring comes out solid -- which looks exactly like the model having no
 * core in it, rather than like a winding bug.
 */
function wind(ring: [number, number][], counterClockwise: boolean): [number, number][] {
  const positive = shoelace(ring) > 0;
  return positive === counterClockwise ? ring : [...ring].reverse();
}

/**
 * A measured ring, resized to the area this band actually has.
 *
 * The shape is measured at the ground; the area at this height comes from the
 * volume profile. Each ring is scaled about *its own* centroid rather than the
 * cell's, because a threshold can be several separate cores and shrinking those
 * towards a point some kilometres away slides them out of the storm instead of
 * narrowing them. Sized as a set, so the cores keep their relative sizes and
 * their total area is the one the profile asked for.
 */
function resized(
  shapes: Array<[number, number][]>,
  targetAreaRatio: number,
  outlineAreaKm2: number,
  centre: [number, number],
): Array<[number, number][]> {
  const measured = shapes.reduce((sum, ring) => sum + Math.abs(shoelace(toLocalKm(ring, centre))), 0);
  if (!(measured > 0)) return shapes;
  const ratio = (targetAreaRatio * outlineAreaKm2) / measured;
  return shapes.map((ring) => scaleRing(ring, ringCentre(ring), ratio));
}

/** A ring's own middle, so several cores each shrink where they stand. */
function ringCentre(ring: [number, number][]): [number, number] {
  const lon = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  return [lon, lat];
}

function ringFeatures(
  model: CellVolumeModel,
  base: number,
  top: number,
  ring: VolumeRing,
  coreShapes: Array<[number, number][]> | null,
): CellVolumeFeature[] {
  if (ring.outer < MIN_SCALE) return [];

  // The core wears its measured shape where there is one, and every piece of it
  // becomes its own feature: two cores five kilometres apart are two solids,
  // not one polygon pretending to be between them.
  if (ring.tier === 0 && ring.shape) {
    return resized(ring.shape, ring.outer ** 2, model.outlineAreaKm2, model.centre)
      .map((shape) => feature(model, base, top, ring, [closeRing(wind(shape, true))]))
      .filter((one): one is CellVolumeFeature => one !== null);
  }

  const outer = wind(scaleRing(model.outline, model.centre, ring.outer ** 2), true);
  const coordinates = [closeRing(outer)];
  if (coreShapes?.length) {
    // The glass is cut to the core's real shape, which is the whole point: the
    // hole is where the reader sees that the core is not a lozenge in the
    // middle. Several holes are fine; GeoJSON allows any number of them.
    coreShapes.forEach((shape) => coordinates.push(closeRing(wind(shape, false))));
  } else if (ring.inner >= MIN_SCALE && ring.inner < ring.outer) {
    coordinates.push(closeRing(wind(scaleRing(model.outline, model.centre, ring.inner ** 2), false)));
  }
  const one = feature(model, base, top, ring, coordinates);
  return one ? [one] : [];
}

function feature(
  model: CellVolumeModel,
  base: number,
  top: number,
  ring: VolumeRing,
  coordinates: Array<[number, number][]>,
): CellVolumeFeature | null {
  return {
    type: "Feature",
    // No `id`. MapLibre 6 encodes a GeoJSON source's tiles as MVT in its
    // worker, and MVT feature ids are uint64 varints -- so the writer coerces
    // whatever is here to a number. A KONRAD3D code is 22 digits, about 2e21,
    // which overflows: every tile of the source throws "Given varint doesn't
    // fit into 10 bytes", the source is marked errored, and not one ring is
    // drawn. It fails as an `error` event with nothing on the console, so the
    // map simply comes up empty. The code travels in `properties` instead,
    // which is where everything reads it anyway.
    geometry: { type: "Polygon", coordinates },
    properties: {
      code: model.code,
      dbz: ring.dbz,
      base,
      top,
      tier: ring.tier,
    },
  };
}

/** One cell's rings. `scaleRing` takes an area ratio, hence the squared factor. */
export function cellVolumeFeatures(cell: CellCurrent): CellVolumeFeature[] {
  const model = cellVolume(cell);
  if (!model) return [];
  return model.bands.flatMap((band) => {
    // The glass needs the core's shape to cut its hole, and the core is the
    // last ring in the band, so it is resolved once per band and handed down.
    const core = band.rings.find((ring) => ring.tier === 0);
    const coreShapes = core?.shape
      ? resized(core.shape, core.outer ** 2, model.outlineAreaKm2, model.centre)
      : null;
    return band.rings.flatMap((ring) => ringFeatures(model, band.base, band.top, ring, coreShapes));
  });
}

/** Every cell in a run, as one collection ready for a MapLibre GeoJSON source. */
export function volumeCollection(
  cells: CellCurrent[],
): FeatureCollection<Polygon, CellVolumeProperties> {
  return {
    type: "FeatureCollection",
    features: cells.flatMap((cell) => cellVolumeFeatures(cell)),
  };
}

/** The ground outline of each cell, for a flat footprint under the volume. */
export function footprintCollection(
  cells: CellCurrent[],
): FeatureCollection<Polygon, { code: string; severity: number }> {
  return {
    type: "FeatureCollection",
    features: cells
      .filter((cell) => cell.polygon && cell.polygon.length >= 3)
      .map((cell) => ({
        type: "Feature" as const,
        // No `id`, for the reason spelled out in `ringFeature` above: a
        // 22-digit code does not fit the uint64 varint MapLibre writes it as.
        geometry: {
          type: "Polygon" as const,
          coordinates: [closeRing(cell.polygon!.map(([lon, lat]) => [lon, lat] as [number, number]))],
        },
        properties: { code: cell.code, severity: cell.severity },
      })),
  };
}
