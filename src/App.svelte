<script lang="ts">
import { onDestroy } from "svelte";
import { derived, get } from "svelte/store";
import View from "ol/View";
// The catalogues and the language in use, set up before anything renders.
import "./locale/i18n";

import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { fromLonLat, transformExtent } from "ol/proj";
import Map from "./components/Map.svelte";
import MapLoading from "./components/MapLoading.svelte";
import Guide3D from "./components/Guide3D.svelte";
import Logo from "./components/Logo.svelte";
import NowcastPlayback from "./components/NowcastPlayback.svelte";
import BottomToolbar from "./components/BottomToolbar.svelte";

import RadarCapability from "./caps/RadarCapability";
import SatelliteCapability from "./caps/SatelliteCapability";

import { LayerManager, VIEW_EXTENT } from "./lib/LayerManager";
import { capabilityEnabled } from "./caps/enabled";
import { progress } from "./lib/progress";
import Settings from "./lib/Settings";
import type { SettingValue } from "./lib/Settings";

import { tileRefreshSignal } from "./stores";
import {
  bottomToolbarMode,
  colorSchemeDark,
  cellLayerVisible, cells3dLoading, cells3dVisible, cycloneLayerVisible, europeCompositeVisible, lastFocus,
  layerswitcherVisible,
  capLatestObservation, capTimeIndicator, cellDetails, cutRotationDeg,
  lightningLayerVisible, logoStyle,
  mapBaseLayer, mapExtent4326, modelCompareAt, networkStatus, precacheForecast, radarColormap,
  radarColorScheme, selectedCell, selectedVolume, sharedActiveCap, smallScreen, snowLayerVisible, terrain3dVisible,
  toolbarVisible,
} from "./stores";

import "./global.css";
import "@shoelace-style/shoelace/dist/themes/light.css";
// Scoped to .sl-theme-dark, which ui.ts toggles from the colorSchemeDark store.
import "@shoelace-style/shoelace/dist/themes/dark.css";
// Last on purpose: it re-points Shoelace's panel, overlay and primary tokens.
import "./glass.css";
import { websocketBaseUrl } from "./urls";
import { onWake, wake, whenVisible } from "./lib/wakeup";
import { installScrollbars } from "./lib/scrollbars";
import { fetchCurrentVolumes, fetchLightningCache, fetchMesocyclones } from "./api";
import type { CurrentVolumes, RadarVolume } from "./api";
import { showsLatestFrame } from "./lib/freshness";
import { nextSelection } from "./lib/cellSelection";
import { applyLinkedOverlays, openingLink, startUrlState } from "./lib/urlState";
import { setElementCentre } from "./lib/viewCentre";
import type { ClientToServerEvents, ServerToClientEvents } from "./api/events";
import { cleanupUIConstants, initUIConstants } from "./layers/ui";
import makeLightningLayer from "./layers/lightning";
import StrikeManager from "./lib/StrikeManager";
import MesoCycloneManager from "./lib/MesoCycloneManager";
import CellTrackManager from "./lib/CellTrackManager";

import makeMesocycloneLayer from "./layers/mesocyclones";
import makeCellLayer from "./layers/cells";
import makeCellPulseLayer from "./layers/cellPulse";
import makeCloudHintLayer, { setCloudHints } from "./layers/cloudHints";
import { VolumeFeed } from "./lib/scans";
import { forget3DOrigin, openCloudIn3D, origin3D, registerOpen3D, returnFrom3D } from "./lib/open3d";
/* The storm panels are loaded when a storm is opened, not with the page: the
   history charts, the lineage graph (dagre) and the two 3D pictures are a
   third of the app's code, and most sessions never tap a cell. */
const loadCellDetails = () => import("./components/CellDetails.svelte");
const loadCellSheet = () => import("./components/CellSheet.svelte");
const loadCloudDetails = () => import("./components/CloudDetails.svelte");
// The model comparison too: its charts and the forecast fetch are for the
// few who open it.
const loadModelCompare = () => import("./components/ModelCompare.svelte");
import CellSelectionHint from "./components/CellSelectionHint.svelte";
import PointMenu from "./components/PointMenu.svelte";
import { DeviceDetect as dd } from "./lib/DeviceDetect";
import { bordersAndWays, labelsOnly } from "./layers/vector";
import PrecipitationTypesCapability from "./caps/PrecipitationTypesCapability";
import Cells3DCapability from "./caps/Cells3DCapability";
import { tileSourceUrl } from "./layers/dwd";
import { radolanOverlay } from "./layers/dwd";
import AerosolsCapability from "./caps/AerosolsCapability";
import LightningCapability from "./caps/LightningCapability";

export let device;
export let postInitCb;

dd.set(device);

// The native wrappers need CSS hooks the web build must not get: the toolbar
// has to clear the home indicator, and iOS's safe-area insets differ from
// Android's. Set on both <html> and <body> so rules can hang off either.
if (dd.isApp()) {
  document.documentElement.classList.add("is-app");
  document.body.classList.add("is-app");
  if (dd.isIos()) {
    document.documentElement.classList.add("is-ios");
    document.body.classList.add("is-ios");
  }
}

/**
 * The basemap the system colour scheme asks for.
 *
 * Dark chrome over the light basemap is the one combination the glass cannot
 * look right in -- see the header of src/glass.css -- and it is exactly where a
 * dark-mode browser used to land, because the scheme and the basemap were
 * independent settings with independent defaults.
 */
function systemBaseLayer() {
  return get(colorSchemeDark) ? "dark" : "light";
}

/**
 * The basemap a `mapBaseLayer` setting means.
 *
 * "system", the default, follows the colour scheme; anything else is a basemap
 * the reader picked. A value of its own rather than "nothing stored", because
 * Settings.set() stores nothing for a value equal to the default -- so with a
 * default that changed with the scheme, picking Dark in dark mode stored
 * nothing, and the map quietly went light again with the system.
 */
function resolveBaseLayer(value: SettingValue): string {
  return value === "system" || !value ? systemBaseLayer() : String(value);
}

initUIConstants();   // reads prefers-color-scheme into colorSchemeDark

/* Set before Settings is constructed: its constructor only fires a callback
   when the effective value DIFFERS from the declared default, so with nothing
   stored the store would otherwise stay on the initial value it was declared
   with in stores.ts. */
mapBaseLayer.set(systemBaseLayer());

window.settings = new Settings({
  experimentalFeatures: {
    type: "boolean",
    default: false,
    cb: () => {
      // reportToast(`Experimental features ${value}`);
    },
  },
  mapRotation: {
    type: "boolean",
    default: false,
  },
  /**
   * Standing notices the reader has closed, as a comma-separated list of
   * message hashes. Written by lib/Toast.ts, which explains the keying; no
   * `cb`, because nothing reacts to it -- it is read when a notice is raised.
   */
  dismissedNotices: {
    type: "string",
    default: "",
  },
  precacheForecast: {
    type: "boolean",
    default: true,
    cb: (val) => {
      precacheForecast.set(Boolean(val));
    },
  },
  mapBaseLayer: {
    type: "string",
    default: "system",
    cb: (val) => {
      mapBaseLayer.set(resolveBaseLayer(val));
    },
  },
  radarColorMapping: {
    type: "string",
    default: "classic",
    cb: (value) => {
      radarColorScheme.set(String(value));
      radarColormap.set(String(value));
    },
  },
  capability: {
    type: "string",
    default: "radar",
  },
  layerMesocyclones: {
    type: "boolean",
    default: true,
    cb: (value) => {
      cycloneLayerVisible.set(Boolean(value));
    },
  },
  layerCells: {
    type: "boolean",
    default: true,
    cb: (value) => {
      cellLayerVisible.set(Boolean(value));
    },
  },
  layer3dCells: {
    type: "boolean",
    default: false,
    cb: (value) => {
      cells3dVisible.set(Boolean(value));
    },
  },
  layer3dTerrain: {
    type: "boolean",
    default: true,
    cb: (value) => {
      terrain3dVisible.set(Boolean(value));
    },
  },
  layerEuropeComposite: {
    type: "boolean",
    default: false,
    cb: (value) => {
      europeCompositeVisible.set(Boolean(value));
    },
  },
  layerSnow: {
    type: "boolean",
    default: true,
    cb: (value) => {
      snowLayerVisible.set(Boolean(value));
    },
  },
  latLonZ: {
    type: "string",
    default: "49.0,11.0,6",
    source: "url",
  },
  // The wrappers draw their own chrome, so the logo and the layer-switcher
  // button are off there. Enforced in the callback as well as the default,
  // because both are URL-sourced and ?logo=full would otherwise put the web
  // logo back inside the app.
  logo: {
    type: "string",
    default: dd.isApp() ? "none" : "full",
    source: "url",
    cb: (value) => {
      logoStyle.set(dd.isApp() ? "none" : String(value));
    },
  },
  layerswitcher: {
    type: "string",
    default: dd.isApp() ? "no" : "yes",
    source: "url",
    cb: (value) => {
      if (dd.isApp()) {
        layerswitcherVisible.set("no");
        return;
      }
      layerswitcherVisible.set(value === "no" ? "no" : "yes");
    },
  },
  toolbar: {
    type: "string",
    default: "yes",
    source: "url",
    cb: (value) => {
      toolbarVisible.set(value === "no" ? "no" : "yes");
      if (value !== "yes") {
        bottomToolbarMode.set("hidden");
        document.documentElement.style.setProperty("--attributions-bottom-padding", "0px");
      }
    },
  },
  layerLightning: {
    type: "boolean",
    default: true,
    cb: (value) => {
      lightningLayerVisible.set(Boolean(value));
    },
  },
});
/* A link says which overlays the sender had on. Held for this page load only,
   and before the stores below first read their settings, so the layers come up
   the way the link says without the link rewriting the reader's own choices. */
applyLinkedOverlays(window.settings);

const [lightningSource, lightningLayer] = makeLightningLayer();
lightningLayerVisible.subscribe((value) => {
  lightningLayer.setVisible(value);
  window.settings.set("layerLightning", value);
});
lightningLayerVisible.set(window.settings.getBoolean("layerLightning"));

const nb = progress();
// WebSocket first: socket.io's default opens a long-polling transport and
// upgrades it, which is three requests and a sticky-session hazard before the
// first poke. Polling stays as the fallback for a network that blocks it.
const radarSocketIO: Socket<ServerToClientEvents, ClientToServerEvents> = io(`${websocketBaseUrl}/radar`, {
  transports: ["websocket", "polling"],
});
radarSocketIO.on("connect", () => {
  console.log("radar/forecast websocket connected!");
});

const strikemgr = new StrikeManager(1000, lightningSource);

const [mesocycloneSource, mesocycloneLayer] = makeMesocycloneLayer();
const mesocyclonemgr = new MesoCycloneManager(100, mesocycloneSource);
cycloneLayerVisible.subscribe((value) => {
  mesocycloneLayer.setVisible(value);
  window.settings.set("layerMesocyclones", value);
});
// This restored the *lightning* store from the mesocyclone setting, so the
// mesocyclone layer never came back and the lightning visibility read three
// lines above was immediately overwritten.
cycloneLayerVisible.set(window.settings.getBoolean("layerMesocyclones"));

const [cellSource, cellLayer] = makeCellLayer();
const [pulseSource, pulseLayer, stopPulse] = makeCellPulseLayer();
const cellmgr = new CellTrackManager(cellSource, pulseSource);
onDestroy(stopPulse);
cellLayerVisible.subscribe((value) => {
  cellmgr.enable(Boolean(value));
  window.settings.set("layerCells", value);
  if (value) cellmgr.reload(get(mapExtent4326), { force: true, nanobar: nb });
});
cellLayerVisible.set(window.settings.getBoolean("layerCells"));

/**
 * Cells are drawn on the newest observation and nowhere else.
 *
 * The tracks endpoint answers with one state -- where every storm is now, the
 * outline of its latest detection, and where it is going -- and nothing here
 * rewinds it. Scrub the radar back an hour, or out into the nowcast, and the
 * map underneath moves while every dot, path and outline stays parked at the
 * present: the marks then sit beside echoes they have nothing to do with, and
 * read as a tracker that has lost its storms rather than as a layer showing a
 * different moment than the frame.
 *
 * The test is the frame on screen against the newest one the grid holds, not
 * the `live` store the pill uses: that is cleared at the top of every grid
 * refetch and set again when the grid lands, so a layer keyed to it would
 * blink off and back every few minutes. It is also a deliberate one-way test
 * -- both stores at 0 means no grid has arrived, which is a page that has not
 * loaded its radar or is not showing radar at all, and there is no frame there
 * for the cells to disagree with. Hiding is for the case we can positively
 * see, where the player is parked somewhere the storms are not.
 *
 * The manager keeps running throughout: this hides the drawing, it does not
 * drop the data, so coming back to the live edge costs no refetch.
 */
derived(
  [cellLayerVisible, capTimeIndicator, capLatestObservation],
  ([wanted, shown, newest]) => Boolean(wanted) && showsLatestFrame(shown, newest),
).subscribe((value) => {
  cellLayer.setVisible(value);
  // The ping only ever marks cells the tracks layer is already drawing, so it
  // appears and disappears with it rather than carrying a rule of its own.
  pulseLayer.setVisible(value);
  // The popup is anchored to a mark that is no longer on the map, and it dims
  // the radar underneath for as long as it is up. Leaving it open over a frame
  // its cell is not drawn on would be a panel of present-tense numbers about a
  // storm the map has stopped showing, over a picture darkened to make room
  // for marks that are not there.
  if (!value) selectedCell.set(null);
});

/* Trial: a "3D" tag beside every storm core the 3D map can cut open, and the
   way there -- see layers/cloudHints.ts. Only where that map is offered, and,
   like the cells, only on the newest observation, which is the scan the cores
   were found in. */
const hintsWanted = capabilityEnabled("cells3d");
const [cloudHintSource, cloudHintLayer] = makeCloudHintLayer();
derived(
  [capTimeIndicator, capLatestObservation],
  ([shown, newest]) => hintsWanted && showsLatestFrame(shown, newest),
).subscribe((value) => cloudHintLayer.setVisible(value));

const cloudHints = new VolumeFeed<CurrentVolumes>(
  () => fetchCurrentVolumes().catch(() => null),
  (answer) => setCloudHints(cloudHintSource, (answer.volumes ?? []) as RadarVolume[]),
);

/* `run` is the scan of a KONRAD3D run that has just landed. Its cores are
   usually not built yet, and fetched only now the tags stood a scan behind
   until the next run; they are waited for -- see lib/scans.ts. */
async function reloadCloudHints(run: number | null = null) {
  if (!hintsWanted) return;
  const answer = await fetchCurrentVolumes(nb).catch(() => null);
  if (answer) cloudHints.offer(answer);
  cloudHints.follow(run);
}

/* The panel is a property of a selection and cannot outlive one. Anything that
   drops the selection -- the map background, the layer switcher, the scrubber
   leaving the live edge -- therefore closes it without having to remember to. */
selectedCell.subscribe((track) => {
  if (!track) cellDetails.set(false);
});

/* So is the slice. Every storm opens cut along its own track: an angle turned
   for the last one means nothing for this one, whose track points somewhere
   else. On the selection rather than on the cutaway mounting, which is where
   it was -- so walking the family re-cuts each cell it lands on, and a link
   restoring a storm cut at some angle can set the angle after the storm
   without the panel's mount undoing it. Keyed on the storm, not on the
   object: a refresh hands the same cell over as a fresh copy every few
   minutes, and that is not a new storm. */
derived([selectedCell, selectedVolume], ([cell, cloud]) => (
  cell ? `cell:${cell.code}` : cloud ? `cloud:${cloud.path}` : ""
)).subscribe(() => cutRotationDeg.set(0));

/**
 * The drawer holds one thing: tapping a storm while the model comparison is
 * open replaces it, as tapping a second storm replaces the first.
 */
derived([selectedCell, selectedVolume], ([cell, cloud]) => Boolean(cell || cloud))
  .subscribe((storm) => { if (storm) modelCompareAt.set(null); });

/**
 * And opening the player puts it away: the player is the screen's bottom edge
 * and the frames it steps through, which the comparison's drawer covered.
 */
bottomToolbarMode.subscribe((mode) => { if (mode === "player") modelCompareAt.set(null); });

const closeCompare = () => modelCompareAt.set(null);
const closeVolume = () => selectedVolume.set(null);
/** Whether the selected storm stands cut open on the 3D map behind its sheet. */
$: cutOpen = $sharedActiveCap === "cells3d";

// Cell tracks are fetched for what is on screen, so they follow the map rather
// than a timer. The manager ignores a move that stays inside what it already
// holds, which is most of them.
mapExtent4326.subscribe((extent) => {
  cellmgr.reload(extent, { nanobar: nb });
});

// The event is a nudge rather than the cells: a severe afternoon is hundreds of
// kilobytes of tracks, and only the ones in view are worth asking for -- and
// only once someone is looking; a hidden tab takes the newest run when it
// comes back.
radarSocketIO.on("cells", () => {
  whenVisible("cells", () => cellmgr.reload(get(mapExtent4326), { force: true, nanobar: nb }));
});

radarSocketIO.on("lightning", (data) => {
  strikemgr.addStrike(data.lon, data.lat);
});
window.ll = lightningLayer;
radarSocketIO.on("mesocyclones", (data) => {
  mesocyclonemgr.clearAll();
  data.forEach((elem) => mesocyclonemgr.addCyclone(elem));
});

// Both managers cap themselves by count, but nothing ever dropped features for
// being old: fadeStrikes/fadeCyclones existed and were never called, so a quiet
// day left half-hour-old strikes on the map until the ring buffer wrapped.
const FADE_INTERVAL_MS = 5 * 60 * 1000;
const fadeInterval = window.setInterval(() => {
  strikemgr.fadeStrikes();
  mesocyclonemgr.fadeCyclones();
}, FADE_INTERVAL_MS);
onDestroy(() => window.clearInterval(fadeInterval));

// Was `export let lm`, assigned from inside the component: an outward binding
// for a named import that nothing used, and a prop you cannot write to in
// Svelte 5. It is reachable as window.lm, which is what the apps call.
const lm = new LayerManager({
  settings: window.settings,
  nanobar: nb,
  initialCapability: openingLink.layer,
  capabilities: [
    {
      name: "radar",
      capability: RadarCapability,
      additionalLayers: [
        pulseLayer, cellLayer, cloudHintLayer, mesocycloneLayer, lightningLayer, labelsOnly(), radolanOverlay(),
      ],
      options: {
        nanobar: nb,
        socket_io: radarSocketIO,
      },
    },
    {
      name: "satellite",
      capability: SatelliteCapability,
      additionalLayers: [bordersAndWays()],
      options: {
        nanobar: nb,
        hasBaseLayer: false,
      },
    },
    {
      name: "aerosols",
      capability: AerosolsCapability,
      additionalLayers: [bordersAndWays()],
      options: {
        nanobar: nb,
        hasBaseLayer: false,
      },
    },
    {
      name: "lightning",
      capability: LightningCapability,
      additionalLayers: [labelsOnly()],
      options: {
        nanobar: nb,
        hasBaseLayer: true,
        socket: radarSocketIO,
      },
    },
    {
      name: "cells3d",
      capability: Cells3DCapability,
      // No OpenLayers layers: MapLibre draws this one. The bare ol/Map it still
      // receives is the camera the layer switcher previews and the shared View
      // rides on.
      options: { nanobar: nb, hasBaseLayer: true },
    },
    {
      name: "precipTypes",
      capability: PrecipitationTypesCapability,
      additionalLayers: [labelsOnly(), radolanOverlay()],
      options: {
        nanobar: nb,
      },
    }].filter((descriptor) => capabilityEnabled(descriptor.name)),
});
window.lm = lm;

/* The 3D map drapes the same radar frame the flat map is showing, so the two
   never disagree about what the weather is. RadarCapability already resolves
   which frame is current and what its tiles are; this just forwards it rather
   than working it out a second time -- with its scan, against which the 3D map
   greys out storms from an older one; see lib/scans.ts. */
const cells3d = lm.getCapability("cells3d") as Cells3DCapability | undefined;
const radarCap = lm.getCapability("radar") as RadarCapability | undefined;
if (cells3d && radarCap) {
  // With the European composite on, the 3D map drapes that one frame, whole,
  // in place of DWD's and the networks'; see RadarCapability.showNetworks.
  const forwardRadarFrame = () => {
    const step = radarCap.getMostRecentObservation();
    const europe = radarCap.liveEuropeFrame();
    if (europe) {
      cells3d.setRadarFrame(tileSourceUrl("meteoradar", europe.tile_id), step, europe.tiles, { whole: true });
      return;
    }
    const frame = radarCap.clientGrid?.[step];
    cells3d.setRadarFrame(frame?.url ?? null, step, frame?.tiles);
  };
  // The networks' own newest frames go the same way: the 3D map drapes them
  // over their countries, cut out of DWD's frame as the flat map does.
  const forwardNetworkFrames = () => {
    cells3d.setNetworkFrames(radarCap.liveEuropeFrame() ? {} : radarCap.liveNetworkFrames());
  };
  radarCap.addObserver((subject) => {
    if (subject === "grid") forwardRadarFrame();
    if (subject === "networks") {
      forwardRadarFrame();
      forwardNetworkFrames();
    }
  });
  forwardNetworkFrames();
  // A new run means new cells as well as a new frame. Not in a hidden tab,
  // where it was the cells and megabytes of volumes for nobody; the newest
  // run is fetched on the way back.
  radarSocketIO.on("cells", () => whenVisible("cells3d", () => cells3d.newRun()));
  // And every network's runs, which have no KONRAD3D run to follow, as they
  // are built -- in a hidden tab, once, on the way back.
  radarSocketIO.on("volumes", () => whenVisible("cells3dVolumes", () => cells3d.newVolumes()));
  // The same strikes the flat map is drawing, read out of its ring buffer
  // rather than collected a second time off the socket.
  cells3d.setStrikeSource(lightningSource);
}

// The cores are rebuilt with each run, so the tags follow the same nudge.
radarSocketIO.on("cells", (cells) => {
  whenVisible("cloudHints", () => void reloadCloudHints(Math.floor(cells.reference_time / 1000)));
});
// And with each network's runs as they are built, which no KONRAD3D run announces.
radarSocketIO.on("volumes", () => {
  whenVisible("cloudHints", () => void reloadCloudHints());
});
void reloadCloudHints();

// Thin scrollbars that show only while something scrolls; see lib/scrollbars.ts.
installScrollbars();

// The panels' "open in 3D" links and the tags above all switch through this,
// and the way back -- see below -- through the same manager.
if (cells3d) registerOpen3D(() => lm.setTarget("cells3d", "map"), (cap) => lm.setTarget(cap, "map"));

/*
 * A storm opened on the 3D map from the flat one goes back when it closes.
 *
 * Opening a tag or a panel's "open on the 3D map" is a detour to look at one
 * storm; closing that storm is the end of it, and the reader is put back on
 * the map they left rather than on a tilted map they did not pick, one
 * switcher away from the radar. The camera settles to nadir and north-up over
 * the view they left first, so the flat map appears where the 3D one landed
 * and nothing jumps. Closing means the popup or sheet going: on a phone the
 * sheet can close with the cell still selected, and that counts.
 *
 * Only for a detour. A 3D map picked from the switcher or opened by a link
 * has nothing to go back to, and lib/open3d.ts forgets the origin as soon as
 * the reader is on any other map by their own doing.
 */
let leaving3D = false;
derived(
  [selectedCell, selectedVolume, cellDetails, sharedActiveCap],
  ([cell, cloud, details, cap]) => ({ open: Boolean(cloud || (cell && details)), cap }),
).subscribe(({ open, cap }) => {
  if (cap !== "cells3d") {
    forget3DOrigin();
    return;
  }
  const origin = origin3D();
  if (open || !origin || leaving3D || !cells3d) return;
  leaving3D = true;
  cells3d.leave(origin.view).finally(() => {
    leaving3D = false;
    // Something was opened while the camera was on its way: the reader is
    // looking at it, and stays.
    if (get(selectedVolume) || (get(selectedCell) && get(cellDetails))) return;
    returnFrom3D();
  });
});

/**
 * Whether this is a device with a real pointer that can hover.
 *
 * Asked once. A touch screen reports neither, and a hover cursor there is a
 * style nobody can see bought with a hit test on every frame of every drag.
 */
const finePointer = typeof window === "undefined" || !window.matchMedia
  ? null
  : window.matchMedia("(hover: hover) and (pointer: fine)");

/*
 * Tapping a storm opens its history.
 *
 * The long press is already the radar's "what is falling here" gesture, and it
 * asks about a point rather than about an object, so cells take the plain tap
 * instead. `forEachFeatureAtPixel` stops at the first cell feature under the
 * finger, which may be the path or the forecast dots as easily as the centroid
 * -- they all carry their track's code.
 *
 * A cell before a "3D" tag, when the finger is on both: the tag sits beside
 * its core, which is usually inside a cell, so it caught taps aimed at the
 * cell and switched maps instead of opening the storm. The 3D map ranks the
 * two the same way. The tag answers where no cell is under the finger.
 */
lm.forEachMap((map) => {
  /* `mapExtent4326` is published on moveend, so on a cold load -- where the
     view comes from the URL before the map has a target -- it stays null until
     the user pans, and the layer would sit empty behind a map full of storms.
     The first completed render is when there is a viewport to ask about. */
  map.once("rendercomplete", () => {
    const size = map.getSize();
    if (!size) return;
    cellmgr.reload(transformExtent(
      map.getView().calculateExtent(size),
      "EPSG:3857",
      "EPSG:4326",
    ) as [number, number, number, number], { nanobar: nb });
  });

  map.on("singleclick", (event) => {
    const cellsShown = get(cellLayerVisible);
    const code = cellsShown
      ? map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature.get("code") as string | undefined,
        { layerFilter: (layer) => layer === cellLayer, hitTolerance: 6 },
      )
      : undefined;
    if (!code && cloudHintLayer.getVisible()) {
      const cloud = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature.get("cloud") as RadarVolume | undefined,
        { layerFilter: (layer) => layer === cloudHintLayer, hitTolerance: 4 },
      );
      if (cloud) {
        openCloudIn3D(cloud);
        return;
      }
    }
    if (!cellsShown) return;
    const next = nextSelection(
      { code: get(selectedCell)?.code ?? null, details: get(cellDetails) },
      code ?? null,
      get(smallScreen),
    );
    selectedCell.set(next.code ? cellmgr.trackFor(next.code) ?? null : null);
    cellDetails.set(next.details);
  });

  /*
   * The cursor says what is clickable, which on a map is otherwise invisible.
   *
   * A storm centroid is a 6px dot among a screenful of radar; nothing about it
   * says it answers a click, and on a desktop the pointer is the one channel
   * that can say so without drawing anything.
   *
   * It runs the same hit test as the tap above, hit tolerance included, so the
   * pointer can never promise a cell that a click would then miss. Written on
   * the map's own viewport rather than on the shared `#map` target, so a
   * capability switch cannot leave another one wearing this one's cursor.
   */
  let hovering = false;
  const viewport = map.getViewport();
  map.on("pointermove", (event) => {
    // Nothing to say mid-drag: the cursor belongs to the pan for its duration,
    // and hit-testing every frame of one buys a style nobody is looking at.
    if (!finePointer?.matches || event.dragging) return;
    const over = map.hasFeatureAtPixel(event.pixel, {
      layerFilter: (layer) => (layer === cellLayer && get(cellLayerVisible))
        || (layer === cloudHintLayer && layer.getVisible()),
      hitTolerance: 6,
    });
    if (over === hovering) return;
    hovering = over;
    viewport.style.cursor = over ? "pointer" : "";
  });
  /* A pointer that leaves over a cell never reports leaving it. */
  viewport.addEventListener("pointerleave", () => {
    if (!hovering) return;
    hovering = false;
    viewport.style.cursor = "";
  });
});

window.settings.setCb("mapRotation", (value) => {
  // Settings callbacks can fire before a capability is on screen, and there is
  // no view to carry over then.
  const current = lm.getCurrentMap();
  if (!current) return;
  const newView = new View({
    center: current.getView().getCenter(),
    zoom: current.getView().getZoom(),
    minZoom: current.getView().getMinZoom(),
    enableRotation: Boolean(value),
    extent: VIEW_EXTENT,
  });
  lm.forEachMap((map) => map.setView(newView));
});
window.settings.setCb("latLonZ", (value) => {
  if (!value) return;
  const parts = String(value).split(",");
  if (parts.length !== 3) return;
  const [lat, lon, z] = parts.map(parseFloat);
  const view = lm.getCurrentMap()?.getView();
  if (!view) return;
  // The middle of the map element, which is what a URL's latLonZ records.
  view.setZoom(z);
  setElementCentre(view, fromLonLat([lon, lat]));
});

// Both of these used to finish a nanobar task keyed on the global `URL`
// constructor rather than on a URL string, and neither had a matching start.
async function reloadLightning() {
  const strikes = await fetchLightningCache(nb).catch(() => null);
  if (!strikes) return;
  strikemgr.clearAll();
  strikes.forEach((strike) => {
    strikemgr.addStrikeWithTime(strike.lon, strike.lat, Math.round(strike.time));
  });
}

async function reloadCyclones() {
  const detections = await fetchMesocyclones(nb).catch(() => null);
  if (!detections) return;
  mesocyclonemgr.clearAll();
  detections.forEach((detection) => mesocyclonemgr.addCyclone(detection));
}

reloadLightning();
reloadCyclones();

/* Everything that has to happen when the page starts running again. The web
   never reached this: the hook existed for the two native apps to call, and
   nothing in the browser called it, so a tab that had been asleep sat on its
   expired frames until the next poke happened to arrive. lib/wakeup.ts is the
   browser's side of it. */
const unsubscribeWake = onWake(() => {
  lastFocus.set(new Date());
  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }
  /* socket.io's reconnect backoff is a timer, and it was suspended along with
     everything else, so the socket can sit disconnected for minutes after we
     are back. The poke that refreshes the map comes over it. */
  if (radarSocketIO.disconnected) radarSocketIO.connect();
  reloadLightning();
  reloadCyclones();
  void reloadCloudHints();
});
onDestroy(unsubscribeWake);

/* The apps call this directly. Routed through wake() so a native foreground
   and the browser signals that accompany it still only resync once. */
window.enterForeground = () => wake("native bridge");

/* The scheme can flip while the app is open, and the chrome follows it live,
   so the map has to as well or they end up disagreeing. Only while the basemap
   follows the system: writable.set() with an unchanged value notifies nobody,
   so the immediate first call here is a no-op. */
const baseLayerSub = colorSchemeDark.subscribe(() => {
  mapBaseLayer.set(resolveBaseLayer(window.settings.get("mapBaseLayer")));
});
onDestroy(baseLayerSub);

const refreshSub = tileRefreshSignal.subscribe((n) => {
  if (n > 0) lm.refreshTiles();
});
onDestroy(refreshSub);

/* Coming back online does not make OpenLayers re-request the tiles that failed
   while it was down, so nothing recovers on its own. That is what the banner's
   retry button was for; with the banner folded into the Latest pill there is no
   button, so the reconnection does it. */
let wasOnline = true;
const reconnectSub = networkStatus.subscribe(({ online }) => {
  if (online && !wasOnline) tileRefreshSignal.update((n) => n + 1);
  wasOnline = online;
});
onDestroy(reconnectSub);
onDestroy(cleanupUIConstants);

/* The URL from here on: the rest of the opening link, once there is data for
   it, then the address bar kept in step with the page, and Back and Forward. */
onDestroy(startUrlState({
  lm, settings: window.settings, cellmgr, cells3d, nanobar: nb,
}));

if (postInitCb) postInitCb(lm);
</script>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    /* The basemap earth colour, so nothing flashes under the tiles. */
    background-color: var(--mc-map-bg);
    color: var(--mc-text);
    font-family: var(--mc-font);
  }

  :global(.nanobar) {
    width: 100%;
    height: 3px;
    z-index: var(--mc-z-nanobar);
    top: var(--mc-safe-top);
    pointer-events: none;
  }
  :global(.bar) {
    width: 0;
    height: 2px;
    background: var(--mc-brand);
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 3px var(--mc-brand);
  }

  /* .sl-toast-stack and the sl-alert parts live in src/glass.css. */

  /* The page itself is never zoomable.
     `manipulation` was not enough: it only turns off double-tap-to-zoom and
     still permits pinch, and the platforms treat a double-tap that turns into a
     drag as a pinch -- which is how a double tap on the loop button in the
     player ended up zooming the whole page. `pan-x pan-y` allows scrolling and
     nothing else, so the diagnostics panel still scrolls, the map still pans,
     and the only zoom left anywhere is the map's own.
     Not `none`: that would take scrolling with it. Elements that want the whole
     gesture -- the strip's swipe, the pill -- still set `none` for themselves. */
  /* Anchored rather than floating over the tap: the map animates under a
     popup, and a panel that chases the storm is harder to read than one that
     stays put. Above the toolbar, clear of the bottom tray. */
  /* The drawer material (src/glass.css) supplies the fill, blur, shadow and
     ink; this is the frame. It does not scroll itself: the content scrolls
     inside it, so what runs past the top and bottom can fade out into the
     glass -- a mask on the frame would fade the glass along with it. */
  .cell-details-panel {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: var(--mc-z-details);
    display: flex;
    flex-direction: column;
    max-width: min(392px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: hidden;
    border: 1px solid var(--mc-drawer-edge);
    border-radius: var(--mc-radius-tray);
    box-sizing: border-box;
  }
  .cell-details-panel > .scroll {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px var(--mc-drawer-pad) var(--mc-fade-bottom);
    -webkit-mask-image: linear-gradient(to bottom,
      transparent, #000 var(--mc-fade-top),
      #000 calc(100% - var(--mc-fade-bottom)), transparent);
    mask-image: linear-gradient(to bottom,
      transparent, #000 var(--mc-fade-top),
      #000 calc(100% - var(--mc-fade-bottom)), transparent);
  }

  /* The bottom trays step aside for a sheet on a phone.

     The sheet is most of the screen there, and what is left of the map is the
     strip below it -- which is exactly where the scale, the clock and the
     playback controls sit. Hidden through a class on <body>, which CellSheet
     sets while any sheet is up, rather than by not rendering them: the player
     owns subscriptions to the radar grid and its own playback state, and
     tearing that down and rebuilding it every time a sheet opens would be a
     lot of machinery moved for a visual answer. Both trays carry
     .bottomToolbar, and .buttonBar is the pair of discs the collapsed player
     puts in the bottom corners. */
  :global(body.cell-details-open .bottomToolbar),
  :global(body.cell-details-open .buttonBar) {
    display: none;
  }

  /* MapLibre is appended into the map element rather than replacing it, so it
     has to be told to fill it; OpenLayers sizes its own viewport. */
  :global(.maplibre-host) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  :global(*) {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    touch-action: pan-x pan-y;
  }
</style>

{#if !dd.isApp()}
  <Logo />
{/if}

<!-- toolbarVisible holds "yes"/"no", and "no" is a truthy string: testing the
     store itself left ?toolbar=no showing the whole toolbar. -->
{#if $toolbarVisible === "yes"}
  <BottomToolbar layerManager={lm} />
{/if}

<div id="nanobar" />
<Map layerManager={lm} />
<!-- The glass veil over the map while the 3D map is brought up for the
     first time; gated on the active map as well, so switching away during
     the bring-up takes it with it. -->
{#if $cells3dLoading && $sharedActiveCap === "cells3d"}
  <MapLoading />
{/if}
<!-- The 3D map's controls and legend, once it is up. A desktop's: the apps
     draw their own chrome, and a toolbar asked away is a display that wants
     none of this either. -->
{#if $sharedActiveCap === "cells3d" && !$cells3dLoading && !$smallScreen && !dd.isApp() && $toolbarVisible === "yes"}
  <Guide3D />
{/if}
<PointMenu layerManager={lm} />


{#if $selectedCell && $cellDetails}
  {#if $smallScreen}
    {#await loadCellSheet() then { default: CellSheet }}
      <svelte:component this={CellSheet} track={$selectedCell} />
    {/await}
  {:else}
    <div class="cell-details-panel mc-drawer">
      <div class="scroll">
        {#await loadCellDetails() then { default: CellDetails }}
          <svelte:component this={CellDetails} track={$selectedCell} />
        {/await}
      </div>
    </div>
  {/if}
{:else if $selectedCell && $smallScreen}
  <CellSelectionHint track={$selectedCell} />
{:else if $selectedVolume && $smallScreen}
  <!-- A phone's storm core takes the cell's glass sheet: the same surface for
       whichever kind of storm was tapped. On the 3D map the storm is cut open
       on the map itself, so the sheet is only as tall as what it holds -- a
       few facts and the dial that turns the cut -- until it is pulled up for
       how the volume was built. A volume is only ever selected for that map
       (see lib/open3d.ts), so the flat map holds one just for the moment a
       tapped tag takes to switch: one sheet, which takes its resting shape
       when the map arrives, rather than a card replaced by a sheet. -->
  {#await Promise.all([loadCellSheet(), loadCloudDetails()]) then [{ default: CellSheet }, { default: CloudDetails }]}
    <svelte:component this={CellSheet} fitAtRest={cutOpen} onClose={closeVolume} let:expanded let:expand>
      <svelte:component this={CloudDetails} cloud={$selectedVolume} compact={cutOpen} {expanded} {expand} />
    </svelte:component>
  {/await}
{:else if $selectedVolume}
  <!-- A storm core with no KONRAD3D track, in the same popup as a cell's
       details: the same panel, only with less to say. -->
  <div class="cell-details-panel mc-drawer">
    <div class="scroll">
      {#await loadCloudDetails() then { default: CloudDetails }}
        <svelte:component this={CloudDetails} cloud={$selectedVolume} />
      {/await}
    </div>
  </div>
{:else if $modelCompareAt}
  <!-- The model comparison, opened from the dry-weather strip: the same
       drawer a storm's details take, sheet on a phone and corner panel on a
       desktop. Keyed on the place and range: the panel fetches once, on
       mount. -->
  {#key `${$modelCompareAt.lat},${$modelCompareAt.lon},${$modelCompareAt.hours ?? 24}`}
    {#await Promise.all([loadModelCompare(), $smallScreen ? loadCellSheet() : null]) then [{ default: ModelCompare }, sheet]}
      {#if sheet}
        <svelte:component this={sheet.default} onClose={closeCompare}>
          <svelte:component
            this={ModelCompare}
            lat={$modelCompareAt.lat}
            lon={$modelCompareAt.lon}
            initialHours={$modelCompareAt.hours ?? 24}
            onClose={closeCompare} />
        </svelte:component>
      {:else}
        <div class="cell-details-panel mc-drawer">
          <div class="scroll">
            <svelte:component
              this={ModelCompare}
              lat={$modelCompareAt.lat}
              lon={$modelCompareAt.lon}
              initialHours={$modelCompareAt.hours ?? 24}
              onClose={closeCompare} />
          </div>
        </div>
      {/if}
    {/await}
  {/key}
{/if}

{#if $toolbarVisible === "yes"}
  <NowcastPlayback cap={lm.getCapability("radar") as RadarCapability} />
{/if}
