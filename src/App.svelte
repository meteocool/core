<script>
  import Map from './Map.svelte';
  import Logo from './Logo.svelte';
  import NowcastPlayback from './NowcastPlayback.svelte';

  import {RadarCapability} from './lib/RadarCapability';
  import {SatelliteCapability} from './lib/SatelliteCapability';
  import {WeatherCapability} from './lib/WeatherCapability';

  import {LayerManager} from './lib/LayerManager';
  import {NanobarWrapper} from './lib/NanobarWrapper.js';
  import {Settings} from './lib/Settings';

  import * as Sentry from '@sentry/browser';
  import {Integrations} from '@sentry/tracing';
  import View from 'ol/View';

  import {addMessages, init, getLocaleFromNavigator} from 'svelte-i18n';
  import de from './de.json';

  addMessages('de', de);

  init({
      fallbackLocale: 'de',
      initialLocale: getLocaleFromNavigator(),
  });

  Sentry.init({
    dsn: 'https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137',
    integrations: [
      new Integrations.BrowserTracing(),
    ],
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    autoSessionTracking: false,
    release: GIT_COMMIT_HASH,
  });
  console.log(GIT_COMMIT_HASH);

  import './style/global.css';
  import '@shoelace-style/shoelace/dist/shoelace/shoelace.css';
  import {
    SlAlert,
    SlButton,
    SlIconButton,
    SlIcon,
    SlSpinner,
    setAssetPath,
    SlProgressRing,
    SlTag, SlDialog,
  } from '@shoelace-style/shoelace';
  import BottomToolbar from './BottomToolbar.svelte';
  import About from "./About.svelte";
  import {colorSchemeDark} from "./stores";
  import {subscribe} from "svelte/internal";

  setAssetPath(document.currentScript.src);
  customElements.define('sl-button', SlButton);
  customElements.define('sl-icon', SlIcon);
  customElements.define('sl-icon-button', SlIconButton);
  customElements.define('sl-spinner', SlSpinner);
  customElements.define('sl-alert', SlAlert);
  customElements.define('sl-progress-ring', SlProgressRing);
  customElements.define('sl-tag', SlTag);
  customElements.define('sl-dialog', SlDialog);

  let baseUrl = 'https://api.ng.meteocool.com/api/';
  //baseUrl = "http://localhost:5000/api/";
  window.settings = new Settings({
    mapRotation: {
      type: 'boolean',
      default: false,
      cb: (value) => {
          const newView = new View({
              center: lm.getCurrentMap().getView().getCenter(),
              zoom: lm.getCurrentMap().getView().getZoom(),
              minzoom: 5,
              enableRotation: value,
          });
          lm.forEachMap((map) => map.setView(newView));
      },
    },
    mapBaseLayer: {
      type: 'string',
      default: 'topographic',
      cb: (value) => {
          lm.switchBaseLayer(value);
      },
    },
    radarColorMapping: {
      type: 'string',
      default: 'classic',
      cb: (val) => window.updateColormap ? window.updateColormap(val) : true,
    },
    capability: {
      type: 'string',
      default: 'radar',
    },
    experimentalFeatures: {
      type: 'boolean',
      default: false,
    },
    layerMesocyclones: {
      type: 'boolean',
      default: true,
    },
    layerLightning: {
      type: 'boolean',
      default: true,
    },
  });

  const nb = new NanobarWrapper();
  export const radar = new RadarCapability({
    'nanobar': nb,
    'tileURL': baseUrl + 'radar/'
  });
  export const weather = new WeatherCapability({
    'nanobar': nb,
    'tileURL': baseUrl + 'icon/t_2m/'
  });

  window.enterForeground = () => {
    radar.reloadTilesRadar();
    weather.reloadTilesWeather();
  };

  export let lm = new LayerManager({
    baseURL: baseUrl + 'tiles/',
    settings: window.settings,
    nanobar: nb,
    capabilities: {
      'radar': radar,
      'satellite': new SatelliteCapability({'nanobar': nb}),
      'weather': weather,
    },
  });
  export let device = window.device;
  window.lm = lm;

  if (device == 'ios' && 'webkit' in window) {
    window.webkit.messageHandlers['scriptHandler'].postMessage('requestSettings');
  }

  //Dark and Light mode
  let colorSchemeLocal = false;
  colorSchemeDark.subscribe(value => {colorSchemeLocal = value;});
  if (colorSchemeLocal){
    document.documentElement.style.setProperty("--sl-color-white", "#3F3F3F");
    document.documentElement.style.setProperty("--sl-color-black", "#FFFFFF");
    document.documentElement.style.setProperty("--sl-color-gray-700", "#FFFFFF");
    document.documentElement.style.setProperty("--sl-color-gray-200", "#3F3F3F");
    document.documentElement.style.setProperty("--sl-color-gray-50", "#3F3F3F");
    document.documentElement.style.setProperty("--sl-color-primary-600", "#38BDF8");
    document.documentElement.style.setProperty("--sl-color-primary-800", "#0284C7");
  }
</script>

<style>
	:global(body) {
		margin: 0;
        padding: 0;
        overflow: hidden;
	}

    :global(.nanobar) {
        width: 100%;
        height: 4px;
        z-index: 9999;
        top:0
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
        bottom: calc(env(safe-area-inset-bottom) + 42px);
        top: auto;
    }

    :global(*) {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        touch-action: manipulation;
    }
</style>

{#if device !== 'ios' && device !== 'android'}
    <Logo />
{/if}
<BottomToolbar/>
<div id="nanobar" />
<Map layerManager={lm} />
<NowcastPlayback cap={radar} nowcast={radar.nowcast} />
