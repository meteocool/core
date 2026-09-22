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
import { buildCellLinks, supersededCodes } from "./cellLinks";
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
    /** The lineage joins, kept apart only so they can be drawn underneath. */
    const joins: Feature[] = [];
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

    // Trimmed and indexed before anything is drawn. Both the joins and the
    // superseded rule are about one cell's relationship to another, so neither
    // can be decided while walking the answer a cell at a time.
    const trimmed = drawing.map((raw) => trimToLastRun(raw));
    trimmed.forEach((track) => this.tracks.set(track.properties.code, track.properties));

    const superseded = supersededCodes(this.tracks);
    // Never the open cell. The panel describes it in the present tense and is
    // anchored to its mark; taking the mark away would leave the reader a
    // description of a storm with nothing on the map under it. It is also how
    // a walk up the family chart into a cell that has already been taken over
    // still shows you where you have got to.
    if (open) superseded.delete(open);

    trimmed.forEach((track) => {
      const p = track.properties;
      /** Replaced by something else that is on the map; see `supersededCodes`. */
      const taken = superseded.has(p.code);

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
        // The dot and its badge are the claim that a storm is here now, which
        // is the one thing a superseded cell should stop making: its
        // continuation is drawn a few kilometres along, and two dots for one
        // storm is what this reads as on the map.
        if (!taken) add("cell", p.code, new Point(fromLonLat([last.lon, last.lat])));
        // Only what the ping needs: where, and what colour. It never hit-tests
        // and never opens a popup, so it carries no code. Superseded the same
        // way the dot above is -- without `!taken` a storm that DWD had
        // renamed kept its ping alive on the old code's last position, which
        // reads as a dashed ring with nothing in it once the dot it used to
        // sit under is gone.
        if (!taken && p.active && isLive(ageMinutes(p.last_seen, reference))) {
          live.push(new Feature({
            max_severity: p.max_severity,
            geometry: new Point(fromLonLat([last.lon, last.lat])),
          }));
        }
      }

      // The outline is the same claim about the present as the dot is.
      if (p.polygon && !taken) {
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
            // When this ring is for, and where to say so.
            //
            // `forecast_at` is the absolute moment, and it is what the label
            // is written from: a reader looking at a ring wants to know how
            // long they have, and the answer has to count down as they watch.
            // Measured from the last detection it would not -- DWD publishes
            // KONRAD3D a few minutes behind the scan and the scan is a few
            // minutes behind the sky, so a ring labelled "+15 min" is already
            // eight or nine minutes away by the time anybody reads it.
            //
            // `lead_minutes` stays, and stays measured from the evidence,
            // because it is what decides *which* rings are labelled. The steps
            // divide the hour evenly (see `labelStepMinutes`), and selecting
            // on a clock-relative value instead would leave the set changing
            // every minute and mostly empty -- the rings are five minutes
            // apart in forecast time, not in time-from-now.
            forecast_at: new Date(point.t).getTime(),
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

    /*
     * The splits and the merges, as a segment per (parent, child) pair.
     *
     * Carried by the child: it is the cell the join leads into, so it decides
     * the colour and how far the pair has faded, and a tap on the join opens
     * the continuation rather than the cell that has ended. The parent's code
     * rides along so the layer can light the join up from either end.
     */
    buildCellLinks(this.tracks).forEach((link) => {
      const child = this.tracks.get(link.to);
      if (!child) return;
      const feature = new Feature({
        kind: "link" as CellFeatureKind,
        code: link.to,
        from_code: link.from,
        max_severity: child.max_severity,
        age_minutes: ageMinutes(child.last_seen, now),
        geometry: new LineString([fromLonLat(link.start), fromLonLat(link.end)]),
      });
      feature.setId(`${link.from}>${link.to}`);
      joins.push(feature);
    });

    this.vs.clear(true);
    // Joins first, so the tracks and their marks draw over them rather than a
    // dotted line crossing a cell's dot.
    this.vs.addFeatures([...joins, ...features]);
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
