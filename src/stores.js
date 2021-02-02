import { writable } from "svelte/store";

export const showTimeSlider = writable(false);
export const capDescription = writable("Meteorology for everyone");
export const capLastUpdated = writable(new Date());
