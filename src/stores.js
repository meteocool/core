import { writable } from "svelte/store";

export const showTimeSlider = writable(false);
export const capDescription = writable("Meteorology for everyone");
export const capLastUpdated = writable(new Date());
export const colorSchemeDark = writable(
  window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark )").matches,
);
