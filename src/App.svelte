<script>
	import Map from './Map.svelte';
	import Logo from './Logo.svelte';
    import {LayerManager} from "./lib/LayerManager";
    import {NanobarWrapper} from "./lib/NanobarWrapper.js"

    import * as Sentry from "@sentry/browser";
    import { Integrations } from "@sentry/tracing";
    import {Settings} from "./lib/Settings";
    import View from "ol/View";
    import {RadarCapability} from "./lib/RadarCapability";
    import {SatelliteCapability} from "./lib/SatelliteCapability";
    import {WeatherCapability} from "./lib/WeatherCapability";

    Sentry.init({
        dsn: 'https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137',
        integrations: [
            new Integrations.BrowserTracing(),
        ],

        // We recommend adjusting this value in production, or using tracesSampler
        // for finer control
        tracesSampleRate: 1.0,
    });

    let baseUrl = "https://api.ng.meteocool.com/api/";
    //baseUrl = "http://localhost:5000/api/";
    window.settings = new Settings({
        mapRotation: {
            type: 'boolean',
            default: false,
            cb: (value) => {
                const newView = new View({
                    center: map.getView().getCenter(),
                    zoom: map.getView().getZoom(),
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
    });

    const nb = new NanobarWrapper();
    export let lm = new LayerManager({
        baseURL: baseUrl + "tiles/",
        settings: window.settings,
        nanobar: nb,
        capabilities: {
            "radar": new RadarCapability({"nanobar": nb, "tileURL": baseUrl + "radar/"}),
            "satellite": new SatelliteCapability(nb),
            "weather": new WeatherCapability(nb),
        },
    });
    export let device = document.currentScript.getAttribute('device');
    window.lm = lm;

    if (device == "ios" && "webkit" in window) {
        window.webkit.messageHandlers["scriptHandler"].postMessage("requestSettings");
    }
</script>

<style>
	:global(body) {
		margin: 0;
        padding: 0;
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
        border-radius: 2px;
        height: 2px;
        border-top-left-radius: 0px;
        border-bottom-left-radius: 0px;
        box-shadow: 0 0 3px rgb(135, 202, 214);
    }

    :global(.sl-toast-stack) {
        bottom: env(safe-area-inset-top);
        top: auto;
    }

</style>

{#if device !== 'ios'}
<Logo />
{/if}
<div id="nanobar" />
<Map layerManager={lm} />
