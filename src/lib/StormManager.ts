import { Feature } from "ol";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import type VectorSource from "ol/source/Vector";
import { get } from "svelte/store";
import { fetchStorms } from "../api";
import type { Progress, Storm } from "../api";
import { selectedStorm } from "../stores";
import { covers, padExtent, worldExtent } from "./cellGeometry";
import type { Extent } from "./cellGeometry";
import { drawStorms } from "./stormMarks";
import type { MarkGeometry, StormMark } from "./stormMarks";
import { selectionKey, withStorm } from "./stormSelection";
import { holdStorms } from "./stormResolver";

/**
 * The storm layer's contents: `/storms` for the viewport, replaced on each
 * answer. It replaces CellTrackManager, which drew KONRAD3D's
 * tracks; the marks are the same kinds (lib/stormMarks.ts, layers/cells.ts).
 *
 * As with the tracks, an answer is the whole answer for a viewport, so
 * nothing is kept from the one before it.
 */

/**
 * How far back to ask for: the player's two hours and the hour before them,
 * so the earliest frame has every storm it would have shown then, and a
 * storm that has merged is still there to be joined to.
 */
export const WINDOW_MINUTES = 180;

/** How much larger than the view to fetch, so small pans cost nothing. */
export const BBOX_PADDING = 0.25;

const project = (geometry: MarkGeometry): Point | LineString | Polygon => {
  switch (geometry.type) {
    case "Point": return new Point(fromLonLat(geometry.coordinates));
    case "LineString": return new LineString(geometry.coordinates.map((c) => fromLonLat(c)));
    default: return new Polygon(geometry.coordinates.map((ring) => ring.map((c) => fromLonLat(c))));
  }
};

function featureOf(mark: StormMark): Feature {
  const { geometry, tip, id, ...properties } = mark;
  const feature = new Feature({ ...properties, geometry: project(geometry), ...(tip ? { tip: fromLonLat(tip) } : {}) });
  feature.setId(id);
  return feature;
}

export default class StormManager {
  /** The source the marks are drawn from. */
  private vs: VectorSource;

  /** One point per storm still being seen, for the ping in layers/cellPulse; apart for the reason CellTrackManager gave. */
  private pulse: VectorSource | null;

  /** The viewport the drawn storms were fetched for, padded. */
  private fetched: Extent | null = null;

  private enabled = true;

  /** The most recent request, so a slower earlier answer cannot overwrite it. */
  private pending: symbol | null = null;

  /** The last answer as it came, so a past frame or a new selection can be drawn from it. */
  private answer: { storms: Storm[] } | null = null;

  /** The moment drawn, ms, when the player is parked on an earlier frame; null for the present. */
  private at: number | null = null;

  /** What the selection was when last drawn, so only a change of storm, cell or forecast redraws. */
  private drawnFor = "";

  constructor(vectorSource: VectorSource, pulseSource: VectorSource | null = null) {
    this.vs = vectorSource;
    this.pulse = pulseSource;
    holdStorms(() => this.answer?.storms ?? []);
    // The forecast is the selected storm's, and a cell walked to brings its own.
    selectedStorm.subscribe((selection) => {
      const key = `${selectionKey(selection)}|${selection?.cell?.code ?? ""}|${selection?.summary ? 1 : 0}`;
      if (key === this.drawnFor) return;
      this.drawnFor = key;
      this.draw();
    });
  }

  /**
   * Fetch and draw the storms covering `extent`. A move inside what is
   * already drawn is ignored unless forced.
   */
  async reload(extent: Extent | null, { force = false, nanobar }: { force?: boolean; nanobar?: Progress } = {}): Promise<void> {
    if (!this.enabled || !extent) return;
    if (!force && covers(this.fetched, worldExtent(extent))) return;

    const padded = worldExtent(padExtent(extent, BBOX_PADDING));
    const token = Symbol("storms");
    this.pending = token;

    let collection;
    try {
      collection = await fetchStorms(padded, WINDOW_MINUTES, nanobar);
    } catch {
      // Already reported, or no storms served (a 404 is absence): nothing to draw.
      return;
    }
    if (this.pending !== token) return;

    this.fetched = padded;
    this.answer = { storms: collection.features ?? [] };
    this.draw();
    this.refreshSelection();
  }

  /** Draw the storms as they were at `atMs`, or as they are now for null; no request. */
  showAt(atMs: number | null): void {
    if (atMs === this.at) return;
    this.at = atMs;
    this.draw();
  }

  /** The storms held, by id, for a tap on one of them. */
  stormFor(id: string): Storm | undefined {
    return this.answer?.storms.find((storm) => storm.properties.id === id);
  }

  /**
   * The open panel is written in the present tense, so the selected storm is
   * handed the answer's copy of itself; a newer `last_seen` on it makes the
   * resolver fetch its detail again. Only in the present.
   */
  private refreshSelection(): void {
    if (this.at !== null) return;
    const current = get(selectedStorm);
    if (!current?.id) return;
    const fresh = this.stormFor(current.id);
    if (fresh && fresh !== current.summary) selectedStorm.update((selection) => (
      selection?.id === fresh.properties.id ? withStorm(selection, fresh) : selection
    ));
  }

  private draw(): void {
    if (!this.enabled || !this.answer) return;
    const now = this.at ?? Date.now();
    // The answer names no cycle of its own, as `/cells/tracks` did: the clock is the reference.
    const { storms } = this.answer;
    const reference = now;
    const { marks, links, pings } = drawStorms(storms, {
      now, reference, selection: get(selectedStorm), at: this.at,
    });
    this.vs.clear(true);
    // Joins first, so the tracks and their marks draw over them.
    this.vs.addFeatures([...links, ...marks].map(featureOf));
    if (this.pulse) {
      this.pulse.clear(true);
      // Not silent: the ping's timer starts and stops on this source changing.
      if (pings.length) {
        this.pulse.addFeatures(pings.map((ping) => new Feature({
          storm: ping.storm,
          severity: ping.severity,
          history_minutes: ping.history_minutes,
          geometry: new Point(fromLonLat(ping.coordinates)),
        })));
      } else {
        this.pulse.changed();
      }
    }
  }

  clearAll(): void {
    this.fetched = null;
    this.answer = null;
    this.vs.clear();
    this.pulse?.clear();
  }

  enable(state: boolean): void {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
