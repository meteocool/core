import { Feature } from "ol";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import type VectorSource from "ol/source/Vector";
import { fetchCellTracks } from "../api";
import type { CellTrack, CellTrackProperties, Progress } from "../api";
import type { CellFeatureKind } from "../layers/cells";
import {
  ageMinutes, covers, ellipseRing4326, leadingTip, padExtent,
} from "./cellGeometry";
import { trimToLastRun } from "./cellTrack";
import { selectedCell } from "../stores";
import { isLive } from "./cellPulse";
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

export default class CellTrackManager {
  /** The source the features are drawn from. */
  vs: VectorSource;

  /**
   * One point per cell still being detected, for the ping in layers/cellPulse.
   *
   * Kept apart from `vs` rather than filtered out of it at draw time: the ping
   * restyles every frame, and this way the couple of thousand features of a
   * busy viewport are not what gets recomputed twenty times a second.
   */
  private pulse: VectorSource | null;

  /** The viewport the drawn features were fetched for, padded. */
  fetched: Extent | null;

  enabled: boolean;

  /** The tracks currently drawn, by cell code, for the detail popup. */
  tracks: Map<string, CellTrackProperties>;

  /** The most recent request, so a slower earlier answer cannot overwrite it. */
  private pending: symbol | null;

  /**
   * The open cell's last full track, kept so a refetch cannot take it away.
   *
   * Tracks are fetched for the viewport, and a cell's forecast reaches an hour
   * ahead -- tens of kilometres past its centroid. Zoom in on the cone to read
   * the lead times on it and the centroid leaves the viewport, the next fetch
   * comes back without that cell, and the marks vanish while the panel
   * describing them stays open. The one cell the reader has asked about is
   * therefore redrawn from this whether or not the answer mentions it.
   *
   * The raw track rather than the drawn features, so it goes through
   * `trimToLastRun` and the age fading exactly as a fetched one does: a pinned
   * cell that has stopped being detected fades and drops its outline on the
   * same schedule as any other. Cleared as soon as the selection changes, so
   * this holds at most one stale track and only while it is being looked at.
   */
  private pinned: CellTrack | null;

  constructor(vectorSource: VectorSource, pulseSource: VectorSource | null = null) {
    this.vs = vectorSource;
    this.pulse = pulseSource;
    this.fetched = null;
    this.enabled = true;
    this.tracks = new Map();
    this.pending = null;
    this.pinned = null;

    selectedCell.subscribe((track) => {
      if (track?.code !== this.pinned?.properties.code) this.pinned = null;
    });
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
    this.apply(
      (collection.features ?? []) as CellTrack[],
      Date.now(),
      collection.reference_time ?? null,
    );
  }

  /**
   * Replace every drawn feature with the ones in this response.
   *
   * Replaced rather than merged: a track missing from the answer has either
   * dissipated or left the viewport, and either way it should stop being drawn.
   */
  apply(tracks: CellTrack[], now = Date.now(), referenceTime: string | null = null): void {
    if (!this.enabled) return;

    const features: Feature[] = [];
    const live: Feature[] = [];
    this.tracks = new Map();

    // The feed's own newest run, so "how recently was this detected" is asked
    // of the data rather than of the clock; see `LIVE_MINUTES`. Falling back to
    // the clock only matters on a backend that sends no reference time.
    const reference = referenceTime ? new Date(referenceTime).getTime() : now;

    const open = this.openCode();
    const answered = tracks.some((raw) => raw.properties.code === open);
    // Order matters only in that the pinned copy goes last: if the answer does
    // carry the open cell, the fresh one is what gets kept and pinned below.
    const drawing = !answered && this.pinned ? [...tracks, this.pinned] : tracks;

    drawing.forEach((raw) => {
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
      if (last) {
        add("cell", p.code, new Point(fromLonLat([last.lon, last.lat])));
        // Only what the ping needs: where, and what colour. It never hit-tests
        // and never opens a popup, so it carries no code.
        if (p.active && isLive(ageMinutes(p.last_seen, reference))) {
          live.push(new Feature({
            max_severity: p.max_severity,
            geometry: new Point(fromLonLat([last.lon, last.lat])),
          }));
        }
      }

      if (p.polygon) {
        add("outline", `${p.code}:outline`, new Polygon([p.polygon.map((c) => fromLonLat(c))]));
      }

      // Only while the cell is still being detected: a forecast for a storm
      // that has since dissipated is a prediction nobody should act on.
      if (!p.active) return;
      const forecast = p.forecast ?? [];
      forecast.forEach((point, index) => {
        add("forecast", `${p.code}:fc:${index}`, new Point(fromLonLat([point.lon, point.lat])));
        // Every step's ellipse is built, where once only the outermost was.
        // They nest, so a dozen of them per cell over a screen full of storms
        // is a wash that hides the radar underneath -- which is why only one
        // used to be drawn. What decides it now is selection rather than
        // index: `cells.ts` draws none of this for an unselected cell and all
        // of it for the one whose popup is open, so the sequence is there to
        // read when it is being asked for and gone when it is not.
        if (point.major_km) {
          const ring = ellipseRing4326(
            point.lon,
            point.lat,
            point.major_km,
            point.minor_km ?? point.major_km,
            point.angle_deg ?? 0,
          );
          const feature = new Feature({
            ...shared,
            kind: "ellipse" as CellFeatureKind,
            geometry: new Polygon([ring.map((coordinate) => fromLonLat(coordinate))]),
            // How far ahead this ring is, and where to say so. Both are worked
            // out here because both need the track: the lead is measured from
            // the last detection rather than from the clock, so it says how
            // far past the evidence the ring is rather than how long ago the
            // page loaded, and the tip needs the cell's position to know which
            // end of the ring is the leading one.
            lead_minutes: Math.round(
              (new Date(point.t).getTime() - new Date(p.last_seen).getTime()) / 60_000,
            ),
            tip: fromLonLat(leadingTip(ring, [last?.lon ?? point.lon, last?.lat ?? point.lat])),
          });
          feature.setId(`${p.code}:el:${index}`);
          features.push(feature);
        }
      });
    });

    this.vs.clear(true);
    this.vs.addFeatures(features);
    if (this.pulse) {
      this.pulse.clear(true);
      // Not silent: the ping's timer starts and stops on this source changing,
      // so a quiet swap would leave it animating an empty layer or not
      // animating a full one.
      if (live.length) this.pulse.addFeatures(live);
      else this.pulse.changed();
    }

    if (answered && open) {
      this.pinned = tracks.find((raw) => raw.properties.code === open) ?? null;
      // The open panel is written in the present tense -- how long ago the cell
      // was last seen, whether it is still growing, where it is going next --
      // and the selection is the snapshot taken when it was tapped. Handed the
      // answer's copy, so a panel left open across a few refreshes describes
      // the storm as it is rather than as it was when it was opened.
      //
      // After `pinned`, so the selection subscription above compares the new
      // properties against the track just pinned and finds the same cell.
      const fresh = this.tracks.get(open);
      if (fresh) selectedCell.set(fresh);
    }
  }

  /** The cell whose panel or marks are up, which `apply` will not drop. */
  private openCode(): string | null {
    let code: string | null = null;
    selectedCell.subscribe((track) => { code = track?.code ?? null; })();
    return code;
  }

  /** The track behind a drawn feature, for the detail popup. */
  trackFor(code: string): CellTrackProperties | undefined {
    return this.tracks.get(code);
  }

  clearAll(): void {
    this.fetched = null;
    this.tracks = new Map();
    this.vs.clear();
    this.pulse?.clear();
  }

  enable(state: boolean): void {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
