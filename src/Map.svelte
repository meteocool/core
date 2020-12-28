<script>
    import McLayerSwitcher from "./McLayerSwitcher.svelte";
    import "ol/ol.css";
    import {uiState} from "./stores";

    let map = null;
    export let layerManager;
    let mapID;

    function changeLayer(newLayer) {
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

        uiState.subscribe(obj => {
            console.log(obj.nowcastPlayback);
            if (obj.nowcastPlayback == true) {
                document.getElementById(node.id).style.height = "calc(90% + 11pt)";
            } else {
                document.getElementById(node.id).style.height = "100%";
            }
            layerManager.forEachMap(map => {
                map.updateSize();
            });
        });
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
        padding-bottom: 1.9em;
        font-size: 7pt;
    }

</style>

<div id="map" use:mapInit/>
<McLayerSwitcher layerManager={layerManager} on:changeLayer={changeLayer}/>
