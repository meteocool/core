<script lang="ts" >
import View from "ol/View";
import { addMessages, init, getLocaleFromNavigator } from "svelte-i18n";

import { io } from "socket.io-client";
import { fromLonLat } from "ol/proj";
import Map from "./components/Map.svelte";
import Logo from "./components/Logo.svelte";
import NowcastPlayback from "./components/NowcastPlayback.svelte";
import BottomToolbar from "./components/BottomToolbar.svelte";

import RadarCapability from "./caps/RadarCapability";
import SatelliteCapability from "./caps/SatelliteCapability";

import { LayerManager } from "./lib/LayerManager";
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

import "./html/global.css";
import "@shoelace-style/shoelace/dist/themes/base.css";
import { apiBaseUrl, dataUrl, websocketBaseUrl } from "./urls";
import { initUIConstants } from "./layers/ui";
import makeLightningLayer from "./layers/lightning";
import StrikeManager from "./lib/StrikeManager";
import MesoCycloneManager from "./lib/MesoCycloneManager";

import makeMesocycloneLayer from "./layers/mesocyclones";
import { DeviceDetect as dd } from "./lib/DeviceDetect";
import { bordersAndWays, labelsOnly } from "./layers/vector";
import PrecipitationTypesCapability from "./caps/PrecipitationTypesCapability";
import { radolanOverlay } from "./layers/radar";
import AerosolsCapability from "./caps/AerosolsCapability";

// eslint-disable-next-line import/no-mutable-exports
export let device;

dd.set(device);

addMessages("de", de);
addMessages("en", en);

init({
  fallbackLocale: "en",
  initialLocale: getLocaleFromNavigator(),
});

initUIConstants();

(window as any).settings = new Settings({
  mapRotation: {
    type: "boolean",
    default: false,
  },
  precacheForecast: {
    type: "boolean",
    default: true,
    cb: (val) => {
      precacheForecast.set(val);
    },
  },
  mapBaseLayer: {
    type: "string",
    default: "light",
    cb: (val) => {
      mapBaseLayer.set(val);
    },
  },
  radarColorMapping: {
    type: "string",
    default: "classic",
    cb: (value) => {
      radarColorScheme.set(value);
      radarColormap.set(value);
    },
  },
  capability: {
    type: "string",
    default: "radar",
  },
  experimentalFeatures: {
    type: "boolean",
    default: false,
    cb: () => {
      // reportToast(`Experimental features ${value}`);
    },
  },
  layerMesocyclones: {
    type: "boolean",
    default: true,
    cb: (value) => {
      cycloneLayerVisible.set(value);
    },
  },
  layerSnow: {
    type: "boolean",
    default: true,
    cb: (value) => {
      snowLayerVisible.set(value);
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
      logoStyle.set(value);
    },
  },
  layerswitcher: {
    type: "string",
    default: "yes",
    source: "url",
    cb: (value) => {
      layerswitcherVisible.set(value);
    },
  },
  toolbar: {
    type: "string",
    default: "yes",
    source: "url",
    cb: (value) => {
      toolbarVisible.set(value);
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
      lightningLayerVisible.set(value);
    },
  },
});
const [lightningSource, lightningLayer] = makeLightningLayer();
lightningLayerVisible.subscribe((value) => {
  lightningLayer.setVisible(value);
  (window as any).settings.set("layerLightning", value);
});
lightningLayerVisible.set((window as any).settings.get("layerLightning"));

const nb = new NanobarWrapper();
const radarSocketIO = io(`${websocketBaseUrl}/radar`);
radarSocketIO.on("connect", () => {
  console.log("radar/forecast websocket connected!");
});

const strikemgr = new StrikeManager(1000, lightningSource);

const [mesocycloneSource, mesocycloneLayer] = makeMesocycloneLayer();
const mesocyclonemgr = new MesoCycloneManager(100, mesocycloneSource);
cycloneLayerVisible.subscribe((value) => {
  mesocycloneLayer.setVisible(value);
  (window as any).settings.set("layerMesocyclones", value);
});
lightningLayerVisible.set((window as any).settings.get("layerMesocyclones"));

radarSocketIO.on("lightning", (data) => {
  strikemgr.addStrike(data.lon, data.lat);
});
(window as any).ll = lightningLayer;
radarSocketIO.on("mesocyclones", (data) => {
  mesocyclonemgr.clearAll();
  data.forEach((elem) => mesocyclonemgr.addCyclone(elem));
});

export let lm;
lm = new LayerManager({
  settings: (window as any).settings,
  nanobar: nb,
  capabilities: [
    {
      capability: RadarCapability,
      additionalLayers: [mesocycloneLayer, lightningLayer, labelsOnly(), radolanOverlay()],
      options: {
        nanobar: nb,
        socket_io: radarSocketIO,
      },
    },
    {
      capability: SatelliteCapability,
      additionalLayers: [bordersAndWays()],
      options: {
        nanobar: nb,
        hasBaseLayer: false,
      },
    },
    {
      capability: AerosolsCapability,
      additionalLayers: [bordersAndWays()],
      options: {
        nanobar: nb,
        hasBaseLayer: false,
      },
    },
    {
      capability: PrecipitationTypesCapability,
      additionalLayers: [labelsOnly(), radolanOverlay()],
      options: {
        nanobar: nb,
        tileURL: `${apiBaseUrl}/radar/classification`,
      },
    }],
});

(window as any).lm = lm;
(window as any).settings.setCb("mapRotation", (value) => {
  const newView = new View({
    center: lm.getCurrentMap().getView().getCenter(),
    zoom: lm.getCurrentMap().getView().getZoom(),
    minZoom: lm.getCurrentMap().getView().getMinZoom(),
    enableRotation: value,
    extent: lm.getCurrentMap().getView().extent,
  });
  lm.forEachMap((map) => map.setView(newView));
});
(window as any).settings.setCb("latLonZ", (value) => {
  if (!value) return;
  const parts = value.split(",");
  if (parts.length !== 3) return;
  const [lat, lon, z] = parts.map(parseFloat);
  lm.getCurrentMap().getView().setCenter(fromLonLat([lon, lat]));
  lm.getCurrentMap().getView().setZoom(z);
});

function reloadLightning() {
  fetch(`${dataUrl}/lightning_cache`)
    .then((response) => response.json())
    .then((data) => {
      strikemgr.clearAll();
      // differential download: send timestamp of newest strike to backend
      // only retrieve the difference.
      data.forEach((elem) => {
        strikemgr.addStrikeWithTime(elem.lon, elem.lat, Math.round(elem.time / 1000 / 1000));
      });
    })
    .then(() => nb.finish(URL))
    .catch((error) => {
      console.log(error);
    });
}

function reloadCyclones() {
  fetch(`${dataUrl}/mesocyclones/all/`)
    .then((response) => response.json())
    .then((data) => {
      mesocyclonemgr.clearAll();
      data.forEach((elem) => mesocyclonemgr.addCyclone(elem));
    })
    .then(() => nb.finish(URL))
    .catch((error) => {
      console.log(error);
    });
}

reloadLightning();
reloadCyclones();

(window as any).enterForeground = () => {
  lastFocus.set(new Date());
  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }
  reloadLightning();
  reloadCyclones();
};

if (device === "web") {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition((position) => {
      lm.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0);
    });
  }
  // window.onfocus = function () {
  //   // if (lastFocus)
  //   window.enterForeground();
  // };
}

if (dd.isIos()) {
  (window as any).webkit.messageHandlers.scriptHandler.postMessage("requestSettings");
}

if (dd.isAndroid()) {
  Android.requestSettings();
}
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
  <BottomToolbar />
{/if}

<div id="nanobar" />
<Map layerManager={lm} />

{#if $toolbarVisible}
<NowcastPlayback cap={lm.getCapability("radar")} />
{/if}
