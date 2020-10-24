<script>
	import Map from './Map.svelte';
	import Logo from './Logo.svelte';
	import ColorSwitcher from "./ColorSwitcher.svelte";
    import {LayerManager} from "./lib/LayerManager";
    import {NanobarWrapper} from "./lib/NanobarWrapper.js"

    import * as Sentry from "@sentry/browser";
    import { Integrations } from "@sentry/tracing";

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
    let nb = new NanobarWrapper();
    export let lm = new LayerManager(baseUrl + "tiles/", 0.8, false, nb);
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
        background: rgb(137, 205, 217);
        border-radius: 2px;
        height: 1px;
        border-top-left-radius: 0px;
        border-bottom-left-radius: 0px;
        box-shadow: 0 0 2px #0000ff;
    }

</style>

<Logo />
<ColorSwitcher />
<div id="nanobar" />
<Map layerManager={lm} />
