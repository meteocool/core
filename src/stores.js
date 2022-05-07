import { writable } from "svelte/store";

// XXX basically a list of places where global state was chosen instead of an actual, working
// abstraction.

export const bottomToolbarMode = writable("collapsed");
export const capDescription = writable("Meteorology for everyone");
export const capLastUpdated = writable(null);
export const capTimeIndicator = writable(0);
export const colorSchemeDark = writable(false);
export const radarColormap = writable("classic");

export const latLon = writable(null);
export const zoomlevel = writable(3);

export const lightningLayerVisible = writable(true);
export const layerswitcherVisible = writable("yes");
export const toolbarVisible = writable("yes");
export const cycloneLayerVisible = writable(true);
export const snowLayerVisible = writable(true);
export const logoStyle = writable("full");

export const mapBaseLayer = writable("light");
export const radarColorScheme = writable("classic");

export const showForecastPlaybutton = writable(true);
export const satelliteLayer = writable("sentinel2");
export const satelliteLayerCloudy = writable(false);
export const satelliteLayerLabels = writable(true);

export const live = writable(false);
export const unit = writable("pictogram");
export const precacheForecast = writable(true);

export const sharedActiveCap = writable("");
export const sharedCmap = writable("");

export const lastFocus = writable(new Date());
