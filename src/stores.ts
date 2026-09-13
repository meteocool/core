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

/**
 * Connection state, as the browser reports it.
 *
 * `isSlow` is a hint, not a measurement: it comes from the Network Information
 * API, which Safari does not implement, so it stays false there rather than
 * pretending to know.
 *
 * The shape lives here rather than beside the code that fills it in
 * (src/lib/networkStatus.ts), because that module imports this one -- defining
 * the initial value there too makes the cycle a real one and the store reads as
 * undefined at load.
 */
export interface NetworkStatus {
  online: boolean;
  /** "slow-2g" | "2g" | "3g" | "4g", or null where the browser has no opinion. */
  effectiveType: string | null;
  isSlow: boolean;
}

/** Connection state, written by src/lib/networkStatus.ts. */
export const networkStatus = writable<NetworkStatus>({
  online: true,
  effectiveType: null,
  isSlow: false,
});

/**
 * When map tiles last arrived, written by src/lib/tileStatus.ts.
 *
 * Only `lastSuccessAt` is here because only `lastSuccessAt` is rendered -- the
 * banner says how stale the map is. An in-flight counter and the last error
 * would both be cheap to add and neither would be read.
 */
export const tileStatus = writable<{ lastSuccessAt: number | null }>({ lastSuccessAt: null });

/** Bumped by the banner's retry button; LayerManager refreshes every source. */
export const tileRefreshSignal = writable<number>(0);
