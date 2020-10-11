<script>
	import Map from './Map.svelte';
	import Logo from './Logo.svelte';
	import ColorSwitcher from "./ColorSwitcher.svelte";
    import {LayerManager} from "./LayerManager";

    let baseUrl = "https://api.ng.meteocool.com";
    export let lm = new LayerManager(baseUrl + "/api/tiles/", 0.8, false);
</script>

<style>
	:global(body) {
		margin: 0;
        padding: 0;
	}
</style>

<Logo />
<ColorSwitcher />
<Map layerManager={lm} />
