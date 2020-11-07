<script>
    import McLayerSwitcher from "./McLayerSwitcher.svelte";
    import "ol/ol.css";

    let map = null;
    export let layerManager;

    function changeLayer(newLayer) {
        layerManager.unregisterAll(map);
        switch(newLayer.detail) {
            case "reflectivity":
                layerManager.registerMap(["reflectivity"], map, true);
                return;
            case "satellite":
                layerManager.registerMap(["satellite"], map, true);
                return;
            default:
                console.log(newLayer.detail);
                return;
        }
    }

    function mapInit(node) {
        layerManager.setDefaultTarget(node.id);

        return {
            destroy() {
                if (map) {
                    map.setTarget(null);
                    map = null;
                }
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
