<script>
  import Map from './Map';
  import Logo from './Logo';
  import NowcastPlayback from './NowcastPlayback';
  import BottomToolbar from './BottomToolbar';

  import { RadarCapability } from './caps/RadarCapability';
  import { SatelliteCapability } from './caps/SatelliteCapability';
  import { WeatherCapability } from './caps/WeatherCapability';

  import { LayerManager } from './lib/LayerManager';
  import { NanobarWrapper } from './lib/NanobarWrapper';
  import { Settings } from './lib/Settings';

  import * as Sentry from '@sentry/browser';
  import { Integrations } from '@sentry/tracing';
  import View from 'ol/View';

  import { addMessages, init, getLocaleFromNavigator } from 'svelte-i18n';
  import de from './locale/de.json';
  import en from './locale/en.json';
  import { colorSchemeDark } from './stores';

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
    SlTag,
    SlDropdown,
    SlDialog,
    SlSelect,
    SlMenuItem,
    SlCheckbox,
    SlMenu,
    SlButtonGroup,
    SlTooltip,
    SlMenuLabel,
    SlRange
  } from '@shoelace-style/shoelace';
  import TimeIndicator from './components/TimeIndicator.svelte';

  Sentry.init({
    dsn:
            'https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137',
    integrations: [new Integrations.BrowserTracing()],
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    autoSessionTracking: false,
    release: GIT_COMMIT_HASH,
  });

  addMessages('de', de);
  addMessages('en', en);

  init({
    fallbackLocale: 'en',
    initialLocale: getLocaleFromNavigator(),
  });

  setAssetPath(document.currentScript.src);
  customElements.define('sl-button', SlButton);
  customElements.define('sl-icon', SlIcon);
  customElements.define('sl-icon-button', SlIconButton);
  customElements.define('sl-spinner', SlSpinner);
  customElements.define('sl-alert', SlAlert);
  customElements.define('sl-progress-ring', SlProgressRing);
  customElements.define('sl-tag', SlTag);
  customElements.define('sl-dialog', SlDialog);
  customElements.define('sl-range', SlRange);
  customElements.define('sl-select', SlSelect);
  customElements.define('sl-dropdown', SlDropdown);
  customElements.define('sl-menu-item', SlMenuItem);
  customElements.define('sl-menu-label', SlMenuLabel);
  customElements.define('sl-menu', SlMenu);
  customElements.define('sl-checkbox', SlCheckbox);
  customElements.define('sl-button-group', SlButtonGroup);
  customElements.define('sl-tooltip', SlTooltip);

  let baseUrl = 'https://api.ng.meteocool.com/api/';
  baseUrl = "http://localhost:5000/api/";
  window.settings = new Settings({
    mapRotation: {
      type: 'boolean',
      default: false,
      cb: (value) => {
        const newView = new View({
          center: lm.getCurrentMap()
                  .getView()
                  .getCenter(),
          zoom: lm.getCurrentMap()
                  .getView()
                  .getZoom(),
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
      cb: (val) => (window.updateColormap ? window.updateColormap(val) : true),
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
    nanobar: nb,
  });
  export const weather = new WeatherCapability({
    nanobar: nb,
    tileURL: baseUrl + 'icon/t_2m/',
  });

  window.enterForeground = () => {
    radar.reloadTilesRadar();
    weather.reloadTilesWeather();
    colorSchemeDark.set(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark )').matches);
  }; // may be a second function if you want to have no switch to of the scheme at the start of the app

  export let lm = new LayerManager({
    baseURL: baseUrl + 'tiles/',
    settings: window.settings,
    nanobar: nb,
    capabilities: {
      radar,
      satellite: new SatelliteCapability({ nanobar: nb }),
      weather,
    },
  });
  export let device = window.device;
  window.lm = lm;

  if (device == 'ios' && 'webkit' in window) {
    window.webkit.messageHandlers['scriptHandler'].postMessage(
            'requestSettings',
    );
  }

  if (device == 'android') {
    Android.requestSettings();
  }

  colorSchemeDark.set(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark )').matches);

  window.matchMedia('(prefers-color-scheme: dark)')
          .addListener(function (e) {
            console.log(`changed to ${e.matches ? 'dark' : 'light'} mode`);
            colorSchemeDark.set(e.matches);
          });

  //Dark and Light mode
  let colorSchemeLocal = false;
  colorSchemeDark.subscribe((value) => {
    colorSchemeLocal = value;
    if (colorSchemeLocal) {
      document.documentElement.style.setProperty('--sl-color-white', '#3F3F3F');
      document.documentElement.style.setProperty('--sl-color-black', '#FFFFFF');
      document.documentElement.style.setProperty(
              '--sl-color-gray-700',
              '#FFFFFF',
      );
      document.documentElement.style.setProperty(
              '--sl-color-gray-300',
              '#717171',
      );
      document.documentElement.style.setProperty(
              '--sl-color-gray-200',
              '#3F3F3F',
      );
      document.documentElement.style.setProperty('--sl-color-gray-50', '#3F3F3F');
      document.documentElement.style.setProperty('--sl-color-gray-200', '#8b8b8b');
      document.documentElement.style.setProperty('--sl-color-info-100', '#3F3F3F');
      document.documentElement.style.setProperty('--sl-color-primary-text', '#ffffff');
      document.documentElement.style.setProperty('--sl-color-gray-600', '#d6d6d6');
      document.documentElement.style.setProperty('--sl-color-info-700', '#c2c2c2');
      document.documentElement.style.setProperty(
              '--sl-color-primary-600',
              '#38BDF8',
      );
    } else {
      document.documentElement.style.removeProperty('--sl-color-gray-600');
      document.documentElement.style.removeProperty('--sl-color-white');
      document.documentElement.style.removeProperty('--sl-color-black');
      document.documentElement.style.removeProperty('--sl-color-info-700');
      document.documentElement.style.removeProperty('--sl-color-info-100');
      document.documentElement.style.removeProperty('--sl-color-gray-50');
      document.documentElement.style.removeProperty('--sl-color-gray-200');
      document.documentElement.style.removeProperty('--sl-color-gray-300');
      document.documentElement.style.removeProperty('--sl-color-gray-700');
      document.documentElement.style.removeProperty("--sl-color-primary-600");
    }
  });


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
    z-index: 9999;
    top: 0;
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

{#if device !== "ios" && device !== "android"}
  <Logo />
{/if}
<TimeIndicator />
<BottomToolbar device={device} />
<div id="nanobar" />
<Map layerManager={lm} />
<NowcastPlayback cap={radar} device={device} />
