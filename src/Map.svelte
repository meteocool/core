<script>
    import {Map, View} from "ol";
    import {fromLonLat} from "ol/proj.js";
    import {mapTiler} from "./layers/base";
    import McLayerSwitcher from "./McLayerSwitcher.svelte";
    import Attribution from "ol/control/Attribution";
    import "ol/ol.css";
    import {defaults} from "ol/control";

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
        let attribution = new Attribution({
            collapsible: false
        });

        map = new Map({
            target: node.id,
            layers: [mapTiler()],
            view: new View({
                constrainResolution: true,
                zoom: 7,
                center: fromLonLat([11, 49]),
            }),
            controls: defaults({ attribution: false }).extend([
                attribution
            ]),
        });
        layerManager.registerMap(["reflectivity"], map);

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
