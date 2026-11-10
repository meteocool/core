/**
 * Filling in the selected storm: from a seed to its storm, and from the
 * storm's list copy to its detail.
 *
 * The selection (lib/stormSelection.ts) is set at once from whatever was
 * tapped, and this does the asking that follows:
 *
 * - a seed is found in its storm, client-side, since the backend has no
 *   lookup by cell or feature: a KONRAD3D cell by the tracks each listed
 *   storm claims (the flat map's, else a small box around the cell asked of
 *   `/storms`); a box of sky by its patch, among the features of the few
 *   storms nearest it, fetched in full. One no storm claims stays a seed;
 * - a storm known by id is fetched in full (`/storms/{id}`), and again when
 *   its list copy shows it has moved on, or a `storms` event says so. The
 *   last detail of each storm is kept, so one reopened shows its history at
 *   once rather than an empty panel while (or instead of) it is asked again;
 * - a storm with no volume yet gets the one cut from its newest patch, of
 *   the volumes listed now (`offerVolumes`), so its panel can cut it open on
 *   the flat map as well.
 *
 * Each answer is applied only to the selection it was asked for.
 */
import { get } from "svelte/store";
import { fetchStorm, fetchStorms, NothingPublished, quietly } from "../api";
import type { Progress, RadarVolume, Storm, StormDetail } from "../api";
import { selectedStorm } from "../stores";
import {
  holdsFeature, keepHistory, lookupOf, nearestStorms, positionOf, selectionKey, stormClaiming, volumeOfStorm, withDetail,
  withStorm,
} from "./stormSelection";
import type { StormSelection } from "./stormSelection";

/** The storms the flat map holds, for finding a seed's storm without a request; see StormManager. */
let held: () => Iterable<Storm> = () => [];

/** The volumes listed now (the flat map's cloud tags, the 3D map's boxes), newest offer wins. */
let volumes: readonly RadarVolume[] = [];

/** How far around a seed to ask for storms, in degrees: a storm's centroid is near its cells and its boxes. */
const SEARCH_DEG = 0.5;
/** How far back: a cell or a box from a link may be some way into the past. */
const SEARCH_MINUTES = 180;
/** A box of sky is looked for in at most this many storms, this near it. */
const FEATURE_CANDIDATES = 3;
const FEATURE_WITHIN_KM = 40;

/** Who holds the storms the flat map draws. */
export function holdStorms(source: () => Iterable<Storm>): void {
  held = source;
}

/** The storms the flat map holds now. */
export function heldStorms(): Storm[] {
  return [...held()];
}

/** The volumes listed now, so a storm selected on the flat map finds the box its patch is in. */
export function offerVolumes(listed: readonly RadarVolume[]): void {
  volumes = listed;
  const current = get(selectedStorm);
  if (current?.id && !current.volume) attachVolume(current);
}

function attachVolume(selection: StormSelection) {
  const volume = volumeOfStorm(volumes, selection);
  if (!volume) return;
  selectedStorm.update((current) => (
    current && current.id === selection.id && !current.volume ? { ...current, volume } : current
  ));
}

/** The storms listed around a point, quietly; none when the backend serves none. */
async function stormsAround([lon, lat]: [number, number]): Promise<Storm[]> {
  try {
    const answer = await fetchStorms(
      [lon - SEARCH_DEG, lat - SEARCH_DEG, lon + SEARCH_DEG, lat + SEARCH_DEG], SEARCH_MINUTES, quietly,
    );
    return answer.features ?? [];
  } catch {
    return [];
  }
}

/**
 * Start resolving whatever is selected, now and from here on. Returns
 * `refresh`, which fetches the open storm's detail again (the `storms`
 * event), and the teardown.
 */
export function startStormResolver(nanobar?: Progress): { refresh: () => void; stop: () => void } {
  /** Lookups and fetches already asked, by what they were for, so nothing is asked twice. */
  const asked = new Set<string>();
  /**
   * The newest detail of each storm opened, by id: what a storm reopened
   * shows at once, and whose `last_seen` says whether a newer list copy needs
   * it fetched again. A storm's history only grows, so an older detail is
   * never worse than none.
   */
  const details = new Map<string, StormDetail>();

  function remember(detail: StormDetail) {
    const id = detail.storm.properties.id;
    const held = details.get(id);
    if (held && held.storm.properties.last_seen > detail.storm.properties.last_seen) return;
    details.set(id, held ? keepHistory(detail, held) : detail);
  }

  /** Apply what was found for a seed, if that seed is still what is selected. */
  function found(key: string, storm: Storm, detail: StormDetail | null) {
    selectedStorm.update((current) => {
      if (selectionKey(current) !== key) return current;
      const resolved = withStorm(current, storm);
      return detail ? withDetail(resolved, detail) : resolved;
    });
    if (detail) remember(detail);
  }

  async function resolve(selection: StormSelection) {
    const lookup = lookupOf(selection);
    if (!lookup) return;
    const key = selectionKey(selection);
    if (asked.has(key)) return;
    asked.add(key);
    const at = positionOf(selection);

    if ("cell" in lookup) {
      const storm = stormClaiming(held(), lookup.cell) ?? (at ? stormClaiming(await stormsAround(at), lookup.cell) : null);
      if (storm) found(key, storm, null);
      return;
    }

    if (!at) return;
    const nearby = nearestStorms([...held()], at, FEATURE_WITHIN_KM, FEATURE_CANDIDATES);
    const candidates = nearby.length ? nearby : nearestStorms(await stormsAround(at), at, FEATURE_WITHIN_KM, FEATURE_CANDIDATES);
    for (const storm of candidates) {
      let detail: StormDetail;
      try {
        detail = await fetchStorm(storm.properties.id, quietly);
      } catch {
        continue;
      }
      if (selectionKey(get(selectedStorm)) !== key) return;
      const candidate = { ...selection, id: storm.properties.id, summary: storm, detail };
      if (holdsFeature(candidate, lookup.feature)) {
        found(key, detail.storm, detail);
        return;
      }
    }
  }

  async function fetchDetail(id: string, seen: string) {
    const key = `detail:${id}@${seen}`;
    if (asked.has(key)) return;
    asked.add(key);
    let detail: StormDetail;
    try {
      detail = await fetchStorm(id, nanobar);
    } catch (error) {
      // Gone from the working set, or not served: the panel says what the
      // list copy or the seed can. A request that failed is asked again the
      // next time the selection changes, as a storm that is gone is not.
      if (!(error instanceof NothingPublished)) asked.delete(key);
      return;
    }
    remember(detail);
    selectedStorm.update((current) => withDetail(current, detail));
    const current = get(selectedStorm);
    if (current?.id === id && !current.volume) attachVolume(current);
  }

  function step(selection: StormSelection | null) {
    if (!selection) return;
    if (selection.id === null) {
      void resolve(selection);
      return;
    }
    const { id } = selection;
    if (selection.detail) remember(selection.detail);
    const held = details.get(id);
    if (!selection.detail && held) {
      // Reopened: the history it had, at once. Under the list copy's header,
      // which may be newer; that makes the next step ask for a newer detail.
      selectedStorm.update((current) => {
        if (current?.id !== id || current.detail) return current;
        const shown = withDetail(current, held);
        return shown && current.summary ? { ...shown, summary: current.summary } : shown;
      });
      return;
    }
    const seen = selection.summary?.properties.last_seen ?? "";
    const fetchedAt = held?.storm.properties.last_seen;
    if (!selection.detail || (fetchedAt !== undefined && seen > fetchedAt)) {
      void fetchDetail(selection.id, seen);
    }
    if (!selection.volume) attachVolume(selection);
  }

  const unsubscribe = selectedStorm.subscribe(step);

  return {
    refresh() {
      const current = get(selectedStorm);
      if (!current?.id) return;
      // A new cycle: anything may have changed, asked again under a new key.
      void fetchDetail(current.id, `${current.summary?.properties.last_seen ?? ""}#${Date.now()}`);
    },
    stop: unsubscribe,
  };
}
