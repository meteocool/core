import { Feature } from "ol";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import MultiPolygon from "ol/geom/MultiPolygon";
import { fromLonLat } from "ol/proj";
import type VectorSource from "ol/source/Vector";
import { get } from "svelte/store";
import { fetchStormGroups, fetchStorms, NothingPublished } from "../api";
import type { Progress, Storm, StormGroup } from "../api";
import { heldStormGroups, hiddenStormMarks, selectedStorm } from "../stores";
import { covers, padExtent, worldExtent } from "./cellGeometry";
import type { Extent } from "./cellGeometry";
import { liveReference } from "./cellPulse";
import { drawStorms } from "./stormMarks";
import { asksForGroups, groupOutlines } from "./stormGroups";
import type { GroupOutline } from "./stormGroups";
import type { StormMark } from "./stormMarks";
import { EASE_MS, easeOut, eases, plan, settledOn, shapeAt, showingAt } from "./stormEasing";
import type { Drawn, Easing, Shape } from "./stormEasing";
import { selectionKey, withStorm } from "./stormSelection";
import { holdStorms } from "./stormResolver";
import { stormAtMesocyclone } from "./mesocyclones";
import type { LiveStorm } from "./mesocyclones";
import { sameWindow } from "./archive";
import type { ArchiveWindow } from "./archive";

/**
 * The storm layer's contents: `/storms` for the viewport, replaced on each
 * answer. It replaces CellTrackManager, which drew KONRAD3D's
 * tracks; the marks are the same kinds (lib/stormMarks.ts, layers/cells.ts).
 *
 * As with the tracks, an answer is the whole answer for a viewport, so
 * nothing is kept from the one before it.
 *
 * With the storms, `/storms/groups` for the same viewport and window: the
 * storms that are one system, outlined on a layer of their own under the
 * marks (layers/stormGroups.ts). A backend without groups is a map without
 * outlines (lib/stormGroups.ts).
 */

/**
 * How far back to ask for: the player's two hours and the hour before them,
 * so the earliest frame has every storm it would have shown then, and a
 * storm that has merged is still there to be joined to.
 */
export const WINDOW_MINUTES = 180;

/** How much larger than the view to fetch, so small pans cost nothing. */
export const BBOX_PADDING = 0.25;

const project = (shape: Shape): Point | LineString | Polygon | MultiPolygon => {
  switch (shape.type) {
    case "Point": return new Point(fromLonLat(shape.coordinates));
    case "LineString": return new LineString(shape.coordinates.map((c) => fromLonLat(c)));
    case "Polygon": return new Polygon(shape.coordinates.map((ring) => ring.map((c) => fromLonLat(c))));
    default: return new MultiPolygon(shape.coordinates.map((rings) => rings.map((ring) => ring.map((c) => fromLonLat(c)))));
  }
};

/** Move a feature's geometry to `shape`, which is of the same type: only a position or a path is ever moved. */
function moveTo(feature: Feature, shape: Shape): void {
  const geometry = feature.getGeometry();
  if (shape.type === "Point" && geometry instanceof Point) geometry.setCoordinates(fromLonLat(shape.coordinates));
  else if (shape.type === "LineString" && geometry instanceof LineString) {
    geometry.setCoordinates(shape.coordinates.map((c) => fromLonLat(c)));
  }
}

/**
 * A mark's fade as its style reads it, in tenths: the styles are cached per
 * tenth (layers/cells.ts), and a feature whose tenth has not changed is not
 * touched, so a frame of a fade redraws only when the eye could tell.
 */
const tenths = (alpha: number): number => Math.round(alpha * 10) / 10;

/** What decides how a mark looks: a change of it cross-fades. */
const lookOf = (mark: StormMark): string => (mark.kind === "position" || mark.kind === "path"
  ? `${mark.kind}:${mark.quiet ? 1 : 0}:${mark.severity}:${mark.hail ? 1 : 0}:${mark.meso ? 1 : 0}:${mark.source}`
  : `${mark.kind}:${mark.severity}:${mark.source}`);

const drawnMark = (mark: StormMark): Drawn<StormMark> => ({
  key: mark.id,
  look: lookOf(mark),
  moves: mark.kind === "position" || mark.kind === "path",
  shape: mark.geometry,
  value: mark,
});

const drawnOutline = (outline: GroupOutline): Drawn<GroupOutline> => ({
  key: outline.id,
  // A system that catches up with the radar cross-fades from dashed to solid.
  look: outline.stale ? "stale" : "",
  moves: false,
  shape: { type: "MultiPolygon", coordinates: outline.polygons },
  value: outline,
});

function markFeature(easing: Easing<StormMark>): Feature {
  const { geometry: _geometry, tip, id: _id, ...properties } = easing.item.value;
  const feature = new Feature({
    ...properties,
    geometry: project(easing.from),
    ...(tip ? { tip: fromLonLat(tip) } : {}),
    fade: tenths(easing.fromAlpha),
    leaving: easing.leaving,
  });
  feature.setId(easing.key);
  return feature;
}

function outlineFeature(easing: Easing<GroupOutline>): Feature {
  const outline = easing.item.value;
  const feature = new Feature({
    storms: outline.storms,
    severity: outline.severity,
    stale: outline.stale,
    geometry: project(easing.from),
    fade: tenths(easing.fromAlpha),
    leaving: easing.leaving,
  });
  feature.setId(easing.key);
  return feature;
}

/** Whether the reader asked for less motion: every change then applies at once. */
const reducedMotion = (): boolean => (
  typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
);

/** One source's part of a transition: what it eases, and the features it draws them with. */
interface Running<T> {
  easings: Easing<T>[];
  /** The ones that change as it runs, each with its feature. */
  moving: { easing: Easing<T>; feature: Feature }[];
}

/** The easings that change as a transition runs, each with the feature drawing it. */
function movingOf<T>(easings: Easing<T>[], features: Feature[]): Running<T>["moving"] {
  return easings.flatMap((easing, index) => (
    easing.fromAlpha !== easing.toAlpha || easing.from !== easing.to ? [{ easing, feature: features[index] }] : []
  ));
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

  /**
   * The viewport that request asks for, padded, while it is out. A move
   * inside it waits for that answer instead of asking again: the bottom bar
   * settling just after the first fetch nudges the view a few pixels, and
   * that sent the storms and the groups twice.
   */
  private requested: Extent | null = null;

  /** The last answer as it came, so a past frame or a new selection can be drawn from it. */
  private answer: { storms: Storm[]; groups: StormGroup[] } | null = null;

  /** The source the groups' outlines are drawn from, if the map draws them. */
  private groupSource: VectorSource | null;

  /** When the backend last had no groups, ms, so it is not asked again on every pan; null for never. */
  private groupsAbsentAt: number | null = null;

  /** The moment drawn, ms, when the player is parked on an earlier frame; null for the present. */
  private at: number | null = null;

  /** The newest observed scan, ms, which a live storm's age counts from; null before the radar has one. */
  private newestScan: number | null = null;

  /** The storms still being seen, where the drawing has them: what a mesocyclone is matched against. */
  private live: LiveStorm[] = [];

  /** What the selection was when last drawn, so only a change of storm, cell or forecast redraws. */
  private drawnFor = "";

  /**
   * The past window the map is open in (lib/archive.ts), or null live: the
   * storms asked for are then every one that overlapped it, rewound to the
   * step on screen as an earlier live frame's are.
   */
  private past: ArchiveWindow | null = null;

  /** The storm marks' transition: running, or settled on what is drawn (lib/stormEasing.ts). */
  private marks: Running<StormMark> = { easings: [], moving: [] };

  /** The systems' outlines', the same way. */
  private outlines: Running<GroupOutline> = { easings: [], moving: [] };

  /** The live rings' points, by storm, kept so a ring stays the same ring while its storm moves. */
  private pings = new Map<string, Feature<Point>>();

  /** The rings that follow a sliding mark while a transition runs. */
  private following: { ping: Feature<Point>; easing: Easing<StormMark> }[] = [];

  /** When the running transition began (`performance.now()`), or null with none running. */
  private easingSince: number | null = null;

  /** The animation frame asked for, while a transition runs. */
  private frameRequest: number | null = null;

  /** Counts transitions, so what starts leaving in one has keys of its own. */
  private seq = 0;

  /** Whether anything has been drawn since the storms were last dropped: a first drawing appears at once. */
  private drawnOnce = false;

  /** When the player last stepped (`performance.now()`), for whether the next step is eased. */
  private lastStep: number | null = null;

  constructor(vectorSource: VectorSource, pulseSource: VectorSource | null = null, groupSource: VectorSource | null = null) {
    this.vs = vectorSource;
    this.pulse = pulseSource;
    this.groupSource = groupSource;
    holdStorms(() => this.answer?.storms ?? []);
    // The forecast is the selected storm's, and a cell walked to brings its own.
    selectedStorm.subscribe((selection) => {
      const key = `${selectionKey(selection)}|${selection?.cell?.code ?? ""}|${selection?.summary ? 1 : 0}`;
      if (key === this.drawnFor) return;
      this.drawnFor = key;
      this.draw("view");
    });
    // What the map key turns off is left out of the drawing, not hidden in its style.
    hiddenStormMarks.subscribe(() => this.draw("view"));
  }

  /**
   * Fetch and draw the storms covering `extent`. A move inside what is
   * already drawn is ignored unless forced.
   */
  async reload(extent: Extent | null, { force = false, nanobar }: { force?: boolean; nanobar?: Progress } = {}): Promise<void> {
    if (!this.enabled || !extent) return;
    const seen = worldExtent(extent);
    if (!force && (covers(this.fetched, seen) || covers(this.requested, seen))) return;

    const padded = worldExtent(padExtent(extent, BBOX_PADDING));
    const token = Symbol("storms");
    this.pending = token;
    this.requested = padded;

    const past = this.past;
    const window = past ? { since: past.start, until: past.end } : WINDOW_MINUTES;
    // Beside the storms, and never in their way: a failure is no groups.
    const groups = this.groupSource && asksForGroups(this.groupsAbsentAt, Date.now())
      ? fetchStormGroups(padded, window, nanobar).then((answer) => answer.features ?? [], (error: unknown) => {
        if (error instanceof NothingPublished) this.groupsAbsentAt = Date.now();
        return [] as StormGroup[];
      })
      : Promise.resolve([] as StormGroup[]);
    let collection;
    try {
      collection = await fetchStorms(padded, window, nanobar);
    } catch {
      // Already reported, or no storms served (a 404 is absence): nothing to
      // draw, and the next move asks again.
      if (this.pending === token) this.requested = null;
      return;
    }
    const held = await groups;
    if (this.pending === token) this.requested = null;
    if (this.pending !== token || !sameWindow(past, this.past)) return;

    this.fetched = padded;
    this.answer = { storms: collection.features ?? [], groups: held };
    heldStormGroups.set(this.answer);
    this.draw("update");
    this.refreshSelection();
  }

  /**
   * Open a past window, or go back to live with null: what is drawn is
   * dropped, and the next `reload` asks for the window's storms. Whether it
   * changed anything, for the caller to reload.
   */
  setWindow(next: ArchiveWindow | null): boolean {
    if (sameWindow(next, this.past)) return false;
    this.past = next;
    this.pending = null;
    this.requested = null;
    this.fetched = null;
    this.answer = null;
    this.live = [];
    this.dropDrawing();
    heldStormGroups.set({ storms: [], groups: [] });
    return true;
  }

  /** Draw the storms as they were at `atMs`, or as they are now for null; no request. */
  showAt(atMs: number | null): void {
    if (atMs === this.at) return;
    this.at = atMs;
    const now = performance.now();
    const stepGap = this.lastStep === null ? Infinity : now - this.lastStep;
    this.lastStep = now;
    this.draw("step", stepGap);
  }

  /** A new scan on the live step: the present's storms age from it. */
  setNewestScan(ms: number | null): void {
    if (ms === this.newestScan) return;
    this.newestScan = ms;
    if (this.at === null) this.draw("update");
  }

  /** The storms held, by id, for a tap on one of them. */
  stormFor(id: string): Storm | undefined {
    return this.answer?.storms.find((storm) => storm.properties.id === id);
  }

  /** The tracked storm a mesocyclone at `lon`, `lat` turns in, as drawn; null with none near it. */
  stormAtMesocyclone(lon: number, lat: number): string | null {
    return stormAtMesocyclone(this.live, lon, lat);
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

  /**
   * Draw the answer held, eased from what is drawn now (lib/stormEasing.ts):
   * a new answer or scan, and a step of the player unless it came hard on
   * the one before. A change of what is viewed (a selection, the map key)
   * applies at once, as does everything with reduced motion.
   */
  private draw(change: "update" | "step" | "view", stepGap?: number): void {
    if (!this.enabled || !this.answer) return;
    // The answer names no cycle of its own, as `/cells/tracks` did: in the present, the newest scan is the reference.
    const now = liveReference(this.at, this.newestScan, Date.now());
    const { storms, groups } = this.answer;
    const reference = now;
    const hidden = get(hiddenStormMarks);
    const { marks, links, pings, live } = drawStorms(storms, {
      now, reference, selection: get(selectedStorm), at: this.at, hidden,
    });
    this.live = live;

    const ease = change !== "view" && eases({
      reducedMotion: reducedMotion(), drawnBefore: this.drawnOnce, stepGap: change === "step" ? stepGap : undefined,
    });
    this.drawnOnce = true;
    // Taken over from wherever a running transition has got to.
    const t = this.easingSince === null ? 1 : (performance.now() - this.easingSince) / EASE_MS;
    const seq = ++this.seq;
    const transition = <T>(running: Running<T>, next: Drawn<T>[]): Easing<T>[] => (
      ease ? plan(showingAt(running.easings, t), next, seq) : settledOn(next)
    );

    if (this.groupSource) {
      // Switched off in the map key: the systems' outlines fade out with the rest of a change.
      const outlines = hidden.has("system") ? [] : groupOutlines(groups, now);
      const easings = transition(this.outlines, outlines.map(drawnOutline));
      const features = easings.map(outlineFeature);
      this.outlines = { easings, moving: movingOf(easings, features) };
      this.groupSource.clear(true);
      this.groupSource.addFeatures(features);
    }

    // Joins first, so the tracks and their marks draw over them.
    const easings = transition(this.marks, [...links, ...marks].map(drawnMark))
      .sort((a, b) => Number(b.item.value.kind === "link") - Number(a.item.value.kind === "link"));
    const features = easings.map(markFeature);
    this.marks = { easings, moving: movingOf(easings, features) };
    this.vs.clear(true);
    this.vs.addFeatures(features);

    if (this.pulse) this.placePings(pings, easings, ease);

    if (ease && (this.marks.moving.length || this.outlines.moving.length || this.following.length)) {
      this.easingSince = performance.now();
      if (this.frameRequest === null) this.frameRequest = requestAnimationFrame(this.frame);
    } else {
      this.stopEasing();
    }
  }

  /**
   * The live rings: one point per storm, kept from one drawing to the next
   * so its ring stays the same ring, starting where its storm's mark starts
   * and following it while it slides. A storm that fades in brings its ring
   * in with it (layers/cellPulse.ts `arriving`).
   */
  private placePings(pings: ReturnType<typeof drawStorms>["pings"], easings: Easing<StormMark>[], ease: boolean): void {
    const pulse = this.pulse!;
    const positions = new Map<string, Easing<StormMark>>();
    for (const easing of easings) {
      if (!easing.leaving && easing.item.value.kind === "position") positions.set(easing.item.value.storm, easing);
    }
    const wanted = new Set(pings.map((ping) => ping.storm));
    for (const [storm, feature] of this.pings) {
      if (wanted.has(storm)) continue;
      pulse.removeFeature(feature);
      this.pings.delete(storm);
    }
    this.following = [];
    const added: Feature<Point>[] = [];
    for (const ping of pings) {
      const easing = positions.get(ping.storm);
      const start = easing && easing.from.type === "Point" ? easing.from.coordinates : ping.coordinates;
      let feature = this.pings.get(ping.storm);
      const properties = {
        storm: ping.storm,
        severity: ping.severity,
        history_minutes: ping.history_minutes,
        arriving: ease && !feature && (easing?.fromAlpha ?? 1) === 0,
      };
      if (feature) {
        feature.setProperties(properties, true);
        feature.getGeometry()!.setCoordinates(fromLonLat(start));
      } else {
        feature = new Feature({ ...properties, geometry: new Point(fromLonLat(start)) });
        this.pings.set(ping.storm, feature);
        added.push(feature);
      }
      if (easing && easing.from !== easing.to) this.following.push({ ping: feature, easing });
    }
    // Not silent: the rings are laid out again on this source changing.
    if (added.length) pulse.addFeatures(added);
    else pulse.changed();
  }

  /** One frame of the running transition: only what changes is touched. */
  private frame = (time: number): void => {
    this.frameRequest = null;
    if (this.easingSince === null) return;
    const t = (time - this.easingSince) / EASE_MS;
    if (t >= 1) {
      this.settle();
      return;
    }
    const e = easeOut(t);
    for (const running of [this.marks, this.outlines] as Running<unknown>[]) {
      for (const { easing, feature } of running.moving) {
        if (easing.from !== easing.to) moveTo(feature, shapeAt(easing.from, easing.to, e));
        feature.set("fade", tenths(easing.fromAlpha + (easing.toAlpha - easing.fromAlpha) * e));
      }
    }
    for (const { ping, easing } of this.following) {
      const shape = shapeAt(easing.from, easing.to, e);
      if (shape.type === "Point") ping.getGeometry()!.setCoordinates(fromLonLat(shape.coordinates));
    }
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  /** End the running transition: everything where it was going, what was leaving gone. */
  private settle(): void {
    const finish = <T>(running: Running<T>, source: VectorSource | null): Running<T> => {
      for (const { easing, feature } of running.moving) {
        if (easing.leaving) {
          source?.removeFeature(feature);
          continue;
        }
        if (easing.from !== easing.to) moveTo(feature, easing.to);
        feature.set("fade", 1);
      }
      return { easings: settledOn(running.easings.filter((easing) => !easing.leaving).map((easing) => easing.item)), moving: [] };
    };
    this.marks = finish(this.marks, this.vs);
    this.outlines = finish(this.outlines, this.groupSource);
    for (const { ping, easing } of this.following) {
      if (easing.to.type === "Point") ping.getGeometry()!.setCoordinates(fromLonLat(easing.to.coordinates));
    }
    for (const ping of this.pings.values()) ping.set("arriving", false, true);
    this.following = [];
    this.stopEasing();
  }

  private stopEasing(): void {
    this.easingSince = null;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
  }

  /** Drop everything drawn and any transition, so the next drawing appears at once. */
  private dropDrawing(): void {
    this.stopEasing();
    this.marks = { easings: [], moving: [] };
    this.outlines = { easings: [], moving: [] };
    this.following = [];
    this.pings.clear();
    this.drawnOnce = false;
    this.vs.clear();
    this.pulse?.clear();
    this.groupSource?.clear();
  }

  clearAll(): void {
    this.fetched = null;
    this.requested = null;
    this.answer = null;
    this.live = [];
    this.dropDrawing();
    heldStormGroups.set({ storms: [], groups: [] });
  }

  enable(state: boolean): void {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
