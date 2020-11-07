<script>
    import {mapTilerOutdoor, mapTilerSatellite, osm} from "./layers/base";
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
    import {sentinel2} from "./layers/satellite";

    export let layerManager;
    let baseUrl = "https://api.ng.meteocool.com";
    let map = null;
    export let layer;
    let uniqueID = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    import { onMount } from 'svelte';

    onMount(async () => {
        dispatch("mount", {"id": `map-{uniqueID}`});
    });

    function getLayersByName(name) {
        switch(name) {
            case "sentinel2":
                return [mapTilerSatellite(), sentinel2()];
            case "reflectivity":
                return [mapTilerOutdoor()];
            case "osm":
                return [osm()];
            default:
                console.log(name);
                return [];
        }
    }

    function mapInit(node) {
        layerManager.setTarget(layer, node.id)
    }
    export function updateMap() {
        map.updateSize();
    }
    export function getMap() {
        return map;
    }


</script>

<style>
    .map {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        top: 0;
        left: 0;
    }
</style>

<div id="map-{uniqueID}" class="map" use:mapInit/>
