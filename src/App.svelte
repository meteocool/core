<script lang="ts">
import View from "ol/View";
import { addMessages, init, getLocaleFromNavigator } from "svelte-i18n";

import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { fromLonLat } from "ol/proj";
import Map from "./components/Map.svelte";
import Logo from "./components/Logo.svelte";
import NowcastPlayback from "./components/NowcastPlayback.svelte";
import BottomToolbar from "./components/BottomToolbar.svelte";

import RadarCapability from "./caps/RadarCapability";
import SatelliteCapability from "./caps/SatelliteCapability";

import { LayerManager, VIEW_EXTENT } from "./lib/LayerManager";
import { capabilityEnabled } from "./caps/enabled";
import NanobarWrapper from "./lib/NanobarWrapper";
import Settings from "./lib/Settings";

import de from "./locale/de.json";
import en from "./locale/en.json";
import {
  bottomToolbarMode,
  colorSchemeDark,
  cycloneLayerVisible, lastFocus, layerswitcherVisible,
  lightningLayerVisible, logoStyle,
  mapBaseLayer, precacheForecast, radarColormap,
  radarColorScheme, snowLayerVisible, toolbarVisible,
} from "./stores";

import "./global.css";
import "@shoelace-style/shoelace/dist/themes/light.css";
import { websocketBaseUrl } from "./urls";
import { fetchLightningCache, fetchMesocyclones } from "./api";
import type { ClientToServerEvents, ServerToClientEvents } from "./api/events";
import { initUIConstants } from "./layers/ui";
import makeLightningLayer from "./layers/lightning";
import StrikeManager from "./lib/StrikeManager";
import MesoCycloneManager from "./lib/MesoCycloneManager";

import makeMesocycloneLayer from "./layers/mesocyclones";
import { DeviceDetect as dd } from "./lib/DeviceDetect";
import { bordersAndWays, labelsOnly } from "./layers/vector";
import PrecipitationTypesCapability from "./caps/PrecipitationTypesCapability";
import { radolanOverlay } from "./layers/dwd";
import AerosolsCapability from "./caps/AerosolsCapability";
import LightningCapability from "./caps/LightningCapability";

export let device;
export let postInitCb;

dd.set(device);

addMessages("de", de);
addMessages("en", en);

init({
  fallbackLocale: "en",
  initialLocale: getLocaleFromNavigator(),
});

initUIConstants();

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
  precacheForecast: {
    type: "boolean",
    default: true,
    cb: (val) => {
      precacheForecast.set(Boolean(val));
    },
  },
  mapBaseLayer: {
    type: "string",
    default: "light",
    cb: (val) => {
      mapBaseLayer.set(String(val));
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
  logo: {
    type: "string",
    default: "full",
    source: "url",
    cb: (value) => {
      logoStyle.set(String(value));
    },
  },
  layerswitcher: {
    type: "string",
    default: "yes",
    source: "url",
    cb: (value) => {
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
const [lightningSource, lightningLayer] = makeLightningLayer();
lightningLayerVisible.subscribe((value) => {
  lightningLayer.setVisible(value);
  window.settings.set("layerLightning", value);
});
lightningLayerVisible.set(window.settings.getBoolean("layerLightning"));

const nb = new NanobarWrapper({});
const radarSocketIO: Socket<ServerToClientEvents, ClientToServerEvents> = io(`${websocketBaseUrl}/radar`);
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

radarSocketIO.on("lightning", (data) => {
  strikemgr.addStrike(data.lon, data.lat);
});
window.ll = lightningLayer;
radarSocketIO.on("mesocyclones", (data) => {
  mesocyclonemgr.clearAll();
  data.forEach((elem) => mesocyclonemgr.addCyclone(elem));
});

// Was `export let lm`, assigned from inside the component: an outward binding
// for a named import that nothing used, and a prop you cannot write to in
// Svelte 5. It is reachable as window.lm, which is what the apps call.
const lm = new LayerManager({
  settings: window.settings,
  nanobar: nb,
  capabilities: [
    {
      name: "radar",
      capability: RadarCapability,
      additionalLayers: [mesocycloneLayer, lightningLayer, labelsOnly(), radolanOverlay()],
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
      name: "precipTypes",
      capability: PrecipitationTypesCapability,
      additionalLayers: [labelsOnly(), radolanOverlay()],
      options: {
        nanobar: nb,
      },
    }].filter((descriptor) => capabilityEnabled(descriptor.name)),
});
window.lm = lm;

window.settings.setCb("mapRotation", (value) => {
  const newView = new View({
    center: lm.getCurrentMap().getView().getCenter(),
    zoom: lm.getCurrentMap().getView().getZoom(),
    minZoom: lm.getCurrentMap().getView().getMinZoom(),
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
  lm.getCurrentMap().getView().setCenter(fromLonLat([lon, lat]));
  lm.getCurrentMap().getView().setZoom(z);
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

window.enterForeground = () => {
  lastFocus.set(new Date());
  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }
  reloadLightning();
  reloadCyclones();
};

if (postInitCb) postInitCb(lm);
</script>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: var(--sl-color-white);
  }

  :global(:root) {
    --toast-stack-offset: 0px;
  }

  :global(.nanobar) {
    width: 100%;
    height: 4px;
    z-index: 999999;
    top: calc(env(safe-area-inset-top) + 0px);
  }
  :global(.bar) {
    width: 0;
    height: 100%;
    background: rgb(135, 202, 214);
    height: 2px;
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 3px rgb(135, 202, 214);
  }

  :global(.sl-toast-stack) {
    bottom: calc(env(safe-area-inset-bottom) + var(--toast-stack-offset));
    top: auto;
  }

  :global(*) {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
</style>

{#if !dd.isApp()}
  <Logo />
{/if}

{#if $toolbarVisible}
  <BottomToolbar layerManager={lm} />
{/if}

<div id="nanobar" />
<Map layerManager={lm} />

{#if $toolbarVisible}
  <NowcastPlayback cap={lm.getCapability("radar") as RadarCapability} />
{/if}
