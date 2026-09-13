import { writable } from "svelte/store";

// XXX basically a list of places where global state was chosen instead of an actual, working
// abstraction.

export const bottomToolbarMode = writable<"collapsed" | "player" | "hidden">("collapsed");
export const capDescription = writable<string>("Meteorology for everyone");
export const capLastUpdated = writable<Date | null>(null);
export const capTimeIndicator = writable<number>(0);
export const colorSchemeDark = writable<boolean>(false);
export const radarColormap = writable<string>("classic");

export const latLon = writable<[number, number] | null>(null);
export const zoomlevel = writable<number>(3);

export const lightningLayerVisible = writable<boolean>(true);
export const layerswitcherVisible = writable<"yes" | "no">("yes");
export const toolbarVisible = writable<"yes" | "no">("yes");
export const cycloneLayerVisible = writable<boolean>(true);
export const snowLayerVisible = writable<boolean>(true);
export const logoStyle = writable<string>("full");

export const mapBaseLayer = writable<string>("light");
export const radarColorScheme = writable<string>("classic");

export const showForecastPlaybutton = writable<boolean>(true);
export const satelliteLayer = writable<string>("sentinel2");
export const satelliteLayerCloudy = writable<boolean>(false);
export const satelliteLayerLabels = writable<boolean>(true);

export const live = writable<boolean>(false);
export const unit = writable<string>("pictogram");
export const precacheForecast = writable<boolean>(true);

export const sharedActiveCap = writable<string>("");
export const sharedCmap = writable<string>("");

export const lastFocus = writable<Date>(new Date());

export const tileCacheHit = writable<number | Date>(0);
export const tileCacheDownloaded = writable<number | Date>(0);
export const tileCachePending = writable<number | Date>(0);
