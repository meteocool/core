<script>
    import McLayerSwitcher from "./McLayerSwitcher.svelte";
    import "ol/ol.css";

    let map = null;
    export let layerManager;
    let mapID;

    function changeLayer(newLayer) {
        console.log(newLayer);
        layerManager.setTarget(newLayer.detail, mapID);
    }

    function mapInit(node) {
        mapID = node.id;
        layerManager.setDefaultTarget(mapID);
        return {
            destroy() {
                console.log("destroy");
            }
        };
    }
</script>

<style>
    #map {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        z-index: 0;
    }

    :global(.ol-zoom) {
        display: none;
        /* XXX */
    }

    :global(.ol-attribution.ol-uncollapsible) {
        height: 1.2em;
        font-size: 7pt;
    }

</style>

<div id="map" use:mapInit/>
<McLayerSwitcher layerManager={layerManager} on:changeLayer={changeLayer}/>
