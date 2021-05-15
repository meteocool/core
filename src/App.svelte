<script>
import View from "ol/View";
import { addMessages, init, getLocaleFromNavigator } from "svelte-i18n";

import { io } from "socket.io-client";
import Map from "./components/Map.svelte";
import Logo from "./components/Logo.svelte";
import NowcastPlayback from "./components/NowcastPlayback.svelte";
import BottomToolbar from "./components/BottomToolbar.svelte";

import RadarCapability from "./caps/RadarCapability";
import SatelliteCapability from "./caps/SatelliteCapability";
import WeatherCapability from "./caps/WeatherCapability";

import { LayerManager } from "./lib/LayerManager";
import NanobarWrapper from "./lib/NanobarWrapper";
import Settings from "./lib/Settings";

import de from "./locale/de.json";
import en from "./locale/en.json";
import {
  capLastUpdated,
  colorSchemeDark,
  cycloneLayerVisible,
  lightningLayerVisible,
  mapBaseLayer,
  radarColorScheme,
} from "./stores";

import "./style/global.css";
import "@shoelace-style/shoelace/dist/themes/base.css";
import { apiBaseUrl, dataUrl, websocketBaseUrl } from "./urls";
import { initUIConstants } from "./layers/ui";
import makeLightningLayer from "./layers/lightning";
import StrikeManager from "./lib/StrikeManager";
import MesoCycloneManager from "./lib/MesoCycloneManager";
import makeMesocycloneLayer from "./layers/mesocyclones";
import { DeviceDetect as dd } from "./lib/DeviceDetect";
import { labelsOnly } from "./layers/vector";
import { reportError, reportToast } from './lib/Toast';
import Router from './lib/Router';

export let device;

dd.set(device);

addMessages("de", de);
addMessages("en", en);

init({
  fallbackLocale: "en",
  initialLocale: getLocaleFromNavigator(),
});

initUIConstants();

window.settings = new Settings({
  mapRotation: {
    type: "boolean",
    default: false,
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
    },
  },
  capability: {
    type: "string",
    default: "radar",
  },
  experimentalFeatures: {
    type: "boolean",
    default: false,
  },
  layerMesocyclones: {
    type: "boolean",
    default: true,
    applyInitial: true,
    cb: (value) => {
      cycloneLayerVisible.set(value);
    },
  },
  layerLightning: {
    type: "boolean",
    default: true,
    applyInitial: true,
    cb: (value) => {
      lightningLayerVisible.set(value);
    },
  },
});
const [lightningSource, lightningLayer] = makeLightningLayer();
lightningLayerVisible.subscribe((value) => {
  lightningLayer.setVisible(value);
  window.settings.set("layerLightning", value);
});
lightningLayerVisible.set(window.settings.get("layerLightning"));

const nb = new NanobarWrapper();
const radarSocketIO = io(`${websocketBaseUrl}/radar`);
radarSocketIO.on("connect", () => {
  console.log("radar/forecast websocket connected!");
});

const strikemgr = new StrikeManager(1000, lightningSource);

const [mesocycloneSource, mesocycloneLayer] = makeMesocycloneLayer();
const mesocyclonemgr = new MesoCycloneManager(100, mesocycloneSource);

radarSocketIO.on("lightning", (data) => {
  strikemgr.addStrike(data.lon, data.lat);
});
radarSocketIO.on("mesocyclones", (data) => {
  mesocyclonemgr.clearAll();
  data.forEach((elem) => mesocyclonemgr.addCyclone(elem));
});

export const radar = new RadarCapability({
  nanobar: nb,
  socket_io: radarSocketIO,
  additionalLayers: [mesocycloneLayer, lightningLayer, labelsOnly()],
});
export const weather = new WeatherCapability({
  nanobar: nb,
  tileURL: `${apiBaseUrl}/icon/t_2m/`,
});

export const lm = new LayerManager({
  settings: window.settings,
  nanobar: nb,
  capabilities: {
    radar,
    satellite: new SatelliteCapability({ nanobar: nb }),
    weather,
  },
});
window.lm = lm;
window.settings.setCb("mapRotation", (value) => {
  const newView = new View({
    center: lm.getCurrentMap().getView().getCenter(),
    zoom: lm.getCurrentMap().getView().getZoom(),
    minZoom: 5,
    enableRotation: value,
  });
  lm.forEachMap((map) => map.setView(newView));
});

if (dd.isIos()) {
  window.webkit.messageHandlers.scriptHandler.postMessage(
    "requestSettings",
  );
}

if (dd.isAndroid()) {
  Android.requestSettings();
}

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

window.enterForeground = () => {
  capLastUpdated.set(null);
  radar.downloadCurrentRadar();
  weather.reloadTilesWeather();
  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }
  reloadLightning();
  reloadCyclones();
};

console.log(Router.ParseURL(window.location.href));

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
    border-radius: 0px 2px 2px 0px;
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
<BottomToolbar />
<div id="nanobar" />
<Map layerManager={lm} />
<NowcastPlayback cap={radar} />
