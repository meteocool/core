import { Map as OlMap } from "ol";
import { toLonLat, fromLonLat } from "ol/proj";
import { circular as circularPolygon } from "ol/geom/Polygon";
import type Point from "ol/geom/Point";
import type BaseLayer from "ol/layer/Base";
import type {
  DataDrivenPropertyValueSpecification, ExpressionSpecification, Map as GlMap, MapGeoJSONFeature,
  StyleSpecification,
} from "maplibre-gl";
import Capability from "./Capability";
import type { UserLocation } from "./Capability";
import type { CapabilityOptions } from "./options";
import { basemapStyle, muteTheme, PLACE_LABELS, placeLabels } from "../layers/maplibreStyle";
import { darkLabels, lightLabels } from "../layers/labels";
import { placeNameKeys } from "../layers/placeName";
import { chooseLocale } from "../locale/choose";
import { locale } from "svelte-i18n";
import { blitzortungAttribution, dwdAttribution } from "../layers/attributions";
import { tileSourceUrl } from "../layers/dwd";
import { drawnTileId } from "../lib/rvp6";
import { NETWORKS } from "../layers/network";
import { SEVERITY_COLOURS } from "../layers/cells";
import { HOLES } from "../layers/networkHoles";
import type { NetworkCode } from "../layers/networkHoles";
import { forgetMaskedTiles, installMaskedProtocol, registerMaskedTiles } from "../layers/maskedTiles";
import { maskPath } from "../layers/tileMask";
import { applyTerrain, VERTICAL_SCALE } from "../layers/terrain";
import type { TileIndex } from "../lib/tileIndex";
import { darkTheme, lightTheme } from "../layers/base";
import { volumeCollection, footprintCollection } from "../lib/cellExtrusions";
import { loadCutaway, VolumeGone } from "../lib/cellCutaway";
import { drawnExtentM, tileBounds, tileCode } from "../lib/volumeBox";
import { atLevel, fineAt } from "../lib/volumeLevels";
import { framingCamera } from "../lib/stormFrame";
import { DIM_UNOPENABLE, isFaint, makeCloudsLayer } from "../layers/cellVolumeLayer";
import type { CloudsLayer } from "../layers/cellVolumeLayer";
import type { Cutaway } from "../lib/cellCutaway";
import { isSuccessor } from "../lib/cloudSuccession";
import { dbzStops, RING_ALPHAS } from "../lib/cellVolume";
import { fetchCellTrack, fetchCurrentCells, fetchCurrentVolumes } from "../api";
import {
  capDescription, cellDetails, cells3dFailed, cells3dLoading, cells3dVisible, colorSchemeDark, cutRotationDeg, cutSweepDeg, mapView, radarColormap,
  selectedCell, selectedVolume, sharedActiveCap, showForecastPlaybutton, smallScreen, terrain3dVisible,
} from "../stores";
import { get } from "svelte/store";
import { nextSelection } from "../lib/cellSelection";
import { moved3D, origin3D } from "../lib/open3d";
import { normaliseCut } from "../lib/cutAngle";
import { startSweep, stopSweep } from "../lib/cutSweep";
import { elementCentre, setElementCentre } from "../lib/viewCentre";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { correctCtrlClicks, reportsCtrlClickAsRight } from "../lib/ctrlDrag";
import { middleDragTurnsAndTilts } from "../lib/middleDrag";
import { tracked } from "../lib/progress";
import { boxFootprint, tileWidthM } from "../lib/cloudFootprint";
import { isPastItsScan, scanTime, VolumeFeed } from "../lib/scans";
import type { Scan } from "../lib/scans";

import { trimToLastRun } from "../lib/cellTrack";
import type {
  CellCurrent, CellTrack, CellTrackProperties, CellVolume, CurrentVolumes, RadarFrame, RadarVolume,
} from "../api";
import type { MapView } from "../stores";
import type VectorSource from "ol/source/Vector";

/**
 * The storms in three dimensions.
 *
 * Every other capability draws a map from above, where a thunderstorm is a
 * coloured blob and its most important property -- whether the intense core is
 * deep or shallow -- is invisible. Radar measures that: for each reflectivity
 * threshold it reports the ground area exceeding it, the height it reaches and
 * the volume it encloses, and `cellVolume` turns those numbers into a solid.
 *
 * OpenLayers cannot extrude, so this one capability renders through MapLibre
 * instead. That makes it the odd one out, and the seams are handled here rather
 * than by loosening LayerManager: it still receives an `ol/Map` like everyone
 * else, still shares the one `View`, and still draws an ordinary 2D preview in
 * the layer switcher. MapLibre takes over only while the capability owns the
 * main map, and hands the camera back on the way out.
 */

/**
 * MapLibre is about a megabyte, and most sessions never open this map.
 *
 * Loading it on first attach rather than at import time keeps that weight off
 * everyone who only ever looks at the flat radar -- it is also precached by the
 * service worker, so a static import would put it in every install.
 */
async function loadMapLibre() {
  const [lib, worker] = await tracked("maplibre-gl", () => Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]));

  /*
   * Tell MapLibre where its worker is.
   *
   * v6 ships ESM only and works the worker's URL out from its own
   * `import.meta.url`, which a bundler rewrites -- leaving it pointing at a
   * path with no worker beside it.
   *
   * `?worker&url` rather than plain `?url`, because the worker file imports
   * MapLibre's 500 KB shared chunk and only the worker form makes Vite bundle
   * that in. Served as a bare module it has to fetch and evaluate that chunk
   * itself, which under Vite means a multi-megabyte transformed module; the
   * worker then misses the first messages MapLibre sends it. The symptom is
   * maddening rather than obvious: it works on one load and on the next the
   * map answers a single message and then sits there, with no error anywhere.
   */
  lib.config.WORKER_URL = worker.default;
  return lib;
}

/**
 * Resolves once the browser has painted whatever is pending.
 *
 * The first frame only schedules the second; the paint happens between them.
 * Used to get the loading veil on screen before MapLibre's parse and shader
 * compile take the main thread, which would otherwise hold the veil back
 * until the work it was meant to cover is half done.
 */
function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * How long the first bring-up may take before the veil comes down regardless.
 *
 * MapLibre's `idle` is the signal; this stands in if it never comes -- a
 * WebGL context that failed, a tile server that answers nothing -- so a
 * map that will never settle is at least a map the reader can see.
 */
const SETTLE_CEILING_MS = 15000;

const CELL_SOURCE = "cells";
/** The raymarched volume, which replaces the selected storm's extruded tiers. */
/** Every storm's raymarched volume, in the one layer that draws them all. */
const VOLUME_LAYER = "cell-volume-raymarched";

/**
 * How many volumes load at once.
 *
 * A dozen of them is several megabytes, and fetched all together they queue
 * behind each other and behind the map's own tiles; a few at a time, each
 * storm appears as its volume arrives instead of all of them at the end.
 */
const VOLUME_FETCHES = 4;

/**
 * How much volume is held at once, in bytes of 3D texture.
 *
 * The list now covers five networks and every tile of sky it rains in, so on
 * a continental afternoon it runs to a hundred; each held one is a 3D texture
 * and a raymarch per frame. So only what is in view, strongest and nearest
 * first, up to this much: the rest stay as the ground outlines, which are
 * already there and tappable, and load when the camera comes to them.
 *
 * Raised from 16 boxes to 24 on 2026-10-01: zoomed out over the Alps, 40
 * storms stood on screen and 16 got clouds. The raymarch is scissored to each
 * box, so a storm drawn small costs little; the cost that grows is the
 * textures. Counted in bytes since the boxes became tiles, each 0.44 of a box:
 * the same 39 MB holds 54 tiles.
 */
const RESIDENT_BYTES = 24 * 160 * 160 * 32 * 2;
/** One tile's texture, apron included, as the worker builds it (`voxels.TILE_VOXELS`, `APRON`). */
const TILE_TEXTURE_BYTES = 106 * 106 * 32 * 2;
/** One core's tile or one coarse tile: half as many voxels across (`voxels.across`). */
const CORE_TEXTURE_BYTES = 54 * 54 * 32 * 2;
/** One box's from before tiles. */
const BOX_TEXTURE_BYTES = 160 * 160 * 32 * 2;
const textureBytes = (volume: RadarVolume) => {
  if (!volume.tile) return BOX_TEXTURE_BYTES;
  // A core's tile and a coarse tile are both half a tile's voxels across.
  return volume.tile[0] === 10 ? TILE_TEXTURE_BYTES : CORE_TEXTURE_BYTES;
};

/**
 * How large a coarse tile has to stand on screen, in CSS pixels across, for
 * the map to draw the tiles in it instead (`lib/volumeLevels.ts`).
 *
 * Measured per coarse tile, so at a tilt the tiles near the camera turn fine
 * while the ones towards the horizon stay coarse, and only the ones close up
 * cost a tile's raymarch and texture. At 384 pixels a coarse voxel, about
 * 1 km, is 7 pixels across, which the soft edges of a cloud still hide;
 * below it the fine tiles' 250 m add little the screen can show. It turns
 * back below 288, so a tile on the line does not flicker between the two
 * while the camera settles.
 */
const FINE_ABOVE_PX = 384;
const COARSE_BELOW_PX = 288;

/** How far past the viewport's edge a storm still counts as in view, as a fraction of the viewport. */
const VIEW_MARGIN = 0.35;

/** A storm not seen well enough to open; see `RadarVolume.tier`. */
const TIER_UNOPENABLE = 1;
const FOOTPRINT_SOURCE = "cell-footprints";
const RADAR_SOURCE = "radar";

/**
 * How strongly the flat reflectivity composite is drawn under the storms.
 *
 * Lower than the 2D map's, and for a reason that only applies here: this view
 * already draws the same storms a second time, as extrusions coloured by the
 * same reflectivity ramp. At the 2D map's opacity the raster reads as a
 * competing copy of them -- same colours, same footprint, no height -- and the
 * volumes it is meant to sit under get lost in it.
 *
 * Kept rather than removed, because it is the only thing on this map showing
 * the rain that is not a detected cell: the broad stratiform shield around a
 * line of storms has no volume drawn for it, and without the raster the map
 * says nothing is there.
 */
const RADAR_OPACITY = 0.35;
const STRIKE_SOURCE = "strikes";

/** One EUMETNET network's draped composite: its source and its layer share the id. */
const networkLayerId = (code: NetworkCode) => `radar-${code}`;

/** Which tier a volume is in: what the list says, else what its own header says, else openable. */
const tierOf = (listed: { tier?: number }, cutaway: Cutaway) => listed.tier ?? cutaway.header.tier ?? 2;

/** Every storm core with a volume: its box's outline, and the box to tap it by. */
const CLOUD_SOURCE = "clouds";

/** The outline of the box a storm's cutaway raymarches, on the ground. */
const CLOUD_BOX = "cloud-box";

/** The inside of a storm's box, undrawn: what a tap opens it by. */
const CLOUD_HIT = "cloud-hit";

/** The layers a tap can land on to mean "that storm". */
const PICKABLE = ["cell-volume-0", "cell-volume-1", "cell-footprint", CLOUD_HIT];

/** The client's own position, and the circle its accuracy gives; see `ensureLocation`. */
const LOCATION_SOURCE = "location";
const LOCATION_ACCURACY = "location-accuracy";
const LOCATION_DOT = "location-dot";

/** Whatever is being raymarched, reduced to what drawing it needs. */
interface VolumeTarget {
  code: string;
  volume: CellVolume;
  lon: number;
  lat: number;
  /** Degrees clockwise from north; null for a storm with no track. */
  heading: number | null;
}

/**
 * How long a strike stays on this map.
 *
 * The flat map's own buffer fades them over thirty minutes. Here they are
 * shown only as a recent-activity halo around the cells that are producing
 * them, and half an hour of accumulation over a squall line is a solid smear
 * -- ten minutes keeps it to what is happening now.
 */
export const STRIKE_MINUTES = 10;

/** A strike's two circles: a soft glow, and a bright core with a rim. The legend draws the same. */
export const STRIKE_COLOURS = { glow: "#ffd166", core: "#fff8e1", rim: "#f7b500" };

/** How strongly a storm core's ring is drawn: fainter under one that does not open, as the storm itself is. */
export const RING_OPACITY = { openable: 0.9, unopenable: 0.45 };

/** How often a burst of strikes is redrawn at most; see `scheduleStrikes`. */
const STRIKE_REDRAW_MS = 1000;

/** The id of the one full-size map element; minimaps carry generated ids. */
const MAIN_MAP_ID = "map";

/** Opening tilted is the whole point; flat, this is just a slower 2D map. */
const INITIAL_PITCH = 55;

/**
 * The tilt an opened storm is looked at from: low, so the cut
 * stands up in front of the reader, short of the horizon filling the screen.
 */
const OPEN_PITCH = 76;

/** How far from the opening tilt the map can be at closing and still count as not re-tilted. */
const PITCH_KEPT_DEG = 4;

/**
 * How far the camera can be from where an opened storm framed it, at
 * closing, and still count as not moved: a nudge, not a view of the reader's
 * own. The shift is of the centre on screen, as a share of the shorter side.
 */
const CAMERA_KEPT = { zoom: 0.5, bearingDeg: 10, pitchDeg: PITCH_KEPT_DEG, shift: 0.1 };

/** A camera, as far as going back to one goes. */
interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/**
 * The steepest the map tilts: a view from low over the ground, just short of
 * where MapLibre loses track of what it is looking at.
 *
 * When a drag or an ease ends over terrain, MapLibre finds the centre again
 * where the line of sight meets the ground. Steeper than acos(0.1), about
 * 84.26 degrees, it gives that up and puts the centre 10 km in front of the
 * camera instead -- which, from the camera's height at a regional zoom, is
 * hundreds of kilometres back from where the reader was looking. A tilt into
 * the old limit of 85 flung the map from Bavaria to the Atlantic and to a
 * street-level zoom.
 */
const MAX_PITCH = 84;

/**
 * The furthest the map zooms out, in MapLibre's levels: at the opening tilt,
 * about half the world across a 1440px window, and Europe across a phone.
 *
 * Tighter than the flat map's 3 (2 here), because a tilted camera sees out to
 * the horizon: at 2, the far edge of a desktop's screen spanned the whole
 * world, the storms were a speck in the middle of it, and there was nothing
 * to find the way back by. Still past where the radar's own tiles start, 3,
 * so the map has radar under its centre however far out it is.
 */
const MIN_ZOOM = 3.5;
/**
 * How long the camera takes to right itself on the way back to a flat map;
 * see `leave`. Longer than the tilt's own 700ms: this one also pulls back
 * and re-centres, and it is the whole handover, not a nudge.
 */
const LEAVE_MS = 1100;

/** The map controls and the logo along the top, which the storm stays below. */
const OPEN_TOP_PX = 64;

/** The share of the screen the phone's detail sheet covers at rest. */
const OPEN_SHEET_FRACTION = 0.32;

/**
 * The desktop's storm panel, anchored top right: at most this wide, 12px in
 * from the edge, and kept clear of by as much again. See `.cell-details-panel`
 * in App.svelte.
 */
const OPEN_PANEL_PX = 392;
const OPEN_PANEL_MARGIN_PX = 12;

/** The tray along a desktop's bottom edge, which the storm stays above. */
const OPEN_TRAY_PX = 88;

/** How long a camera set by a link or a history step is kept over a storm opened after it. */
const CAMERA_KEPT_MS = 3000;

/** Where a link asks the camera to be, in the flat map's zoom levels like `mapView`. */
export interface CameraRequest {
  lat?: number;
  lon?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
}

/**
 * Severity class to colour.
 *
 * A `match` rather than indexing into a literal array with `at`: MapLibre types
 * `at` as returning the array's element type, so a colour looked up that way
 * fails paint-property validation -- and validation drops the whole layer
 * without throwing, which is a footprint that silently never draws. The
 * built-at-runtime shape cannot be checked against the spec's fixed-arity
 * tuple, hence the assertion.
 */
function severityColour(): DataDrivenPropertyValueSpecification<string> {
  return [
    "match",
    ["get", "severity"],
    ...SEVERITY_COLOURS.flatMap((colour, severity) => [severity, colour]),
    SEVERITY_COLOURS[SEVERITY_COLOURS.length - 1],
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

/**
 * The radar map's palette as a MapLibre expression.
 *
 * Built at runtime from the palette the flat map is drawn in, so the 3D map,
 * the popup's model and the radar underneath agree on what 55 dBZ looks like.
 * The assertion is the same story as `severityColour`: a run-length shape
 * cannot be checked against the spec's fixed-arity tuple.
 */
function dbzRamp(colormap: string): DataDrivenPropertyValueSpecification<string> {
  return [
    "interpolate", ["linear"], ["get", "dbz"],
    ...dbzStops(colormap).flatMap(([dbz, colour]) => [dbz, colour]),
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

/**
 * A storm's box outline, in the palette by its peak. In colour whatever scan
 * it is from: a storm a scan behind the radar under it is still the newest
 * picture of that storm there is, and greying it read as if it were gone.
 */
function boxColour(colormap: string): DataDrivenPropertyValueSpecification<string> {
  return dbzRamp(colormap);
}

/** Between a run's volumes being announced and asking for them, so a run's parts are fetched together. */
const VOLUMES_SETTLE_MS = 1500;

export default class Cells3DCapability extends Capability {
  private gl: GlMap | null = null;

  /** The element MapLibre draws into, parented to whatever target is active. */
  private container: HTMLDivElement | null = null;

  private cells: CellCurrent[] = [];

  /**
   * Whether the KONRAD3D cells are drawn at all; see `cells3dVisible`. Off,
   * they are not even fetched, and the volumes are the only storms here.
   */
  private cellsWanted = get(cells3dVisible);

  private unsubscribeCellsWanted: (() => void) | null = null;

  /** Whether the map stands on the ground's relief; see `terrain3dVisible`. */
  private terrainWanted = get(terrain3dVisible);

  private unsubscribeTerrain: (() => void) | null = null;

  /** The scan the cells were found in; null before the first run, and while they are off. */
  private cellsScan: Scan | null = null;

  /** The newest cells request, so a slower earlier answer cannot win. */
  private cellsToken: symbol | null = null;

  /** Every storm core with a volume in the newest scan, KONRAD3D cell or not. */
  private clouds: RadarVolume[] = [];

  /** A refetch of the volumes, waiting for the rest of a run's parts; see `newVolumes`. */
  private volumesTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The storm cores, waited for until they reach the newest scan on the map.
   *
   * Asked for when a KONRAD3D run lands, which live is half a minute before
   * that scan's volumes exist; fetched only then, every storm stood a scan
   * upwind of the radar under it until the next run. Waits only while shown.
   */
  private readonly volumes = new VolumeFeed<CurrentVolumes>(
    () => fetchCurrentVolumes(undefined, { coarse: true }).catch(() => null),
    (answer) => this.takeClouds(answer),
  );

  /** The radar frame to drape, as a tile URL template. Set by the caller. */
  private radarUrl: string | null = null;

  /** Which tiles that frame has, so the ones it lacks are never asked for; see lib/tileIndex.ts. */
  private radarIndex: TileIndex | null | undefined = undefined;

  /** The `masked://` registration of that frame; see `ensureRadar`. */
  private radarMask: { url: string; palette: string; key: string; tiles: string } | null = null;

  /** The scan of that frame; see lib/scans.ts. */
  private radarScan: Scan | null = null;

  /** Each network's newest composite, as the flat map's live step draws it. Set by the caller. */
  private networkFrames: Partial<Record<NetworkCode, RadarFrame>> = {};

  /** Each network's `masked://` registration, by the frame it was made for. */
  private networkMasks: Partial<Record<NetworkCode, { tileId: string; palette: string; key: string; tiles: string }>> = {};

  /**
   * The flat map's strike buffer, read rather than duplicated.
   *
   * The strikes arrive over one socket and one ring buffer already holds them,
   * evicts them and fades them; a second copy here would be a second thing to
   * keep in step for no gain. The coordinates in it are EPSG:3857 metres --
   * the `lightning` event documents them that way and `StrikeManager` stores
   * them untouched -- so they are projected back on the way out.
   */
  private strikes: VectorSource | null = null;

  /** Where the client is, as LayerManager last reported it; see `showLocation`. */
  private location: UserLocation | null = null;

  /** The properties place names are read from, in the reader's language first. */
  private nameKeys = placeNameKeys(chooseLocale());

  /** The newest select in flight, so a slower earlier answer cannot win. */
  private picking: symbol | null = null;


  private dark = false;

  /** Guards the two-way camera sync against echoing a move back and forth. */
  private syncing = false;

  /**
   * Whether the style will accept sources and layers.
   *
   * Deliberately not `isStyleLoaded()`, which also reports false while any
   * source still has tiles in flight -- over a slow connection that is never,
   * and gating on it left the map showing a basemap and no storms.
   */
  private styleReady = false;

  private unsubscribeTheme: (() => void) | null = null;

  private unsubscribeSelection: (() => void) | null = null;

  /** Every storm's volume, drawn at once; see `cellVolumeLayer.ts`. */
  private cloudsLayer: CloudsLayer | null = null;

  /**
   * The volumes that have loaded, by object path, and where each one stands.
   *
   * Kept across refreshes: a volume is immutable once built, so a storm still
   * in the next scan's list is the same object, and fetching it again would
   * be several hundred kilobytes for nothing.
   */
  private cutaways = new Map<string, {
    code: string; cutaway: Cutaway; lon: number; lat: number; tier: number;
    /** The storm it is a tile of; see `RadarVolume.system`. */
    system: string | null;
  }>();

  /**
   * Listed storms whose volume loaded too faint to draw; see `isFaint`.
   *
   * Neither drawn nor ringed, and not held: a volume is immutable, so one
   * found faint stays faint, and remembering it by path keeps it from being
   * fetched again and from taking a place another storm in view could have.
   * Opened anyway -- a KONRAD3D cell tapped inside one, a link to one -- it is
   * drawn, because then a reader asked for exactly that storm.
   */
  private faint = new Set<string>();

  /** The coarse tiles, by code, that stand large enough on screen to be drawn as their tiles; see `updateDetail`. */
  private fineTiles = new Set<string>();


  /** Which storm is open, by its volume's path, and which way its slice runs before the reader turns it. */
  private opened: { path: string; heading: number | null } | null = null;

  /** The newest load, so a slow one finishing late cannot undo a newer list. */
  private loadToken: symbol | null = null;

  /** When a link or a history step last pointed the camera; see `frameOpened`. */
  private cameraSetAt = -Infinity;

  /**
   * The camera the reader had before an opened storm was framed, to go back
   * to on closing; null when no storm has moved it. The first one's, across a
   * walk from storm to storm: the reader's own view is the one before any of
   * them.
   */
  private cameraBeforeOpen: Camera | null = null;

  /** Where the latest framing left the camera, which a reader's own move is told from; see `restoreCamera`. */
  private framedCamera: Camera | null = null;

  /** Whether another storm was opened after the first, so closing is no longer one step back. */
  private walked = false;

  /** Stops waiting for the latest framing to land; see `frameOpened`. */
  private unwatchFraming: (() => void) | null = null;

  /** The newest open, so a volume still loading cannot reopen over a newer choice. */
  private openToken: symbol | null = null;

  private unsubscribeVolume: (() => void) | null = null;

  private unsubscribeCut: (() => void) | null = null;

  private unsubscribeColormap: (() => void) | null = null;

  private unsubscribeSweep: (() => void) | null = null;

  private unsubscribeLocale: (() => void) | null = null;

  /** The radar palette the settings name, which every storm here is painted in. */
  private colormap = get(radarColormap);

  /** MapLibre, once it has loaded; the volume layer needs its Mercator maths. */
  private maplibre: Awaited<ReturnType<typeof loadMapLibre>> | null = null;

  /**
   * A camera asked for before there was a map to point: a link that opens on
   * this capability arrives before MapLibre has even been fetched. The map is
   * built with it and it is forgotten.
   */
  private requestedCamera: CameraRequest | null = null;

  /** The first answer for the list of storms, which a linked cloud waits on. */
  private firstRefresh: Promise<void> | null = null;

  /** The element the map was last attached to, for `retry`. */
  private host: HTMLElement | null = null;

  /**
   * Sources a tile of which failed to load, to be asked again by `resync`.
   *
   * MapLibre never retries a tile on its own: one that failed while the
   * network was down stays a hole in the basemap or the radar until the
   * camera leaves it.
   */
  private failedSources = new Set<string>();

  /**
   * Resolves once the map has drawn its first settled frame: style parsed,
   * shaders built, the tiles on screen loaded. Already resolved before the
   * map exists, so anything awaiting it on a later open goes straight on.
   *
   * Framing an opened storm waits on it (see `open`): the camera ease is 900ms
   * of motion, and started while MapLibre is still compiling and the volume
   * is still uploading it stutters through most of them. After the first
   * settled frame the same ease is smooth, and it is what the reader sees as
   * the veil lifts.
   */
  private settled: Promise<void> = Promise.resolve();

  /**
   * Whether this map owns the main map element right now.
   *
   * The MapLibre map is kept when another capability takes over, so coming
   * back is instant -- but kept alive, it went on doing everything a shown map
   * does: every new radar frame reloaded its tiles, every new run re-fetched
   * the cells and several megabytes of volumes, and every strike rebuilt the
   * strike source and raymarched every storm again, all into a canvas nobody
   * could see. On a stormy day that is a browser pegged on a map that is not
   * on screen. While hidden, all of it waits, and `attach` catches up.
   */
  private shown = false;

  /** A light/dark switch that arrived while hidden, applied on the way back. */
  private styleStale = false;

  /** The pending strike update, if one is waiting; see `scheduleStrikes`. */
  private strikeTimer: ReturnType<typeof setTimeout> | null = null;


  /** Takes back the ⌃-click correction, where one was needed; see lib/ctrlDrag.ts. */
  private uncorrectCtrlClicks: (() => void) | null = null;
  /** Takes back the middle drag's turning and tilting; see lib/middleDrag.ts. */
  private unmiddleDrag: (() => void) | null = null;

  constructor(map: OlMap, additionalLayers: BaseLayer[], options: CapabilityOptions) {
    super(map, "cells3d", () => Cells3DCapability.announce(), additionalLayers);

    this.nanobar = options.nanobar;
    // A cell tapped on the flat map is not opened here until this map is
    // shown: opening fetches its volume, and `attach` opens whatever is
    // selected by then.
    this.unsubscribeSelection = selectedCell.subscribe((track) => {
      if (!this.shown) return;
      if (track) void this.open(this.targetOfTrack(track));
      else if (!get(selectedVolume)) void this.open(null);
    });
    this.unsubscribeVolume = selectedVolume.subscribe((cloud) => {
      if (!this.shown) return;
      if (cloud) void this.open(this.targetOfCloud(cloud));
      else if (!get(selectedCell)) void this.open(null);
    });
    // Turning the slice in the popup turns it here. Only a uniform changes, so
    // this is a repaint and nothing is rebuilt.
    this.unsubscribeCut = cutRotationDeg.subscribe(() => this.applyCut());
    this.unsubscribeSweep = cutSweepDeg.subscribe(() => this.applyCut());
    this.unsubscribeColormap = radarColormap.subscribe((name) => this.applyColormap(name));
    this.unsubscribeCellsWanted = cells3dVisible.subscribe((wanted) => this.applyCellsWanted(wanted));
    this.unsubscribeTerrain = terrain3dVisible.subscribe((wanted) => {
      this.terrainWanted = wanted;
      // Before the style is up, `applyData` adds it once it is.
      if (this.gl && this.styleReady) applyTerrain(this.gl, wanted, this.dark);
    });
    // An app tells the page its language after the map is up.
    this.unsubscribeLocale = locale.subscribe((tag) => {
      if (!tag) return;
      this.nameKeys = placeNameKeys(tag);
      if (this.gl && this.styleReady) this.ensureLabels(this.gl);
    });
    this.unsubscribeTheme = colorSchemeDark.subscribe((value) => {
      this.dark = Boolean(value);
      if (!this.gl) return;
      if (!this.shown) {
        this.styleStale = true;
        return;
      }
      this.restyle();
    });
  }

  private nanobar: CapabilityOptions["nanobar"];

  /** What every attach of this capability tells the rest of the UI. */
  private static announce(): void {
    capDescription.set("Storm cells in 3D");
    // The playback strip drives the 2D radar's frame grid; this map shows one
    // timestep and has nothing for it to scrub.
    showForecastPlaybutton.set(false);
  }

  private style(): StyleSpecification {
    return basemapStyle(muteTheme(this.dark ? darkTheme : lightTheme));
  }

  private restyle(): void {
    if (!this.gl) return;
    this.styleStale = false;
    // setStyle discards every source and layer added on top of it; the
    // `style.load` handler in `attach` puts them back.
    this.styleReady = false;
    this.gl.setStyle(this.style());
  }

  /**
   * Attach or detach.
   *
   * On the main map MapLibre takes the element; anywhere else -- the layer
   * switcher's previews -- the ordinary OpenLayers map draws, which is both
   * cheaper and a truthful thumbnail of where the storms are.
   */
  setTarget(target: string | HTMLElement | undefined): void {
    const element = typeof target === "string" ? document.getElementById(target) : target;
    const isMain = Boolean(element && element.id === MAIN_MAP_ID);

    if (!isMain) {
      this.shown = false;
      this.detach();
      super.setTarget(target);
      return;
    }

    // Deliberately not `super.setTarget(target)`: the base class would point
    // the OpenLayers map at this same element, leaving two maps stacked in one
    // container with OL painting over the WebGL canvas. Only the announcement
    // side of it is wanted here.
    this.map.setTarget(undefined);
    Cells3DCapability.announce();
    this.shown = true;
    void this.attach(element as HTMLElement);
  }

  /*
   * No `setPreviewTarget` override: the base class points only the OpenLayers
   * map at the switcher's tile, which is what this one wants too -- cheaper
   * than a second WebGL context, a truthful picture of where the storms are,
   * and it leaves the MapLibre canvas alone. The tiles are live while the
   * switcher is open, and if this capability is the one currently showing,
   * its map is still underneath and has to be there when the switcher closes
   * again. Only `willLoseFocus` detaches.
   */

  private async attach(host: HTMLElement): Promise<void> {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "maplibre-host";
      /*
       * Positioned inline, not from the stylesheet.
       *
       * MapLibre puts `maplibregl-map` on whatever element it is given, and
       * its own CSS declares that class `position: relative` -- same
       * specificity as the app's `.maplibre-host` rule and loaded after it,
       * so it wins. In flow rather than layered, the canvas took its own
       * 100%-height box *below* the OpenLayers viewport already sitting in
       * `#map`, which reads as the 3D map simply not being there: the flat
       * map is on screen and the storms are a screen further down the page.
       * An inline style outranks both stylesheets and settles it.
       */
      Object.assign(this.container.style, {
        position: "absolute", inset: "0", width: "100%", height: "100%",
      });
    }
    /*
     * Appended every time, not only when it is somewhere else.
     *
     * Capabilities do not take `#map` from each other -- OpenLayers appends
     * its viewport to the target and leaves any earlier one in place -- so
     * which map is visible comes down to which element is last in the DOM.
     * Coming back to this capability, the flat map's viewport had been
     * appended after this container, so the 3D map was being drawn correctly
     * underneath an opaque OpenLayers canvas. `appendChild` on a node that is
     * already a child moves it to the end, which is exactly what is wanted.
     */
    host.appendChild(this.container);
    this.host = host;

    let built = false;
    if (!this.gl) {
      // The veil first, and on screen, before the megabyte of library is
      // parsed and the map built: both take the main thread, and a veil
      // asked for in the same frame appeared only once they were done.
      cells3dFailed.set(false);
      cells3dLoading.set(true);
      await painted();
      let maplibre: Awaited<ReturnType<typeof loadMapLibre>>;
      try {
        maplibre = await loadMapLibre();
      } catch (error) {
        /* MapLibre is not precached, so a first open on a network that is
           down lands here, and so does a tab that outlived the deploy whose
           chunks it asks for. Uncaught, this left the veil spinning over an
           empty map for good; it now says so and offers `retry`, which a
           wake also tries. */
        console.warn(error);
        if (this.gl) return;
        cells3dLoading.set(false);
        if (this.shown) cells3dFailed.set(true);
        return;
      }
      // Another attach may have won the race while the library was loading.
      if (this.gl) return;
      this.maplibre = maplibre;
      // The radar rasters' tiles come through `masked://`; see `ensureRadar`.
      installMaskedProtocol(maplibre);
      built = true;
      let settle!: () => void;
      this.settled = new Promise((resolve) => { settle = resolve; });
      setTimeout(settle, SETTLE_CEILING_MS);
      const view = this.map.getView();
      const centre = elementCentre(view);
      const [lon, lat] = centre ? toLonLat(centre) : [10, 51];
      const asked = this.requestedCamera ?? {};
      this.requestedCamera = null;

      let gl: GlMap;
      try {
        gl = new maplibre.Map({
          container: this.container,
          style: this.style(),
          center: [asked.lon ?? lon, asked.lat ?? lat],
          zoom: (asked.zoom ?? view.getZoom() ?? 6) - 1,
          pitch: asked.pitch ?? INITIAL_PITCH,
          bearing: asked.bearing ?? 0,
          minZoom: MIN_ZOOM,
          maxZoom: 13,
          // MapLibre stops at 60 unless told otherwise, which is a view from a
          // hilltop; an opened storm is looked at from lower -- see frameOpened.
          maxPitch: MAX_PITCH,
          // Spelled out rather than behind an (i), like the flat map's; see the
          // attribution rules in glass.css.
          attributionControl: { compact: false },
        });
      } catch (error) {
        // No WebGL, most likely. The veil has nothing to wait for.
        settle();
        cells3dLoading.set(false);
        throw error;
      }
      /*
       * Two controls where one would do, so they can be drawn as the flat
       * map's are: a zoom capsule, and below it a disc -- there the locate
       * button, here the compass, which also shows the tilt and resets both.
       * Under the layer-switcher disc, in glass; see glass.css and Map.svelte.
       *
       * Not in the apps, which draw their own controls over the webview. The
       * flat map leaves its zoom and locate out there for the same reason, and
       * a column of web buttons would land under the native ones.
       */
      if (!dd.isApp()) {
        gl.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        gl.addControl(new maplibre.NavigationControl({ showZoom: false, visualizePitch: true }), "top-right");
      }
      // ⌃-drag turns and tilts in a Mac's Firefox as well; see lib/ctrlDrag.ts.
      if (reportsCtrlClickAsRight(navigator.userAgent, dd.isMac())) {
        this.uncorrectCtrlClicks = correctCtrlClicks(this.container);
      }
      // A middle drag turns and tilts, as in SketchUp; see lib/middleDrag.ts.
      // On the canvas only: a middle click on an attribution link opens a tab.
      this.unmiddleDrag?.();
      this.unmiddleDrag = middleDragTurnsAndTilts(gl.getCanvasContainer());
      // Fires on the first style and again after every `setStyle`, which is
      // what a light/dark switch does -- and that discards everything added on
      // top of it, so this is also how the storms get put back.
      let firstStyle = true;
      gl.on("style.load", () => {
        this.styleReady = true;
        if (firstStyle) {
          firstStyle = false;
          // `idle`: everything on screen rendered and nothing left in flight,
          // which the first time round means the basemap, the draped radar
          // and the storms `applyData` is about to add.
          gl.once("idle", settle);
        }
        // `setStyle` throws the volumes away with every other layer. The
        // loaded fields are kept, so `applyData` puts the same storms back
        // without fetching them again, and the open one is cut again.
        // Except when it diffs the two styles, which is how a light/dark
        // switch goes: a custom layer is not in the diff, so it stays, and
        // adding it again failed -- leaving the volumes on screen frozen,
        // with every later update going to a layer that was never added.
        // Taken off here, so it goes back above the layers added before it.
        if (gl.getLayer(VOLUME_LAYER)) gl.removeLayer(VOLUME_LAYER);
        this.cloudsLayer = null;
        this.applyData();
        this.applyCut();
      });
      // Keep the shared View in step so switching back to the flat map lands
      // where this one was left, and so anything reading the viewport agrees.
      // The tilt and heading only this map has go out with it, for the URL.
      // A camera move the reader made -- drag, wheel, pinch, tilt, turn, the
      // zoom buttons -- carries the DOM event that caused it; one from code
      // (a storm being framed, the camera settling back) does not. Only the
      // reader's own change where the way back to the flat map lands; see
      // open3d.ts.
      gl.on("movestart", (event) => {
        if (event.originalEvent) moved3D();
      });
      gl.on("moveend", () => {
        this.pushCameraToView();
        if (get(sharedActiveCap) === this.getName()) mapView.set(this.currentView());
        // Some places crossed the line between coarse tiles and fine: other outlines.
        if (this.updateDetail() && this.styleReady) this.ensureClouds(gl);
        // The camera has come to other storms: load theirs, let go of the far ones.
        void this.loadClouds();
      });
      // Tapping a storm opens the same popup the flat map opens, and tapping
      // past one closes it -- the panel is rendered above whichever map is
      // showing, so it needs no separate plumbing here.
      gl.on("click", (event) => {
        const hits = gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) });
        // A KONRAD3D cell first, when both are under the finger: it has a
        // history and a heading, and the popup it opens carries the cutaway
        // anyway if the cell stands inside a volume.
        const cell = hits.find((feature) => feature.layer.id !== CLOUD_HIT && feature.properties?.code);
        // Of overlapping boxes, the storm whose spin axis is nearest the finger.
        const distance = ({ properties }: MapGeoJSONFeature) => {
          const { x, y } = gl.project([properties.pivotLon, properties.pivotLat]);
          return Math.hypot(x - event.point.x, y - event.point.y);
        };
        const cloud = hits
          .filter((feature) => feature.layer.id === CLOUD_HIT)
          .reduce<MapGeoJSONFeature | undefined>((best, feature) => (
            best && distance(best) <= distance(feature) ? best : feature
          ), undefined);
        if (cell?.properties?.code) {
          selectedVolume.set(null);
          // The same two steps the flat map takes -- panel at once on a
          // desktop, forecast first on a phone. Setting the cell alone left a
          // desktop with nothing on screen but the cut: the panel is drawn only
          // for a selection whose details are open.
          const code = String(cell.properties.code);
          const next = nextSelection(
            { code: get(selectedCell)?.code ?? null, details: get(cellDetails) },
            code,
            get(smallScreen),
          );
          void this.select(code, next.details);
        } else {
          // A cell's track still in flight must not land over this: it would
          // open that cell on top of the storm core, or of nothing, after the
          // reader had moved on from it.
          this.picking = null;
          selectedCell.set(null);
          // By path: a code is a grid position, unique only within one
          // network's scan, and the list holds five networks' scans.
          const listed = cloud?.properties?.path
            ? this.clouds.find((c) => c.path === cloud.properties.path) ?? null
            : null;
          // A coarse tile opens the tile under the finger: 1 km voxels are a
          // picture of where it rains, not one to cut a storm open by.
          selectedVolume.set(listed?.coarse ? fineAt(this.clouds, event.lngLat.lng, event.lngLat.lat) : listed);
        }
      });
      /* A tile that failed is noted for `resync` to ask for again. Listening
         at all also stops MapLibre's own console.error for each one, which
         went to Sentry as a fault of ours for every tile a phone lost. */
      gl.on("error", (event) => {
        // A source's errors carry which source and tile; MapLibre's typing
        // knows only the error.
        const { sourceId, tile } = event as typeof event & { sourceId?: string; tile?: unknown };
        if (sourceId && tile) {
          this.failedSources.add(sourceId);
          console.warn(`3D map: a ${sourceId} tile failed`, event.error);
          return;
        }
        console.error(event.error);
      });
      gl.on("mousemove", (event) => {
        const over = gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) }).length > 0;
        gl.getCanvas().style.cursor = over ? "pointer" : "";
      });
      this.gl = gl;
      // Built after the switch that asked for it, so LayerManager had no
      // camera to publish then; and MapLibre does not report its first one.
      if (get(sharedActiveCap) === this.getName()) mapView.set(this.currentView());
    } else {
      // A map that exists is a map that has been brought up: no veil, whatever
      // was left set by a bring-up the reader switched away from.
      cells3dLoading.set(false);
      this.pullCameraFromView();
      this.gl.resize();
      // Catch up on what was held back while hidden: the theme, then the
      // newest radar frame and strikes, which need no fetch of their own.
      if (this.styleStale) this.restyle();
      else this.applyData();
      this.applyCut();
    }

    // Switched away again while MapLibre was loading.
    if (!this.shown) {
      if (built) cells3dLoading.set(false);
      return;
    }

    // Whatever the reader picked on the flat map meanwhile.
    const track = get(selectedCell);
    const cloud = get(selectedVolume);
    const opening = this.open(track ? this.targetOfTrack(track) : cloud ? this.targetOfCloud(cloud) : null);
    void this.refresh();
    // The veil lifts on the first settled frame -- and not before the storm
    // the reader came for has its volume loaded and uploaded, which is the
    // other stall of a first bring-up; `open` has framed it by then, so the
    // map comes into view already easing onto the storm.
    if (built) void Promise.all([this.settled, opening]).finally(() => cells3dLoading.set(false));
  }

  /**
   * The cell layers that are actually on the style right now.
   *
   * `queryRenderedFeatures` throws on a layer id it does not know, and these
   * are added after the style loads and thrown away again by every light/dark
   * switch -- so a tap landing in the gap would take the map down with it.
   */
  private pickable(gl: GlMap): string[] {
    return PICKABLE.filter((id) => gl.getLayer(id));
  }

  /**
   * Hand the map back.
   *
   * MapLibre's canvas lives in a div appended to `#map`, not in the element
   * itself, so nothing about pointing the next capability at `#map` removes
   * it: OpenLayers drew underneath while the 3D map stayed on top, absolutely
   * positioned over the lot. Picking any other tile in the switcher looked
   * exactly like being bounced straight back to this one.
   *
   * The camera goes back to the shared View on the way out, so the flat map
   * opens where this one was left.
   */
  willLoseFocus(): void {
    this.pushCameraToView();
    this.shown = false;
    cells3dFailed.set(false);
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    // `attach` refreshes, and waits again from there.
    this.volumes.stop();
    if (this.volumesTimer !== null) clearTimeout(this.volumesTimer);
    this.volumesTimer = null;
    this.detach();
    super.willLoseFocus();
  }

  /**
   * Back to the view the reader had, once the storm that moved the camera
   * closes.
   *
   * Opening a storm flies in close, low and square to its cut. Closing the
   * one storm that was opened, with the camera still where that left it, is
   * a step back out: position, zoom, heading and tilt all go back to the
   * reader's own. Otherwise the reader has made the view theirs -- moved it,
   * or walked on to another storm -- and only the tilt goes back, and only if
   * it is still the one the opening set: looking at a cut from low down is
   * right while it is open and wrong for a map, where the far half of the
   * screen is horizon.
   */
  private restoreCamera(): void {
    const gl = this.gl;
    const before = this.cameraBeforeOpen;
    const framed = this.framedCamera;
    const walked = this.walked;
    this.forgetCameraBeforeOpen();
    if (!gl || before === null) return;
    // On the way back to the flat map, `leave` owns the camera: two eases at
    // once, and the later one wins.
    if (origin3D()) return;
    if (!walked && framed && this.stillAt(gl, framed)) {
      gl.easeTo({ ...before, duration: 900 });
      return;
    }
    if (Math.abs(gl.getPitch() - OPEN_PITCH) > PITCH_KEPT_DEG) return;
    // A 3D map that had no tilt of its own to go back to: a flat 3D map is
    // the one view that shows none of what it is for, so it settles to the
    // tilt it opens at instead.
    gl.easeTo({ pitch: before.pitch < 1 ? INITIAL_PITCH : before.pitch, duration: 700 });
  }

  private forgetCameraBeforeOpen(): void {
    this.unwatchFraming?.();
    this.unwatchFraming = null;
    this.cameraBeforeOpen = null;
    this.framedCamera = null;
    this.walked = false;
  }

  private cameraOf(gl: GlMap): Camera {
    const { lng, lat } = gl.getCenter();
    return { center: [lng, lat], zoom: gl.getZoom(), pitch: gl.getPitch(), bearing: gl.getBearing() };
  }

  /** Whether the camera is still about where `camera` had it; see `CAMERA_KEPT`. */
  private stillAt(gl: GlMap, camera: Camera): boolean {
    const turned = Math.abs(((gl.getBearing() - camera.bearing + 540) % 360) - 180);
    const { clientWidth: width, clientHeight: height } = gl.getContainer();
    const { x, y } = gl.project(camera.center);
    const shift = Math.hypot(x - width / 2, y - height / 2) / Math.min(width, height);
    return Math.abs(gl.getZoom() - camera.zoom) <= CAMERA_KEPT.zoom
      && turned <= CAMERA_KEPT.bearingDeg
      && Math.abs(gl.getPitch() - camera.pitch) <= CAMERA_KEPT.pitchDeg
      && shift <= CAMERA_KEPT.shift;
  }

  /**
   * Settle the camera onto a flat map's view, and say when it has.
   *
   * The way out of a detour (lib/open3d.ts): the storm the reader came to see
   * has closed, and the flat map they left is about to take the element. Cut
   * straight to it and the picture snaps from a low, tilted look at one storm
   * to a map of the whole sky. So the camera first eases up and back -- nadir,
   * north up, the centre and zoom the flat map was left at -- and the switch
   * happens once it has landed, on a view the flat map draws identically.
   * The sweep stops on the way, or the slice would go on turning under a
   * camera that is leaving it.
   *
   * With no view to go back to it still rights itself and pulls back a level,
   * which is the same motion without the destination. Resolves at once when
   * the map is not showing.
   */
  leave(view: MapView | null): Promise<void> {
    const gl = this.gl;
    if (!gl || !this.shown) return Promise.resolve();
    stopSweep(false);
    this.forgetCameraBeforeOpen();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        gl.off("moveend", done);
        resolve();
      };
      gl.once("moveend", done);
      // A ceiling rather than the way it usually ends: the ease's own moveend
      // is the signal, and this only stands in if it never comes.
      setTimeout(done, LEAVE_MS + 500);
      gl.easeTo({
        pitch: 0,
        bearing: 0,
        ...(view
          ? { center: [view.lon, view.lat] as [number, number], zoom: view.zoom - 1 }
          : { zoom: gl.getZoom() - 1 }),
        duration: LEAVE_MS,
      });
    });
  }

  /** Bring the map up again after MapLibre failed to load; see `cells3dFailed`. */
  retry(): void {
    if (!this.shown || this.gl || !this.host) return;
    void this.attach(this.host);
  }

  /**
   * Catch up after the page or the network has been away (lib/wakeup.ts).
   *
   * The socket's `cells` and `volumes` events are what keep this map current,
   * and a socket that was down missed them; the tiles that failed meanwhile
   * are holes until they are asked for again. A bring-up that failed is
   * tried again, since the network may well be back.
   */
  resync(): void {
    if (!this.shown) return;
    if (!this.gl) {
      if (get(cells3dFailed)) this.retry();
      return;
    }
    void this.refresh();
    const gl = this.gl;
    for (const id of this.failedSources) {
      if (gl.getSource(id)) gl.refreshTiles(id);
    }
    this.failedSources.clear();
    // The storm the reader opened, if its volume failed to come down then:
    // the panel retries its own copy, and the cut here would stay unmade.
    const track = get(selectedCell);
    const cloud = get(selectedVolume);
    const target = track ? this.targetOfTrack(track) : cloud ? this.targetOfCloud(cloud) : null;
    if (target && this.opened?.path !== target.volume.path) void this.open(target);
  }

  private detach(): void {
    stopSweep(true);
    if (this.container?.parentElement) this.container.parentElement.removeChild(this.container);
  }

  /**
   * Open the detail popup for a tapped storm.
   *
   * This map is drawn from `/cells/current`, which is one timestep: it knows
   * a cell's structure but not its history, and the popup is mostly history.
   * So the tap fetches the track the flat map would already have had, and
   * trims it the same way -- otherwise the same mis-stitched track that the
   * flat map now refuses to draw a line for would still report its borrowed
   * age and peak here.
   */
  /**
   * Which tiers a storm still draws as extrusions.
   *
   * Every cell but those standing inside a drawn volume. The volume is the
   * same weather measured another way, and `fill-extrusion` writes depth even
   * when it is translucent -- so a cell left extruded inside one punches its
   * tier boundaries straight through the cloud around it.
   */
  private tierFilter(tier: number): ExpressionSpecification {
    const mine: ExpressionSpecification = ["==", ["get", "tier"], tier];
    const hidden = this.hiddenCodes();
    if (!hidden.length) return mine;
    return ["all", mine, ["!", ["in", ["get", "code"], ["literal", hidden]]]];
  }

  /** Every cell whose centroid falls inside any volume currently loaded. */
  private hiddenCodes(): string[] {
    const boxes = [...this.cutaways.values()].map(({ cutaway }) => {
      const [width, height] = drawnExtentM(cutaway);
      return { lon: cutaway.header.lon, lat: cutaway.header.lat, halfX: width / 2000, halfY: height / 2000 };
    });
    if (!boxes.length) return [];
    return this.cells
      .filter((cell) => boxes.some((box) => {
        const kmPerLon = 111.32 * Math.cos((box.lat * Math.PI) / 180);
        return Math.abs((cell.lon - box.lon) * kmPerLon) <= box.halfX
          && Math.abs((cell.lat - box.lat) * 110.57) <= box.halfY;
      }))
      .map((cell) => cell.code);
  }

  private applyTierFilters(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady) return;
    RING_ALPHAS.forEach((_opacity, tier) => {
      if (gl.getLayer(`cell-volume-${tier}`)) gl.setFilter(`cell-volume-${tier}`, this.tierFilter(tier));
    });
  }

  /** A KONRAD3D cell, as something to open: it has a track, so a heading. */
  private targetOfTrack(track: CellTrackProperties): VolumeTarget | null {
    const volume = track.volume ?? null;
    const series = track.series ?? [];
    const last = series[series.length - 1];
    if (!volume || !last) return null;
    return { code: track.code, volume, lon: last.lon, lat: last.lat, heading: last.heading_deg ?? null };
  }

  /**
   * A storm core found in the composite. It has no track and so no heading:
   * its slice starts north to south, and the reader turns it from there.
   */
  private targetOfCloud(cloud: RadarVolume): VolumeTarget {
    return { code: cloud.code, volume: cloud, lon: cloud.lon, lat: cloud.lat, heading: null };
  }

  /**
   * Cut one storm open, or close whichever was open.
   *
   * Every storm is already on the map, whole; opening one only slices it. A
   * KONRAD3D cell's volume is one of the storms already drawn, found by its
   * path -- and if it somehow is not (the list failed to load, say), it is
   * fetched and added so that tapping a cell never opens nothing.
   */
  private async open(target: VolumeTarget | null): Promise<void> {
    const token = Symbol("open");
    this.openToken = token;
    if (!target) {
      this.opened = null;
      stopSweep(false);
      this.applyCut();
      this.restoreCamera();
      // A storm kept past its scan only because it was open goes with it, and
      // the newer scan of it that was held back in its place comes out.
      this.dropUnlisted();
      this.pushClouds();
      return;
    }
    let entry = this.cutaways.get(target.volume.path);
    if (!entry) {
      try {
        const cutaway = await loadCutaway(target.volume);
        entry = {
          code: target.code, cutaway, lon: target.lon, lat: target.lat, tier: tierOf(target.volume, cutaway),
          system: "system" in target.volume ? (target.volume as RadarVolume).system ?? null : null,
        };
        this.cutaways.set(target.volume.path, entry);
        this.pushClouds();
      } catch {
        // A volume that will not load is one the reader never sees; the
        // extruded tiers are still there and still say what they always did.
        return;
      }
    }
    // Tapped past while it loaded: the volume is kept and drawn like any
    // other, but cutting it now would open the storm the reader has left.
    if (this.openToken !== token) return;
    // Not seen well enough to open: the panel says so, the storm stays whole
    // on the map, and nothing is cut -- a cut through interpolation between
    // two sweeps kilometres apart looks exactly as convincing as a real one.
    if (entry.tier === TIER_UNOPENABLE) {
      this.opened = null;
      stopSweep(false);
      this.applyCut();
      // Picked after one that was opened: closing it is no step back to the
      // view before that one.
      if (this.cameraBeforeOpen) this.walked = true;
      return;
    }
    // Not before the map's first settled frame; see `settled`. Resolved
    // already on every open after the first, so this costs nothing then.
    await this.settled;
    if (this.openToken !== token) return;
    // Held again: a refresh landing while the map settled let go of every
    // volume not in its list, and a linked storm from an older scan is in
    // none, so it was never drawn or cut.
    this.cutaways.set(target.volume.path, entry);
    this.opened = { path: target.volume.path, heading: target.heading };
    // The storm open before this one may have been kept past its scan.
    this.dropUnlisted();
    this.pushClouds();
    this.applyCut();
    // A frame later, so the slice has already been reset for the new
    // selection -- App.svelte does that from its own subscription to the same
    // stores, which can run after this one -- or set by the link that opened it.
    const { cutaway } = entry;
    requestAnimationFrame(() => {
      if (this.openToken !== token) return;
      this.frameOpened(cutaway);
      // Swung only where the cut is drawn: on the flat map the panel's own
      // camera already circles the storm, and a plane turning under a turning
      // camera is two motions where one reads. Nor for a storm past its scan;
      // see `pushClouds`.
      if (get(sharedActiveCap) === this.getName() && !this.heldOpen()) startSweep();
    });
  }

  /**
   * Stand the camera in front of an opened storm's cut.
   *
   * Close enough that the cross-section spans the room, from low down, so the
   * cut stands up as a wall of weather rather than lying flat as a map, and
   * square on to it, so what is shown is the face and not its edge. It is
   * placed in the part of the screen the panel leaves -- above the sheet on a
   * phone, left of it on a desktop -- with room for its top.
   *
   * The half kept is whichever faces the camera: a vertical plane turned half
   * way round is the same cut, and the caption reads the same. That keeps the
   * turn to face it within a quarter.
   *
   * Not after a link or a history step has just set the camera: that is a
   * view somebody chose, and it is kept.
   */
  private frameOpened(cutaway: Cutaway): void {
    const gl = this.gl;
    if (!gl || !this.opened || get(sharedActiveCap) !== this.getName()) return;
    if (performance.now() - this.cameraSetAt < CAMERA_KEPT_MS) return;

    // Facing the cut is looking along the kept half's side of the plane: for
    // a cut running along `direction`, a bearing a quarter turn short of it.
    const turn = get(cutRotationDeg);
    let direction = (this.opened.heading ?? 0) + turn;
    const bearing = gl.getBearing();
    const offFacing = normaliseCut(direction - 90 - bearing);
    const offFlipped = normaliseCut(direction + 90 - bearing);
    let off = offFacing;
    if (Math.abs(offFlipped) < Math.abs(offFacing)) {
      off = offFlipped;
      direction += 180;
      cutRotationDeg.set(normaliseCut(turn + 180));
    }

    // The storm itself rather than its box; see `locateStorm`.
    const { clientWidth: width, clientHeight: height } = gl.getContainer();
    const panel = Math.min(OPEN_PANEL_PX, width - 2 * OPEN_PANEL_MARGIN_PX) + 2 * OPEN_PANEL_MARGIN_PX;
    const room = get(smallScreen)
      ? { width, height, top: OPEN_TOP_PX, bottom: height * (1 - OPEN_SHEET_FRACTION), left: 0, right: width }
      : { width, height, top: OPEN_TOP_PX, bottom: height - OPEN_TRAY_PX, left: 0, right: Math.max(width - panel, width / 2) };
    const camera = framingCamera(cutaway, direction, room, OPEN_PITCH, gl.getMaxZoom(), VERTICAL_SCALE);

    if (this.cameraBeforeOpen) this.walked = true;
    else this.cameraBeforeOpen = this.cameraOf(gl);
    // Where it lands, which closing compares the camera with: the ease's own
    // moveend, told from any other by the token it carries. Landed early --
    // the reader took hold of the map -- it is where they took over.
    this.unwatchFraming?.();
    this.framedCamera = null;
    const framing = Symbol("framing");
    // MapLibre's typing knows nothing of the data an ease is given to carry.
    const landed = (event: object) => {
      if ((event as { framing?: symbol }).framing !== framing) return;
      this.unwatchFraming?.();
      this.unwatchFraming = null;
      this.framedCamera = this.cameraOf(gl);
    };
    gl.on("moveend", landed);
    this.unwatchFraming = () => gl.off("moveend", landed);
    gl.easeTo({
      center: [camera.lon, camera.lat],
      zoom: camera.zoom,
      pitch: OPEN_PITCH,
      bearing: bearing + off,
      offset: [camera.offsetX, camera.offsetY],
      duration: 900,
    }, { framing });
  }

  /** Repaint every storm, ring and tier in the radar palette the settings now name. */
  private applyColormap(name: string): void {
    if (name === this.colormap) return;
    this.colormap = name;
    this.cloudsLayer?.setColormap(name);
    // The radar under the storms too: DWD's and every network's rasters are
    // painted as they load (maskedTiles.ts), so they are pointed afresh.
    if (this.gl && this.styleReady) {
      this.ensureRadar(this.gl);
      this.ensureNetworks(this.gl);
    }
    // Hidden, the paint is set and waits for the map to be shown again.
    this.applyStaleness();
  }

  /**
   * Paint the cells and the storm cores in full colour.
   *
   * Live, the composite for a scan is out two minutes before KONRAD3D's cells
   * for it, and half a minute more before its volumes, so for part of every
   * cycle the storms are a scan behind the radar under them. They stay in
   * colour all the same: they are the newest picture of each storm there is,
   * and greyed they read as gone.
   */
  private applyStaleness(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady) return;
    RING_ALPHAS.forEach((opacity, tier) => {
      const id = `cell-volume-${tier}`;
      if (!gl.getLayer(id)) return;
      gl.setPaintProperty(id, "fill-extrusion-color", dbzRamp(this.colormap));
      gl.setPaintProperty(id, "fill-extrusion-opacity", opacity);
    });
    if (gl.getLayer("cell-footprint")) gl.setPaintProperty("cell-footprint", "line-color", severityColour());
    if (gl.getSource(CLOUD_SOURCE)) {
      this.ensureClouds(gl);
      gl.setPaintProperty(CLOUD_BOX, "line-color", boxColour(this.colormap));
    }
    if (this.shown) gl.triggerRepaint();
  }

  /** Tell the layer which storm is open, and which way its slice now runs. */
  private applyCut(): void {
    const turn = get(cutRotationDeg) + get(cutSweepDeg);
    this.cloudsLayer?.setCut(this.opened?.path ?? null, (this.opened?.heading ?? 0) + turn);
    if (this.shown) this.gl?.triggerRepaint();
  }

  /**
   * Load every listed storm's volume, a few at a time, keeping the ones held.
   *
   * Each storm appears as its volume arrives rather than all of them at the
   * end. Volumes no longer listed are dropped, except the one that is open:
   * taking the storm a reader is looking at away between two refreshes would
   * look like the popup had broken. `pushClouds` keeps the newer scan of it
   * off the map meanwhile.
   *
   * A volume that turns out faint is set aside instead, its ring taken off,
   * and its place goes to the next storm in view -- so this asks `wanted`
   * again after a pass that found one, until a pass finds none. A volume that
   * would not load is not asked for again in the same call.
   */
  private async loadClouds(): Promise<void> {
    const token = Symbol("clouds");
    this.loadToken = token;
    // A new list brings new coarse tiles, each to be measured on screen.
    this.updateDetail();
    this.dropUnlisted();
    this.pushClouds();

    const tried = new Set<string>();
    const missing = () => this.wanted().filter((cloud) => !this.cutaways.has(cloud.path) && !tried.has(cloud.path));
    for (let pass = missing(); pass.length; pass = missing()) {
      const faintBefore = this.faint.size;
      for (let i = 0; i < pass.length; i += VOLUME_FETCHES) {
        const batch = pass.slice(i, i + VOLUME_FETCHES);
        const faintInBatch = this.faint.size;
        for (const cloud of batch) tried.add(cloud.path);
        const loaded = await Promise.all(batch.map(async (cloud) => {
          try {
            return { cloud, cutaway: await loadCutaway(cloud) };
          } catch {
            return null;
          }
        }));
        if (this.loadToken !== token) return;
        for (const found of loaded) {
          if (!found) continue;
          const { cloud, cutaway } = found;
          if (isFaint(cutaway)) {
            this.faint.add(cloud.path);
            continue;
          }
          this.cutaways.set(cloud.path, {
            code: cloud.code, cutaway, lon: cloud.lon, lat: cloud.lat, tier: tierOf(cloud, cutaway),
            system: cloud.system ?? null,
          });
        }
        this.pushClouds();
        if (this.faint.size > faintInBatch && this.gl && this.styleReady) this.ensureClouds(this.gl);
        // Switched away: the rest waits for `attach`, whose refresh fetches
        // whatever is still missing.
        if (!this.shown) return;
      }
      if (this.faint.size === faintBefore) return;
    }
  }

  /**
   * Which of the listed storms to hold volumes for: those on screen first,
   * then those just past its edges, strongest first and nearer first among
   * equals within each, up to `RESIDENT_BYTES`.
   *
   * On screen by projecting each storm, not by the viewport's bounds: tilted,
   * the bounds are the box around a trapezoid running to the horizon, mostly
   * ground nobody can see, and ranked by strength alone the storms off to its
   * sides took the places of the ones in front of the camera. Zoomed out over
   * the Alps at 72 degrees, 48 storms stood on screen as bare rings while 13 of
   * the 16 volumes held were for storms off it. The margin still counts, after
   * them: it is what makes a pan land on clouds already loaded.
   *
   * Before the map exists, or when it has no bounds yet, the strongest few
   * of the whole list, so a first attach has something to draw at once.
   */
  private wanted(): RadarVolume[] {
    const gl = this.gl;
    const bounds = gl?.getBounds();
    const centre = gl?.getCenter();
    let candidates = this.levelled().filter((cloud) => !this.faint.has(cloud.path));
    let shown = new Set<RadarVolume>();
    if (gl && bounds && centre) {
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      const dx = (east - west) * VIEW_MARGIN;
      const dy = (north - south) * VIEW_MARGIN;
      candidates = candidates.filter((cloud) => (
        cloud.lon >= west - dx && cloud.lon <= east + dx && cloud.lat >= south - dy && cloud.lat <= north + dy
      ));
      const { clientWidth: width, clientHeight: height } = gl.getContainer();
      shown = new Set(candidates.filter((cloud) => {
        // Inside the bounds proper as well: a point past the horizon projects
        // to somewhere meaningless, which can be on the canvas.
        if (cloud.lon < west || cloud.lon > east || cloud.lat < south || cloud.lat > north) return false;
        const { x, y } = gl.project([cloud.lon, cloud.lat]);
        return x >= 0 && x <= width && y >= 0 && y <= height;
      }));
    }
    const distance = (cloud: RadarVolume) => (centre
      ? Math.hypot((cloud.lon - centre.lng) * Math.cos((cloud.lat * Math.PI) / 180), cloud.lat - centre.lat)
      : 0);
    const ranked = [...candidates].sort((a, b) => (
      Number(shown.has(b)) - Number(shown.has(a))
      || (b.peak_dbz ?? 0) - (a.peak_dbz ?? 0)
      || distance(a) - distance(b)
    ));
    const held: RadarVolume[] = [];
    let bytes = 0;
    for (const cloud of ranked) {
      bytes += textureBytes(cloud);
      if (bytes > RESIDENT_BYTES) break;
      held.push(cloud);
    }
    return held;
  }

  /**
   * Work out again which coarse tiles stand large enough on screen to be
   * drawn as their tiles; see `FINE_ABOVE_PX`. Whether that changed anything.
   */
  private updateDetail(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const fine = new Set<string>();
    for (const cloud of this.clouds) {
      if (!cloud.coarse || !cloud.tile) continue;
      const [west, south, east, north] = tileBounds(cloud.tile[0], cloud.tile[1], cloud.tile[2]);
      const corners = ([[west, south], [east, south], [east, north], [west, north]] as const)
        .map((corner) => gl.project([corner[0], corner[1]]));
      const across = Math.max(
        Math.max(...corners.map(({ x }) => x)) - Math.min(...corners.map(({ x }) => x)),
        Math.max(...corners.map(({ y }) => y)) - Math.min(...corners.map(({ y }) => y)),
      );
      const code = tileCode(cloud.tile[0], cloud.tile[1], cloud.tile[2]);
      if (across > (this.fineTiles.has(code) ? COARSE_BELOW_PX : FINE_ABOVE_PX)) fine.add(code);
    }
    const changed = fine.size !== this.fineTiles.size || [...fine].some((code) => !this.fineTiles.has(code));
    this.fineTiles = fine;
    return changed;
  }

  /** The listed volumes to draw: coarse tiles where they are small on screen, fine ones where large. */
  private levelled(): RadarVolume[] {
    return atLevel(
      this.clouds, (tile) => !this.fineTiles.has(tileCode(tile[0], tile[1], tile[2])), this.opened?.path ?? null,
    );
  }

  /** Forget every volume no longer listed or no longer wanted in view, bar the open one. */
  private dropUnlisted(): void {
    const wanted = new Set(this.wanted().map((cloud) => cloud.path));
    for (const path of this.cutaways.keys()) {
      if (!wanted.has(path) && path !== this.opened?.path) this.cutaways.delete(path);
    }
  }

  /**
   * Hand the layer every loaded storm, and let the tiers inside them stand down.
   *
   * Bar the newer scans of an open storm that is older than the list. A
   * storm open when a new scan lands is kept as it was, and the new scan
   * brings the same storm again under a new path -- and usually a new code,
   * its peak having moved a pixel -- so both were drawn, one volume over the
   * other a few kilometres apart. The same happens opening a link to an old
   * scan. Its successor comes back when the storm is closed.
   */
  private pushClouds(): void {
    const open = this.opened ? this.cutaways.get(this.opened.path) : undefined;
    const stale = open && !this.clouds.some((cloud) => cloud.path === this.opened?.path);
    const held = this.heldOpen();
    const drawn = [...this.cutaways].filter(([path, { cutaway }]) => (
      !stale || path === this.opened?.path || !isSuccessor(open.cutaway, cutaway)
    ));
    this.cloudsLayer?.setClouds(drawn.map(([key, { cutaway, tier, system }]) => ({
      key,
      cutaway,
      system,
      dim: tier === TIER_UNOPENABLE ? DIM_UNOPENABLE : 1,
      // Held whole: its layers are interpolation, which a peel cannot reveal anything in.
      peels: tier !== TIER_UNOPENABLE,
    })));
    // Kept past its scan, there is nothing newer in it to show: the slice
    // stops where it is, rather than turning through a storm the radar has
    // already moved on from. It stays in colour, as every storm does.
    if (held) stopSweep(true);
    // A volume just in moves its spin axis from the box's centre onto its storm.
    if (this.gl && this.styleReady && this.gl.getSource(CLOUD_SOURCE)) this.ensureClouds(this.gl);
    this.applyTierFilters();
    if (this.shown) this.gl?.triggerRepaint();
  }

  /**
   * Whether the open storm is only still on the map because it is open: a
   * newer scan of its network was listed without it while it was open, or
   * it was opened from an older list than this one -- the flat map's, a
   * link. See `isPastItsScan`.
   */
  private heldOpen(): boolean {
    const path = this.opened?.path;
    const open = path ? this.cutaways.get(path) : undefined;
    if (!path || !open) return false;
    const { network, reference_time: referenceTime } = open.cutaway.header;
    return isPastItsScan({ path, network, reference_time: referenceTime }, this.clouds);
  }

  /** The one layer that draws every storm's volume, added once per style. */
  private ensureVolumes(gl: GlMap): void {
    if (this.cloudsLayer || !this.maplibre) return;
    const layer = makeCloudsLayer(VOLUME_LAYER, this.maplibre.MercatorCoordinate, this.colormap);
    gl.addLayer(layer);
    this.cloudsLayer = layer;
    this.pushClouds();
    this.applyCut();
  }

  /**
   * Every tile of sky with a volume: the outline of its box on the ground,
   * and its inside as the tap target.
   *
   * The outline is the box the cutaway raymarches, so a reader sees before
   * tapping what will open: one tile of sky, not the storm alone. A storm is
   * covered by as many as it needs, which abut and never overlap. Fainter for
   * one that does not open. No "3D" pill as on the flat map: here every storm
   * already stands in 3D, and a tag over each one only covered the clouds it
   * pointed at. A tap anywhere in a box opens it instead; where boxes from
   * before tiles overlap, the nearest by its spin axis
   * (`lib/cloudFootprint.ts`) -- the storm's own centre once its volume is
   * in, the box's until then.
   */
  private ensureClouds(gl: GlMap): void {
    const data = {
      type: "FeatureCollection" as const,
      // Not for a storm too faint to draw: a box promises a cloud.
      features: this.levelled().filter((cloud) => !this.faint.has(cloud.path)).map((cloud) => {
        const dbz = cloud.peak_dbz ?? 40;
        const properties = { code: cloud.code, path: cloud.path, dbz, tier: cloud.tier ?? 2 };
        const loaded = this.cutaways.get(cloud.path)?.cutaway;
        // The tile itself, not its apron, which is the neighbours' to outline.
        const drawnM = loaded ? drawnExtentM(loaded) : null;
        const listedM = cloud.tile ? tileWidthM(cloud.tile[0], cloud.lat) : null;
        const { ring, pivot } = loaded && drawnM
          ? boxFootprint(
            loaded.header.lon, loaded.header.lat, [drawnM[0], drawnM[1]], [loaded.centreKm[0], loaded.centreKm[1]],
          )
          : boxFootprint(cloud.lon, cloud.lat, listedM ? [listedM, listedM] : undefined);
        return {
          type: "Feature" as const,
          geometry: { type: "Polygon" as const, coordinates: [ring] },
          properties: { ...properties, pivotLon: pivot[0], pivotLat: pivot[1] },
        };
      }),
    };
    const source = gl.getSource(CLOUD_SOURCE);
    if (source) {
      (source as unknown as { setData(data: unknown): void }).setData(data);
      return;
    }
    gl.addSource(CLOUD_SOURCE, { type: "geojson", data, attribution: dwdAttribution });
    // Fainter for a storm that does not open, as the storm itself is.
    const unopenable: ExpressionSpecification = ["==", ["get", "tier"], TIER_UNOPENABLE];
    gl.addLayer({
      id: CLOUD_BOX,
      type: "line",
      source: CLOUD_SOURCE,
      layout: { "line-join": "round" },
      paint: {
        "line-color": boxColour(this.colormap),
        "line-width": 1.5,
        "line-opacity": ["case", unopenable, RING_OPACITY.unopenable, RING_OPACITY.openable],
      },
    });
    // Not drawn, only hit: a fill at no opacity is still queried.
    gl.addLayer({
      id: CLOUD_HIT,
      type: "fill",
      source: CLOUD_SOURCE,
      paint: { "fill-opacity": 0 },
    });
  }

  private async select(code: string, details: boolean): Promise<void> {
    const token = Symbol("pick");
    this.picking = token;
    try {
      const answer = await fetchCellTrack(code, this.nanobar);
      if (this.picking !== token) return;
      const track = answer as unknown as CellTrack | undefined;
      if (track?.properties) {
        selectedCell.set(trimToLastRun(track).properties);
        cellDetails.set(details);
      }
    } catch {
      // Already reported by the API wrapper; a popup that does not open is
      // not worth a second message on top of it.
    }
  }

  /** The 3D camera, in the flat map's zoom levels; null before MapLibre has loaded. */
  currentView(): MapView | null {
    const gl = this.gl;
    if (!gl) return null;
    const centre = gl.getCenter();
    return {
      lat: centre.lat, lon: centre.lng, zoom: gl.getZoom() + 1, pitch: gl.getPitch(), bearing: gl.getBearing(),
    };
  }

  /**
   * Point the camera where a link or a history entry says.
   *
   * Before the map exists the request is kept for it; after, it is a jump.
   * Only what is given moves, so a link with a tilt and no heading keeps
   * whichever heading the map already has.
   */
  setCamera(camera: CameraRequest): void {
    this.cameraSetAt = performance.now();
    if (!this.gl) {
      this.requestedCamera = { ...this.requestedCamera, ...camera };
      return;
    }
    const { lat, lon, zoom, pitch, bearing } = camera;
    this.gl.jumpTo({
      ...(lat !== undefined && lon !== undefined ? { center: [lon, lat] as [number, number] } : {}),
      ...(zoom !== undefined ? { zoom: zoom - 1 } : {}),
      ...(pitch !== undefined ? { pitch } : {}),
      ...(bearing !== undefined ? { bearing } : {}),
    });
  }

  /**
   * The storm core a link names, by its volume's path, as something to open.
   *
   * Usually one of the newest scan's, and then it is the listed one, with the
   * peak and the area the popup shows. A link opened later names a scan that
   * has since been replaced -- a core's code is its grid position, so there is
   * no following it into the next scan -- but its volume is immutable and
   * still there, and the file's own header says where it stands and when it
   * was measured. That is enough to open it where it was, as it was.
   *
   * Null when the volume has gone as well, which is the end of its retention.
   * A download that failed is thrown instead: the volume may well be there,
   * and the link should be tried again rather than called gone.
   */
  async restoreCloud(path: string): Promise<RadarVolume | null> {
    await (this.firstRefresh ?? this.refresh());
    const listed = this.clouds.find((cloud) => cloud.path === path);
    if (listed) return listed;
    try {
      const cutaway = await loadCutaway({ path, coverage: 0, tier: 2 });
      const { header } = cutaway;
      const tier = header.tier ?? 2;
      // Held like a listed one, so opening it does not fetch it a second time.
      this.cutaways.set(path, { code: header.code, cutaway, lon: header.lon, lat: header.lat, tier, system: null });
      this.pushClouds();
      return {
        path,
        code: header.code,
        network: header.network ?? "de",
        tier,
        lon: header.lon,
        lat: header.lat,
        reference_time: header.reference_time,
        coverage: header.coverage,
        sites: header.sites,
        scanned_at: header.scanned_at ?? null,
        oldest_scan_at: header.oldest_scan_at ?? null,
        tile: header.tile ?? null,
        coarse: (header.tile?.[0] ?? 10) < 10,
      };
    } catch (error) {
      if (error instanceof VolumeGone) return null;
      throw error;
    }
  }

  private pushCameraToView(): void {
    if (this.syncing || !this.gl) return;
    this.syncing = true;
    const centre = this.gl.getCenter();
    const view = this.map.getView();
    // MapLibre's centre is the middle of its element, which is not the View's
    // centre while the View carries the tray; see lib/viewCentre.ts. Zoom
    // first, because the two differ by an amount measured at the resolution.
    view.setZoom(this.gl.getZoom() + 1);
    setElementCentre(view, fromLonLat([centre.lng, centre.lat]));
    this.syncing = false;
  }

  private pullCameraFromView(): void {
    if (this.syncing || !this.gl) return;
    this.syncing = true;
    const view = this.map.getView();
    const centre = elementCentre(view);
    if (centre) {
      const [lon, lat] = toLonLat(centre);
      this.gl.jumpTo({ center: [lon, lat], zoom: (view.getZoom() ?? 6) - 1 });
    }
    this.syncing = false;
  }

  /**
   * Read strikes from the flat map's own buffer.
   *
   * Given the source rather than the strikes themselves so this map picks up
   * every arrival without App.svelte having to forward each one; the source
   * fires `change` as the buffer adds and evicts.
   */
  setStrikeSource(source: VectorSource): void {
    this.strikes = source;
    source.on("change", () => this.scheduleStrikes());
    this.ensureStrikes();
  }

  /**
   * Mark the client's position, from the same `updateLocation` the apps and
   * the browser drive the flat map's blue dot through. Hidden, it is only
   * kept: `attach` draws it.
   */
  showLocation(location: UserLocation | null): void {
    this.location = location;
    if (this.shown && this.gl && this.styleReady) this.ensureLocation(this.gl);
  }

  /** Fly this map's camera rather than the View's, which only follows it; see `Capability.lookAt`. */
  lookAt(centre: [number, number] | null, zoom: number | null): boolean {
    // Still being brought up, it opens wherever the View is by then.
    if (!this.shown || !this.gl) return false;
    this.gl.easeTo({
      ...(centre ? { center: centre } : {}),
      ...(zoom !== null ? { zoom: zoom - 1 } : {}),
      duration: 500,
    });
    return true;
  }

  /**
   * Redraw the strikes soon, once, however many arrive meanwhile.
   *
   * The buffer fires `change` for every strike, and each redraw re-serialises
   * the whole buffer for MapLibre's worker and raymarches every storm again.
   * A squall line sends several a second; once a second is plenty for a
   * recent-activity glow. Nothing at all while hidden -- `attach` redraws.
   */
  private scheduleStrikes(): void {
    if (!this.shown || this.strikeTimer !== null) return;
    this.strikeTimer = setTimeout(() => {
      this.strikeTimer = null;
      this.ensureStrikes();
    }, STRIKE_REDRAW_MS);
  }

  /**
   * Point the draped radar at a frame, and say which scan it is. Called with
   * DWD's newest frame, HX, whichever product the 2D map draws (ng ADR 0016).
   */
  setRadarFrame(url: string | null, scan: Scan, index?: TileIndex | null): void {
    this.radarUrl = url;
    this.radarIndex = index;
    this.radarScan = url ? scan : null;
    // Held for `attach`: a hidden map would load the whole frame's tiles.
    if (!this.shown) return;
    // `styleReady`, not `isStyleLoaded()`, for the reason on the field: a
    // frame landing while tiles were in flight was otherwise not draped until
    // the next run.
    if (!this.gl || !this.styleReady) return;
    this.ensureRadar(this.gl);
    this.applyStaleness();
  }

  /**
   * Point each network's draped composite at its newest frame. Called with
   * the same frames the flat map's live step shows; a network left out has
   * nothing fresh, and its layer stands down.
   */
  setNetworkFrames(frames: Partial<Record<NetworkCode, RadarFrame>>): void {
    this.networkFrames = frames;
    if (this.shown && this.gl && this.styleReady) this.ensureNetworks(this.gl);
    this.applyStaleness();
  }

  /**
   * Re-read the volumes, when a run's (or a part of a run's) are built.
   *
   * Each network's runs land on their own clock and a run in parts, so the
   * ones that land between two KONRAD3D runs were otherwise not seen until
   * the next -- by when its radar had moved on and they were a scan behind. A
   * moment's wait first, so a run's parts landing together are one fetch.
   */
  newVolumes(): void {
    if (!this.shown || this.volumesTimer !== null) return;
    this.volumesTimer = setTimeout(() => {
      this.volumesTimer = null;
      if (!this.shown) return;
      void fetchCurrentVolumes(undefined, { coarse: true }).catch(() => null).then((answer) => {
        if (answer && this.shown) this.volumes.offer(answer);
      });
    }, VOLUMES_SETTLE_MS);
  }

  /**
   * Re-read the latest run, when a new one lands.
   *
   * Nothing while hidden: that is a fetch of the cells and of every new
   * volume for a map nobody is looking at, and `attach` refreshes anyway.
   */
  newRun(): void {
    if (this.shown) void this.refresh();
  }

  /** Re-read the latest run. One timestep only: this map does not scrub. */
  refresh(): Promise<void> {
    const run = this.load();
    this.firstRefresh ??= run;
    return run;
  }

  private async load(): Promise<void> {
    const token = Symbol("cells");
    this.cellsToken = token;
    const [current, clouds] = await Promise.all([
      // Not asked for while they are off: a severe afternoon's run is a
      // sizeable answer for a map that would draw none of it. A failure
      // (already reported by the API wrapper) keeps the cells already drawn,
      // and no longer takes a good answer for the volumes down with it.
      this.cellsWanted ? fetchCurrentCells(this.nanobar).catch(() => undefined) : null,
      // Its own failure is not the cells' failure: a map with storms and no
      // cutaways is worth drawing. Nor does it take the storms already
      // drawn away; they stay until an answer replaces them.
      fetchCurrentVolumes(undefined, { coarse: true }).catch(() => null),
    ]);
    if (this.cellsToken !== token) return;
    if (current !== undefined) {
      // Turned off while the answer was on its way is off.
      const run = this.cellsWanted ? current : null;
      this.cells = (run?.cells ?? []) as CellCurrent[];
      this.cellsScan = run ? scanTime(run.reference_time) : null;
    }
    // The same scan as before still loads: a load cut short by switching
    // away left volumes to fetch, and this is the refresh `attach` relies on.
    if (!clouds || !this.volumes.offer(clouds)) void this.loadClouds();
    if (this.shown) this.volumes.follow(this.newestScan());
    this.applyData();
  }

  /**
   * Turn the KONRAD3D cells on or off.
   *
   * On, they are fetched now if the map is showing, and otherwise by the
   * refresh `attach` does. Off, they go at once, and their layers stay on
   * the style empty -- nothing to tap, nothing to hide a tier of.
   */
  private applyCellsWanted(wanted: boolean): void {
    if (wanted === this.cellsWanted) return;
    this.cellsWanted = wanted;
    if (wanted) {
      if (this.shown) void this.refresh();
      return;
    }
    this.cells = [];
    this.cellsScan = null;
    if (!this.gl || !this.styleReady) return;
    this.ensureCells(this.gl);
    this.applyTierFilters();
  }

  /** The newest scan anything on this map is from, which the volumes are waited for to reach. */
  private newestScan(): Scan | null {
    const scans = [this.cellsScan, this.radarScan].filter((scan): scan is Scan => scan !== null);
    return scans.length ? Math.max(...scans) : null;
  }

  /** A newer scan's storm cores, from a refresh or from waiting for one. */
  private takeClouds(answer: CurrentVolumes): void {
    this.clouds = (answer.volumes ?? []) as RadarVolume[];
    // Only the listed ones are worth remembering; every run brings new paths.
    const listed = new Set(this.clouds.map((cloud) => cloud.path));
    for (const path of this.faint) if (!listed.has(path)) this.faint.delete(path);
    void this.loadClouds();
    // A refresh draws them with everything else; a wait has only these to draw.
    if (!this.gl || !this.styleReady) return;
    this.ensureClouds(this.gl);
    this.applyStaleness();
  }

  /**
   * Put the radar frame and the cells onto the map, adding or updating.
   *
   * Written to be safe to call at any time and any number of times. Two things
   * make that necessary: the first data can arrive before MapLibre has finished
   * parsing its style, and a light/dark switch calls `setStyle`, which discards
   * every source and layer added here. An earlier version bailed out when the
   * style was not ready and never tried again, which left a basemap with no
   * storms on it whenever the fetch won that race.
   */
  private applyData(): void {
    const gl = this.gl;
    // Nothing to do yet: `style.load` calls this again once there is.
    if (!gl || !this.styleReady) return;

    applyTerrain(gl, this.terrainWanted, this.dark);
    this.ensureRadar(gl);
    this.ensureNetworks(gl);
    this.ensureCells(gl);
    this.ensureClouds(gl);
    this.ensureVolumes(gl);
    this.ensureStrikes();
    this.ensureLabels(gl);
    this.ensureLocation(gl);
    this.applyStaleness();
  }

  /**
   * DWD's frame, with the EUMETNET networks' countries cut out of it.
   *
   * The same cut the flat map's live frame gets (`networkHoles.ts`), for the
   * same reason: the networks' composites drape over those countries
   * (`ensureNetworks`), every palette is part transparent, and DWD showing
   * through underneath would blend into colours neither radar measured. The
   * holes are cut whether or not a network has a frame to fill them, as the
   * flat map does -- a country whose radar is down shows nothing rather than
   * DWD's long-range view of it alone.
   *
   * MapLibre cannot clip a raster, so the tiles go through `maskedTiles.ts`.
   */
  private ensureRadar(gl: GlMap): void {
    if (!this.radarUrl) return;

    if (this.radarMask?.url !== this.radarUrl || this.radarMask.palette !== this.colormap) {
      forgetMaskedTiles(this.radarMask?.key);
      this.radarMask = {
        url: this.radarUrl,
        palette: this.colormap,
        ...registerMaskedTiles({
          template: this.radarUrl,
          index: this.radarIndex,
          erase: HOLES,
          palette: this.colormap,
        }),
      };
    }
    const { tiles } = this.radarMask;

    const existing = gl.getSource(RADAR_SOURCE);
    if (existing) {
      // Unchanged is left alone: `setTiles` reloads every tile on screen, and
      // this runs on every refresh and every return to this map.
      const source = existing as unknown as { tiles?: string[]; setTiles(tiles: string[]): void };
      if (source.tiles?.[0] !== tiles) source.setTiles([tiles]);
      return;
    }

    gl.addSource(RADAR_SOURCE, {
      type: "raster",
      tiles: [tiles],
      tileSize: 512,
      minzoom: 3,
      // The observed frame's depth, HX at 250 m; an older frame's 8 is
      // magnified past it in maskedTiles.ts.
      maxzoom: 9,
      attribution: dwdAttribution,
    });
    gl.addLayer({
      id: RADAR_SOURCE,
      type: "raster",
      source: RADAR_SOURCE,
      paint: { "raster-opacity": RADAR_OPACITY, "raster-resampling": "nearest" },
    }, this.rasterAnchor(gl));
  }

  /**
   * Each network's newest composite, draped over the ground `extents.ts`
   * gives it and nowhere else -- the other half of the cut `ensureRadar`
   * makes, so exactly one radar colours any pixel, as on the flat map.
   *
   * One source and one layer per network, kept and re-pointed rather than
   * rebuilt: a network's frame lands every minute or two, and `setTiles`
   * only reloads what is on screen.
   */
  private ensureNetworks(gl: GlMap): void {
    for (const network of NETWORKS) {
      const { code } = network;
      const id = networkLayerId(code);
      const frame = this.networkFrames[code];
      if (!frame) {
        if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", "none");
        continue;
      }

      let mask = this.networkMasks[code];
      const tileId = drawnTileId(frame);
      if (mask?.tileId !== tileId || mask.palette !== this.colormap) {
        forgetMaskedTiles(mask?.key);
        mask = {
          tileId,
          palette: this.colormap,
          ...registerMaskedTiles({
            template: tileSourceUrl("meteoradar", tileId),
            index: frame.tiles,
            keep: network.coverage ? maskPath(network.coverage) : null,
            palette: this.colormap,
          }),
        };
        this.networkMasks[code] = mask;
      }

      const existing = gl.getSource(id);
      if (existing) {
        const source = existing as unknown as { tiles?: string[]; setTiles(tiles: string[]): void };
        if (source.tiles?.[0] !== mask.tiles) source.setTiles([mask.tiles]);
        gl.setLayoutProperty(id, "visibility", "visible");
        continue;
      }

      gl.addSource(id, {
        type: "raster",
        tiles: [mask.tiles],
        tileSize: 512,
        minzoom: 3,
        maxzoom: 8,
        attribution: network.attribution,
      });
      gl.addLayer({
        id,
        type: "raster",
        source: id,
        paint: { "raster-opacity": RADAR_OPACITY, "raster-resampling": "nearest" },
      }, this.rasterAnchor(gl));
    }
  }

  /**
   * Where a radar raster goes in the style: under everything this map draws
   * on top of the ground. The storms are added in `applyData` after the
   * rasters, but a frame can arrive later than the storms did, and a raster
   * appended then would paint over them.
   */
  private rasterAnchor(gl: GlMap): string | undefined {
    return gl.getStyle().layers.find((layer) => /^(cell|cloud|strike|place|location)-/.test(layer.id))?.id;
  }

  /**
   * The cell layers, added once and fed new data thereafter.
   *
   * Two `fill-extrusion` layers over one source, and the order they are added
   * in is the whole trick. `fill-extrusion` writes depth even when it is
   * translucent, so anything drawn behind a see-through surface that went down
   * first is simply erased. The opaque interior therefore goes first and the
   * see-through outer shell second, where it depth-tests against the interior
   * and blends over it correctly. Swap them and every storm becomes a hollow
   * bag with nothing inside.
   */
  /**
   * Recent strikes, on the deck under the storms.
   *
   * Flat circles at ground level rather than anything raised: a strike is a
   * channel from cloud to ground and drawing it as a mark on the ground is
   * both true and the one place it cannot be confused with the volume above
   * it. Two circles per strike -- a soft wide one and a small bright core --
   * so a cluster reads as a glow rather than as gravel.
   *
   * Newer strikes are brighter. `fill-extrusion` writes depth, so anything
   * drawn flat has to come after the storms to survive them, which is where
   * the layers go in.
   */
  private ensureStrikes(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady || !this.strikes) return;

    const cutoff = Date.now() - STRIKE_MINUTES * 60_000;
    const features = this.strikes.getFeatures().flatMap((strike) => {
      // The feature id is the strike time, which is also how the flat map's
      // ring buffer evicts them.
      const at = Number(strike.getId());
      if (!Number.isFinite(at) || at < cutoff) return [];
      const point = strike.getGeometry() as Point | undefined;
      const coordinates = point?.getCoordinates();
      if (!coordinates) return [];
      const [lon, lat] = toLonLat(coordinates);
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
        properties: { age: (Date.now() - at) / (STRIKE_MINUTES * 60_000) },
      }];
    });
    const data = { type: "FeatureCollection" as const, features };

    const existing = gl.getSource(STRIKE_SOURCE);
    if (existing) {
      (existing as unknown as { setData(value: unknown): void }).setData(data);
      return;
    }

    gl.addSource(STRIKE_SOURCE, { type: "geojson", data, attribution: blitzortungAttribution });
    const fade: DataDrivenPropertyValueSpecification<number> = [
      "interpolate", ["linear"], ["get", "age"], 0, 1, 1, 0,
    ] as unknown as DataDrivenPropertyValueSpecification<number>;
    // Under the place names and the position, which can be on the map before
    // the first strike is.
    const below = [PLACE_LABELS, LOCATION_ACCURACY].find((id) => gl.getLayer(id));
    gl.addLayer({
      id: "strike-glow",
      type: "circle",
      source: STRIKE_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 14],
        "circle-color": STRIKE_COLOURS.glow,
        "circle-blur": 1,
        "circle-opacity": ["*", 0.5, fade] as never,
      },
    }, below);
    gl.addLayer({
      id: "strike-core",
      type: "circle",
      source: STRIKE_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 12, 3.4],
        "circle-color": STRIKE_COLOURS.core,
        "circle-stroke-color": STRIKE_COLOURS.rim,
        "circle-stroke-width": 1,
        "circle-opacity": fade,
        "circle-stroke-opacity": fade,
      },
    }, below);
  }

  /**
   * The place names, over the storms and the strikes as the flat map's are
   * over the radar, and under the position. In the palette of the basemap
   * under them: a light/dark switch restyles the map, and they are added
   * again in its colours. Only the language is changed in place.
   */
  private ensureLabels(gl: GlMap): void {
    const layer = placeLabels(this.dark ? darkLabels : lightLabels, this.nameKeys);
    if (gl.getLayer(PLACE_LABELS)) {
      gl.setLayoutProperty(PLACE_LABELS, "text-field", layer.layout?.["text-field"]);
      return;
    }
    gl.addLayer(layer, gl.getLayer(LOCATION_ACCURACY) ? LOCATION_ACCURACY : undefined);
  }

  /**
   * The client's position: the flat map's blue dot and its accuracy circle,
   * drawn the same way so the two maps agree on what it looks like.
   *
   * Last on the style, over the storms, strikes and place names, as the flat map's
   * sits over every layer. The dot faces the screen at a fixed size however
   * the map is tilted -- it marks a place, it is not a thing on the ground --
   * while the circle lies on the ground, because it is an area of it.
   */
  private ensureLocation(gl: GlMap): void {
    const at = this.location;
    const features = at ? [
      ...(at.accuracy > 0 ? [{
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: circularPolygon([at.lon, at.lat], at.accuracy, 64).getCoordinates() },
        properties: {},
      }] : []),
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [at.lon, at.lat] },
        properties: {},
      },
    ] : [];
    const data = { type: "FeatureCollection" as const, features };

    const existing = gl.getSource(LOCATION_SOURCE);
    if (existing) {
      (existing as unknown as { setData(value: unknown): void }).setData(data);
      return;
    }

    gl.addSource(LOCATION_SOURCE, { type: "geojson", data });
    // OpenLayers' default polygon style, which is what the flat map's circle is drawn in.
    gl.addLayer({
      id: LOCATION_ACCURACY,
      type: "fill",
      source: LOCATION_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "rgba(255, 255, 255, 0.4)", "fill-outline-color": "#3399cc" },
    });
    gl.addLayer({
      id: LOCATION_DOT,
      type: "circle",
      source: LOCATION_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        // The flat map's 10px radius runs down the middle of its 3.5px
        // stroke; MapLibre's stroke starts where the radius ends.
        "circle-radius": 8.25,
        "circle-color": "#048ef9",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 3.5,
        "circle-pitch-scale": "viewport",
      },
    });
  }

  private ensureCells(gl: GlMap): void {
    const volume = volumeCollection(this.cells);
    const footprints = footprintCollection(this.cells);
    const volumeSource = gl.getSource(CELL_SOURCE);
    if (volumeSource) {
      (volumeSource as unknown as { setData(data: unknown): void }).setData(volume);
      const feet = gl.getSource(FOOTPRINT_SOURCE);
      if (feet) (feet as unknown as { setData(data: unknown): void }).setData(footprints);
      return;
    }

    gl.addSource(FOOTPRINT_SOURCE, { type: "geojson", data: footprints });
    gl.addLayer({
      id: "cell-footprint",
      type: "line",
      source: FOOTPRINT_SOURCE,
      paint: {
        // A `match` rather than indexing into a literal array: MapLibre types
        // `at` as returning the array's element type, so a colour looked up
        // that way fails paint-property validation -- and validation drops the
        // layer without throwing, which is a footprint that silently never draws.
        "line-color": severityColour(),
        "line-width": 1.2,
        "line-opacity": 0.7,
      },
    });

    gl.addSource(CELL_SOURCE, { type: "geojson", data: volume, attribution: dwdAttribution });
    // Innermost tier first. Each is one `fill-extrusion` layer because
    // `fill-extrusion-opacity` takes no expression, and the order is what
    // makes the glass work: a tier drawn later blends over the tiers already
    // in the depth buffer, so the core is laid down before anything covers it.
    RING_ALPHAS.forEach((opacity, tier) => {
      gl.addLayer({
        id: `cell-volume-${tier}`,
        type: "fill-extrusion",
        source: CELL_SOURCE,
        filter: this.tierFilter(tier),
        paint: {
          "fill-extrusion-color": dbzRamp(this.colormap),
          // Stretched upwards as the storms and the ground are.
          "fill-extrusion-base": ["*", ["get", "base"], VERTICAL_SCALE],
          "fill-extrusion-height": ["*", ["get", "top"], VERTICAL_SCALE],
          "fill-extrusion-opacity": opacity,
        },
      });
    });
  }

  destroy(): void {
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    if (this.volumesTimer !== null) clearTimeout(this.volumesTimer);
    this.volumesTimer = null;
    this.volumes.stop();
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.unsubscribeSelection?.();
    this.unsubscribeSelection = null;
    this.unsubscribeCut?.();
    this.unsubscribeCut = null;
    this.unsubscribeColormap?.();
    this.unsubscribeColormap = null;
    this.unsubscribeCellsWanted?.();
    this.unsubscribeCellsWanted = null;
    this.unsubscribeTerrain?.();
    this.unsubscribeTerrain = null;
    this.unsubscribeSweep?.();
    this.unsubscribeSweep = null;
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;
    stopSweep(false);
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.uncorrectCtrlClicks?.();
    this.uncorrectCtrlClicks = null;
    this.unmiddleDrag?.();
    this.unmiddleDrag = null;
    this.gl?.remove();
    this.gl = null;
    forgetMaskedTiles(this.radarMask?.key);
    this.radarMask = null;
    for (const mask of Object.values(this.networkMasks)) forgetMaskedTiles(mask?.key);
    this.networkMasks = {};
    this.detach();
    this.container = null;
  }
}
