import { writable } from "svelte/store";

export const showTimeSlider = writable(false);
export const capDescription = writable("Meteorology for everyone");
export const capLastUpdated = writable(null);
export const capTimeIndicator = writable(null);
export const colorSchemeDark = writable(false);
export const latLon = writable(null);
export const lightningLayerVisible = writable(true);
