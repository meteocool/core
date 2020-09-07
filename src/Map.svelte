<script>
    import CircleStyle from "ol/style/Circle";
    import { circular as circularPolygon } from "ol/geom/Polygon.js";
    import { get as getProjection, getTransformFromProjections, fromLonLat } from "ol/proj.js";
    import Control from "ol/control/Control";
    import OSM from "ol/source/OSM";
    import Point from "ol/geom/Point";
    import XYZ from "ol/source/XYZ.js";
    import Overlay from "ol/Overlay.js";
    import TileLayer from "ol/layer/Tile.js";
    import Attribution from "ol/control/Attribution";
    import VectorLayer from "ol/layer/Vector";
    import VectorSource from "ol/source/Vector";
    //import distanceInWordsToNow from "date-fns/distance_in_words_to_now";
    //import dateFnGerman from "date-fns/locale/de";
    //import dateFnEnglish from "date-fns/locale/en";
    //import io from "socket.io-client";
    import { Cluster } from "ol/source.js";
    //import { DeviceDetect } from "./DeviceDetect.js";
    //import { Settings } from "./Settings.js";
    import { Fill, Stroke, Style, Icon } from "ol/style";
    import { Map, View, Geolocation, Feature } from "ol";
    import {DEVICE_PIXEL_RATIO} from 'ol/has';
    import { defaults as defaultControls, OverviewMap } from "ol/control.js";

    import { LayerManager } from "./LayerManager.js";
    //import { StrikeManager } from "./StrikeManager.js";
    //import { MesoCycloneManager } from "./MesoCycloneManager.js";
    import {transformExtent} from 'ol/proj';

    import "ol/ol.css";
    import "ol-ext/dist/ol-ext.css";
    import LayerSwitcher from "ol-ext/control/LayerSwitcher";
    import {defaults} from "ol/interaction";
    import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
    import VectorTileLayer from "ol/layer/VectorTile";
    import VectorTileSource from 'ol/source/VectorTile';
    import TopoJSON from "ol/format/TopoJSON";
    import LayerGroup from "ol/layer/Group";

    let baseUrl = "https://api.ng.meteocool.com";
    if (process.env.NODE_ENV === "production") {
        baseUrl = "";
    }

    let map = null;

    var roadStyleCache = {};
    var boundaryStyleCache = {};
    var roadColor = {
        'major_road': '#776',
        'minor_road': '#ccb',
        'highway': '#ffa333',
    };
    var boundaryStyle = function (feature) {
        var kind = feature.get('kind');
        if (kind !== "country") {
            return;
        }
        var style = boundaryStyleCache[kind];
        if (!style) {
            window.boundary = feature;
            var color, width;
            style = new Style({
                stroke: new Stroke({
                    color: '#454542',
                    width: 2,
                }),
                zIndex: 1,
            });
            roadStyleCache[kind] = style;
        }
        return style;
    }
    var roadStyle = function (feature) {
        var kind = feature.get('kind');
        var railway = feature.get('railway');
        var sort_key = feature.get('sort_key');
        var styleKey = kind + '/' + railway + '/' + sort_key;
        var style = roadStyleCache[styleKey];
        if (!style) {
            var color, width;
            if (railway) {
                color = '#7de';
                width = 1;
            } else {
                color = roadColor[kind];
                width = kind == 'highway' ? 1.5 : 1;
            }
            style = new Style({
                stroke: new Stroke({
                    color: color,
                    width: width,
                }),
                zIndex: sort_key,
            });
            roadStyleCache[styleKey] = style;
        }
        return style;
    };

    const satelliteExtent = transformExtent([-19.98902381657924, 32.750667412687676, 29.840756983321853, 62.440050453973896], 'EPSG:4326', 'EPSG:3857');

    function mapInit(node) {
        const copernicusAttribution = new Attribution({html: "© Contains modified Copernicus data"});
        const maptilerAttribution = new Attribution({html: "© OpenStreetMap Contributors, MapTiler"});
        map = new Map({
            target: node.id,
            layers: [
                // Base Layers
                new TileLayer({
                    source: new XYZ({
                        url: 'https://api.maptiler.com/maps/outdoor/{z}/{x}/{y}@2x.png?key=0RSNnnPNGNsXG0c4BaXV',
                        tileSize: 512,
                        tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
                        attributions: [maptilerAttribution],
                    }),
                    zIndex: 1,
                    displayInLayerSwitcher: false,
                }),
                new LayerGroup({
                    title: "Sentinel-2 (10m/5 days)",
                    layers: [
                        new TileLayer({
                            source: new XYZ({
                                url: 'https://s3-meteocool.diecktator.xyz/satellite/sentinel2/{z}/{x}/{y}.png',
                                tileSize: 256,
                                minZoom: 1,
                                maxZoom: 14,
                                attributions: [copernicusAttribution],
                            }),
                            zIndex: 5,
                            extent: satelliteExtent,
                        }),
                        new VectorTileLayer({
                            extent: satelliteExtent,
                            zIndex: 99,
                            source: new VectorTileSource({
                                attributions:
                                        '&copy; OpenStreetMap contributors, Who’s On First, ' +
                                        'Natural Earth, and openstreetmapdata.com',
                                format: new TopoJSON({
                                    layerName: 'layer',
                                    layers: ['roads', 'boundaries'],
                                }),
                                maxZoom: 19,
                                url:
                                        'https://tile.nextzen.org/tilezen/vector/v1/all/{z}/{x}/{y}.topojson?api_key=qW-EcxRGQcanc6upJoSHSA',

                            }),
                            style: function (feature, resolution) {
                                switch (feature.get('layer')) {
                                    case 'roads':
                                        return roadStyle(feature);
                                    case 'boundaries':
                                        return boundaryStyle(feature);
                                    default:
                                        return null;
                                }
                            },
                        }),
                    ]}),
                //new TileLayer({
                //    title: "Sentinel-3 (300m/0.5 days)",
                //    source: new XYZ({
                //        url: 'https://s3-meteocool.diecktator.xyz/satellite/sentinel3/{z}/{x}/{y}.png',
                //        tileSize: 256,
                //        minZoom: 1,
                //        maxZoom: 14,
                //        attributions: [copernicusAttribution],
                //    }),
                //    enabled: false,
                //})
            ],
            view: new View({
                constrainResolution: true,
                zoom: 7,
                center: fromLonLat([11, 49]),
            })
        });
        window.lm = new LayerManager(map, baseUrl + "/api/tiles/", 0.8, false);

        // Add control inside the map
        let ctrl = new LayerSwitcher();
        map.addControl(ctrl);

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
    }
    :global(.ol-zoom) {
        display: none;
        /* XXX */
    }
    :global(.ol-layerswitcher) {
        left: unset;
        right: 1vw;
    }
    :global(.ol-control.ol-layerswitcher) {
        top: 1vh;
        right: 1vh;
    }
</style>

<div id="map" use:mapInit />
