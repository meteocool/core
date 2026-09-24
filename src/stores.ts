import { EMPTY_HEALTH, type ApiHealth } from "./lib/apiHealth";
import { NOT_DEGRADED, type DegradedState } from "./lib/degraded";
import { EMPTY_CADENCE, type Cadence } from "./lib/updateCadence";
import { derived, readable, writable } from "svelte/store";
import type { CellTrackProperties, RadarVolume } from "./api";

// XXX basically a list of places where global state was chosen instead of an actual, working
// abstraction.

export const bottomToolbarMode = writable<"collapsed" | "player" | "hidden">("collapsed");
/**
 * How many DismissableStrips (the radar/lightning strip above the toolbar)
 * are currently mounted -- each is a fixed 104px tall. CellSelectionHint reads
 * this to stack itself above them instead of on top of them: both float at
 * roughly the same height above the toolbar on their own, so without this they
 * land on each other rather than in a notification-style stack.
 */
export const openStripCount = writable(0);
export const capDescription = writable<string>("Meteorology for everyone");
export const capLastUpdated = writable<Date | null>(null);
/**
 * The frame on screen, and the newest observation the radar grid holds, as the
 * same unix-second steps the grid keys them by -- or 0 before any grid has
 * arrived.
 *
 * The pair answers "is the map showing now?", which `live` cannot: that one is
 * cleared at the start of every grid refetch and set again when the grid lands,
 * so anything keyed to it blinks once every few minutes. These two only move
 * when a frame actually changes, and both being 0 means there is no player to
 * be off the live edge of rather than that we are.
 *
 * Held in one store and published through `setFrames` rather than written
 * separately, because a live grid refresh moves both halves at once and a
 * reader of the pair must never see half the move. As two stores it did: the
 * new observation landed while the indicator was still on the previous frame,
 * and for that one tick the map read as parked behind the live edge. That is
 * all the cell layer's gate in App.svelte needs to hide itself and drop the
 * selection with it -- so the storm detail panel closed itself every few
 * minutes, under a reader who was in the middle of using it.
 */
const capFrames = writable<{ shown: number; newest: number }>({ shown: 0, newest: 0 });

/**
 * Publish either half of the frame pair, or both in one update.
 *
 * A write that changes nothing wakes nobody: `processRadar` republishes the
 * newest step after every grid, and on the live path `resetToLatest` has
 * already said the same thing on its way past.
 */
export function setFrames(next: { shown?: number; newest?: number }): void {
  capFrames.update((frames) => {
    const merged = { ...frames, ...next };
    return merged.shown === frames.shown && merged.newest === frames.newest ? frames : merged;
  });
}

/** The frame the player is showing. */
export const capTimeIndicator = derived(capFrames, (frames) => frames.shown);
/** The newest observation the grid holds. */
export const capLatestObservation = derived(capFrames, (frames) => frames.newest);
export const colorSchemeDark = writable<boolean>(false);
export const radarColormap = writable<string>("classic");

export const latLon = writable<[number, number] | null>(null);
/**
 * A point on the map the user tapped to ask about, as [lat, lon], or null for
 * "wherever I am". Separate from latLon: that one means the client's own
 * position and owns the blue dot, and a question about somewhere else must not
 * move it. Whatever is set here is what the forecast strip samples.
 */
export const inspectLatLon = writable<[number, number] | null>(null);
/**
 * Bumped on every tap on the map, whichever layer is showing. Separate from
 * inspectLatLon because a tap means "I am asking about the map" to strips that
 * have nothing to do with a point -- the lightning histogram covers the whole
 * viewport -- while only the radar strip wants the coordinate and the marker.
 */
export const mapTapped = writable<number>(0);
/**
 * What the map is currently showing, as [minLon, minLat, maxLon, maxLat], or
 * null before the first render. Published so components can reason about the
 * view without holding a map: whether the radar covers any of it, which area a
 * viewport-wide reading is about.
 */
export const mapExtent4326 = writable<[number, number, number, number] | null>(null);

/** Where the map on screen is looking; see `mapView`. */
export interface MapView {
  lat: number;
  lon: number;
  /** In the flat map's zoom levels, which the 3D map's run one below. */
  zoom: number;
  /** The 3D map's tilt and heading, in degrees; absent on the flat maps. */
  pitch?: number;
  bearing?: number;
}

/**
 * The camera of whichever map is showing, published when it comes to rest.
 *
 * Both kinds of map write it -- LayerManager for the OpenLayers ones, the 3D
 * capability for MapLibre -- so the one reader, the URL (lib/urlState.ts),
 * does not have to know which is on screen or reach into either. Null until
 * the first map has settled.
 */
export const mapView = writable<MapView | null>(null);

/* The shape and the transition rules live in lib/apiHealth.ts, so they can be
   tested without pulling a store or the generated client into the test. */
export const apiHealth = writable<ApiHealth>(EMPTY_HEALTH);

/**
 * Whether the map is in its degraded state, and which criteria put it there.
 *
 * Failed calls are only one of those criteria; what the whole set is lives in
 * lib/degraded.ts, and this store is written from there by lib/degradedStatus.ts
 * on a timer. The timer is the point: every criterion is self-clearing, but
 * only if something keeps asking, and before this the pill re-evaluated when
 * apiHealth happened to change -- so a state nothing was touching any more
 * could sit on the map indefinitely.
 */
export const degradedStatus = writable<DegradedState>(NOT_DEGRADED);

/**
 * The backend's publish rhythm as observed this session, written by
 * RadarCapability from the grid it already has. Read by the diagnostics panel
 * for "next update expected", and by the degraded criteria to tell a late
 * frame from a missing one.
 */
export const radarCadence = writable<Cadence>(EMPTY_CADENCE);

/**
 * Whether the radar frames on screen have been overtaken by the clock.
 *
 * Set the instant the page notices it has come back from not running, before
 * the refetch that fixes it has been answered, and cleared by the grid that
 * lands. Distinct from degradedStatus: that is a claim about the backend, this
 * is one about us. What counts as overtaken is lib/freshness.ts, and the wiring
 * is RadarCapability.
 */
export const radarStale = writable<boolean>(false);
export const zoomlevel = writable<number>(3);

export const lightningLayerVisible = writable<boolean>(true);
export const layerswitcherVisible = writable<"yes" | "no">("yes");
export const toolbarVisible = writable<"yes" | "no">("yes");
export const cycloneLayerVisible = writable<boolean>(true);
/** Whether tracked thunderstorm cells are drawn. */
export const cellLayerVisible = writable<boolean>(true);
/** The cell the detail popup is showing, or null when it is closed. */
export const selectedCell = writable<CellTrackProperties | null>(null);
/**
 * How far the cutaway's slice is turned away from the storm's own track, in
 * degrees clockwise.
 *
 * Relative to the track rather than to north, because the track is what makes
 * a cut meaningful: along it is where an overhang shows, across it is where
 * the storm's width does. Zero is the along-track cut every storm opens with.
 * One value shared by the panel and the 3D map, so turning the slice in one
 * turns it in both -- two views of one storm cut two different ways would be
 * two different claims about it.
 */
export const cutRotationDeg = writable<number>(0);
/**
 * A storm opened for its volume alone, with no KONRAD3D track behind it.
 *
 * Most clouds with a volume are showers KONRAD3D never reports, so there is no
 * history to show and no track for `selectedCell` to hold; this is what they
 * are selected as instead. The two are exclusive -- opening one closes the
 * other -- because there is one cutaway on screen at a time.
 */
export const selectedVolume = writable<RadarVolume | null>(null);

/**
 * Whether the selected cell's detail panel is open, as opposed to only its
 * marks being drawn on the map.
 *
 * The two are one step on a desktop and two on a phone, where the panel covers
 * the storm it describes; lib/cellSelection.ts holds the rules and App.svelte
 * wires them to the map's click handler.
 */
export const cellDetails = writable<boolean>(false);

/**
 * Whether the viewport is phone-sized, at the 620px the stylesheets already
 * use for it.
 *
 * A store rather than a call, because this decides what is rendered and not
 * just how it is painted: a component that read `window.innerWidth` once would
 * keep whatever the page loaded at through a rotation or a resized window.
 * Readable rather than writable so the media query stays the only writer.
 */
export const smallScreen = readable(
  typeof window !== "undefined" && window.matchMedia("(max-width: 620px)").matches,
  (set) => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(max-width: 620px)");
    const update = () => set(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  },
);
export const snowLayerVisible = writable<boolean>(true);
export const logoStyle = writable<string>("full");

export const mapBaseLayer = writable<string>("light");
export const radarColorScheme = writable<string>("classic");

export const showForecastPlaybutton = writable<boolean>(true);
export const satelliteLayer = writable<string>("sentinel2");
export const satelliteLayerCloudy = writable<boolean>(false);
export const satelliteLayerLabels = writable<boolean>(true);

export const live = writable<boolean>(false);

/**
 * A frame the player is asked to open on, from outside it: a link naming one,
 * or Back returning to one. "live" asks it to close and follow the newest
 * frame again. NowcastPlayback takes the request once the grid can answer it,
 * and clears it either way; a frame the grid no longer holds is dropped.
 */
export const frameRequest = writable<number | "live" | null>(null);

/**
 * Whether the player is animating. The URL leaves the frame out while it is,
 * rather than rewriting the address bar twice a second.
 */
export const playbackRunning = writable<boolean>(false);
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
