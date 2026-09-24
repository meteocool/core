/**
 * The address bar as a record of what is on screen, and the way back into it.
 *
 * Three jobs:
 *
 * - on load, put the page in the state its link describes. What is known
 *   before anything is built -- which map, where, which overlays -- goes in
 *   through App.svelte and LayerManager at construction; what needs data -- a
 *   storm, its slice, a frame of the player -- is restored here once it can be;
 * - while the page runs, keep the URL describing what is on screen, so the
 *   address bar, and the share sheet that shares it, always hold a link back;
 * - on Back and Forward, restore whatever the entry describes.
 *
 * What goes into a link, and what deliberately stays out of it, is
 * lib/deepLink.ts. Presentation -- basemap, colours, dark mode, units -- is
 * the receiver's own and is never written.
 *
 * The writing is web only. The apps' webviews have no address bar, and on
 * Android the history is what the hardware Back button walks: entries pushed
 * there would make Back step through storms instead of leaving the map. A
 * link handed to an app's webview is still read.
 */
import { get } from "svelte/store";
import type { Readable } from "svelte/store";
import { fromLonLat } from "ol/proj";
import { fetchCellTrack } from "../api";
import type { CellTrack, Progress } from "../api";
import type Cells3DCapability from "../caps/Cells3DCapability";
import type { CameraRequest } from "../caps/Cells3DCapability";
import {
  capLatestObservation, capTimeIndicator, cellDetails, cellLayerVisible, cutRotationDeg, cycloneLayerVisible,
  frameRequest, inspectLatLon, lightningLayerVisible, mapExtent4326, mapView, playbackRunning, selectedCell,
  selectedVolume, sharedActiveCap,
} from "../stores";
import { trimToLastRun } from "./cellTrack";
import type CellTrackManager from "./CellTrackManager";
import { OVERLAYS, isNavigation, linkSearch, parseLink } from "./deepLink";
import type { LinkState, Overlay } from "./deepLink";
import { DeviceDetect as dd } from "./DeviceDetect";
import type { LayerManager } from "./LayerManager";
import type Settings from "./Settings";
import { reportToast } from "./Toast";
import { setElementCentre } from "./viewCentre";

/** The setting each overlay is stored under, whose callback drives its store. */
const OVERLAY_SETTINGS: Record<Overlay, string> = {
  cells: "layerCells",
  lightning: "layerLightning",
  mesocyclones: "layerMesocyclones",
};

const OVERLAY_STORES: Record<Overlay, Readable<boolean>> = {
  cells: cellLayerVisible,
  lightning: lightningLayerVisible,
  mesocyclones: cycloneLayerVisible,
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
  return Boolean(link.view || link.cell || link.cloud || link.point);
}

/**
 * The overlays a link names, held for this page load without being stored.
 *
 * Called before the overlay stores are first read, so the layers come up the
 * way the link says rather than flickering through the reader's own on the
 * way. A linked cell turns the cell layer on as well: a storm selected on a map
 * that does not draw storms is a panel about nothing, and the layer's gate in
 * App.svelte would drop the selection as soon as it was made.
 */
export function applyLinkedOverlays(settings: Settings, link: LinkState = openingLink): void {
  if (link.overlays) {
    for (const overlay of OVERLAYS) {
      settings.override(OVERLAY_SETTINGS[overlay], link.overlays.includes(overlay));
    }
  }
  if (link.cell) settings.override(OVERLAY_SETTINGS.cells, true);
}

/** `CameraRequest` without the keys a link left out, so a merge cannot erase them. */
function defined(camera: CameraRequest): CameraRequest {
  return Object.fromEntries(Object.entries(camera).filter(([, value]) => value !== undefined));
}

/** The storm that is open, as one comparable string; empty for none. */
function selection(): string {
  const cell = get(selectedCell);
  if (cell) return `cell:${cell.code}`;
  const cloud = get(selectedVolume);
  return cloud ? `cloud:${cloud.path}` : "";
}

/** Whether the player is parked on a frame other than the newest observation. */
function offLiveEdge(): boolean {
  const shown = get(capTimeIndicator);
  const newest = get(capLatestObservation);
  return shown > 0 && newest > 0 && shown !== newest;
}

/** What is on screen, as a link would describe it; null before anything is. */
function currentState(): LinkState | null {
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

  const cell = get(selectedCell);
  const cloud = get(selectedVolume);
  if (cell) {
    state.cell = cell.code;
    if (!get(cellDetails)) state.details = false;
    // Only a cell with a volume has a slice to turn.
    if (cell.volume) state.cut = get(cutRotationDeg);
  } else if (cloud && layer === "cells3d") {
    state.cloud = cloud.path;
    state.cut = get(cutRotationDeg);
  }

  // The overlays, the player and the forecast point are all the radar map's.
  if (layer === "radar") {
    // Only when they differ from the default of all on. Everything on is what
    // nearly every link would say, and saying it would override a reader who
    // turned lightning off for good with a sender who never touched it.
    const on = OVERLAYS.filter((overlay) => get(OVERLAY_STORES[overlay]));
    if (on.length !== OVERLAYS.length) state.overlays = on;
    // Not while it plays: that is a new frame twice a second, and a link
    // copied mid-animation would open parked on whichever one it caught.
    if (!cell && !get(playbackRunning) && offLiveEdge()) state.time = get(capTimeIndicator);
    const point = get(inspectLatLon);
    if (point) state.point = point;
  }
  return state;
}

interface Wiring {
  lm: LayerManager;
  settings: Settings;
  cellmgr: CellTrackManager;
  cells3d?: Cells3DCapability;
  nanobar?: Progress;
}

/**
 * Restore the opening link, then keep the URL and the history in step with
 * the page. Returns the teardown.
 */
export function startUrlState({ lm, settings, cellmgr, cells3d, nanobar }: Wiring): () => void {
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
   * there would stack a copy of the entry on itself -- and after Back, throw
   * away every entry Forward could have gone to.
   */
  let settling = true;

  let timer: number | null = null;

  /** The View every OpenLayers map shares, and the 3D map reads on attach. */
  const sharedView = () => lm.maps[0]?.getView();

  /** Bring a storm into view, for a link that named it but not where to look. */
  function centreOn(lat: number, lon: number) {
    const view = sharedView();
    const zoom = Math.max(view?.getZoom() ?? 0, STORM_ZOOM);
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
   * outliving the storm and is said as such rather than as a failure.
   */
  async function restoreCell(link: LinkState, token: number, opening: boolean) {
    const before = selection();
    const answer = await fetchCellTrack(link.cell!, nanobar, { optional: true }).catch(() => null);
    // The reader has moved on in the meantime, and their choice beats the link's.
    if (token !== generation || selection() !== before) return;
    const track = answer as unknown as CellTrack | null;
    if (!track?.properties) {
      reportToast("That storm is no longer being tracked.");
      return;
    }
    const trimmed = trimToLastRun(track);
    cellmgr.pin(track);
    selectedVolume.set(null);
    selectedCell.set(trimmed.properties);
    cellDetails.set(link.details !== false);
    // After the cell, which resets the slice for a new storm on its own.
    if (link.cut !== undefined && trimmed.properties.volume) cutRotationDeg.set(link.cut);
    if (opening && !link.view) {
      const series = trimmed.properties.series ?? [];
      const last = series[series.length - 1];
      if (last) centreOn(last.lat, last.lon);
    }
    // Drawn now rather than on the next pan: the tracks the layer holds were
    // fetched without this cell in them. A no-op before the first render,
    // whose own fetch then includes the pin.
    void cellmgr.reload(get(mapExtent4326), { force: true, nanobar });
  }

  /** Open a linked storm core; the finding is Cells3DCapability.restoreCloud's. */
  async function restoreCloud(link: LinkState, token: number, opening: boolean) {
    if (!cells3d) return;
    const before = selection();
    const cloud = await cells3d.restoreCloud(link.cloud!);
    if (token !== generation || selection() !== before) return;
    if (!cloud) {
      reportToast("That storm core's radar volume is no longer available.");
      return;
    }
    selectedCell.set(null);
    selectedVolume.set(cloud);
    if (link.cut !== undefined) cutRotationDeg.set(link.cut);
    if (opening && !link.view) centreOn(cloud.lat, cloud.lon);
  }

  /**
   * Put the page in the state `link` describes.
   *
   * On load the map, the view and the overlays are already in place -- they
   * were read at construction -- so only what needs data is left. From the
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
      // An entry the page wrote itself leaves the overlays out when all of
      // them are on, so on the way back that is what their absence means --
      // not "whatever the reader has", which is only true of a link someone
      // else wrote. Held rather than stored, like a link's: Back is not the
      // reader choosing.
      applyLinkedOverlays(settings, lm.currentCap === "radar"
        ? { ...link, overlays: link.overlays ?? [...OVERLAYS] }
        : link);
    }

    const layer = opening ? lm.startingCapability() : lm.currentCap;
    if (layer === "cells3d") {
      cells3d?.setCamera(defined({ ...(opening ? {} : link.view), pitch: link.pitch, bearing: link.bearing }));
    }

    const current = selection();
    if (link.cell && (layer === "radar" || layer === "cells3d")) {
      if (current !== `cell:${link.cell}`) {
        holding(restoreCell(link, token, opening));
      } else {
        cellDetails.set(link.details !== false);
        cutRotationDeg.set(link.cut ?? 0);
      }
    } else if (link.cloud && layer === "cells3d") {
      if (current !== `cloud:${link.cloud}`) holding(restoreCloud(link, token, opening));
      else cutRotationDeg.set(link.cut ?? 0);
    } else if (!opening) {
      selectedCell.set(null);
      selectedVolume.set(null);
    }

    if (layer === "radar") {
      // Only when it moves. The strip shows its loading state on every write
      // to the point and clears it when the next grid lands -- and the radar
      // does not refetch for a point it already has, so the same point written
      // again left the strip loading for good.
      const point = link.point ?? null;
      const held = get(inspectLatLon);
      if (point?.[0] !== held?.[0] || point?.[1] !== held?.[1]) {
        if (point || !opening) inspectLatLon.set(point);
      }
      if (point && opening && !link.view && !link.cell) centreOn(point[0], point[1]);
      if (link.time !== undefined) frameRequest.set(link.time);
      else if (!opening && offLiveEdge()) frameRequest.set("live");
    }
    schedule();
  }

  function write() {
    timer = null;
    // A restore in flight means the page has not caught up with its own URL
    // yet: written now, the link would lose the storm it is still fetching,
    // and the difference would read as the reader closing it -- a push.
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

  const watched: Readable<unknown>[] = [
    sharedActiveCap, mapView, selectedCell, selectedVolume, cellDetails, cutRotationDeg,
    lightningLayerVisible, cellLayerVisible, cycloneLayerVisible,
    capTimeIndicator, capLatestObservation, playbackRunning, inspectLatLon,
  ];
  const unsubscribers = watched.map((store) => store.subscribe(() => schedule()));

  const onPopState = () => apply(parseLink(window.location.search), false);
  window.addEventListener("popstate", onPopState);

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener("popstate", onPopState);
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
}
