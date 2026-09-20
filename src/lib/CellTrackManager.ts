import { Feature } from "ol";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import type VectorSource from "ol/source/Vector";
import { fetchCellTracks } from "../api";
import type { CellStep, CellTrack, CellTrackProperties, Progress } from "../api";
import type { CellFeatureKind } from "../layers/cells";
import {
  ageMinutes, covers, ellipseRing4326, lastRunStart, padExtent,
} from "./cellGeometry";
import type { Extent } from "./cellGeometry";

/**
 * The cell layer's contents: fetched for the viewport, replaced on each answer.
 *
 * Unlike the strike and mesocyclone managers this holds no ring buffer. Those
 * receive individual events and have to decide what to forget; a track response
 * is the whole answer for a viewport, so the previous one is simply discarded.
 */

/** How far back to ask for. Long enough to show where a storm came from. */
export const WINDOW_MINUTES = 180;

/** How much larger than the view to fetch, so small pans cost nothing. */
export const BBOX_PADDING = 0.25;

/**
 * A track cut back to the last storm in it.
 *
 * `lastRunStart` explains why a track can contain two: the identity upstream
 * is DWD's cell number, which is reused, so a stale detection occasionally
 * ends up glued to an unrelated new cell. Everything the UI reads off a track
 * is derived from its series, so the cut has to be applied to all of it at
 * once -- the drawn path, the history plot, the age in the popup -- or the
 * line stops lying while the numbers beside it carry on.
 *
 * The maxima are recomputed rather than trusted: the backend took them over
 * the glued history, so a storm can inherit the peak reflectivity of one it
 * never had anything to do with. `first_seen` likewise -- one of these in a
 * real run claimed forty minutes of age that belonged to another cell.
 *
 * The lineage flags are left as they came. A `hail_ever` inherited across a
 * bad join is a false positive and this could clear it, but the flags carry
 * minute counters and merge/split history that cannot be recomputed from the
 * series, and half-correcting them would be worse than leaving them whole and
 * saying so. That part belongs upstream, where the join is made.
 */
function trimToLastRun(track: CellTrack): CellTrack {
  const p = track.properties;
  const series = p.series ?? [];
  const from = lastRunStart(series);
  if (from === 0) return track;

  const kept = series.slice(from);
  const max = (pick: (step: CellStep) => number | null | undefined): number | null => {
    const values = kept.map(pick).filter((v): v is number => v !== null && v !== undefined);
    return values.length ? Math.max(...values) : null;
  };

  const geometry = track.geometry.type === "LineString"
    // The coordinates run one per step, so the same cut applies to both.
    ? { ...track.geometry, coordinates: (track.geometry.coordinates as number[][]).slice(from) }
    : track.geometry;

  return {
    ...track,
    geometry,
    properties: {
      ...p,
      series: kept,
      n_steps: kept.length,
      first_seen: kept[0].t,
      max_dbz: max((step) => step.max_dbz),
      echo_top_max_m: max((step) => step.echo_top_m),
      vil_max: max((step) => step.vil),
    },
  } as CellTrack;
}

export default class CellTrackManager {
  /** The source the features are drawn from. */
  vs: VectorSource;

  /** The viewport the drawn features were fetched for, padded. */
  fetched: Extent | null;

  enabled: boolean;

  /** The tracks currently drawn, by cell code, for the detail popup. */
  tracks: Map<string, CellTrackProperties>;

  /** The most recent request, so a slower earlier answer cannot overwrite it. */
  private pending: symbol | null;

  constructor(vectorSource: VectorSource) {
    this.vs = vectorSource;
    this.fetched = null;
    this.enabled = true;
    this.tracks = new Map();
    this.pending = null;
  }

  /**
   * Fetch and draw the tracks covering `extent`.
   *
   * A move that stays inside what is already drawn is ignored unless forced,
   * which is most moves: the padded extent is a quarter larger than the view.
   */
  async reload(extent: Extent | null, { force = false, nanobar }: {
    force?: boolean;
    nanobar?: Progress;
  } = {}): Promise<void> {
    if (!this.enabled || !extent) return;
    if (!force && covers(this.fetched, extent)) return;

    const padded = padExtent(extent, BBOX_PADDING);
    const token = Symbol("cells");
    this.pending = token;

    let collection;
    try {
      collection = await fetchCellTracks(padded, WINDOW_MINUTES, nanobar);
    } catch {
      // `fetchCellTracks` has already reported it; a missing storm layer is not
      // worth a second message on top of that.
      return;
    }

    // A pan produces a burst of requests and they need not answer in order.
    if (this.pending !== token) return;

    this.fetched = padded;
    this.apply((collection.features ?? []) as CellTrack[]);
  }

  /**
   * Replace every drawn feature with the ones in this response.
   *
   * Replaced rather than merged: a track missing from the answer has either
   * dissipated or left the viewport, and either way it should stop being drawn.
   */
  apply(tracks: CellTrack[], now = Date.now()): void {
    if (!this.enabled) return;

    const features: Feature[] = [];
    this.tracks = new Map();

    tracks.forEach((raw) => {
      const track = trimToLastRun(raw);
      const p = track.properties;
      this.tracks.set(p.code, p);

      const shared = {
        code: p.code,
        max_severity: p.max_severity,
        hail_ever: p.hail_ever,
        meso_ever: p.meso_ever,
        age_minutes: ageMinutes(p.last_seen, now),
      };

      const add = (kind: CellFeatureKind, id: string, geometry: Point | LineString | Polygon) => {
        const feature = new Feature({ ...shared, kind, geometry });
        feature.setId(id);
        features.push(feature);
      };

      if (track.geometry.type === "LineString" && track.geometry.coordinates.length > 1) {
        add("path", `${p.code}:path`, new LineString(
          (track.geometry.coordinates as number[][]).map((c) => fromLonLat(c)),
        ));
      }

      // `series` and `forecast` carry defaults on the producing side, so the
      // schema marks them optional even though a real response always has them.
      const series = p.series ?? [];
      const last = series[series.length - 1];
      if (last) add("cell", p.code, new Point(fromLonLat([last.lon, last.lat])));

      if (p.polygon) {
        add("outline", `${p.code}:outline`, new Polygon([p.polygon.map((c) => fromLonLat(c))]));
      }

      // Only while the cell is still being detected: a forecast for a storm
      // that has since dissipated is a prediction nobody should act on.
      if (!p.active) return;
      const forecast = p.forecast ?? [];
      forecast.forEach((point, index) => {
        add("forecast", `${p.code}:fc:${index}`, new Point(fromLonLat([point.lon, point.lat])));
        // Only the last ellipse is drawn. Every step has one and they nest, so
        // drawing all twelve stacks twelve translucent polygons per cell -- with
        // a handful of storms on screen that is an opaque wash over the map
        // rather than a sense of how uncertain the forecast is. The outermost
        // one says the same thing and leaves the map readable.
        if (point.major_km && index === forecast.length - 1) {
          const ring = ellipseRing4326(
            point.lon,
            point.lat,
            point.major_km,
            point.minor_km ?? point.major_km,
            point.angle_deg ?? 0,
          ).map((coordinate) => fromLonLat(coordinate));
          add("ellipse", `${p.code}:el:${index}`, new Polygon([ring]));
        }
      });
    });

    this.vs.clear(true);
    this.vs.addFeatures(features);
  }

  /** The track behind a drawn feature, for the detail popup. */
  trackFor(code: string): CellTrackProperties | undefined {
    return this.tracks.get(code);
  }

  clearAll(): void {
    this.fetched = null;
    this.tracks = new Map();
    this.vs.clear();
  }

  enable(state: boolean): void {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
