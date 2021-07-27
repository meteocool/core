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
  bottomToolbarMode,
  capLastUpdated,
  colorSchemeDark,
  cycloneLayerVisible, lastFocus, layerswitcherVisible,
  lightningLayerVisible, logoStyle,
  mapBaseLayer,
  radarColorScheme, toolbarVisible,
} from './stores';

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
import { fromLonLat } from 'ol/proj';
import PrecipitationTypesCapability from './caps/PrecipitationTypesCapability';
import { greyOverlay } from './layers/radar';

import {easeOut} from 'ol/easing';
import {getVectorContext} from 'ol/render';
import {unByKey} from 'ol/Observable';
import { Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';

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
    cb: (value) => {
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

// const duration = 3000;
// const flash = (feature, layer) => {
//   var start = new Date().getTime();
//   var listenerKey = layer.on('postrender', (event) => {
//     var vectorContext = getVectorContext(event);
//     var frameState = event.frameState;
//     var flashGeom = feature.getGeometry().clone();
//     var elapsed = frameState.time - start;
//     var elapsedRatio = elapsed / duration;
//     // radius will be 5 at start and 30 at end.
//     var radius = easeOut(elapsedRatio) * 25 + 5;
//     var opacity = easeOut(1 - elapsedRatio);
//
//     var style = new Style({
//       image: new CircleStyle({
//         radius: radius,
//         stroke: new Stroke({
//           color: 'rgba(255, 0, 0, ' + opacity + ')',
//           width: 0.25 + opacity,
//         }),
//       }),
//     });
//
//     vectorContext.setStyle(style);
//     vectorContext.drawGeometry(flashGeom);
//     if (elapsed > duration) {
//       unByKey(listenerKey);
//       return;
//     }
//     // tell OpenLayers to continue postrender animation
//     lm.getCurrentMap().render();
//   });
// }
//
// window.flash = flash;
// window.sm = strikemgr;

radarSocketIO.on("lightning", (data) => {
  strikemgr.addStrike(data.lon, data.lat);
});
window.ll = lightningLayer;
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
export const precipTypes = new PrecipitationTypesCapability({
  nanobar: nb,
  tileURL: `${apiBaseUrl}/precip_types/`,
  additionalLayers: [labelsOnly(), greyOverlay()],
});

export const lm = new LayerManager({
  settings: window.settings,
  nanobar: nb,
  capabilities: {
    radar,
    satellite: new SatelliteCapability({ nanobar: nb }),
    weather,
    precipTypes,
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
window.settings.setCb("latLonZ", (value) => {
  if (!value) return;
  const parts = value.split(",");
  if (parts.length !== 3) return;
  const [lat, lon, z] = parts.map(parseFloat);

  const newView = new View({
    center: fromLonLat([lon, lat]),
    zoom: z,
    minZoom: lm.getCurrentMap().getView().getMinZoom(),
    rotation: lm.getCurrentMap().getView().getRotation(),
  });
  lm.getCurrentMap().setView(newView);
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
  lastFocus.set(new Date());
  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }
  reloadLightning();
  reloadCyclones();
};

if (device === "web" && "geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition((position) => {
    lm.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0);
  });
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

{#if $toolbarVisible}
  <BottomToolbar />
{/if}

<div id="nanobar" />
<Map layerManager={lm} />

{#if $toolbarVisible}
<NowcastPlayback cap={radar} />
{/if}
