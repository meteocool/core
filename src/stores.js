import { writable } from "svelte/store";

export const showTimeSlider = writable(false);
export const capDescription = writable("Meteorology for everyone");
export const capLastUpdated = writable(null);
export const capTimeIndicator = writable(0);
export const colorSchemeDark = writable(false);
export const latLon = writable(null);
export const lightningLayerVisible = writable(true);
export const cycloneLayerVisible = writable(true);
export const mapBaseLayer = writable("light");
export const radarColorScheme = writable("classic");
export const showForecastPlaybutton = writable(true);
export const satelliteLayer = writable("sentinel2");
export const zoomlevel = writable(3);
