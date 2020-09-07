import App from './App.svelte';
import CircleStyle from "ol/style/Circle";
import { circular as circularPolygon } from "ol/geom/Polygon.js";
import { get as getProjection, getTransformFromProjections, fromLonLat } from "ol/proj.js";
import Control from "ol/control/Control";
import OSM from "ol/source/OSM";
import Point from "ol/geom/Point";
import TileJSON from "ol/source/TileJSON.js";
import Overlay from "ol/Overlay.js";
import TileLayer from "ol/layer/Tile.js";
import Attribution from "ol/control/Attribution";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Cluster } from "ol/source.js";
import { Fill, Stroke, Style, Icon } from "ol/style";
import { Map, View, Geolocation, Feature } from "ol";
import { defaults as defaultControls, OverviewMap } from "ol/control.js";

const app = new App({
	target: document.body,
	props: {
		name: 'world'
	}
});

window.app = app;

export default app;
