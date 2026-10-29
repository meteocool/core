/**
 * The address bar as a record of what is on screen, and the way back into it.
 *
 * Three jobs:
 *
 * - on load, put the page in the state its link describes. What is known
 *   before anything is built (which map, where, which overlays) goes in
 *   through App.svelte and LayerManager at construction; what needs data (a
 *   storm, its slice, a frame of the player) is restored here once it can be;
 * - while the page runs, keep the URL describing what is on screen, so the
 *   address bar, and the share sheet that shares it, always hold a link back;
 * - on Back and Forward, restore whatever the entry describes.
 *
 * What goes into a link, and what deliberately stays out of it, is
 * lib/deepLink.ts. Presentation (basemap, colours, dark mode, units) is the
 * receiver's own and is never written.
 *
 * The writing is web only. The apps' webviews have no address bar, and on
 * Android the history is what the hardware Back button walks: entries pushed
 * there would make Back step through storms instead of leaving the map. A
 * link handed to an app's webview is still read.
 */
import { derived, get } from "svelte/store";
import type { Readable } from "svelte/store";
import { fromLonLat } from "ol/proj";
import { fetchCellTrack, fetchStorm, NothingPublished } from "../api";
import type { CellTrack, Progress, StormDetail } from "../api";
import type Cells3DCapability from "../caps/Cells3DCapability";
import type { CameraRequest } from "../caps/Cells3DCapability";
import {
  capLatestObservation, capTimeIndicator, cellLayerVisible, cells3dLoading, cells3dVisible, cloudsTime, cutRotationDeg,
  cycloneLayerVisible, frameRequest, hiddenStormMarks, inspectLatLon, lightningLayerVisible, mapExtent4326, mapView,
  modelCompareAt, observedProduct, peelLevel, peelManual, playbackRunning, selectedStation, selectedStorm,
  sharedActiveCap, siteMarksVisible, siteMode, srvManualMotion, srvPrefersManual, stationChoice,
  stationLayerVisible, stormDetails,
} from "../stores";
import type StormManager from "./StormManager";
import type StationManager from "./StationManager";
import {
  fromStorm, isResolution, motionOf, positionOf, selectionKey, withCell, withDetail, withVolume,
} from "./stormSelection";
import type { StormSelection } from "./stormSelection";
import { MAP_OVERLAYS, OVERLAYS, STORM_MARKS, isNavigation, linkSearch, parseLink } from "./deepLink";
import type { LinkState, Overlay, OverlayStates } from "./deepLink";
import { formatManualMotion, resolveMotion } from "./srvMotion";
import { DeviceDetect as dd } from "./DeviceDetect";
import type { LayerManager } from "./LayerManager";
import type Settings from "./Settings";
import { linkAge, staleNotice, staleSince } from "./shareLink";
import { reportToast } from "./Toast";
import { currentLocale, t } from "../locale/t";
import { setElementCentre } from "./viewCentre";
import { onWake } from "./wakeup";
import { radarSite } from "./radarSites";

/** The setting each overlay is stored under, whose callback drives its store. */
const OVERLAY_SETTINGS: Record<Overlay, string> = {
  cells: "layerCells",
  lightning: "layerLightning",
  mesocyclones: "layerMesocyclones",
  sites: "layerSites",
  stations: "layerStations",
  tiers: "layer3dCells",
};

const OVERLAY_STORES: Record<Overlay, Readable<boolean>> = {
  cells: cellLayerVisible,
  lightning: lightningLayerVisible,
  mesocyclones: cycloneLayerVisible,
  sites: siteMarksVisible,
  stations: stationLayerVisible,
  tiers: cells3dVisible,
};

/** The element every capability draws its full-size map into; see Map.svelte. */
const MAP_TARGET = "map";

/**
 * How long a change waits before it is written.
 *
 * Dragging the cutaway's slice changes it every frame, and Safari does not
 * ignore a page that updates its history faster than about three times a
 * second for long: it throws.
 */
const WRITE_DELAY_MS = 250;

/**
 * The longest a restore may hold the URL back.
 *
 * Long enough for a slow phone to fetch a track and a volume; short enough
 * that a request the network has silently dropped cannot leave the address bar
 * frozen for the rest of the session.
 */
const RESTORE_HOLD_MS = 15_000;

/**
 * The zoom a link to a storm opens at when it does not say where to look.
 * At the country-wide default a storm is a dot; this is a county.
 */
const STORM_ZOOM = 8;

/** The zoom a link to a radar opens at when it does not say where to look: its whole reach in view. */
const RADAR_ZOOM = 7;

/** The link the page was opened with. Read once: the URL is ours to rewrite from here on. */
export const openingLink: LinkState = parseLink(window.location.search);

/**
 * Whether the opening link says where to look.
 *
 * The web build flies to the reader's own position once geolocation answers,
 * which on a link would take them away from the storm they were sent, a few
 * seconds after showing it to them. Their position is still marked; the map
 * just stays where the link put it.
 */
export function linkPlacesView(link: LinkState = openingLink): boolean {
  return Boolean(link.view || link.storm || link.cell || link.cloud || link.point || link.radar || link.station);
}

/**
 * The choices a link names that are settings (the overlays, the product,
 * the storm marks put away, the stations' parameter, a hand's storm motion),
 * held for this page load without being stored.
 *
 * Called before the stores are first read, so the layers come up the way the
 * link says rather than flickering through the reader's own on the way. An
 * overlay the link does not name stays the reader's own. A linked cell turns
 * the cell layer on as well: a storm selected on a map that does not draw
 * storms is a panel about nothing, and the layer's gate in App.svelte would
 * drop the selection as soon as it was made. A linked station turns the
 * stations on for the same reason, and a linked radar the radars' marks.
 */
export function applyLinkedChoices(settings: Settings, link: LinkState = openingLink): void {
  if (link.overlays) {
    for (const overlay of OVERLAYS) {
      const on = link.overlays[overlay];
      if (on !== undefined) settings.override(OVERLAY_SETTINGS[overlay], on);
    }
  }
  if (link.product) settings.override("radarProduct", link.product);
  // As the setting spells it, in the key's order, so the store's echo of it matches.
  if (link.hide) settings.override("hiddenStormMarks", STORM_MARKS.filter((mark) => link.hide!.includes(mark)).join(","));
  if (link.stationParameter) settings.override("stationParameter", link.stationParameter);
  if (link.motion) settings.override("srvMotion", formatManualMotion(link.motion));
  if (link.storm || link.cell) settings.override(OVERLAY_SETTINGS.cells, true);
  // A linked radar opens whether or not the reader keeps the radars' marks on.
  if (link.radar) settings.override(OVERLAY_SETTINGS.sites, true);
  if (link.station) settings.override(OVERLAY_SETTINGS.stations, true);
}

/** Every overlay of `layer`'s map, on or off: a link from it says each, so the receiver's own do not stand in. */
function overlayStates(layer: string): OverlayStates | undefined {
  const overlays = MAP_OVERLAYS[layer];
  if (!overlays) return undefined;
  return Object.fromEntries(overlays.map((overlay) => [overlay, get(OVERLAY_STORES[overlay])]));
}

/** Resolves once `ready` holds for the store's value, or after `ms` in any case. */
function until<T>(store: Readable<T>, ready: (value: T) => boolean, ms = RESTORE_HOLD_MS): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // Called from inside subscribe() the first time round, before it has returned.
      queueMicrotask(() => unsubscribe?.());
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    unsubscribe = store.subscribe((value) => { if (ready(value)) finish(); });
  });
}

/** `CameraRequest` without the keys a link left out, so a merge cannot erase them. */
function defined(camera: CameraRequest): CameraRequest {
  return Object.fromEntries(Object.entries(camera).filter(([, value]) => value !== undefined));
}

/** The storm that is open, as one comparable string; empty for none. */
function selection(): string {
  return selectionKey(get(selectedStorm));
}

/** Whether the player is parked on a frame other than the newest observation. */
function offLiveEdge(): boolean {
  const shown = get(capTimeIndicator);
  const newest = get(capLatestObservation);
  return shown > 0 && newest > 0 && shown !== newest;
}

/**
 * What is on screen, as a link would describe it; null before anything is.
 * Also what a shared link says (lib/share.ts), which in the apps is the only
 * place it is written: their webviews keep the URL they were opened with.
 */
export function currentState(): LinkState | null {
  const layer = get(sharedActiveCap);
  if (!layer) return null;
  const state: LinkState = { layer };

  const view = get(mapView);
  if (view) {
    state.view = { lat: view.lat, lon: view.lon, zoom: view.zoom };
    if (layer === "cells3d" && view.pitch !== undefined) {
      state.pitch = view.pitch;
      state.bearing = view.bearing;
    }
  }

  // The storm once found; until then (or if none claims it) the cell or
  // the box it was opened on, so a link copied meanwhile still opens it.
  const storm = get(selectedStorm);
  const cell = storm?.cell ?? null;
  const cloud = storm?.volume ?? null;
  const tracked = Boolean(storm?.id || cell);
  if (storm?.id) state.storm = storm.id;
  else if (cell) state.cell = cell.code;
  else if (cloud && layer === "cells3d") state.cloud = cloud.path;
  if (tracked && !get(stormDetails)) state.details = false;
  // Only a storm with a volume has a slice to turn.
  if (storm && (cell?.volume || cloud) && (tracked || layer === "cells3d")) state.cut = get(cutRotationDeg);

  // Every overlay of the map on screen, on or off. All on used to go unsaid,
  // which left a receiver who had turned one off for good with theirs rather
  // than the sender's; a link now says what the sender saw.
  const overlays = overlayStates(layer);
  if (overlays) state.overlays = overlays;

  // The product, the storm key, the stations, the player and the forecast
  // point are all the radar map's.
  if (layer === "radar") {
    state.product = get(observedProduct);
    const hidden = get(hiddenStormMarks);
    state.hide = STORM_MARKS.filter((mark) => hidden.has(mark));
    if (get(stationLayerVisible)) state.stationParameter = get(stationChoice);
    // Not while it plays: that is a new frame twice a second, and a link
    // copied mid-animation would open parked on whichever one it caught.
    if (!tracked && !get(playbackRunning) && offLiveEdge()) state.time = get(capTimeIndicator);
    const point = get(inspectLatLon);
    if (point) state.point = point;
    const radar = get(siteMode);
    // A tilt of 0 is a link's "the lowest", until one is chosen in the tray.
    if (radar) state.radar = { site: radar.site, quantity: radar.quantity, tilt: radar.elevation || undefined };
    // The motion SRV takes out, when it is the hand's: a storm's comes with the storm.
    if (radar?.quantity === "srv") {
      const manual = get(srvManualMotion);
      if (resolveMotion(storm ? motionOf(storm) : null, manual, get(srvPrefersManual)).source === "manual") {
        state.motion = manual;
      }
    }
    const station = get(selectedStation);
    if (station && !storm) state.station = station.station;
  }

  // The 3D map's earlier scan, and its peel once the reader has set it.
  if (layer === "cells3d") {
    const scan = get(cloudsTime).shown;
    if (scan !== null && !tracked) state.time = scan;
    if (get(peelManual) && !storm) state.peel = get(peelLevel);
  }

  // The model comparison's drawer, on whichever map it was opened over.
  const compare = get(modelCompareAt);
  if (compare && !storm) state.compare = [compare.lat, compare.lon];
  return state;
}

/**
 * Tell the receiver of a shared link that has aged how old it is: the map
 * opens on the weather now, and without a word the reader takes it for what
 * the sender saw. Only for the link the page was opened with; Back never
 * reaches a stamped entry, because the first write drops the stamp.
 */
function noticeAge(link: LinkState) {
  const now = Date.now() / 1000;
  const shared = staleSince(link, now);
  if (shared === null) return;
  // Intl rather than date-fns, whose catalogue for the reader's language may
  // not have arrived this early in the load: "vor 2 Stunden", not "2 hours ago".
  const [value, unit] = linkAge(now - shared);
  const ago = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" }).format(-value, unit);
  reportToast(t(staleNotice(link), { values: { ago } }), "primary", "clock-history");
}

interface Wiring {
  lm: LayerManager;
  settings: Settings;
  stormmgr: StormManager;
  stationmgr?: StationManager;
  cells3d?: Cells3DCapability;
  nanobar?: Progress;
}

/**
 * Restore the opening link, then keep the URL and the history in step with
 * the page. Returns the teardown.
 */
export function startUrlState({ lm, settings, stormmgr, stationmgr, cells3d, nanobar }: Wiring): () => void {
  const writes = !dd.isApp();

  /** Restores in flight. Nothing is written while any are: see write(). */
  let pending = 0;

  /** Hold the writer while `work` runs, up to RESTORE_HOLD_MS. */
  function holding(work: Promise<void>) {
    pending += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.clearTimeout(ceiling);
      pending -= 1;
      schedule();
    };
    const ceiling = window.setTimeout(release, RESTORE_HOLD_MS);
    work.catch((error) => console.error("could not restore the link", error)).finally(release);
  }

  /** Bumped by every apply, so a slow restore cannot land over a newer one. */
  let generation = 0;

  /**
   * Whether the next write is the page catching up with a state it was put
   * in, rather than the reader doing something: the first write after load,
   * and the first after Back. Those replace the entry they describe. A push
   * there would stack a copy of the entry on itself and, after Back, throw
   * away every entry Forward could have gone to.
   */
  let settling = true;

  let timer: number | null = null;

  /** The View every OpenLayers map shares, and the 3D map reads on attach. */
  const sharedView = () => lm.maps[0]?.getView();

  /** Restores waiting for the network to come back; see `againOnWake`. */
  const waiting = new Set<() => void>();

  /**
   * Try a restore again on the next wake, for a link whose storm failed to
   * download rather than turned out to be gone. Opened on a train, a link
   * used to say the storm had dissipated when it was the network that had;
   * it now waits for the network, which a wake is the sign of
   * (lib/recovery.ts), unless the reader or Back has moved on by then.
   */
  function againOnWake(token: number, retry: () => Promise<void>) {
    const off = onWake(() => {
      off();
      waiting.delete(off);
      if (token === generation) retry().catch((error) => console.error("could not restore the link", error));
    });
    waiting.add(off);
  }

  /** Bring a storm (or a radar) into view, for a link that named it but not where to look. */
  function centreOn(lat: number, lon: number, least = STORM_ZOOM) {
    const view = sharedView();
    const zoom = Math.max(view?.getZoom() ?? 0, least);
    view?.setZoom(zoom);
    if (view) setElementCentre(view, fromLonLat([lon, lat]));
    // The 3D map reads the View when it is built, but not after.
    if (get(sharedActiveCap) === "cells3d") cells3d?.setCamera({ lat, lon, zoom });
  }

  /**
   * Open a linked cell: its whole track, as a tap on the map would have it.
   *
   * The code may be for a storm that has since dissipated, or that is nowhere
   * near the viewport, so the track is fetched on its own and pinned for the
   * layer to draw. One the backend has forgotten is a 404, which is the link
   * outliving the storm and is said as such rather than as a failure. Any
   * other failure is the network's, and is tried again once it is back.
   */
  async function restoreCell(link: LinkState, token: number, opening: boolean) {
    const before = selection();
    let answer: unknown = null;
    let failed = false;
    try {
      answer = await fetchCellTrack(link.cell!, nanobar, { optional: true });
    } catch (error) {
      failed = !(error instanceof NothingPublished);
    }
    // The reader has moved on in the meantime, and their choice beats the link's.
    if (token !== generation || selection() !== before) return;
    if (failed) {
      againOnWake(token, () => restoreCell(link, token, opening));
      return;
    }
    const track = answer as unknown as CellTrack | null;
    if (!track?.properties) {
      reportToast(t("storm.toast.cell_gone"));
      return;
    }
    // A seed of its storm, which lib/stormResolver.ts finds; the URL then
    // says `storm=` instead (see `resolved` below).
    selectedStorm.set(withCell(null, track.properties));
    stormDetails.set(link.details !== false);
    // After the cell, which resets the slice for a new storm on its own.
    if (link.cut !== undefined && track.properties.volume) cutRotationDeg.set(link.cut);
    if (opening && !link.view) {
      const series = track.properties.series ?? [];
      const last = series[series.length - 1];
      if (last) centreOn(last.lat, last.lon);
    }
    // Drawn now rather than on the next pan: the storms the layer holds
    // were fetched for another view. A no-op before the first render.
    void stormmgr.reload(get(mapExtent4326), { force: true, nanobar });
  }

  /**
   * Open a linked storm, fetched on its own: it may be nowhere near the
   * viewport, or ended past the map's window. One the backend has forgotten
   * is a 404, the link outliving the storm; any other failure is the
   * network's, tried again once it is back.
   */
  async function restoreStorm(link: LinkState, token: number, opening: boolean) {
    const before = selection();
    let detail: StormDetail | null = null;
    let failed = false;
    try {
      detail = await fetchStorm(link.storm!, nanobar);
    } catch (error) {
      failed = !(error instanceof NothingPublished);
    }
    if (token !== generation || selection() !== before) return;
    if (failed) {
      againOnWake(token, () => restoreStorm(link, token, opening));
      return;
    }
    if (!detail) {
      reportToast(t("storm.toast.storm_gone"));
      return;
    }
    const opened: StormSelection | null = withDetail(fromStorm(detail.storm), detail);
    selectedStorm.set(opened);
    stormDetails.set(link.details !== false);
    if (link.cut !== undefined) cutRotationDeg.set(link.cut);
    const at = opened ? positionOf(opened) : null;
    if (opening && !link.view && at) centreOn(at[1], at[0]);
    void stormmgr.reload(get(mapExtent4326), { force: true, nanobar });
  }

  /**
   * Open a linked station's sheet, with the values the stations on the map
   * were drawn from: the newest answer for the parameter on show, or the one
   * on its way. A station missing from it has not reported lately, or is no
   * station; that is said rather than left as a link that does nothing.
   */
  async function restoreStation(link: LinkState, token: number, opening: boolean) {
    if (!stationmgr) return;
    const before = get(selectedStation);
    const found = await stationmgr.find(link.station!);
    // The reader has moved on in the meantime, and their choice beats the link's.
    if (token !== generation || get(selectedStation) !== before || get(selectedStorm)) return;
    if (!found) {
      reportToast(t("stations.toast.station_gone"));
      return;
    }
    selectedStation.set(found.properties);
    const [lon, lat] = found.geometry.coordinates;
    if (opening && !link.view) centreOn(lat, lon);
  }

  /**
   * Put the 3D map's storms on a linked scan, or back on the newest. Once
   * the map is up and has its newest list, which an earlier scan is counted
   * back from; the finding is Cells3DCapability.showScan's.
   */
  async function restoreScan(scan: number | null, token: number) {
    if (!cells3d) return;
    // Up: built, come to rest (only MapLibre's camera has a pitch), and
    // with a scan to count back from.
    const up = derived([cloudsTime, cells3dLoading, mapView], ([time, loading, view]) =>
      time.newest !== null && !loading && view?.pitch !== undefined);
    // Longer than the writer is held: a first bring-up on a slow phone can
    // take that, and the scan is still the link's once it is up.
    await until(up, Boolean, 4 * RESTORE_HOLD_MS);
    // A map that never came up has nothing to look an earlier scan up on.
    if (token !== generation || !get(up)) return;
    cells3d.showScan(scan);
    // Held until it is on the map or turns out empty, so a link copied
    // meanwhile still names it.
    await until(cloudsTime, (time) => time.loading === null);
  }

  /** Open a linked storm core; the finding is Cells3DCapability.restoreCloud's. */
  async function restoreCloud(link: LinkState, token: number, opening: boolean) {
    if (!cells3d) return;
    const before = selection();
    let cloud: Awaited<ReturnType<typeof cells3d.restoreCloud>> = null;
    let failed = false;
    try {
      cloud = await cells3d.restoreCloud(link.cloud!);
    } catch {
      failed = true;
    }
    if (token !== generation || selection() !== before) return;
    if (failed) {
      againOnWake(token, () => restoreCloud(link, token, opening));
      return;
    }
    if (!cloud) {
      reportToast(t("storm.toast.volume_gone"));
      return;
    }
    selectedStorm.set(withVolume(null, cloud));
    stormDetails.set(true);
    if (link.cut !== undefined) cutRotationDeg.set(link.cut);
    if (opening && !link.view) centreOn(cloud.lat, cloud.lon);
  }

  /**
   * Put the page in the state `link` describes.
   *
   * On load the map, the view and the overlays are already in place (they
   * were read at construction), so only what needs data is left. From the
   * history everything is applied, the view first, so a switch to the 3D map
   * builds its camera where the entry was.
   */
  function apply(link: LinkState, opening: boolean) {
    generation += 1;
    const token = generation;
    settling = true;

    if (!opening) {
      const view = sharedView();
      if (link.view && view) {
        // A link's centre is the middle of the map element, as it was written.
        view.setZoom(link.view.zoom);
        setElementCentre(view, fromLonLat([link.view.lon, link.view.lat]));
      }
      if (link.layer && link.layer !== lm.currentCap && lm.getCapability(link.layer)) {
        lm.setTarget(link.layer, MAP_TARGET);
      }
      // Held rather than stored, like a link's: Back is not the reader
      // choosing. An entry the page wrote names every overlay of its map.
      applyLinkedChoices(settings, link);
    }

    const layer = opening ? lm.startingCapability() : lm.currentCap;
    if (layer === "cells3d") {
      cells3d?.setCamera(defined({ ...(opening ? {} : link.view), pitch: link.pitch, bearing: link.bearing }));
    }

    const current = selection();
    const open = get(selectedStorm);
    if (link.storm && (layer === "radar" || layer === "cells3d")) {
      if (current !== `storm:${link.storm}`) {
        holding(restoreStorm(link, token, opening));
      } else {
        stormDetails.set(link.details !== false);
        cutRotationDeg.set(link.cut ?? 0);
      }
    } else if (link.cell && (layer === "radar" || layer === "cells3d")) {
      // Back to an entry written before the cell's storm was found: the
      // storm it was found in is the same selection.
      if (current !== `cell:${link.cell}` && open?.cell?.code !== link.cell) {
        holding(restoreCell(link, token, opening));
      } else {
        stormDetails.set(link.details !== false);
        cutRotationDeg.set(link.cut ?? 0);
      }
    } else if (link.cloud && layer === "cells3d") {
      if (current !== `cloud:${link.cloud}` && open?.volume?.path !== link.cloud) {
        holding(restoreCloud(link, token, opening));
      } else {
        cutRotationDeg.set(link.cut ?? 0);
      }
    } else if (!opening) {
      selectedStorm.set(null);
    }

    if (layer === "radar") {
      // Only when it moves. The strip shows its loading state on every write
      // to the point and clears it when the next grid lands, and the radar
      // does not refetch for a point it already has, so the same point written
      // again left the strip loading for good.
      const point = link.point ?? null;
      const held = get(inspectLatLon);
      if (point?.[0] !== held?.[0] || point?.[1] !== held?.[1]) {
        if (point || !opening) inspectLatLon.set(point);
      }
      if (point && opening && !link.view && !link.cell && !link.storm) centreOn(point[0], point[1]);
      if (link.time !== undefined) frameRequest.set(link.time);
      else if (!opening && offLiveEdge()) frameRequest.set("live");
      // A linked radar: opened, or brought round to what the entry says; none named, closed on Back.
      const radar = link.radar;
      const opened = get(siteMode);
      if (radar) {
        // No tilt: 0, which `tiltNear` takes as the lowest.
        const elevation = radar.tilt ?? 0;
        if (opened?.site !== radar.site || opened.quantity !== radar.quantity || opened.elevation !== elevation) {
          siteMode.set({ site: radar.site, quantity: radar.quantity, elevation });
        }
        const at = radarSite(radar.site);
        if (opening && !link.view && at) centreOn(at.lat, at.lon, RADAR_ZOOM);
      } else if (!opening && opened) {
        siteMode.set(null);
      }
      // A linked station's sheet: opened, or on Back, closed when the entry has none.
      const station = get(selectedStation);
      if (link.station) {
        if (station?.station !== link.station) holding(restoreStation(link, token, opening));
      } else if (!opening && station) {
        selectedStation.set(null);
      }
    }

    if (layer === "cells3d") {
      if (link.peel !== undefined) {
        peelManual.set(true);
        peelLevel.set(link.peel);
      }
      const scan = link.time ?? null;
      if ((scan !== null || !opening) && get(cloudsTime).shown !== scan) holding(restoreScan(scan, token));
    }

    // The model comparison, on either map: opened where the link says, or
    // on Back closed when the entry has none. Compared as the link writes
    // it, so a point read back from one is not taken for another.
    const compare = link.compare;
    const at = get(modelCompareAt);
    const same = (a: number, b: number) => a.toFixed(5) === b.toFixed(5);
    if (compare) {
      if (!at || !same(at.lat, compare[0]) || !same(at.lon, compare[1])) {
        modelCompareAt.set({ lat: compare[0], lon: compare[1] });
      }
    } else if (!opening && at) {
      modelCompareAt.set(null);
    }
    schedule();
  }

  function write() {
    timer = null;
    // A restore in flight means the page has not caught up with its own URL
    // yet: written now, the link would lose the storm it is still fetching,
    // and the difference would read as the reader closing it: a push.
    if (!writes || pending > 0) return;
    const state = currentState();
    if (!state) return;
    const before = window.location.search;
    // Until a map has come to rest there is no view to write, only the one
    // the page was opened on; that one is kept as it was.
    const keep = get(mapView) ? [] : ["latLonZ", "pitch", "bearing"];
    const search = linkSearch(before, state, keep);
    const push = !settling && isNavigation(parseLink(before), state);
    settling = false;
    if (search === before) return;
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    try {
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(window.history.state, "", url);
    } catch (error) {
      // The rate limit above, or a sandboxed frame. The URL is a record of
      // the page, not what drives it, so the page carries on without it.
      console.warn("could not record the map's state in the URL", error);
    }
  }

  function schedule() {
    if (!writes || timer !== null) return;
    timer = window.setTimeout(write, WRITE_DELAY_MS);
  }

  apply(openingLink, true);
  noticeAge(openingLink);

  /* A seed's storm found is the same thing on screen under its proper name:
     the `cell=` or `cloud=` entry is replaced with `storm=`, not pushed over. */
  let shown: StormSelection | null = get(selectedStorm);
  const unsubscribeResolved = selectedStorm.subscribe((next) => {
    if (isResolution(shown, next)) settling = true;
    shown = next;
  });

  const watched: Readable<unknown>[] = [
    sharedActiveCap, mapView, selectedStorm, stormDetails, cutRotationDeg,
    ...Object.values(OVERLAY_STORES), observedProduct, hiddenStormMarks, stationChoice,
    capTimeIndicator, capLatestObservation, playbackRunning, inspectLatLon, siteMode,
    srvManualMotion, srvPrefersManual, selectedStation, modelCompareAt,
    // Only what a link says of them: the peel moves every frame while the
    // storms peel on their own, and the scan picker reports its progress.
    derived([peelManual, peelLevel], ([manual, level]) => (manual ? level : null)),
    derived(cloudsTime, (time) => time.shown),
  ];
  const unsubscribers = watched.map((store) => store.subscribe(() => schedule()));

  const onPopState = () => apply(parseLink(window.location.search), false);
  window.addEventListener("popstate", onPopState);

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribeResolved();
    waiting.forEach((off) => off());
    waiting.clear();
    window.removeEventListener("popstate", onPopState);
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
}
