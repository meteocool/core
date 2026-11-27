import { Map as OlMap } from "ol";
import { toLonLat, fromLonLat } from "ol/proj";
import { circular as circularPolygon } from "ol/geom/Polygon";
import type Point from "ol/geom/Point";
import type BaseLayer from "ol/layer/Base";
import type {
  DataDrivenPropertyValueSpecification, ExpressionSpecification, FilterSpecification, Map as GlMap, MapGeoJSONFeature, Marker, RasterLayerSpecification,
  SkySpecification, StyleSpecification,
} from "maplibre-gl";
import Capability from "./Capability";
import type { UserLocation } from "./Capability";
import type { CapabilityOptions } from "./options";
import { basemapStyle, muteTheme, PLACE_LABELS, placeLabels } from "../layers/maplibreStyle";
import { darkLabels, lightLabels } from "../layers/labels";
import { placeNameKeys } from "../layers/placeName";
import { chooseLocale } from "../locale/choose";
import { t } from "../locale/t";
import { locale } from "svelte-i18n";
import { blitzortungAttribution, dwdAttribution, imprintAttribution, versatilesAttribution } from "../layers/attributions";
import {
  installSatelliteProtocol, SATELLITE_MAX_ZOOM, SATELLITE_PROTOCOL_TILES, satelliteTheme3d,
} from "../layers/satellite";
import { tileSourceUrl } from "../layers/dwd";
import { drawnTileId } from "../lib/rvp6";
import { NETWORKS } from "../layers/network";
import { SEVERITY_COLOURS } from "../layers/cells";
import { HOLES } from "../layers/networkHoles";
import type { NetworkCode } from "../layers/networkHoles";
import { forgetMaskedTiles, installMaskedProtocol, registerMaskedTiles } from "../layers/maskedTiles";
import { maskPath } from "../layers/tileMask";
import { applyTerrain, installTerrainProtocol, isMissingTerrain, VERTICAL_SCALE } from "../layers/terrain";
import { budgetDrapes, flightFog, indexDrapes, lodCamera, lookedAtHeight } from "../layers/flightGround";
import type { TileIndex } from "../lib/tileIndex";
import { darkTheme, lightTheme } from "../layers/base";
import { volumeCollection, footprintCollection } from "../lib/cellExtrusions";
import { loadCutaway, VolumeGone } from "../lib/cellCutaway";
import {
  drapeAnchor, flightDrapeBytes, HANDHELD_DRAPE_SIZE, HANDHELD_TILE_CACHE_ZOOM_LEVELS, isHandheld, mapPixelRatio,
} from "../lib/gpuBudget";
import { drawnExtentM, tileBounds, tileCentre, tileCode } from "../lib/volumeBox";
import {
  atLevel, COARSE_ZOOM, drawnWithin, fineAt, fineWithin, footprintOnScreen, freedAsTiles, volumesAsked,
} from "../lib/volumeLevels";
import type { Bounds, FineCandidate } from "../lib/volumeLevels";
import { framingCamera } from "../lib/stormFrame";
import { DIM_UNOPENABLE, isFaint, makeCloudsLayer } from "../layers/cellVolumeLayer";
import type { CloudsLayer } from "../layers/cellVolumeLayer";
import type { Cutaway } from "../lib/cellCutaway";
import { isSuccessor } from "../lib/cloudSuccession";
import { dbzStops, RING_ALPHAS } from "../lib/cellVolume";
import { fetchCellTrack, fetchCurrentCells, fetchCurrentVolumes, quietly } from "../api";
import {
  archiveStep, capDescription, cells3dFailed, cells3dLoading, cells3dVisible, cloudStyle, cloudsTime, colorSchemeDark, cutRotationDeg,
  cutSweepDeg, mapView, peelLevel, peelManual, peelTop, radarColormap, selectedCell, selectedStorm, sharedActiveCap,
  stormDetails, showForecastPlaybutton, smallScreen, terrain3dVisible, fullResolution3d, mapBaseLayer,
} from "../stores";
import { derived, get } from "svelte/store";
import { nextSelection } from "../lib/cellSelection";
import { headingOf, volumeOfStorm, withVolume } from "../lib/stormSelection";
import type { StormSelection } from "../lib/stormSelection";
import { offerVolumes } from "../lib/stormResolver";
import { moved3D } from "../lib/open3d";
import { normaliseCut } from "../lib/cutAngle";
import { startSweep, stopSweep } from "../lib/cutSweep";
import { elementCentre, setElementCentre } from "../lib/viewCentre";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { correctCtrlClicks, reportsCtrlClickAsRight } from "../lib/ctrlDrag";
import { middleDragTurnsAndTilts } from "../lib/middleDrag";
import { tracked } from "../lib/progress";
import { boxCasing, boxFootprint, tileWidthM } from "../lib/cloudFootprint";
import { isPastItsScan, isVolumeBehind, networkOf, scanTime, VolumeFeed } from "../lib/scans";
import { greyedOut, STALE_GREY } from "../lib/staleTint";
import type { Rgb } from "../lib/staleTint";
import type { Scan } from "../lib/scans";
import {
  askScan, coarseOf, coarseTilesIn, FALLBACK_TEMPLATE, limited, listOf, noFinds, placeKey, placesToAsk, scanOnClock,
  volumeOf,
} from "../lib/cloudHistory";
import type { Place, Quarter, ScanFinds } from "../lib/cloudHistory";
import { networkAt } from "../layers/networkAt";
import { defaultPeel } from "../lib/peel";
import { handOver, ScanListing } from "../lib/volumeHandover";
import { cloudMotion, columnDepth } from "../lib/cloudMotion";
import type { Motion } from "../lib/cloudMotion";
import type { Placed } from "../lib/volumeHandover";
import { FetchRetries } from "../lib/fetchRetries";
import type { StudioPlanesLayer } from "../layers/studioPlanesLayer";
import { DEFAULT_FOV, STUDIO_MAX_PITCH } from "../lib/studio/scene";
import type { StudioCamera } from "../lib/studio/scene";
import { studioFlying, studioFov, studioOpen, studioPlanes, studioSelectedPlane } from "../lib/studio/store";
import type { FlightCut, FlightEye, FlightPose, FlightSupport, InspectMode, StormTileInfo, StudioSupport } from "../lib/studio/director";
import type { SectionPlane } from "../lib/studio/planes";
import type { AircraftLayer, AircraftScreen, AircraftView, TrafficPass, WeatherView } from "../layers/aircraftLayer";
import type { StormMark } from "../lib/studio/flight/marks";
import type { CoarsePlace, Lookout } from "../lib/studio/flight/selection";

import { maplibreLocateControl } from "../lib/GeolocateControl";
import { maplibreShareControl } from "../lib/ShareControl";
import { canShare } from "../lib/shareSupport";
import { reportShown } from "../lib/sentry";
import type {
  CellCurrent, CellTrack, CellTrackProperties, CellVolume, CurrentVolumes, RadarFrame, RadarVolume,
} from "../api";
import type { CloudsTime, MapView } from "../stores";
import type VectorSource from "ol/source/Vector";

/**
 * The storms in three dimensions.
 *
 * Every other capability draws a map from above, where a thunderstorm is a
 * coloured blob and its most important property (whether the intense core is
 * deep or shallow) is invisible. Radar measures that: for each reflectivity
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
 * Loading it on first attach instead of at import time keeps that weight off
 * everyone who only ever looks at the flat radar. It is also precached by the
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
   * `import.meta.url`, which a bundler rewrites, leaving it pointing at a
   * path with no worker beside it.
   *
   * `?worker&url` rather than plain `?url`, because the worker file imports
   * MapLibre's 500 KB shared chunk and only the worker form makes Vite bundle
   * that in. Served as a bare module it has to fetch and evaluate that chunk
   * itself, which under Vite means a multi-megabyte transformed module; the
   * worker then misses the first messages MapLibre sends it. The symptom is
   * hard to pin down: it works on one load, and on the next the map answers a
   * single message and then sits there, with no error anywhere.
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
 * MapLibre's `idle` is the signal; this stands in if it never comes (a
 * WebGL context that failed, a tile server that answers nothing), so a
 * map that will never settle is at least a map the reader can see.
 */
const SETTLE_CEILING_MS = 15000;

const CELL_SOURCE = "cells";
/** Every storm's raymarched volume, in the one layer that draws them all. */
const VOLUME_LAYER = "cell-volume-raymarched";
/** Studio's section planes, drawn as sheets over the storms; see layers/studioPlanesLayer.ts. */
const STUDIO_PLANES_LAYER = "studio-planes";
/**
 * How much of the storms' volumes Studio keeps hold of, in bytes, across the
 * scans of a scene: what makes a scan already shown come back at once, which
 * is what playing a scene is. Past it, a scan is fetched again as it comes up.
 */
const STUDIO_HELD_BYTES = 600 * 1024 * 1024;
/** How many scans' lists of storms Studio keeps, where the map keeps `PAST_KEPT`: the two hours a scene can run. */
const STUDIO_SCANS_KEPT = 30;
/**
 * How often, in milliseconds, a camera a scene is moving has its moves acted
 * on (other storms loaded, the view published): every frame of one would do
 * all of that sixty times a second.
 */
const DIRECTED_MOVE_MS = 400;

/**
 * The sky while flying: deep blue overhead, pale at the horizon, and a haze
 * the distant ground fades into, as it does seen from an aircraft. Without
 * it, a camera at the horizon looks at the map's edge against nothing.
 */
const FLIGHT_SKY: SkySpecification = {
  "sky-color": "#1f5fb8",
  "horizon-color": "#d7e6f4",
  "fog-color": "#cbdbea",
  "sky-horizon-blend": 0.55,
  "horizon-fog-blend": 0.75,
  "fog-ground-blend": 0.35,
  "atmosphere-blend": 0,
};

/**
 * How far the zoom may go while flying. The zoom is not the camera's: a
 * camera put by its position and attitude has one worked out for it, which
 * can fall outside the map's own range, and a zoom clamped back into it
 * moves the camera somewhere else.
 */
const FLIGHT_ZOOM: [number, number] = [0, 22];

/**
 * How far into the distance the ground stays sharp while flying: MapLibre's
 * level of detail (`setSourceTileLodParams`) for the relief and the imagery
 * draped on it. Its own lets the zoom fall away fast with distance, which
 * from a cockpit, nearly level, put mountains 20 km off four to six levels
 * coarser than the ground below: blurred, rounded peaks until the aircraft
 * was nearly on them. These keep them within two, at the cost of more tiles;
 * a phone takes one level less, for its memory (gpuBudget.ts).
 */
const FLIGHT_LOD = { levels: 4, handheldLevels: 5, ratio: 3 } as const;

/**
 * The least the level of detail takes an eye to look down by, degrees.
 * MapLibre's works out how sharp a tile is from how steeply the eye looks
 * down at it, measured by the height of the eye over the point it looks at;
 * looking level, that height is none, and at `FLIGHT_LOD` every tile out to
 * the far plane went to the sharpest zoom: thousands of tiles a frame, the page
 * held for seconds and, shaken in a storm's rough air, the GPU lost. A storm's
 * updrafts lift the eye that far, and a reader can look up. (The far plane is
 * held in too: `FLIGHT_FAR_HEIGHTS`; and the eye is taken to be as high as it
 * is: layers/flightGround.ts, `lodCamera`.)
 */
const FLIGHT_LOD_LEAST_DOWN = 2;
const FLIGHT_LOD_LEAST_RISE = Math.sin((FLIGHT_LOD_LEAST_DOWN * Math.PI) / 180);

/**
 * MapLibre's level of detail: a tile's zoom, from the map's zoom, how far off
 * the tile is across and the eye over the point looked at, how far off that
 * point is, and the lens.
 */
type TileZoom = (zoom: number, across: number, up: number, away: number, fov: number) => number;

/** The ways a hand moves the map, every one of them off while flying. */
const FLIGHT_HANDLERS = [
  "dragPan", "scrollZoom", "dragRotate", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch", "boxZoom",
] as const;

/**
 * Which way MapLibre's roll turns the picture, against the aircraft's (right
 * wing down positive): in a right bank the horizon's right end rises.
 */
const ROLL_SIGN = 1;

/** The aircraft of a flight, drawn over everything; see layers/aircraftLayer.ts. */
const AIRCRAFT_LAYER = "flight-aircraft";

/**
 * How a storm a flight looks into is drawn, bar the cut, which is the
 * layer's own: peeled most of the way to its core in the radar's colours
 * (or as far as the reader has said, `Stage.inspectStorm`), or
 * left as it is, in the flight's own style, with the stronger half of what
 * is inside it showing through.
 */
const INSPECTIONS: Record<Exclude<InspectMode, "cut">, { style: "cloud" | null; peel: number }> = {
  peel: { style: "cloud", peel: 0.72 },
  xray: { style: null, peel: 0.55 },
};

/** Where the camera lands on leaving a flight: how far ahead of the aircraft it looks, and from how high. */
const LANDING_KM = 15;
const LANDING_VIEW = { pitch: 65, zoom: 9.5 };
/**
 * The place names of a flight. Fewer of them: countries, regions, cities and
 * towns, and each with more room round it than the map gives, since low
 * down every village in sight would otherwise have its name over the view.
 * And smaller the lower the aircraft is: the map draws a name the larger the
 * nearer it is, and from a few hundred metres up the nearest ones are a few
 * hundred metres off. `LABEL_SIZES` is the share of its size a name is drawn
 * at from each height over the ground down, true metres (the first is about
 * 3,000 ft); a height has to be left by `LABEL_SLACK_M` before the size
 * changes back, so one flown along does not set the names over and over.
 */
const FLIGHT_LABELS = [
  "any",
  ["in", ["get", "kind"], ["literal", ["country", "region"]]],
  ["in", ["get", "kind_detail"], ["literal", ["city", "town"]]],
] as unknown as ExpressionSpecification;
const FLIGHT_LABEL_ROOM_PX = 34;
const LABEL_SIZES: Array<[number, number]> = [[915, 0.36], [1800, 0.62], [Infinity, 0.9]];
const LABEL_SLACK_M = 60;

/** The nearest a flight's map is drawn from the eye, metres: nearer than a wheel is to the ground under it. */
const FLIGHT_NEAR_M = 1.5;

/**
 * The farthest a flight's map is drawn, as many times the eye's height (as
 * drawn, `VERTICAL_SCALE`), and never less than a floor; metres. Looking
 * down even a little, the map draws 77 heights out, whatever the level.
 * Looking level or up, it drew to where a flat map's horizon is, nowhere:
 * twice as far again, and with it more than twice the tiles.
 */
const FLIGHT_FAR_HEIGHTS = 80;
const FLIGHT_FAR_LEAST_M = 200_000;

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
 * The list now covers sixteen networks and every tile of sky it rains in, so on
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
/**
 * The same for a flight, which is a desktop's and looks to the horizon: a
 * storm system is more sky than the map's share holds, and what was left
 * out stood as slabs of cloud with their sides cut off where the rest
 * should have been.
 */
const FLIGHT_BYTES = RESIDENT_BYTES * 2.5;
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
 * competing copy of them (same colours, same footprint, no height), and the
 * volumes it is meant to sit under get lost in it.
 *
 * It stays because it is the only thing on this map showing the rain that is
 * not a detected cell: the broad stratiform shield around a
 * line of storms has no volume drawn for it, and without the raster the map
 * says nothing is there.
 */
const RADAR_OPACITY = 0.35;
const STRIKE_SOURCE = "strikes";

/** One EUMETNET network's draped composite: its source and its layer share the id. */
const networkLayerId = (code: NetworkCode) => `radar-${code}`;

/**
 * The drape's two sets of layers: the first always there, the second, over
 * it, only while Studio blends two scans; see `applyDrapeBlend`.
 */
type DrapeSlot = 0 | 1;
const DRAPE_SLOTS: readonly DrapeSlot[] = [0, 1];
/** A draped layer's id in a set: the first set's are the ids they always had. */
const drapeLayerId = (id: string, slot: DrapeSlot) => (slot ? `${id}-next` : id);
/**
 * How many steps the drape's crossfade between two scans takes. Not every
 * frame: on the terrain, a draped raster whose opacity changes has every
 * tile of the ground drawn again under it, which took a frame of a blend
 * from 9 ms to 24 on the demo's storms. In eight, each step is an eighth of
 * a third of the drape's opacity, which reads as a fade under the clouds,
 * and a time-lapse of a second a scan pays for eight frames of sixty.
 */
const DRAPE_STEPS = 8;

/** Which tier a volume is in: what the list says, else what its own header says, else openable. */
const tierOf = (listed: { tier?: number }, cutaway: Cutaway) => listed.tier ?? cutaway.header.tier ?? 2;

/** A volume as handing over sees it, from its listing or its header; see lib/volumeHandover.ts. */
const placed = (path: string, at: { network?: string | null; tile?: readonly number[] | null; reference_time: string }): Placed => ({
  path, network: networkOf(at), tile: at.tile ?? null, scan: scanTime(at.reference_time),
});

/** Every storm core with a volume: its box's outline, and the box to tap it by. */
const CLOUD_SOURCE = "clouds";

/** The outline of the box a storm's cutaway raymarches, on the ground. */
const CLOUD_BOX = "cloud-box";

/** A halo under the outline, so it stands off the ground and the clouds; see `boxCasing`. */
const CLOUD_BOX_CASING = "cloud-box-casing";

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
 * them, and half an hour of accumulation over a squall line is a solid smear.
 * Ten minutes keeps it to what is happening now.
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

/** Opens tilted: flat, this is just a slower 2D map. */
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
 * camera instead. From the camera's height at a regional zoom, that is
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
 * A `match` instead of indexing into a literal array with `at`: MapLibre types
 * `at` as returning the array's element type, so a colour looked up that way
 * fails paint-property validation. Validation drops the whole layer without
 * throwing, so the footprint silently never draws. The
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
 * The assertion is there for the same reason as in `severityColour`: a run-length shape
 * cannot be checked against the spec's fixed-arity tuple.
 */
function dbzRamp(
  colormap: string,
  tint?: (colour: Rgb) => Rgb,
): DataDrivenPropertyValueSpecification<string> {
  return [
    "interpolate", ["linear"], ["get", "dbz"],
    ...dbzStops(colormap, tint).flatMap(([dbz, colour]) => [dbz, colour]),
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

/**
 * A storm's box outline on the ground, in the palette by its peak; greyed for
 * a storm a scan behind the radar draped under it, as the flat map's "3D" tag
 * is (lib/staleTint.ts), until its own scan's volumes land. Greyed, not grey:
 * a little of its colour still shows, so it does not read as gone. The storm
 * itself stays in colour, the newest picture of it there is.
 */
function boxColour(colormap: string, dark: boolean): DataDrivenPropertyValueSpecification<string> {
  const grey = STALE_GREY[dark ? "dark" : "light"];
  return [
    "case", ["==", ["get", "stale"], true],
    dbzRamp(colormap, (colour) => greyedOut(colour, grey)),
    dbzRamp(colormap),
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

/** Between a run's volumes being announced and asking for them, so a run's parts are fetched together. */
const VOLUMES_SETTLE_MS = 1500;

/**
 * How many coarse tiles an earlier scan is newly asked for at most, per
 * look: where a newer scan had storms, around them, then the rest of the
 * screen nearest its middle; see lib/cloudHistory.ts. Each is a request,
 * most of them misses; the ones asked before cost nothing and do not count.
 */
const PAST_PLACES = 30;

/**
 * Of those, how many from the rest of the screen, where no storm was: the
 * ground a storm that has died since would be on. Mostly misses, so a few a
 * look; each move of the camera looks over a few more.
 */
const PAST_VIEW_PLACES = 8;

/** How far an earlier scan is looked over from the coarse tile the middle of the screen is in, in coarse tiles. */
const PAST_REACH = 4;

/** Volumes asked for at once while an earlier scan is looked for: most are misses, or small. */
const PAST_FETCHES = 12;

/** How many earlier scans' finds are kept: what was asked for and found there, no voxels. */
const PAST_KEPT = 12;

/**
 * The newest scan's own marks, put away while an earlier scan is on the
 * map: its KONRAD3D cells and the last minutes' strikes, which are now's
 * and not the scan's.
 */
const LIVE_ONLY = [
  "cell-footprint", ...RING_ALPHAS.map((_opacity, tier) => `cell-volume-${tier}`), "strike-glow", "strike-core",
];

/** The radar of one observed step, as `RadarCapability.observedAt` gives it. */
interface PastRadar {
  url: string;
  tiles?: TileIndex | null;
  networks: Partial<Record<NetworkCode, RadarFrame>>;
}

/** A volume as the clouds layer takes it. */
interface StudioCloud {
  key: string;
  cutaway: Cutaway;
  system: string | null;
  dim: number;
  peels: boolean;
  /** The tiles of its own it is drawn over, null for all of it; see `CloudsLayer.setClouds`. */
  within?: ReadonlyArray<readonly number[]> | null;
}

/** An earlier scan on the map in place of the newest; see `showScan`. */
interface PastScan {
  /** On DWD's clock, as the picker has it. */
  scan: Scan;
  /** What is known of it, which a look adds to. */
  finds: ScanFinds;
}

export default class Cells3DCapability extends Capability {
  private gl: GlMap | null = null;
  /** The bearing a two-finger turn started from, while one is under way; see `turn`. */
  private turnFrom: number | null = null;

  /** The element MapLibre draws into, parented to whatever target is active. */
  private container: HTMLDivElement | null = null;

  private cells: CellCurrent[] = [];

  /**
   * Whether the KONRAD3D cells are drawn at all; see `cells3dVisible`. Off,
   * they are not even fetched, and the volumes are the only storms here.
   */
  private cellsWanted = get(cells3dVisible);

  private unsubscribeCellsWanted: (() => void) | null = null;

  /** The step a past window shows, which the cells and volumes are asked for; null live. */
  private unsubscribeStep: (() => void) | null = null;

  /** Whether the map stands on the ground's relief; see `terrain3dVisible`. */
  private terrainWanted = get(terrain3dVisible);

  /** Whether the relief is drawn: as the reader wants it, and always under a flight, which flies among the mountains. */
  private get terrainShown(): boolean {
    return this.terrainWanted || this.flight !== null;
  }

  private unsubscribeTerrain: (() => void) | null = null;
  private unsubscribeResolution: (() => void) | null = null;

  /** The scan the cells were found in; null before the first run, and while they are off. */
  private cellsScan: Scan | null = null;

  /** The newest cells request, so a slower earlier answer cannot win. */
  private cellsToken: symbol | null = null;

  /**
   * Every storm core with a volume on the map, KONRAD3D cell or not: the
   * newest scan's, or an earlier scan's while one is shown in its place.
   */
  private clouds: RadarVolume[] = [];

  /** The newest scan's, as last listed: `clouds` while live, kept aside while an earlier scan is shown. */
  private liveClouds: RadarVolume[] = [];

  /** The earlier scan on the map; null while live. See `showScan`. */
  private past: PastScan | null = null;

  /** A scan picked and being looked for, until it is on the map or turns out empty. */
  private pastLoading: Scan | null = null;

  /** Whether the camera moved while it was, away from where it was looked for. */
  private pastMoved = false;

  /** The newest look at an earlier scan, so one superseded lands nowhere. */
  private pastToken: symbol | null = null;

  /** What every earlier scan looked at is known to have, by scan, the least recently looked at first. */
  private pastFinds = new Map<Scan, ScanFinds>();

  /** The coarse tiles of the earlier scan whose fine tiles were found, by code: only those can be drawn fine. */
  private pastFine = new Set<string>();

  /** An earlier scan's volumes being fetched, by path, so two looks over the same ground ask once. */
  private pastFetches = new Map<string, Promise<Cutaway | null>>();

  /** At most `PAST_FETCHES` of them at once. */
  private readonly pastQueue = limited(PAST_FETCHES);

  /** Each network's newest scan listed, which its earlier scans are counted from; see `scanOnClock`. */
  private networkClocks = new Map<string, Scan>();

  /** A listed volume's path, which an earlier scan's are named after; see `pathAt`. */
  private volumePath: string | null = null;

  /** Where the flat map has the radar for an observed step. Set by the caller. */
  private radarAt: ((step: number) => PastRadar | null) | null = null;

  /** What is draped in place of the newest frames while an earlier scan is shown; null while live. */
  private drapedPast: { url: string | null; index?: TileIndex | null; networks: PastRadar["networks"] } | null = null;

  /** A refetch of the volumes, waiting for the rest of a run's parts; see `newVolumes`. */
  private volumesTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The storm cores, waited for until they reach the newest scan on the map.
   *
   * Asked for when a KONRAD3D run lands, which live is half a minute before
   * that scan's volumes exist; fetched only then, every storm stood a scan
   * upwind of the radar under it until the next run. Waits only while shown,
   * and never in a past window, whose scans are all built.
   */
  private readonly volumes = new VolumeFeed<CurrentVolumes>(
    () => fetchCurrentVolumes(quietly, volumesAsked(this.fillSky, get(archiveStep))).catch(() => null),
    (answer) => this.takeClouds(answer),
  );

  /** The radar frame to drape, as a tile URL template. Set by the caller. */
  private radarUrl: string | null = null;

  /** Which tiles that frame has, so the ones it lacks are never asked for; see lib/tileIndex.ts. */
  private radarIndex: TileIndex | null | undefined = undefined;

  /** The `masked://` registration of that frame; see `ensureRadar`. */
  private radarMasks: Array<{ url: string; palette: string; key: string; tiles: string } | null> = [null, null];

  /** The scans the drape's two sets of layers show while Studio blends two; see `applyDrapeBlend`. */
  private drapeSlots: [Scan, Scan] | null = null;

  /** Each set's opacity. */
  private drapeOpacity: [number, number] = [RADAR_OPACITY, 0];

  /** The scan of that frame; see lib/scans.ts. */
  private radarScan: Scan | null = null;

  /** Each network's newest composite, as the flat map's live step draws it. Set by the caller. */
  private networkFrames: Partial<Record<NetworkCode, RadarFrame>> = {};

  /** Each network's `masked://` registration, by the frame it was made for. */
  private networkMasks: Array<Partial<Record<NetworkCode, { tileId: string; palette: string; key: string; tiles: string }>>> = [{}, {}];

  /**
   * The flat map's strike buffer, read rather than duplicated.
   *
   * The strikes arrive over one socket and one ring buffer already holds them,
   * evicts them and fades them; a second copy here would be a second thing to
   * keep in step for no gain. The coordinates in it are EPSG:3857 metres
   * (the `lightning` event documents them that way and `StrikeManager` stores
   * them untouched), so they are projected back on the way out.
   */
  private strikes: VectorSource | null = null;

  /** Where the client is, as LayerManager last reported it; see `showLocation`. */
  private location: UserLocation | null = null;

  /** The properties place names are read from, in the reader's language first. */
  private nameKeys = placeNameKeys(chooseLocale());

  /** The newest select in flight, so a slower earlier answer cannot win. */
  private picking: symbol | null = null;


  /** Whether what the map is drawn over is dark: the dark scheme, or the satellite imagery. */
  private dark = false;

  /** The satellite basemap in place of the drawn one. */
  private satellite = false;

  /** Guards the two-way camera sync against echoing a move back and forth. */
  private syncing = false;

  /**
   * Whether the style will accept sources and layers.
   *
   * Not `isStyleLoaded()`, which also reports false while any source still
   * has tiles in flight. Over a slow connection that can be all the time, and
   * waiting on it left the map showing a basemap and no storms.
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
    /** A fill tile, weak echo where no storm is; see `fillSky`. */
    fill?: boolean;
  }>();

  /**
   * Listed storms whose volume loaded too faint to draw; see `isFaint`.
   *
   * Neither drawn nor ringed, and not held: a volume is immutable, so one
   * found faint stays faint, and remembering it by path keeps it from being
   * fetched again and from taking a place another storm in view could have.
   * Opened anyway (a KONRAD3D cell tapped inside one, a link to one), it is
   * drawn, because then the reader asked for exactly that storm.
   */
  private faint = new Set<string>();

  /** The coarse tiles, by code, that stand large enough on screen to be drawn as their tiles; see `updateDetail`. */
  private fineTiles = new Set<string>();


  /** Which storm is open, by its volume's path, and which way its slice runs before the reader turns it. */
  private opened: { path: string; heading: number | null } | null = null;

  /** The newest load, so a slow one finishing late cannot undo a newer list. */
  private loadToken: symbol | null = null;

  /**
   * The volumes being downloaded for the map, by path: a load that wants one
   * already on its way waits for it rather than fetching it again, and one no
   * longer wanted is called off (`loadClouds`).
   */
  private fetching = new Map<string, { volume: Promise<Cutaway>; abort: AbortController }>();

  /** The boxes last handed to their source, as JSON; see `ensureClouds`. */
  private cloudsDrawn: string | null = null;

  /** The volumes that would not load, asked for again a little later; see `FetchRetries`. */
  private retries = new FetchRetries();

  /** The next time the volumes that failed are asked for again; see `retryLater`. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Which networks' newest scans are still being listed in parts; see `handOver`. */
  private readonly listing = new ScanListing();

  /** The next time a network's scan has been listed whole, and the scan before it can go; see `settleLater`. */
  private listingTimer: ReturnType<typeof setTimeout> | null = null;

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
  private unsubscribePeel: (() => void) | null = null;

  private unsubscribeCut: (() => void) | null = null;

  private unsubscribeColormap: (() => void) | null = null;

  private unsubscribeStyle: (() => void) | null = null;

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
   * back is instant. Kept alive, though, it went on doing everything a shown
   * map does: every new radar frame reloaded its tiles, every new run re-fetched
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


  /**
   * Whether the map is in Studio (lib/studio): its section planes cut every
   * cloud in place of an opened storm's own cut, a tap opens nothing, the
   * camera tilts further, and the volumes of scans already shown are held.
   */
  private studio = false;

  /** Studio's planes, drawn; see `ensureStudio`. */
  private studioLayer: StudioPlanesLayer | null = null;

  /** The handle each upright plane is dragged by, by the plane's id. */
  private studioHandles = new Map<number, Marker>();

  private unsubscribeStudio: Array<() => void> = [];

  /** Volumes kept across scans while in Studio, by path; see `STUDIO_HELD_BYTES`. */
  private studioHeld = new Map<string, Cutaway>();

  private studioHeldBytes = 0;

  /**
   * What each scan put on the map when it was last the one shown in Studio,
   * of the volumes held: what it looks like, from where the scene had the
   * camera then, for `blendScans` to draw it with its neighbour.
   */
  private studioDrawn = new Map<Scan, StudioCloud[]>();

  /** Two scans drawn at once, and how far between them; see `blendScans`. */
  private blend: { from: Scan; to: Scan; fraction: number } | null = null;

  /** Whether the layer is drawing that blend, which it is once both scans are in `studioDrawn`. */
  private blending = false;

  /** The storms' motion between each pair of scans blended, by `from:to`; see lib/cloudMotion.ts and `prepareBlend`. */
  private blendMotions = new Map<string, Motion>();

  /** A Studio camera asked for before there was a map to stand it on: a link that opens in Studio. */
  private requestedStudioCamera: StudioCamera | null = null;

  /**
   * What flying changed about the map, to put back exactly on landing; null
   * when not flying. See `setFlying`.
   */
  private flight: {
    minZoom: number;
    maxZoom: number;
    maxPitch: number;
    clamped: boolean;
    handlers: Record<(typeof FLIGHT_HANDLERS)[number], boolean>;
  } | null = null;

  /**
   * Studio's and the flight's own code that this map calls, handed over by
   * each as it starts (`setStudioSupport`, `setFlying`) rather than imported
   * here: the map is loaded by everyone who opens it, they only with Studio.
   */
  private studioSupport: StudioSupport | null = null;
  private flightSupport: FlightSupport | null = null;

  /** The share of their size a flight's place names are drawn at; see `FLIGHT_LABELS`. */
  private flightLabelSize = LABEL_SIZES[LABEL_SIZES.length - 1][1];
  /** The storm a flight is looking into, as the layer has it; see `inspectStorm`. */
  private inspected: { key: string; mode: InspectMode; at: [number, number]; cut: FlightCut | null; peel: number | null } | null = null;

  /** Where a flight's clouds begin, kilometres above the sea; see `setCloudBase`. */
  private cloudBaseKm = 1.5;

  /** Whether a flight has taken the radar's picture off the ground; see `setRadarOnGround`. */
  private radarOffGround = false;
  /**
   * The drape's layers put away for that, rather than made clear: a clear
   * layer still fetches and holds its tiles, which a flight wants the memory
   * of. They still count as the ground's picture (`radarTiles`), which the
   * flight's own map reads.
   */
  private offGround = new Set<string>();

  /** Where the aircraft was last put; what the storms are chosen from while flying. */
  private flightPose: FlightPose | null = null;

  /** Which way the flight's camera last looked: the aircraft's own heading, or its eye's. */
  private flightLooking: number | null = null;
  /** How high a flight's eye is over the ground under it, in the map's own units (the world's width is 1); see `lodCamera`. */
  private flightOver = 0;

  /** The aircraft, drawn while flying, and how it was last asked to be; see `setAircraft`. */
  private aircraftLayer: AircraftLayer | null = null;
  /** Other aircraft drawn with it; see `setTraffic`. */
  private trafficPass: TrafficPass | null = null;
  private aircraftView: AircraftView | null = null;
  private aircraftScreens: AircraftScreen[] = [];
  private flightWeather: WeatherView | null = null;
  /** The share of its full sharpness a flight is drawn at; see `setFlightQuality`. */
  private flightQuality = 1;

  /** Whether a scene is moving the camera, frame by frame; see `setDirected`. */
  private directed = false;

  /** When a directed camera's move was last acted on; see `DIRECTED_MOVE_MS`. */
  private directedMoveAt = 0;

  /** The newest load of the storms' volumes, for `stageScan` to wait on. */
  private cloudsLoading: Promise<void> = Promise.resolve();

  /** The locate disc's action; see `CapabilityOptions.locate`. */
  private readonly locate: (() => void) | null;
  /**
   * Whether this map draws the whole sky: the weak echo between the storms
   * as well as the storms (`CapabilityOptions.fillSky`), meteoair's page
   * alone. Settled when the map is made; the 3D map proper draws storms.
   */
  private readonly fillSky: boolean;
  /** Takes back the ⌃-click correction, where one was needed; see lib/ctrlDrag.ts. */
  private uncorrectCtrlClicks: (() => void) | null = null;
  /** Takes back the middle drag's turning and tilting; see lib/middleDrag.ts. */
  private unmiddleDrag: (() => void) | null = null;

  constructor(map: OlMap, additionalLayers: BaseLayer[], options: CapabilityOptions) {
    super(map, "cells3d", () => Cells3DCapability.announce(), additionalLayers);

    this.nanobar = options.nanobar;
    this.locate = options.locate ?? null;
    this.fillSky = options.fillSky ?? false;
    // A storm selected on the flat map is not opened here until this map is
    // shown: opening fetches its volume, and `attach` opens whatever is
    // selected by then.
    this.unsubscribeSelection = selectedStorm.subscribe((selection) => {
      if (this.shown) void this.openSelection(selection);
    });
    // The peel: where the style starts it, or where the reader has put it.
    this.unsubscribePeel = derived([peelManual, peelLevel], (peel) => peel)
      .subscribe(([own, level]) => this.cloudsLayer?.setPeel(level, own));
    // Turning the slice in the popup turns it here. Only a uniform changes, so
    // this is a repaint and nothing is rebuilt.
    this.unsubscribeCut = cutRotationDeg.subscribe(() => this.applyCut());
    this.unsubscribeSweep = cutSweepDeg.subscribe(() => this.applyCut());
    this.unsubscribeColormap = radarColormap.subscribe((name) => this.applyColormap(name));
    // A uniform and each storm's box: nothing is fetched or uploaded again.
    this.unsubscribeStyle = cloudStyle.subscribe((style) => {
      this.cloudsLayer?.setStyle(style);
      // Each style starts its peel where it reads best, until the reader has chosen one.
      if (!get(peelManual)) peelLevel.set(defaultPeel(style));
    });
    this.unsubscribeCellsWanted = cells3dVisible.subscribe((wanted) => this.applyCellsWanted(wanted));
    // A past window's step, earlier or later, or the way back to live: its
    // own cells and volumes, now if the map is showing, else on `attach`.
    let step = get(archiveStep);
    this.unsubscribeStep = archiveStep.subscribe((at) => {
      if (at === step) return;
      step = at;
      this.volumes.reset();
      if (this.shown) void this.refresh();
    });
    this.unsubscribeTerrain = terrain3dVisible.subscribe((wanted) => {
      this.terrainWanted = wanted;
      // Before the style is up, `applyData` adds it once it is.
      if (this.gl && this.styleReady) applyTerrain(this.gl, this.terrainShown, this.dark, this.drapeSize());
    });
    // Settings: full resolution or the handheld cap, redrawn at once.
    this.unsubscribeResolution = fullResolution3d.subscribe((full) => {
      this.gl?.setPixelRatio(mapPixelRatio(window.devicePixelRatio, isHandheld(), full));
    });
    // An app tells the page its language after the map is up.
    this.unsubscribeLocale = locale.subscribe((tag) => {
      if (!tag) return;
      this.nameKeys = placeNameKeys(tag);
      if (this.gl && this.styleReady) this.ensureLabels(this.gl);
    });
    this.unsubscribeStudio = [
      studioOpen.subscribe((open) => this.setStudio(open)),
      studioPlanes.subscribe(() => this.applySections()),
      studioSelectedPlane.subscribe(() => this.applySections()),
      studioFov.subscribe(() => this.applyLens()),
    ];
    /* The drawn basemap here follows the scheme, whichever drawn basemap the
       flat map shows: it is a muted one of its own, made to sit under the
       storms. The satellite imagery replaces it, with the dark palettes. */
    this.unsubscribeTheme = derived([colorSchemeDark, mapBaseLayer], (both) => both).subscribe(([scheme, basemap]) => {
      const satellite = basemap === "satellite";
      const dark = Boolean(scheme) || satellite;
      if (dark === this.dark && satellite === this.satellite) return;
      this.dark = dark;
      this.satellite = satellite;
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
    if (this.satellite) {
      return basemapStyle(satelliteTheme3d, {
        tiles: SATELLITE_PROTOCOL_TILES,
        maxzoom: SATELLITE_MAX_ZOOM,
        attribution: [versatilesAttribution, imprintAttribution].join(" "),
      });
    }
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
   * On the main map MapLibre takes the element. Anywhere else (the layer
   * switcher's previews) the ordinary OpenLayers map draws, which is cheaper
   * and a truthful thumbnail of where the storms are.
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

    // Not `super.setTarget(target)`: the base class would point
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
   * map at the switcher's tile, which is what this one wants too. That is
   * cheaper than a second WebGL context, shows truthfully where the storms
   * are, and leaves the MapLibre canvas alone. The tiles are live while the
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
       * its own CSS declares that class `position: relative`, with the same
       * specificity as the app's `.maplibre-host` rule and loaded after it,
       * so it wins. In flow instead of layered, the canvas took its own
       * 100%-height box *below* the OpenLayers viewport already sitting in
       * `#map`, which looks as if the 3D map is not there at all: the flat
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
     * Capabilities do not take `#map` from each other (OpenLayers appends
     * its viewport to the target and leaves any earlier one in place), so
     * which map is visible comes down to which element is last in the DOM.
     * Coming back to this capability, the flat map's viewport had been
     * appended after this container, so the 3D map was being drawn correctly
     * underneath an opaque OpenLayers canvas. `appendChild` on a node that is
     * already a child moves it to the end, which is what is wanted.
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
        reportShown("3d-map", error);
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
      installSatelliteProtocol(maplibre);
      installTerrainProtocol(maplibre);
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
          // hilltop; an opened storm is looked at from lower (see frameOpened).
          maxPitch: MAX_PITCH,
          // Spelled out rather than behind an (i), like the flat map's; see the
          // attribution rules in glass.css. None in the apps, as on their flat
          // map: their settings list every source and licence instead.
          attributionControl: dd.isApp() ? false : { compact: false },
          // A phone's memory: see gpuBudget.ts.
          pixelRatio: mapPixelRatio(window.devicePixelRatio, isHandheld(), get(fullResolution3d)),
          ...(isHandheld() ? { maxTileCacheZoomLevels: HANDHELD_TILE_CACHE_ZOOM_LEVELS } : {}),
        });
      } catch (error) {
        // No WebGL, most likely. The veil has nothing to wait for.
        settle();
        cells3dLoading.set(false);
        throw error;
      }
      /*
       * Two navigation controls where one would do, so they can be drawn as
       * the flat map's are: a zoom capsule, the locate disc, and the compass
       * where the flat map's north-up disc is (it also shows the tilt and
       * resets both). Under the layer-switcher disc, in glass; see glass.css
       * and Map.svelte. Locating goes through LayerManager like the flat
       * map's, which flies this camera (`lookAt`) and marks the position.
       *
       * Not in the apps, which draw their own controls over the webview. The
       * flat map leaves its zoom and locate out there for the same reason, and
       * a column of web buttons would land under the native ones.
       */
      if (!dd.isApp()) {
        gl.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        if (this.locate) gl.addControl(maplibreLocateControl(this.locate), "top-right");
        gl.addControl(new maplibre.NavigationControl({ showZoom: false, visualizePitch: true }), "top-right");
        // Under the compass rather than between it and locate: the compass
        // belongs with zoom and locate, as how the map is looked at.
        if (canShare()) gl.addControl(maplibreShareControl(), "top-right");
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
      // what a light/dark switch does. That discards everything added on top
      // of it, so this is also how the storms get put back.
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
        // adding it again failed, leaving the volumes on screen frozen,
        // with every later update going to a layer that was never added.
        // Taken off here, so it goes back above the layers added before it.
        if (gl.getLayer(VOLUME_LAYER)) gl.removeLayer(VOLUME_LAYER);
        this.cloudsLayer = null;
        if (gl.getLayer(STUDIO_PLANES_LAYER)) gl.removeLayer(STUDIO_PLANES_LAYER);
        this.studioLayer = null;
        this.applyData();
        this.applyCut();
        // The sky is the style's, and a new style has none; nor the aircraft, a layer of the old one.
        if (gl.getLayer(AIRCRAFT_LAYER)) gl.removeLayer(AIRCRAFT_LAYER);
        this.aircraftLayer = null;
        if (this.flight) {
          gl.setSky(FLIGHT_SKY);
          this.ensureAircraft(gl);
          this.flightSupport?.peaks.add(gl, { dark: this.dark, satellite: this.satellite, nameKeys: this.nameKeys }, this.peaksAnchor(gl));
          this.flightSupport?.water.add(gl, { satellite: this.satellite, dark: this.dark }, this.flightQuality);
        }
      });
      // Keep the shared View in step so switching back to the flat map lands
      // where this one was left, and so anything reading the viewport agrees.
      // The tilt and heading only this map has go out with it, for the URL.
      // A camera move the reader made (drag, wheel, pinch, tilt, turn, the
      // zoom buttons) carries the DOM event that caused it; one from code
      // (a storm being framed, the camera settling back) does not. Only the
      // reader's own change where the way back to the flat map lands; see
      // open3d.ts.
      gl.on("movestart", (event) => {
        if (event.originalEvent) moved3D();
      });
      gl.on("moveend", () => {
        // A scene moves the camera every frame: acted on now and then, and once it stops.
        if (this.directed) {
          const now = performance.now();
          if (now - this.directedMoveAt < DIRECTED_MOVE_MS) return;
          this.directedMoveAt = now;
        }
        this.cameraMoved(gl);
      });
      // Tapping a storm opens the same popup the flat map opens, and tapping
      // past one closes it. The panel is rendered above whichever map is
      // showing, so it needs no separate plumbing here.
      gl.on("click", (event) => {
        // In Studio the storms are the subject, not things to open: a tap is the camera's.
        if (this.studio) return;
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
          // The same two steps the flat map takes: panel at once on a
          // desktop, forecast first on a phone. Setting the cell alone left a
          // desktop with nothing on screen but the cut: the panel is drawn only
          // for a selection whose details are open.
          const code = String(cell.properties.code);
          const next = nextSelection(
            { code: get(selectedCell)?.code ?? null, details: get(stormDetails) },
            code,
            get(smallScreen),
          );
          void this.select(code, next.details);
        } else {
          // A cell's track still in flight must not land over this: it would
          // open that cell on top of the storm core, or of nothing, after the
          // reader had moved on from it.
          this.picking = null;
          // By path: a code is a grid position, unique only within one
          // network's scan, and the list holds sixteen networks' scans.
          const listed = cloud?.properties?.path
            ? this.clouds.find((c) => c.path === cloud.properties.path) ?? null
            : null;
          // A coarse tile opens the tile under the finger: 1 km voxels are a
          // picture of where it rains, not one to cut a storm open by.
          const { lng, lat } = event.lngLat;
          const opened = listed?.coarse ? fineAt(this.clouds, lng, lat) : listed;
          // A box of sky is a seed of the storm whose patch it was cut from;
          // the panel opens at once, as a storm core's always did.
          if (opened) this.selectVolume(opened);
          else selectedStorm.set(null);
          // An earlier scan's fine tiles are found only where the map has
          // drawn them; under a coarse one drawn whole, they are asked for now.
          if (!opened && listed?.coarse && this.past) void this.openPast(listed, lng, lat);
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
          // No relief deeper than the tile a zoom up there, which MapLibre draws instead.
          if (isMissingTerrain(event.error)) return;
          this.failedSources.add(sourceId);
          console.warn(`3D map: a ${sourceId} tile failed`, event.error);
          return;
        }
        console.error(event.error);
      });
      gl.on("mousemove", (event) => {
        const over = !this.studio && gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) }).length > 0;
        gl.getCanvas().style.cursor = over ? "pointer" : "";
      });
      this.gl = gl;
      // Studio asked for before there was a map: a link that opens in it.
      if (this.studio) this.setStudio(true);
      if (this.requestedStudioCamera) this.setStudioCamera(this.requestedStudioCamera);
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
    const opening = this.openSelection(get(selectedStorm), true);
    void this.refresh();
    // The veil lifts on the first settled frame, and not before the storm
    // the reader came for has its volume loaded and uploaded (the other stall
    // of a first bring-up). `open` has framed it by then, so the map comes
    // into view already easing onto the storm.
    if (built) void Promise.all([this.settled, opening]).finally(() => cells3dLoading.set(false));
  }

  /** The camera has come to rest somewhere else: tell the rest of the app, and load what stands there. */
  private cameraMoved(gl: GlMap): void {
    // A camera in the air is nowhere the flat map or a link can stand: they keep where it took off from.
    if (!this.flight) {
      this.pushCameraToView();
      if (get(sharedActiveCap) === this.getName()) mapView.set(this.currentView());
    }
    // Some places crossed the line between coarse tiles and fine: other outlines.
    if (this.updateDetail() && this.styleReady) this.ensureClouds(gl);
    // The camera has come to other storms: load theirs, let go of the far ones.
    void this.loadClouds();
    // An earlier scan's are found only where the camera has been: look
    // here too, or once the one being looked for is in.
    if (this.pastLoading !== null) this.pastMoved = true;
    else if (this.past) void this.lookAgain();
  }

  /**
   * The cell layers that are actually on the style right now.
   *
   * `queryRenderedFeatures` throws on a layer id it does not know, and these
   * are added after the style loads and thrown away again by every light/dark
   * switch, so a tap landing in the gap would take the map down with it.
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
    this.setFlying(false);
    this.pushCameraToView();
    this.shown = false;
    cells3dFailed.set(false);
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    // `attach` refreshes, and waits again from there.
    this.volumes.stop();
    if (this.volumesTimer !== null) clearTimeout(this.volumesTimer);
    this.volumesTimer = null;
    if (this.listingTimer !== null) clearTimeout(this.listingTimer);
    this.listingTimer = null;
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
   * reader's own. Otherwise the reader has made the view theirs (moved it,
   * or walked on to another storm), and only the tilt goes back, and only if
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
    // On the way back to the flat map, `leave` owns the camera and has
    // forgotten the one from before the opening: two eases at once, and the
    // later one wins.
    if (!gl || before === null) return;
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
   * The way out of a detour (lib/open3d.ts): the reader has asked to go back,
   * and the flat map they left is about to take the element. Cut
   * straight to it and the picture snaps from a low, tilted look at one storm
   * to a map of the whole sky. So the camera first eases up and back (nadir,
   * north up, the centre and zoom the flat map was left at), and the switch
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
      // A fallback: the ease's own moveend is the signal, and this only
      // stands in if it never comes.
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
    // An earlier scan's tiles that would not load then.
    if (this.past) void this.lookAgain();
    // The storm the reader opened, if its volume failed to come down then:
    // the panel retries its own copy, and the cut here would stay unmade.
    const target = this.targetOf(get(selectedStorm));
    if (target && this.opened?.path !== target.volume.path) void this.openSelection(get(selectedStorm), true);
  }

  private detach(): void {
    stopSweep(true);
    if (this.container?.parentElement) this.container.parentElement.removeChild(this.container);
  }

  /**
   * Let go of the MapLibre map and everything it holds, to be built again
   * the next time this capability is shown.
   *
   * A hidden map is kept so that coming back is instant (see `shown`), and on
   * a phone it is most of the web view's memory: its canvas, the draped
   * terrain, the tiles and the storms' volumes. The flat map's playback adds
   * every frame it steps through, and on an iPhone 16 Pro the two together
   * passed iOS's 2 GB for a web view, which killed it (October 2026).
   * App.svelte calls this when the player starts stepping through frames. Nothing happens while shown.
   */
  unload(): void {
    const gl = this.gl;
    if (this.shown || !gl) return;
    // The tilt and heading for the way back. Where it looks comes from the
    // flat map then, as on a first bring-up.
    this.requestedCamera = { pitch: gl.getPitch(), bearing: gl.getBearing() };
    // An earlier scan's storms are found where the camera has been, which a
    // new map has not; it comes back on the newest scan.
    if (this.past || this.pastLoading !== null) this.showLatest();
    // Loads, opens and picks still in flight land nowhere.
    this.loadToken = null;
    this.openToken = null;
    this.picking = null;
    for (const { abort } of this.fetching.values()) abort.abort();
    this.fetching.clear();
    this.pastFetches.clear();
    this.cutaways.clear();
    this.retries.clear();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.fineTiles.clear();
    this.opened = null;
    this.requested = null;
    this.forgetCameraBeforeOpen();
    this.cloudsLayer = null;
    this.studioLayer = null;
    this.studioHandles.clear();
    this.styleReady = false;
    this.styleStale = false;
    this.failedSources.clear();
    this.uncorrectCtrlClicks?.();
    this.uncorrectCtrlClicks = null;
    this.unmiddleDrag?.();
    this.unmiddleDrag = null;
    gl.remove();
    this.gl = null;
    this.forgetDrapeMasks();
    this.detach();
    this.container = null;
  }

  /**
   * Which tiers a storm still draws as extrusions.
   *
   * Every cell but those standing inside a drawn volume. The volume is the
   * same weather measured another way, and `fill-extrusion` writes depth even
   * when it is translucent, so a cell left extruded inside one punches its
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
   * What to cut the selected storm open by: the box tapped or linked, else
   * the box its newest patch is in (`volumeOfStorm`, by the volumes'
   * `feature`), else its KONRAD3D cell's volume. Along the storm's heading
   * where it has one; a box with no storm found has none, and its slice
   * starts north to south.
   */
  private targetOf(selection: StormSelection | null): VolumeTarget | null {
    if (!selection) return null;
    const volume = selection.volume ?? volumeOfStorm(this.clouds, selection);
    if (volume) {
      return { code: volume.code, volume, lon: volume.lon, lat: volume.lat, heading: headingOf(selection) };
    }
    return selection.cell ? this.targetOfTrack(selection.cell) : null;
  }

  /** The volume last asked to be opened, so a selection refreshed in place does not reframe the camera. */
  private requested: string | null = null;

  /**
   * Open whatever the selection comes to here, once per volume.
   *
   * The selection changes far more often than what it cuts: its detail
   * lands, its storm is found, a refresh hands over a newer copy. Only a
   * new volume is a new open; the same one with a heading it did not have
   * (a box whose storm has been found) turns the slice to it in place.
   */
  private openSelection(selection: StormSelection | null, force = false): Promise<void> {
    const target = this.targetOf(selection);
    const path = target?.volume.path ?? null;
    if (!force && path === this.requested) {
      if (target && this.opened?.path === path && this.opened.heading !== target.heading) {
        this.opened = { ...this.opened, heading: target.heading };
        this.applyCut();
      }
      return Promise.resolve();
    }
    this.requested = path;
    return this.open(target);
  }

  /** A box of sky tapped or found: the seed of its storm, its panel open. */
  private selectVolume(volume: RadarVolume): void {
    selectedStorm.set(withVolume(get(selectedStorm), volume));
    stormDetails.set(true);
  }

  /**
   * Cut one storm open, or close whichever was open.
   *
   * Every storm is already on the map, whole; opening one only slices it. A
   * KONRAD3D cell's volume is one of the storms already drawn, found by its
   * path. If it somehow is not (the list failed to load, say), it is fetched
   * and added so that tapping a cell never opens nothing.
   */
  private async open(target: VolumeTarget | null): Promise<void> {
    const token = Symbol("open");
    this.openToken = token;
    // An earlier scan still being looked for is given up: the storm opened
    // meanwhile is the one the reader went to, and that scan's storms
    // landing around it would be another scan's drawn over it.
    if (target && this.pastLoading !== null) {
      this.pastToken = null;
      this.pastLoading = null;
      this.publishTime();
    }
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
    // on the map, and nothing is cut: a cut through interpolation between
    // two sweeps kilometres apart looks just as convincing as a real one.
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
    // selection or set by the link that opened it. App.svelte resets it from
    // its own subscription to the same stores, which can run after this one.
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
   * cut stands up as a wall of weather instead of lying flat like a map, and
   * square on to it, so the face is shown and not the edge. It is placed in
   * the part of the screen the panel leaves (above the sheet on a phone, left
   * of it on a desktop), with room for its top.
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
    // moveend, told from any other by the token it carries. If it landed
    // early because the reader took hold of the map, it is where they took
    // over.
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
   * Paint the cells and the storm cores in full colour, and the boxes on the
   * ground greyed where their storm is a scan behind the radar.
   *
   * Live, the composite for a scan is out two minutes before KONRAD3D's cells
   * for it, and half a minute more before its volumes, so for part of every
   * cycle the storms are a scan behind the radar under them. They stay in
   * colour all the same: they are the newest picture of each storm there is,
   * and greyed they read as gone. Their boxes say it instead (`boxColour`).
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
      gl.setPaintProperty(CLOUD_BOX, "line-color", boxColour(this.colormap, this.dark));
    }
    if (this.shown) gl.triggerRepaint();
  }

  /** Tell the layer which storm is open, and which way its slice now runs. */
  private applyCut(): void {
    const turn = get(cutRotationDeg) + get(cutSweepDeg);
    // A flight cuts the storm it looks into; the map, the one a reader opened.
    const looked = this.inspected;
    if (looked) {
      // The layer's cut runs along its heading and takes away what is to the right of it.
      const { cut } = looked;
      this.cloudsLayer?.setCut(looked.mode === "cut" && cut ? looked.key : null, (cut?.facingDeg ?? 90) - 90, cut && [cut.lon, cut.lat]);
      // Seen through, a storm is where its mark is: its tile, from far off, is as wide as several storms.
      this.cloudsLayer?.setInspection(looked.mode === "cut" ? null : {
        key: looked.key, ...INSPECTIONS[looked.mode], ...(looked.mode === "xray" ? { at: looked.at } : null),
        ...(looked.mode === "peel" && looked.peel !== null ? { peel: looked.peel } : null),
      });
    } else {
      this.cloudsLayer?.setInspection(null);
      this.cloudsLayer?.setCut(this.opened?.path ?? null, (this.opened?.heading ?? 0) + turn);
    }
    if (this.flight) this.studioLayer?.setPlanes(...this.flightCutSheet());
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
   * and its place goes to the next storm in view, so this asks `wanted`
   * again after a pass that found one, until a pass finds none. A volume that
   * would not load is not asked for again in the same call.
   */
  private loadClouds(): Promise<void> {
    const run = this.loadCloudsNow();
    this.cloudsLoading = run;
    return run;
  }

  private async loadCloudsNow(): Promise<void> {
    const token = Symbol("clouds");
    this.loadToken = token;
    // A new list brings new coarse tiles, each to be measured on screen.
    this.updateDetail();
    this.dropUnlisted();
    // A scan Studio has shown before comes back from what it kept, with no fetch.
    this.takeHeld();
    this.pushClouds();

    // A fast pan or zoom moves on before the last place's volumes are in:
    // stop downloading the ones no longer wanted, which an earlier load,
    // already overtaken, would only throw away.
    const wanted = new Set(this.wanted().map((cloud) => cloud.path));
    for (const [path, { abort }] of this.fetching) {
      if (!wanted.has(path)) abort.abort();
    }

    const tried = new Set<string>();
    const missing = () => this.wanted().filter((cloud) => (
      !this.cutaways.has(cloud.path) && !tried.has(cloud.path) && this.retries.ready(cloud.path, Date.now())
    ));
    for (let pass = missing(); pass.length; pass = missing()) {
      const letGoBefore = this.faint.size + this.givenUp();
      for (let i = 0; i < pass.length; i += VOLUME_FETCHES) {
        const batch = pass.slice(i, i + VOLUME_FETCHES);
        const faintInBatch = this.faint.size + this.givenUp();
        for (const cloud of batch) tried.add(cloud.path);
        const loaded = await Promise.all(batch.map(async (cloud) => {
          try {
            return { cloud, cutaway: await this.fetchVolume(cloud) };
          } catch (error) {
            // Called off because the camera moved on: not a failure.
            if ((error as { name?: string } | null)?.name !== "AbortError") {
              this.retries.failed(cloud.path, Date.now(), error instanceof VolumeGone);
            }
            return null;
          }
        }));
        // Kept even when a newer load has taken over: it was paid for, and
        // fetched again it would only arrive later.
        const listed = new Set(this.clouds.map((cloud) => cloud.path));
        for (const found of loaded) {
          if (!found || !listed.has(found.cloud.path)) continue;
          const { cloud, cutaway } = found;
          if (isFaint(cutaway)) {
            this.faint.add(cloud.path);
            continue;
          }
          this.cutaways.set(cloud.path, {
            code: cloud.code, cutaway, lon: cloud.lon, lat: cloud.lat, tier: tierOf(cloud, cutaway),
            system: cloud.system ?? null, fill: Boolean(cloud.fill),
          });
        }
        // What the new volumes stood in for can go now; see `handOver`. Drawn
        // even by a load a newer one has taken over: that one may have
        // finished already, and then nothing else would draw them. Each of
        // these works from the map's state as it is now, not this load's.
        this.dropUnlisted();
        this.hold();
        this.pushClouds();
        if (this.loadToken !== token) return;
        if (this.faint.size + this.givenUp() > faintInBatch && this.gl && this.styleReady) this.ensureClouds(this.gl);
        // Switched away: the rest waits for `attach`, whose refresh fetches
        // whatever is still missing.
        if (!this.shown) return;
      }
      if (this.faint.size + this.givenUp() === letGoBefore) break;
    }
    this.retryLater();
  }

  /** How many listed volumes would not load and are no longer asked for; see `FetchRetries`. */
  private givenUp(): number {
    return this.clouds.filter((cloud) => this.retries.givenUp(cloud.path)).length;
  }

  /** Ask again for the volumes that failed, once the soonest of them is due. */
  private retryLater(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const next = this.retries.next();
    if (next === null || !this.shown) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.shown) void this.loadClouds();
    }, Math.max(0, next - Date.now()));
  }

  /** One storm's volume, shared with any other load that asked for it meanwhile. */
  private fetchVolume(cloud: RadarVolume): Promise<Cutaway> {
    const pending = this.fetching.get(cloud.path);
    if (pending && !pending.abort.signal.aborted) return pending.volume;
    const abort = new AbortController();
    const volume = loadCutaway(cloud, abort.signal);
    const entry = { volume, abort };
    this.fetching.set(cloud.path, entry);
    const done = () => {
      if (this.fetching.get(cloud.path) === entry) this.fetching.delete(cloud.path);
    };
    volume.then(done, done);
    return volume;
  }

  /**
   * Which of the listed storms to hold volumes for: those on screen first,
   * then those just past its edges, strongest first and nearer first among
   * equals within each, up to `RESIDENT_BYTES`.
   *
   * On screen by projecting each storm's ground, not by the viewport's bounds: tilted,
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
    // From the cockpit, the aircraft chooses; see lib/studio/flight/selection.ts.
    const lookout = this.lookout();
    if (lookout) {
      const usable = this.levelled().filter((cloud) => !this.faint.has(cloud.path) && !this.retries.givenUp(cloud.path));
      return lookout.support.flightWanted(usable, lookout, FLIGHT_BYTES, textureBytes);
    }
    const gl = this.gl;
    const bounds = gl?.getBounds();
    const centre = gl?.getCenter();
    let candidates = this.levelled().filter((cloud) => !this.faint.has(cloud.path) && !this.retries.givenUp(cloud.path));
    let shown = new Set<RadarVolume>();
    if (gl && bounds && centre) {
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      const dx = (east - west) * VIEW_MARGIN;
      const dy = (north - south) * VIEW_MARGIN;
      // By its tile's ground where it has one, by its middle where not.
      const groundOf = (cloud: RadarVolume): Bounds => (
        cloud.tile ? tileBounds(cloud.tile[0], cloud.tile[1], cloud.tile[2]) : [cloud.lon, cloud.lat, cloud.lon, cloud.lat]
      );
      candidates = candidates.filter((cloud) => {
        const [w, s, e, n] = groundOf(cloud);
        return e >= west - dx && w <= east + dx && n >= south - dy && s <= north + dy;
      });
      const { clientWidth: width, clientHeight: height } = gl.getContainer();
      const view: Bounds = [west, south, east, north];
      shown = new Set(candidates.filter((cloud) => (
        footprintOnScreen(groundOf(cloud), view, (lonLat) => gl.project(lonLat), width, height)
      )));
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
   *
   * In view, only as many as `RESIDENT_BYTES` holds with everything else in
   * view drawn coarse, the largest on screen first (`fineWithin`).
   */
  private updateDetail(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const usable = (cloud: RadarVolume) => !this.faint.has(cloud.path) && !this.retries.givenUp(cloud.path);
    const tiles = new Map<string, RadarVolume[]>();
    for (const cloud of this.clouds) {
      if (cloud.coarse || !cloud.tile || !usable(cloud)) continue;
      const shift = cloud.tile[0] - COARSE_ZOOM;
      const code = tileCode(COARSE_ZOOM, cloud.tile[1] >> shift, cloud.tile[2] >> shift);
      tiles.set(code, [...tiles.get(code) ?? [], cloud]);
    }
    const lookout = this.lookout();
    if (lookout) return this.keepFine(this.flightDetail(lookout, tiles, usable));
    const fine = new Set<string>();
    const candidates: FineCandidate[] = [];
    // Everything in view, drawn coarse: what the fine tiles have to fit beside.
    let coarseInView = 0;
    for (const cloud of this.clouds) {
      if (!cloud.coarse || !cloud.tile) continue;
      const code = tileCode(cloud.tile[0], cloud.tile[1], cloud.tile[2]);
      const inView = this.inView(gl, tileBounds(cloud.tile[0], cloud.tile[1], cloud.tile[2]));
      if (inView && usable(cloud)) coarseInView += textureBytes(cloud);
      const freed = this.freedFine(cloud, tiles.get(code) ?? [], usable);
      if (freed === null || !this.drawnFine(gl, cloud.tile)) continue;
      if (!inView) {
        fine.add(code);
        continue;
      }
      candidates.push({
        code,
        across: this.acrossPx(gl, tileBounds(cloud.tile[0], cloud.tile[1], cloud.tile[2])),
        coarseBytes: freed,
        fineBytes: (tiles.get(code) ?? []).reduce((sum, tile) => sum + textureBytes(tile), 0),
      });
    }
    for (const code of fineWithin(candidates, RESIDENT_BYTES - coarseInView)) fine.add(code);
    return this.keepFine(fine);
  }

  /**
   * What drawing a coarse tile as its tiles frees of its own texture: all
   * of it, as on the map. Drawing the whole sky (`fillSky`), none where it
   * stays drawn over the ground its tiles leave (`weakParts`), and null
   * where it has no tiles to be drawn as, a fill tile's case: it stays
   * coarse, rather than its weak echo going with it. Its tiles are every
   * network's under it (`coveringTiles`): a fill tile over a neighbouring
   * network's storm is drawn as its weak parts close up, as a coarse tile is.
   */
  private freedFine(cloud: RadarVolume, tiles: readonly RadarVolume[], usable: (cloud: RadarVolume) => boolean): number | null {
    const own = usable(cloud) ? textureBytes(cloud) : 0;
    if (!this.fillSky || !cloud.tile) return own;
    return freedAsTiles(cloud.tile, tiles, own);
  }

  /** Make `fine` the coarse tiles drawn as their tiles; whether that changed any. */
  private keepFine(fine: Set<string>): boolean {
    const changed = fine.size !== this.fineTiles.size || [...fine].some((code) => !this.fineTiles.has(code));
    this.fineTiles = fine;
    return changed;
  }

  /**
   * `updateDetail` from the cockpit: by distance from the aircraft, not size
   * on screen, within what is held around it; see lib/studio/flight/selection.ts.
   */
  private flightDetail(
    lookout: Lookout & { support: FlightSupport }, tiles: Map<string, RadarVolume[]>, usable: (cloud: RadarVolume) => boolean,
  ): Set<string> {
    let coarseHeld = 0;
    const places: CoarsePlace[] = [];
    for (const cloud of this.clouds) {
      if (!cloud.coarse || !cloud.tile || !lookout.support.withinHold(lookout, cloud.lon, cloud.lat)) continue;
      const code = tileCode(cloud.tile[0], cloud.tile[1], cloud.tile[2]);
      coarseHeld += usable(cloud) ? textureBytes(cloud) : 0;
      const coarseBytes = this.freedFine(cloud, tiles.get(code) ?? [], usable);
      if (coarseBytes === null) continue;
      places.push({
        code, lon: cloud.lon, lat: cloud.lat, coarseBytes,
        fineBytes: (tiles.get(code) ?? []).reduce((sum, tile) => sum + textureBytes(tile), 0),
      });
    }
    return lookout.support.flightFine(places, lookout, this.fineTiles, FLIGHT_BYTES - coarseHeld);
  }

  /** Whether a coarse tile stands large enough on screen to be drawn as its tiles; see `FINE_ABOVE_PX`. */
  private drawnFine(gl: GlMap, tile: readonly number[]): boolean {
    const code = tileCode(tile[0], tile[1], tile[2]);
    // From the cockpit, by how near the aircraft it is.
    if (this.flight && this.flightPose && this.flightSupport) {
      const [lon, lat] = tileCentre(tile[0], tile[1], tile[2]);
      return this.flightSupport.nearEnoughForFine(this.flightPose, lon, lat, this.fineTiles.has(code));
    }
    const across = this.acrossPx(gl, tileBounds(tile[0], tile[1], tile[2]));
    return across > (this.fineTiles.has(code) ? COARSE_BELOW_PX : FINE_ABOVE_PX);
  }

  /** How large a stretch of ground, west, south, east, north, stands on screen, in CSS pixels across. */
  private acrossPx(gl: GlMap, [west, south, east, north]: readonly number[]): number {
    const corners = ([[west, south], [east, south], [east, north], [west, north]] as const)
      .map(([lon, lat]) => gl.project([lon, lat]));
    return Math.max(
      Math.max(...corners.map(({ x }) => x)) - Math.min(...corners.map(({ x }) => x)),
      Math.max(...corners.map(({ y }) => y)) - Math.min(...corners.map(({ y }) => y)),
    );
  }

  /** Whether a stretch of ground is on screen, or just past its edges; see `VIEW_MARGIN`. */
  private inView(gl: GlMap, [west, south, east, north]: readonly number[]): boolean {
    const bounds = gl.getBounds();
    const dx = (bounds.getEast() - bounds.getWest()) * VIEW_MARGIN;
    const dy = (bounds.getNorth() - bounds.getSouth()) * VIEW_MARGIN;
    return east >= bounds.getWest() - dx && west <= bounds.getEast() + dx
      && north >= bounds.getSouth() - dy && south <= bounds.getNorth() + dy;
  }

  /**
   * The listed volumes to draw: coarse tiles where they are small on screen,
   * fine ones where large. An earlier scan's coarse tile stays whole where
   * its fine tiles have not been found, or were not there.
   */
  private levelled(weak = this.fillSky): RadarVolume[] {
    const coarse = (tile: readonly number[]) => {
      const code = tileCode(tile[0], tile[1], tile[2]);
      return !this.fineTiles.has(code) || (this.past !== null && !this.pastFine.has(code));
    };
    // Drawing the whole sky, a coarse tile drawn as its tiles stays where they leave its weak echo; see `weakParts`.
    const covers = weak
      ? { covers: (cloud: RadarVolume) => !this.faint.has(cloud.path) && !this.retries.givenUp(cloud.path) }
      : null;
    return atLevel(this.clouds, coarse, this.opened?.path ?? null, covers);
  }

  /**
   * Drawing the whole sky (`fillSky`), the tiles of its own each coarse tile
   * held is drawn over: those of its ground none of the finer tiles drawn
   * beside it lies on (`weakParts`); null for all of it, and an empty list
   * for none. Worked out from what is drawn, not what is wanted, so a
   * coarse tile stays whole until its tiles are in. Nothing on the map,
   * where a coarse tile is drawn whole or not at all.
   */
  private weakWithin(drawn: ReadonlyArray<[string, Cutaway]>): Map<string, number[][] | null> {
    if (!this.fillSky) return new Map();
    // Every network's: another's storm under this tile is a cloud it must not be drawn over too.
    return drawnWithin(drawn.map(([key, { header }]) => ({ key, tile: header.tile ?? null })));
  }

  /**
   * Forget every volume no longer listed or no longer wanted in view, bar the
   * open one and those standing in for volumes still on their way (`handOver`).
   */
  private dropUnlisted(): void {
    const wanted = new Set(this.wanted().map((cloud) => cloud.path));
    const { keep } = this.handOver();
    for (const path of this.cutaways.keys()) {
      if (!wanted.has(path) && !keep.has(path) && path !== this.opened?.path) this.cutaways.delete(path);
    }
  }

  /**
   * Which held volumes stand in for wanted ones still on their way, and which
   * of those already in wait behind them; see `lib/volumeHandover.ts`. The
   * open storm is neither: it stays as it is, and `pushClouds` keeps its
   * successors off the map.
   */
  private handOver(): { keep: Set<string>; hide: Set<string> } {
    const wanted = this.wanted();
    const listed = new Map(this.clouds.map((cloud) => [cloud.path, cloud]));
    // Nearest the aircraft while flying: the map's centre is then a point in the air ahead.
    const centre = this.flight && this.flightPose ? { lng: this.flightPose.lon, lat: this.flightPose.lat } : this.gl?.getCenter();
    const distance = ({ lon, lat }: { lon: number; lat: number }) => (centre
      ? Math.hypot((lon - centre.lng) * Math.cos((lat * Math.PI) / 180), lat - centre.lat)
      : 0);
    const held = [...this.cutaways]
      .filter(([path]) => path !== this.opened?.path)
      .sort(([, a], [, b]) => distance(a) - distance(b))
      .map(([path, { cutaway }]) => placed(path, listed.get(path) ?? cutaway.header));
    const pending = wanted
      .filter((cloud) => !this.cutaways.has(cloud.path))
      .map((cloud) => placed(cloud.path, cloud));
    const bytes = new Map([...this.cutaways].map(([path, { cutaway }]) => [path, cutaway.voxels.byteLength]));
    // The newest scan's parts are waited for; an earlier scan's list is whole.
    const listing = this.past === null && this.pastLoading === null ? this.listing.listing(Date.now()) : new Map<string, number>();
    return handOver(
      wanted.map((cloud) => placed(cloud.path, cloud)), held, pending, (volume) => bytes.get(volume.path) ?? 0,
      this.flight ? FLIGHT_BYTES : RESIDENT_BYTES, listing,
    );
  }

  /**
   * Let the scan before go once its network's newest has been listed whole,
   * which no new list says: a while with no part added (`ScanListing`).
   */
  private settleLater(): void {
    if (this.listingTimer !== null) clearTimeout(this.listingTimer);
    this.listingTimer = null;
    const at = this.listing.nextSettled(Date.now());
    if (at === null) return;
    this.listingTimer = setTimeout(() => {
      this.listingTimer = null;
      if (this.shown) {
        this.dropUnlisted();
        this.pushClouds();
      }
      this.settleLater();
    }, at - Date.now() + 1);
  }

  /**
   * Hand the layer every loaded storm, and let the tiers inside them stand down.
   *
   * Bar the newer scans of an open storm that is older than the list. A
   * storm open when a new scan lands is kept as it was, and the new scan
   * brings the same storm again under a new path (and usually a new code,
   * its peak having moved a pixel), so both were drawn, one volume over the
   * other a few kilometres apart. The same happens opening a link to an old
   * scan. Its successor comes back when the storm is closed.
   */
  private pushClouds(): void {
    const open = this.opened ? this.cutaways.get(this.opened.path) : undefined;
    const stale = open && !this.clouds.some((cloud) => cloud.path === this.opened?.path);
    const held = this.heldOpen();
    // Volumes in, waiting behind what stands in for them until the rest are in too.
    const { hide } = this.handOver();
    const shown = [...this.cutaways].filter(([path, { cutaway }]) => !hide.has(path) && (
      !stale || path === this.opened?.path || !isSuccessor(open.cutaway, cutaway)
    ));
    const within = this.weakWithin(shown.map(([path, { cutaway }]) => [path, cutaway]));
    // A coarse tile its tiles cover all of, standing in meanwhile, is not drawn over them.
    const drawn = shown.filter(([path]) => within.get(path)?.length !== 0).map(([key, entry]): StudioCloud => {
      const { cutaway, tier, system, fill } = entry;
      const part = within.get(key);
      return {
        key,
        cutaway,
        system,
        // A fill tile never opens, and is not dimmed for it: it is weak rain, seen as well as the storm beside it.
        dim: tier === TIER_UNOPENABLE && !fill ? DIM_UNOPENABLE : 1,
        // Held whole: its layers are interpolation, which a peel cannot reveal
        // anything in. A fill tile too: weak echo, with no core to peel to.
        peels: tier !== TIER_UNOPENABLE && !fill,
        ...(part ? { within: part } : {}),
      };
    });
    this.keepDrawn(drawn);
    const blended = this.blended();
    this.blending = blended !== null;
    this.cloudsLayer?.setClouds(blended ?? drawn);
    this.cloudsLayer?.setBlend(blended && this.blend ? this.blend.fraction : null);
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
   * it was opened from an older list than this one (the flat map's, a
   * link). See `isPastItsScan`.
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
    const layer = makeCloudsLayer(
      VOLUME_LAYER, this.maplibre.MercatorCoordinate, this.colormap, (dbz) => peelTop.set(dbz), get(cloudStyle),
    );
    layer.setPeel(get(peelLevel), get(peelManual));
    // A flight under way has its own sky, and a layer made anew in it (a style change) is to have it too.
    layer.setScenic(this.flightSupport?.cloudscape(this.cloudBaseKm) ?? null, this.flightSupport?.makeScenicPass);
    gl.addLayer(layer);
    this.cloudsLayer = layer;
    this.pushClouds();
    this.applyCut();
    this.applySections();
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
   * (`lib/cloudFootprint.ts`): the storm's own centre once its volume is
   * in, the box's until then.
   */
  private ensureClouds(gl: GlMap): void {
    const data = {
      type: "FeatureCollection" as const,
      // Not for a storm too faint to draw: a box promises a cloud.
      // Nor for a fill tile, which is no storm, nor for a coarse tile drawn beside its own tiles, which have theirs.
      features: this.levelled(false).filter((cloud) => !this.faint.has(cloud.path) && !cloud.fill).map((cloud) => {
        const dbz = cloud.peak_dbz ?? 40;
        // Against the radar draped under it: the live one, or, with an earlier
        // scan picked, that scan's own, which no storm on the map is behind.
        const stale = !this.past && isVolumeBehind(cloud, { scan: this.radarScan, networks: this.networkFrames });
        const properties = { code: cloud.code, path: cloud.path, dbz, tier: cloud.tier ?? 2, stale };
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
    // Every volume landing asks for the boxes again, and most change none of
    // them. Set anyway, the source was rebuilt each time, and a tap landing
    // while it was found no box under it and opened nothing.
    const drawn = JSON.stringify(data);
    if (source) {
      if (drawn === this.cloudsDrawn) return;
      this.cloudsDrawn = drawn;
      (source as unknown as { setData(data: unknown): void }).setData(data);
      return;
    }
    this.cloudsDrawn = drawn;
    gl.addSource(CLOUD_SOURCE, { type: "geojson", data, attribution: dwdAttribution });
    // Fainter for a storm that does not open, as the storm itself is.
    const unopenable: ExpressionSpecification = ["==", ["get", "tier"], TIER_UNOPENABLE];
    // On the ground with the radar, under the storms: see `drapeAnchor`.
    const under = drapeAnchor(gl.getStyle().layers);
    const casing = boxCasing(this.dark);
    const visibility = this.boxVisibility();
    gl.addLayer({
      id: CLOUD_BOX_CASING,
      type: "line",
      source: CLOUD_SOURCE,
      layout: { "line-join": "round", visibility },
      paint: {
        "line-color": `rgba(${casing.colour.join(", ")})`,
        "line-width": casing.width,
        "line-opacity": ["case", unopenable, RING_OPACITY.unopenable, RING_OPACITY.openable],
      },
    }, under);
    gl.addLayer({
      id: CLOUD_BOX,
      type: "line",
      source: CLOUD_SOURCE,
      layout: { "line-join": "round", visibility },
      paint: {
        "line-color": boxColour(this.colormap, this.dark),
        "line-width": 1.5,
        "line-opacity": ["case", unopenable, RING_OPACITY.unopenable, RING_OPACITY.openable],
      },
    }, under);
    // Not drawn, only hit: a fill at no opacity is still queried.
    gl.addLayer({
      id: CLOUD_HIT,
      type: "fill",
      source: CLOUD_SOURCE,
      paint: { "fill-opacity": 0 },
    }, under);
  }

  /**
   * Open the detail popup for a tapped storm.
   *
   * This map is drawn from `/cells/current`, which is one timestep: it knows
   * a cell's structure but not its history, and the popup is mostly history.
   * So the tap fetches the track the flat map would already have had.
   */
  private async select(code: string, details: boolean): Promise<void> {
    const token = Symbol("pick");
    this.picking = token;
    try {
      const answer = await fetchCellTrack(code, this.nanobar);
      if (this.picking !== token) return;
      const track = answer as unknown as CellTrack | undefined;
      if (track?.properties) {
        selectedCell.set(track.properties);
        stormDetails.set(details);
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
  /**
   * Turn by a two-finger rotation, as two fingers on glass turn MapLibre's
   * map: clockwise fingers turn the map clockwise, so the bearing falls.
   * Absolute from where the turn began, so a late or lost step only delays it.
   */
  turn(degrees: number | null): boolean {
    const gl = this.gl;
    if (degrees === null || !gl || !this.shown) {
      this.turnFrom = null;
      return false;
    }
    this.turnFrom ??= gl.getBearing();
    gl.setBearing(this.turnFrom - degrees);
    return true;
  }

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
   * has since been replaced. A core's code is its grid position, so it cannot
   * be followed into the next scan, but its volume is immutable and
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
      const volume = volumeOf(path, cutaway);
      // Held like a listed one, so opening it does not fetch it a second time.
      this.cutaways.set(path, {
        code: volume.code, cutaway, lon: volume.lon, lat: volume.lat, tier: volume.tier, system: null,
      });
      this.pushClouds();
      return volume;
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
   * Put the map into Studio, or back out of it; see `studio`.
   *
   * Out of it, everything Studio changed about the map goes back: the cut is
   * an opened storm's again, the lens the map's own, the tilt within what a
   * map is looked at from, and the storms the newest scan's: an earlier one
   * is Studio's to show, and the map outside it has no way to say which scan
   * it is on, or to leave it.
   */
  private setStudio(on: boolean): void {
    // A flight is Studio's: it lands first, while the map is still in Studio to land in.
    if (!on) this.setFlying(false);
    this.studio = on;
    if (on) selectedStorm.set(null);
    else {
      // Outside Studio the map shows one scan, the newest, and never blends.
      this.blendScans(null);
      this.studioHeld.clear();
      this.studioHeldBytes = 0;
      this.studioDrawn.clear();
      this.blendMotions.clear();
      this.setDirected(false);
      if (this.past || this.pastLoading !== null) this.showLatest();
    }
    const gl = this.gl;
    if (!gl) return;
    if (!on && gl.getPitch() > MAX_PITCH) gl.setPitch(MAX_PITCH);
    gl.setMaxPitch(on ? STUDIO_MAX_PITCH : MAX_PITCH);
    this.applyLens();
    if (this.styleReady) this.ensureStudio(gl);
    for (const id of [CLOUD_BOX_CASING, CLOUD_BOX]) {
      if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", this.boxVisibility());
    }
    this.applySections();
  }

  /**
   * The storms' boxes on the ground are for finding one to open, and Studio
   * opens none: there they are only a grid drawn over every picture. Put
   * away while in Studio, back on leaving it; a restyle adds them as this says.
   */
  private boxVisibility(): "visible" | "none" {
    return this.studio ? "none" : "visible";
  }

  /** The layer Studio's planes are drawn by, there while in Studio and gone outside it. */
  private ensureStudio(gl: GlMap): void {
    if (!this.studio) {
      if (gl.getLayer(STUDIO_PLANES_LAYER)) gl.removeLayer(STUDIO_PLANES_LAYER);
      this.studioLayer = null;
      return;
    }
    // Studio's panel, which is what makes planes, brings what draws them; see `setStudioSupport`.
    if (this.studioLayer || !this.studioSupport) return;
    this.studioLayer = this.studioSupport.makeStudioPlanesLayer(STUDIO_PLANES_LAYER);
    gl.addLayer(this.studioLayer);
    this.applySections();
  }

  /**
   * Studio's panel is up, and with it the code that cuts storms by its
   * planes and draws them: until then the map has neither, and no plane to
   * need them for.
   */
  setStudioSupport(support: StudioSupport): void {
    this.studioSupport = support;
    if (this.gl && this.styleReady) this.ensureStudio(this.gl);
    this.applySections();
  }

  /** Cut the clouds by Studio's planes and draw them, or by none of them outside Studio. */
  private applySections(): void {
    // Not Studio's own while flying: the flight has a cut of its own (`flightCutSheet`).
    const support = this.studioSupport;
    const cutting = this.studio && !this.flight && support !== null;
    const planes = cutting ? get(studioPlanes) : [];
    const selected = get(studioSelectedPlane);
    this.cloudsLayer?.setSections(cutting && support ? support.clipPlanes(planes) : null);
    if (this.flight) this.studioLayer?.setPlanes(...this.flightCutSheet());
    else this.studioLayer?.setPlanes(planes, selected);

    // A handle on the ground under each plane that stands on it, to drag it
    // by. A level plane has no place on the ground; its height is in its panel.
    const gl = this.gl;
    const maplibre = this.maplibre;
    if (!gl || !maplibre) return;
    const held = new Set(planes.filter((plane) => !support?.isLevel(plane)).map((plane) => plane.id));
    for (const [id, handle] of this.studioHandles) {
      if (held.has(id)) continue;
      handle.remove();
      this.studioHandles.delete(id);
    }
    for (const plane of planes) {
      if (!held.has(plane.id)) continue;
      let handle = this.studioHandles.get(plane.id);
      if (!handle) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "studio-plane-handle";
        element.textContent = String(plane.id);
        element.title = t("studio.plane.handle", { values: { id: plane.id } });
        element.addEventListener("pointerdown", () => studioSelectedPlane.set(plane.id));
        handle = new maplibre.Marker({ element, draggable: true }).setLngLat([plane.lon, plane.lat]).addTo(gl);
        const dragged = handle;
        dragged.on("drag", () => {
          const { lng, lat } = dragged.getLngLat();
          studioPlanes.update((all) => all.map((other) => (other.id === plane.id ? { ...other, lon: lng, lat } : other)));
        });
        this.studioHandles.set(plane.id, handle);
      }
      const at = handle.getLngLat();
      if (at.lng !== plane.lon || at.lat !== plane.lat) handle.setLngLat([plane.lon, plane.lat]);
      handle.getElement().classList.toggle("selected", plane.id === selected);
    }
    if (this.shown) gl.triggerRepaint();
  }

  /** The lens Studio asks for, or the map's own outside it. */
  private applyLens(): void {
    const gl = this.gl;
    if (!gl) return;
    const fov = this.studio ? get(studioFov) : DEFAULT_FOV;
    if (Math.abs(gl.getVerticalFieldOfView() - fov) > 0.01) gl.setVerticalFieldOfView(fov);
  }

  /** Keep hold of the volumes on the map while in Studio, as far as `STUDIO_HELD_BYTES` goes. */
  private hold(): void {
    // Not while flying: a flight wants the memory, and what it flies past is not Studio's to play back.
    if (!this.studio || this.flight) return;
    for (const [path, { cutaway }] of this.cutaways) {
      if (this.studioHeld.has(path)) continue;
      const bytes = cutaway.voxels.byteLength;
      if (this.studioHeldBytes + bytes > STUDIO_HELD_BYTES) return;
      this.studioHeld.set(path, cutaway);
      this.studioHeldBytes += bytes;
      // What the motion between two scans is matched by, worked out as each
      // volume lands rather than all of a scan's on the frame it is blended.
      columnDepth(cutaway);
    }
  }

  /** The scan on the map, as `studioDrawn` and a blend name it: the newest's own, for the newest. */
  private scanShown(): Scan | null {
    return this.past?.scan ?? this.latestScan();
  }

  /**
   * Keep what the scan on the map draws, while in Studio, for a blend to
   * draw it again: of the volumes held, and of its own, not those of the
   * scan before it standing in for volumes still on their way.
   */
  private keepDrawn(drawn: StudioCloud[]): void {
    const scan = this.scanShown();
    if (!this.studio || scan === null || this.pastLoading !== null) return;
    const listed = new Set(this.clouds.map((cloud) => cloud.path));
    this.studioDrawn.set(scan, drawn.filter(({ key }) => listed.has(key) && this.studioHeld.has(key)));
  }

  /**
   * Both scans of the blend as the layer takes them, each cloud with its
   * side and its storm's drift; null where either has not been on the map
   * in Studio yet, and the scan on the map is drawn alone meanwhile.
   */
  private blended(): Array<StudioCloud & { side: 0 | 1; drift: readonly [number, number] }> | null {
    const blend = this.blend;
    if (!this.studio || !blend) return null;
    const [from, to] = [this.keptDrawn(blend.from), this.keptDrawn(blend.to)];
    const motion = this.motionOf(blend.from, blend.to);
    if (!from || !to || !motion) return null;
    // A cloud the motion was not worked out for (the camera has moved since) moves with them all.
    const still: readonly [number, number] = [0, 0];
    const drift = (key: string) => motion.byKey.get(key) ?? motion.all ?? still;
    return [
      ...from.map((cloud) => ({ ...cloud, side: 0 as const, drift: drift(cloud.key) })),
      ...to.map((cloud) => ({ ...cloud, side: 1 as const, drift: drift(cloud.key) })),
    ];
  }

  /** What a scan drew when last on the map in Studio; see `studioDrawn`. The newest's own for anything newer. */
  private keptDrawn(scan: Scan): StudioCloud[] | undefined {
    const latest = this.latestScan();
    return this.studioDrawn.get(latest !== null && scan >= latest ? latest : scan);
  }

  /** The storms' motion from one scan to the next, worked out the first time it is asked; null before both have been drawn. */
  private motionOf(from: Scan, to: Scan): Motion | null {
    const pair = `${from}:${to}`;
    const known = this.blendMotions.get(pair);
    if (known) return known;
    const [earlier, later] = [this.keptDrawn(from), this.keptDrawn(to)];
    if (!earlier || !later) return null;
    const motion = cloudMotion([
      ...earlier.map((cloud) => ({ ...cloud, side: 0 as const })), ...later.map((cloud) => ({ ...cloud, side: 1 as const })),
    ]);
    this.blendMotions.set(pair, motion);
    return motion;
  }

  /**
   * Work out the storms' motion between two scans ahead of their blend: a
   * scene's load does, for every pair it will play, so the frame a pair
   * comes up on does not pay for it (tens of milliseconds, matching every
   * storm in view).
   */
  prepareBlend(from: Scan, to: Scan): void {
    if (!this.studio) return;
    // Worked out again where the two scans have been drawn from elsewhere
    // since (a scene changed, its camera moved): only then, not as a scene
    // plays, where a camera on the move adds tiles every few hundred ms.
    const known = this.blendMotions.get(`${from}:${to}`);
    const drawn = [...this.keptDrawn(from) ?? [], ...this.keptDrawn(to) ?? []];
    if (known && drawn.some(({ key }) => !known.byKey.has(key))) this.blendMotions.delete(`${from}:${to}`);
    this.motionOf(from, to);
  }

  /**
   * Draw two scans at once, `fraction` of the way from the earlier to the
   * later, or one again for null: Studio playing through the minutes between
   * two scans (lib/studio/scene.ts), the storms carried along their motion
   * from one to the other (layers/cellVolumeLayer.ts). Each scan is drawn
   * as it was when last on the map in Studio, which a scene's load has seen
   * to; until both have been, the scan on the map is drawn alone.
   *
   * A new pair hands the layer its clouds, and uploads the textures of the
   * scan new to it; a frame of the same pair only moves the fraction.
   */
  blendScans(blend: { from: Scan; to: Scan; fraction: number } | null): void {
    const next = this.studio ? blend : null;
    const same = next !== null && this.blend !== null && next.from === this.blend.from && next.to === this.blend.to;
    const wasBlending = this.blending;
    this.blend = next;
    // The same pair, not yet drawn, waits for the load that brings its
    // second scan, whose own `pushClouds` draws it.
    if (same) {
      if (wasBlending) this.cloudsLayer?.setBlend(next.fraction);
    } else if (next !== null || wasBlending) {
      this.pushClouds();
    }
    this.applyDrapeBlend();
  }

  /** Put the volumes Studio kept back on the map where they are wanted again. */
  private takeHeld(): void {
    if (!this.studio || !this.studioHeld.size) return;
    for (const cloud of this.wanted()) {
      if (this.cutaways.has(cloud.path)) continue;
      const cutaway = this.studioHeld.get(cloud.path);
      if (!cutaway) continue;
      this.cutaways.set(cloud.path, {
        code: cloud.code, cutaway, lon: cloud.lon, lat: cloud.lat, tier: tierOf(cloud, cutaway),
        system: cloud.system ?? null,
      });
    }
  }

  /** Where Studio's camera stands; null before the map is up. */
  studioCamera(): StudioCamera | null {
    const gl = this.gl;
    if (!gl) return null;
    const { lng, lat } = gl.getCenter();
    return {
      lon: lng, lat, zoom: gl.getZoom(), pitch: gl.getPitch(), bearing: gl.getBearing(), fov: gl.getVerticalFieldOfView(),
    };
  }

  /** Stand the camera exactly here, at once: one frame of a scene. Before the map is up, once it is. */
  setStudioCamera(camera: StudioCamera): void {
    const gl = this.gl;
    this.requestedStudioCamera = gl ? null : camera;
    if (!gl) return;
    if (Math.abs(gl.getVerticalFieldOfView() - camera.fov) > 0.01) gl.setVerticalFieldOfView(camera.fov);
    gl.jumpTo({ center: [camera.lon, camera.lat], zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing });
  }

  /** Move the camera there over a moment, where it is the reader who asked: a named view. */
  easeStudioCamera(camera: Partial<Pick<StudioCamera, "pitch" | "bearing" | "zoom">>, ms = 700): void {
    this.gl?.easeTo({ ...camera, duration: ms });
  }

  /**
   * A scene is moving the camera, or has stopped: while it does, its moves
   * are acted on only now and then (`DIRECTED_MOVE_MS`), and once more when
   * it stops, where the camera was left.
   */
  setDirected(on: boolean): void {
    // A flight directs the camera until it lands, whatever a paused scene says.
    if (this.directed === on || (!on && this.flight)) return;
    this.directed = on;
    if (!on && this.gl) this.cameraMoved(this.gl);
  }

  /**
   * Put a scan's storms on the map, as `showScan` does, and say when they
   * are: once everything of it that is wanted in view has loaded. Whether it
   * is the scan on the map by then; not, where it had nothing here, or
   * another was asked for meanwhile.
   */
  async stageScan(scan: Scan | null): Promise<boolean> {
    const latest = this.latestScan();
    const live = scan === null || (latest !== null && scan >= latest);
    if (live) this.showLatest();
    else if (this.past?.scan !== scan) await this.findScan(scan);
    else if (this.pastLoading !== null) this.showScan(scan);
    // Every load asked for meanwhile, until none is left running.
    let run: Promise<void>;
    do {
      run = this.cloudsLoading;
      await run;
    } while (run !== this.cloudsLoading);
    return live ? this.past === null : this.past?.scan === scan;
  }

  /** The newest scan there is, which a scene's earlier ones count back from; null before the first list. */
  newestScan3D(): Scan | null {
    return this.latestScan();
  }

  /** The canvas the map is drawn on, for a recording to read; null before the map is up. */
  canvas(): HTMLCanvasElement | null {
    return this.gl?.getCanvas() ?? null;
  }

  /**
   * Tell `listener` after every frame the map draws, while the frame is
   * still on its canvas to be read. Returns how to stop.
   */
  onFrame(listener: () => void): () => void {
    const gl = this.gl;
    if (!gl) return () => {};
    gl.on("render", listener);
    return () => gl.off("render", listener);
  }

  /** Draw a frame, whether or not anything changed: a recording wants one each tick. */
  repaint(): void {
    if (this.shown) this.gl?.triggerRepaint();
  }

  /**
   * Put the map into Studio's flight, or take it back out (lib/studio/flight).
   *
   * In: the camera is set free (its centre no longer held to the ground, its
   * tilt allowed to the horizon and past it, its zoom whatever its position
   * works out to), no hand moves the map, the controls are put away, a sky
   * goes up, the section planes stop cutting, and the storms are chosen from
   * the aircraft (`wanted`, `updateDetail`). Its moves are acted on now and
   * then, as a scene's are, and never reach the flat map or the link.
   *
   * Out: all of that exactly as it was, the camera level again and landed on
   * a Studio view of where the flight ended: looking at the ground a little
   * ahead of the aircraft, along its heading. Also on leaving Studio, the 3D
   * map, or the page, whichever comes first.
   */
  setFlying(on: boolean, support?: FlightSupport): void {
    const gl = this.gl;
    if (on) {
      if (this.flight || !gl || !this.studio || !support) return;
      this.flightSupport = support;
      // What Studio kept of earlier scans goes: the flight shows the newest, and wants the memory. Fetched again after.
      this.studioHeld.clear();
      this.studioHeldBytes = 0;
      this.studioDrawn.clear();
      this.blendMotions.clear();
      this.cloudsLayer?.setScenic(support.cloudscape(this.cloudBaseKm), support.makeScenicPass);
      this.flight = {
        minZoom: gl.getMinZoom(),
        maxZoom: gl.getMaxZoom(),
        maxPitch: gl.getMaxPitch(),
        clamped: gl.getCenterClampedToGround(),
        handlers: Object.fromEntries(FLIGHT_HANDLERS.map((name) => [name, gl[name].isEnabled()])) as Record<
          (typeof FLIGHT_HANDLERS)[number], boolean
        >,
      };
      for (const name of FLIGHT_HANDLERS) gl[name].disable();
      gl.setCenterClampedToGround(false);
      gl.setMinZoom(FLIGHT_ZOOM[0]);
      gl.setMaxZoom(FLIGHT_ZOOM[1]);
      gl.setMaxPitch(180);
      this.container?.classList.add("flying");
      if (this.styleReady) {
        gl.setSky(FLIGHT_SKY);
        this.ensureAircraft(gl);
        this.flightSupport?.peaks.add(gl, { dark: this.dark, satellite: this.satellite, nameKeys: this.nameKeys }, this.peaksAnchor(gl));
        if (!this.terrainWanted) applyTerrain(gl, true, this.dark, this.drapeSize());
        this.applyFlightLod(gl);
        support.water.add(gl, { satellite: this.satellite, dark: this.dark }, this.flightQuality);
      }
      this.applySections();
      this.setDirected(true);
      this.applyFlightLabels();
      return;
    }
    const before = this.flight;
    if (!before) return;
    const pose = this.flightPose;
    const had = this.flightSupport;
    this.flight = null;
    this.flightSupport = null;
    this.cloudsLayer?.setScenic(null);
    this.flightPose = null;
    this.flightLooking = null;
    this.aircraftView = null;
    this.aircraftScreens = [];
    this.flightWeather = null;
    this.trafficPass = null;
    this.cloudsLayer?.setGlow(null);
    this.setFlightQuality(1);
    studioFlying.set(false);
    if (gl) {
      if (gl.getLayer(AIRCRAFT_LAYER)) gl.removeLayer(AIRCRAFT_LAYER);
      this.aircraftLayer = null;
      had?.peaks.remove(gl);
      if (this.styleReady) gl.setSky(undefined as unknown as SkySpecification);
      if (this.styleReady && !this.terrainWanted) applyTerrain(gl, false, this.dark, this.drapeSize());
      if (this.styleReady) this.applyFlightLod(gl);
      budgetDrapes(gl, null);
      flightFog(gl, false);
      indexDrapes(gl, false);
      had?.water.remove(gl);
      gl._camera?.transform?.clearNearFarZOverride?.();
      gl.setCenterClampedToGround(before.clamped);
      if (pose && had) {
        const [lon, lat] = had.destination(pose.lon, pose.lat, pose.heading, LANDING_KM * 1000);
        gl.jumpTo({ center: [lon, lat], bearing: pose.heading, roll: 0, ...LANDING_VIEW, elevation: 0 });
      } else {
        gl.setRoll(0);
      }
      if (gl.getPitch() > before.maxPitch) gl.setPitch(before.maxPitch);
      gl.setMaxPitch(before.maxPitch);
      gl.setMinZoom(before.minZoom);
      gl.setMaxZoom(before.maxZoom);
      for (const name of FLIGHT_HANDLERS) {
        if (before.handlers[name]) gl[name].enable();
      }
    }
    this.container?.classList.remove("flying");
    this.flightLabelSize = LABEL_SIZES[LABEL_SIZES.length - 1][1];
    this.applyFlightLabels();
    this.inspected = null;
    this.applyCut();
    this.setRadarOnGround(true);
    this.applySections();
    // The once a directed camera's moves are acted on when it stops: where it landed.
    this.setDirected(false);
  }

  /**
   * Stand the camera in the cockpit. Drawn as tall as the world is
   * (`VERTICAL_SCALE`), or the aircraft would sit wrong against the storm
   * tops and the peaks it is flying among; the instruments read true.
   */
  setFlightCamera(pose: FlightPose, eye?: FlightEye): void {
    const gl = this.gl;
    const support = this.flightSupport;
    if (!this.flight || !gl || !support) return;
    this.flightPose = pose;
    const looking = eye ?? pose;
    this.flightLooking = looking.heading;
    // The eye's place from the aircraft is true metres, as the aircraft drawn round it is: only its height over the sea is stretched.
    const [lon, lat] = eye
      ? support.destination(pose.lon, pose.lat, (Math.atan2(eye.east, eye.north) * 180) / Math.PI, Math.hypot(eye.north, eye.east))
      : [pose.lon, pose.lat];
    // Straight up or down has no heading for the map to turn to: a degree short of both.
    const pitch = Math.min(Math.max(looking.pitch, -89), 89);
    const height = pose.altitude * VERTICAL_SCALE + (eye?.up ?? 0);
    const ground = gl.queryTerrainElevation([pose.lon, pose.lat]) ?? 0;
    this.sizeFlightLabels(pose.altitude - ground / VERTICAL_SCALE);
    const transform = gl._camera?.transform;
    // The map works out how near it draws from afresh, for the far end of what it draws.
    transform?.clearNearFarZOverride?.();
    // What the eye looks at is found on the ground under it, not where the last look left it: layers/flightGround.ts.
    const looked = lookedAtHeight(ground, height);
    transform?.setElevation?.(looked);
    this.flightOver = this.maplibre?.MercatorCoordinate.fromLngLat([lon, lat], height - looked).z ?? 0;
    gl.jumpTo(gl.calculateCameraOptionsFromCameraLngLatAltRotation(
      [lon, lat], height, looking.heading, 90 + pitch, ROLL_SIGN * looking.roll,
    ));
    // The ground's drapes within a budget, and its haze right looking up: layers/flightGround.ts.
    budgetDrapes(gl, flightDrapeBytes());
    flightFog(gl, true);
    indexDrapes(gl, true);
    // The map draws nothing nearer than a fiftieth of the way to what it
    // looks at, and a camera at the horizon looks kilometres off: low down
    // the ground under the aircraft would be cut away. Near the ground it
    // draws from a fifth of the height over it, and never from further than
    // it would have. And no further than an eye looking a little down (`FLIGHT_FAR_HEIGHTS`).
    if (transform?.overrideNearFarZ) {
      const over = height - (gl.queryTerrainElevation([lon, lat]) ?? 0);
      const nearest = Math.min(Math.max(FLIGHT_NEAR_M, over * 0.2) * transform.pixelsPerMeter, transform.nearZ);
      const farthest = Math.min(Math.max(FLIGHT_FAR_LEAST_M, height * FLIGHT_FAR_HEIGHTS) * transform.pixelsPerMeter, transform.farZ);
      if (nearest < transform.nearZ || farthest < transform.farZ) transform.overrideNearFarZ(nearest, farthest);
    }
  }

  setAircraft(view: AircraftView | null, screens: AircraftScreen[] = []): void {
    this.aircraftView = this.flight ? view : null;
    this.aircraftScreens = screens;
    this.aircraftLayer?.setView(this.aircraftView);
    this.aircraftLayer?.setScreens(screens);
    // Over everything, also what was put on the map since: storms that came in, strikes.
    const gl = this.gl;
    if (!gl || !this.aircraftLayer) return;
    // Not where the map has lost its style or the layer (a lost GPU takes both): moving it threw every frame.
    const order = gl.getLayersOrder();
    if (order.includes(AIRCRAFT_LAYER) && order[order.length - 1] !== AIRCRAFT_LAYER) gl.moveLayer(AIRCRAFT_LAYER);
  }

  /** The aircraft's layer, on top of everything, there while flying. */
  private ensureAircraft(gl: GlMap): void {
    const support = this.flightSupport;
    if (this.aircraftLayer || !this.flight || !support) return;
    this.aircraftLayer = support.makeAircraftLayer(AIRCRAFT_LAYER, support.aircraftFiles);
    this.aircraftLayer.setView(this.aircraftView);
    this.aircraftLayer.setScreens(this.aircraftScreens);
    this.aircraftLayer.setWeather(this.flightWeather);
    this.aircraftLayer.setTraffic(this.trafficPass);
    gl.addLayer(this.aircraftLayer);
  }

  /** The ground's height, true metres: the map's terrain is drawn `VERTICAL_SCALE` tall. */
  groundElevation(lon: number, lat: number): number | null {
    const elevation = this.gl?.queryTerrainElevation([lon, lat]) ?? null;
    return elevation === null ? null : elevation / VERTICAL_SCALE;
  }

  /** A flight's clouds begin this high: its sky is drawn again for it, where it has moved by enough to see. */
  setCloudBase(km: number): void {
    if (Math.abs(km - this.cloudBaseKm) < 0.05) return;
    this.cloudBaseKm = km;
    if (this.flightSupport) this.cloudsLayer?.setScenic(this.flightSupport.cloudscape(km), this.flightSupport.makeScenicPass);
  }

  /**
   * A flight may fly over the ground as the basemap has it, without the
   * radar's colours on it: the storms are in the sky there. Back on with the
   * landing, whatever the flight had.
   */
  setRadarOnGround(on: boolean): void {
    this.radarOffGround = !on && this.flight !== null;
    this.applyDrapeBlend();
  }

  /** The frames the drape's first set of layers shows, as their `masked://` templates: the same tiles the ground is painted with. */
  radarTiles(): string[] {
    const gl = this.gl;
    const shown = (id: string) => Boolean(gl?.getLayer(id))
      && (gl?.getLayoutProperty(id, "visibility") !== "none" || this.offGround.has(id));
    return [
      shown(RADAR_SOURCE) ? this.radarMasks[0]?.tiles : undefined,
      ...NETWORKS.map(({ code }) => (shown(networkLayerId(code)) ? this.networkMasks[0][code]?.tiles : undefined)),
    ].filter((tiles): tiles is string => tiles !== undefined);
  }

  /** A drape layer that has a picture to show: shown, or put away while a flight has the radar off the ground. */
  private showDrape(gl: GlMap, id: string): void {
    if (!gl.getLayer(id)) return;
    gl.setLayoutProperty(id, "visibility", this.radarOffGround ? "none" : "visible");
    if (this.radarOffGround) this.offGround.add(id);
    else this.offGround.delete(id);
  }

  /** How opaque one of the drape's two sets of layers is drawn: as its blend has it, or not at all. */
  private drapeShown(slot: DrapeSlot): number {
    return this.radarOffGround ? 0 : this.drapeOpacity[slot];
  }

  /**
   * The flight's cut as a sheet, for Studio's plane layer to draw: from the
   * cockpit the hole alone does not say where the cut stands or which way it
   * runs.
   */
  private flightCutSheet(): [SectionPlane[], number | null, number | undefined] {
    const cut = this.inspected?.mode === "cut" ? this.inspected.cut : null;
    if (!cut) return [[], null, undefined];
    const plane: SectionPlane = {
      id: 1, lon: cut.lon, lat: cut.lat, heightKm: 0, facingDeg: cut.facingDeg, tiltDeg: 0, slabKm: null, enabled: true,
    };
    return [[plane], plane.id, cut.halfKm];
  }

  /**
   * Look into the storm at a place, for a flight. The volume drawn there,
   * the finest of those held: found again each time, since the one drawn
   * changes as the aircraft comes nearer. A cut stands across the line of
   * sight, with the side towards the eye taken away.
   */
  inspectStorm(target: { lon: number; lat: number; mode: InspectMode; cut: FlightCut | null; peel?: number } | null): boolean {
    let found: { key: string; zoom: number } | null = null;
    if (target && this.flight) {
      for (const [key, { cutaway, fill }] of this.cutaways) {
        const tile = cutaway.header.tile;
        // A fill tile is weak rain, never a storm to look into.
        if (!tile || fill) continue;
        const [west, south, east, north] = tileBounds(tile[0], tile[1], tile[2]);
        if (target.lon < west || target.lon > east || target.lat < south || target.lat > north) continue;
        if (!found || tile[0] > found.zoom) found = { key, zoom: tile[0] };
      }
    }
    this.inspected = found && target
      ? {
        key: found.key, mode: target.mode, at: [target.lon, target.lat],
        cut: target.mode === "cut" ? target.cut : null, peel: target.peel ?? null,
      } : null;
    this.applyCut();
    return found !== null;
  }

  trackedCells(): StormMark[] {
    return this.cells.map((cell) => ({
      lon: cell.lon,
      lat: cell.lat,
      peakDbz: cell.max_dbz ?? 0,
      top: cell.echo_top_m ?? null,
      heading: cell.heading_deg ?? null,
      speed: cell.speed_kmh === null || cell.speed_kmh === undefined ? null : cell.speed_kmh / 3.6,
      hail: cell.hail_flag > 0,
    }));
  }

  stormTiles(): StormTileInfo[] {
    // Storms only: a fill tile is the weak rain between them.
    return this.clouds.filter((cloud) => !cloud.fill).map((cloud) => ({
      lon: cloud.lon, lat: cloud.lat, peakDbz: cloud.peak_dbz ?? null, areaKm2: cloud.area_km2 ?? null,
      coarse: cloud.coarse, tile: cloud.tile ?? null, sites: cloud.sites ?? [],
    }));
  }

  reflectivityAt(lon: number, lat: number, altitude: number): number | null {
    return this.flightSupport?.reflectivityAt([...this.cutaways.values()].map(({ cutaway }) => cutaway), lon, lat, altitude) ?? null;
  }

  setTraffic(traffic: TrafficPass | null): void {
    this.trafficPass = this.flight ? traffic : null;
    this.aircraftLayer?.setTraffic(this.trafficPass);
  }

  setFlightWeather(weather: WeatherView | null, glow: { lon: number; lat: number; km: number; brightness: number } | null = null): void {
    this.flightWeather = this.flight ? weather : null;
    this.aircraftLayer?.setWeather(this.flightWeather);
    this.cloudsLayer?.setGlow(this.flight ? glow : null);
    this.applyCloudDetail();
  }

  /**
   * Fewer pixels and coarser clouds for a flight a machine cannot draw fast
   * enough at full sharpness; all of both again on landing.
   */
  setFlightQuality(share: number): void {
    const next = this.flight ? Math.min(Math.max(share, 0.1), 1) : 1;
    if (next === this.flightQuality) return;
    this.flightQuality = next;
    const full = mapPixelRatio(window.devicePixelRatio, isHandheld(), get(fullResolution3d));
    // The clouds give up their sharpness first (`applyCloudDetail`): the map
    // keeps all of its own until that has not been enough, and then loses
    // pixels by the root, a share of the work being that share of the pixels:
    // down to half a screen's points each way, where nothing else has kept it moving.
    this.gl?.setPixelRatio(Math.max(Math.min(full, 0.5), full * Math.min(1, Math.sqrt(next / 0.45))));
    this.applyCloudDetail();
    if (this.gl) this.flightSupport?.water.quality(this.gl, next);
  }

  /**
   * How finely a flight's clouds are marched: as its sharpness has it, and
   * less the more cloud there is round the eye, which hides them. Deep in
   * cloud nothing of them is seen at all, and nothing is drawn: every cloud
   * in the way of a ray is marched, seen or not, and from inside a storm
   * that was most of a frame.
   */
  private applyCloudDetail(): void {
    const veil = this.flightWeather?.veil ?? 0;
    // Their own picture: a screen's point across at full sharpness, two of them at the least, whatever the map's pixels are.
    const points = 0.45 + 0.55 * this.flightQuality;
    const scale = points / (this.gl?.getPixelRatio() ?? 1);
    this.cloudsLayer?.setDetail(veil > 0.94 ? 0 : (0.55 + 0.45 * this.flightQuality) * (1 - 0.45 * veil), scale);
  }

  /** Every strike in the flat map's buffer within reach of a place, each by when it struck, which is also its name there. */
  strikesNear(lon: number, lat: number, km: number, since: number): Array<{ lon: number; lat: number; at: number }> {
    const support = this.flightSupport;
    if (!support) return [];
    const found: Array<{ lon: number; lat: number; at: number }> = [];
    for (const strike of this.strikes?.getFeatures() ?? []) {
      const at = Number(strike.getId());
      if (!Number.isFinite(at) || at < since) continue;
      const coordinates = (strike.getGeometry() as Point | undefined)?.getCoordinates();
      if (!coordinates) continue;
      const [x, y] = toLonLat(coordinates);
      if (support.distanceM(lon, lat, x, y) <= km * 1000) found.push({ lon: x, lat: y, at });
    }
    return found;
  }

  strikesSince(since: number): Array<{ lon: number; lat: number; at: number }> {
    const found: Array<{ lon: number; lat: number; at: number }> = [];
    for (const strike of this.strikes?.getFeatures() ?? []) {
      const at = Number(strike.getId());
      if (!Number.isFinite(at) || at < since) continue;
      const coordinates = (strike.getGeometry() as Point | undefined)?.getCoordinates();
      if (!coordinates) continue;
      const [lon, lat] = toLonLat(coordinates);
      found.push({ lon, lat, at });
    }
    return found;
  }

  /** From the flat map's strike buffer, as the strikes drawn here are; see `ensureStrikes`. */
  strikeNear(lon: number, lat: number, km: number): number | null {
    const support = this.flightSupport;
    if (!support) return null;
    let newest: number | null = null;
    const since = Date.now() - 60_000;
    for (const strike of this.strikes?.getFeatures() ?? []) {
      const at = Number(strike.getId());
      if (!Number.isFinite(at) || at < since || (newest !== null && at <= newest)) continue;
      const coordinates = (strike.getGeometry() as Point | undefined)?.getCoordinates();
      if (!coordinates) continue;
      const [x, y] = toLonLat(coordinates);
      if (support.distanceM(lon, lat, x, y) <= km * 1000) newest = at;
    }
    return newest;
  }

  /**
   * Where the aircraft is and which way it looks, for choosing its storms;
   * null when not flying, or before its first frame.
   */
  private lookout(): (Lookout & { support: FlightSupport }) | null {
    const gl = this.gl;
    const pose = this.flightPose;
    const support = this.flightSupport;
    if (!this.flight || !pose || !gl || !support) return null;
    const { clientWidth: width, clientHeight: height } = gl.getContainer();
    const half = (gl.getVerticalFieldOfView() * Math.PI) / 360;
    const across = (2 * Math.atan(Math.tan(half) * (width / Math.max(height, 1))) * 180) / Math.PI;
    // Ahead is where the eye looks: turned in its seat, or outside, that is not the nose.
    return { lon: pose.lon, lat: pose.lat, heading: this.flightLooking ?? pose.heading, fovDeg: across, support };
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
   * recent-activity glow. Nothing at all while hidden; `attach` redraws.
   */
  private scheduleStrikes(): void {
    // Put away while an earlier scan is on the map; going back redraws them.
    if (!this.shown || this.past || this.strikeTimer !== null) return;
    this.strikeTimer = setTimeout(() => {
      this.strikeTimer = null;
      this.ensureStrikes();
    }, STRIKE_REDRAW_MS);
  }

  /**
   * Point the draped radar at a frame, and say which scan it is. Called with
   * DWD's newest frame, HX, whichever product the 2D map draws.
   */
  setRadarFrame(url: string | null, scan: Scan, index?: TileIndex | null): void {
    this.radarUrl = url;
    this.radarIndex = index;
    this.radarScan = url ? scan : null;
    // What the picker counts back from, when no German storm says.
    this.publishTime();
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
   * the next, by when its radar had moved on and they were a scan behind. A
   * moment's wait first, so a run's parts landing together are one fetch.
   */
  newVolumes(): void {
    if (!this.shown || this.volumesTimer !== null) return;
    this.volumesTimer = setTimeout(() => {
      this.volumesTimer = null;
      if (!this.shown) return;
      // Quietly, as the flat map's tags are (App.svelte): a refresh.
      const at = get(archiveStep);
      void fetchCurrentVolumes(quietly, volumesAsked(this.fillSky, at)).catch(() => null).then((answer) => {
        if (answer && this.shown && get(archiveStep) === at) this.volumes.offer(answer);
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

  /**
   * Re-read the latest run, or a past window's step's. One timestep only:
   * this map does not scrub.
   */
  refresh(): Promise<void> {
    const run = this.load();
    this.firstRefresh ??= run;
    return run;
  }

  private async load(): Promise<void> {
    const token = Symbol("cells");
    this.cellsToken = token;
    const at = get(archiveStep);
    const [current, clouds] = await Promise.all([
      // Not asked for while they are off: a severe afternoon's run is a
      // sizeable answer for a map that would draw none of it. A failure
      // (already reported by the API wrapper) keeps the cells already drawn,
      // and no longer takes a good answer for the volumes down with it.
      this.cellsWanted ? fetchCurrentCells(this.nanobar, at).catch(() => undefined) : null,
      // Its own failure is not the cells' failure: a map with storms and no
      // cutaways is worth drawing. Nor does it take the storms already
      // drawn away; they stay until an answer replaces them.
      fetchCurrentVolumes(undefined, volumesAsked(this.fillSky, at)).catch(() => null),
    ]);
    // A window's step moved on meanwhile: that step's load is the one to draw.
    if (this.cellsToken !== token || get(archiveStep) !== at) return;
    if (current !== undefined) {
      // Turned off while the answer was on its way is off.
      const run = this.cellsWanted ? current : null;
      this.cells = (run?.cells ?? []) as CellCurrent[];
      this.cellsScan = run ? scanTime(run.reference_time) : null;
    }
    // The same scan as before still loads: a load cut short by switching
    // away left volumes to fetch, and this is the refresh `attach` relies on.
    if (!clouds || !this.volumes.offer(clouds)) void this.loadClouds();
    if (this.shown && at === null) this.volumes.follow(this.newestScan());
    this.applyData();
  }

  /**
   * Turn the KONRAD3D cells on or off.
   *
   * On, they are fetched now if the map is showing, and otherwise by the
   * refresh `attach` does. Off, they go at once, and their layers stay on
   * the style empty, with nothing to tap and no tier to hide.
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

  /**
   * A newer scan's storm cores, from a refresh or from waiting for one.
   *
   * Kept aside while an earlier scan is on the map, which stays until the
   * reader picks the newest again: the picker says which scan is shown, and
   * a run landing must not swap it from under them.
   */
  private takeClouds(answer: CurrentVolumes): void {
    this.liveClouds = (answer.volumes ?? []) as RadarVolume[];
    for (const cloud of this.liveClouds) {
      const scan = scanTime(cloud.reference_time);
      const network = networkOf(cloud);
      if (scan !== null && scan > (this.networkClocks.get(network) ?? -Infinity)) this.networkClocks.set(network, scan);
    }
    this.listing.take(this.liveClouds.map((cloud) => placed(cloud.path, cloud)), Date.now());
    this.settleLater();
    this.volumePath = this.liveClouds.find((cloud) => cloud.tile)?.path ?? this.volumePath;
    this.publishTime();
    // An earlier scan's, finished loading after a switch away cut it short.
    if (this.past) {
      void this.loadClouds();
      return;
    }
    this.clouds = this.liveClouds;
    // A storm's boxes: a fill tile is none, and is never opened.
    offerVolumes(this.fillSky ? this.clouds.filter((cloud) => !cloud.fill) : this.clouds);
    this.forgetFaint();
    void this.loadClouds();
    // A storm selected before its box was listed can be cut open now.
    if (this.shown) void this.openSelection(get(selectedStorm));
    // A refresh draws them with everything else; a wait has only these to draw.
    if (!this.gl || !this.styleReady) return;
    this.ensureClouds(this.gl);
    this.applyStaleness();
  }

  /** Only the listed faint storms are worth remembering; every run brings new paths. */
  private forgetFaint(): void {
    const listed = new Set(this.clouds.map((cloud) => cloud.path));
    for (const path of this.faint) if (!listed.has(path)) this.faint.delete(path);
    this.retries.keepOnly(listed);
  }

  /** The scan "Latest" is: the newest German storms', else the radar's under them. */
  private latestScan(): Scan | null {
    let newest: Scan | null = null;
    for (const cloud of this.liveClouds) {
      const scan = networkOf(cloud) === "de" ? scanTime(cloud.reference_time) : null;
      if (scan !== null && (newest === null || scan > newest)) newest = scan;
    }
    return newest ?? this.radarScan;
  }

  /**
   * Show an earlier scan's storms in place of the newest, or the newest
   * again for null, and keep showing them until the reader picks again.
   *
   * There is no list of an earlier scan's, so they are found in the bucket
   * (lib/cloudHistory.ts): around where the storms are now, and over the rest
   * of the screen, a few dozen requests the first time and none the next.
   * Until they are, the map stays as it was; a scan with nothing here leaves
   * it so, and the picker says why. Shown, it is the list the map is drawn
   * from (boxes, peel and taps as ever, a tap opening the storm as it was),
   * with the radar of the same scan draped under it and the newest scan's
   * own cells and strikes put away.
   */
  showScan(scan: Scan | null): void {
    const latest = this.latestScan();
    if (scan === null || (latest !== null && scan >= latest)) {
      this.showLatest();
      return;
    }
    if (this.past?.scan === scan) {
      // Back to the one on the map, from another still being looked for.
      if (this.pastLoading !== null) {
        this.pastLoading = null;
        this.pastToken = null;
      }
      this.publishTime({ missed: null });
      return;
    }
    if (this.pastLoading === scan) return;
    void this.findScan(scan);
  }

  /** Look an earlier scan's storms up, then put them on the map; see `showScan`. */
  private async findScan(scan: Scan): Promise<void> {
    const token = Symbol("past");
    this.pastToken = token;
    this.pastLoading = scan;
    this.pastMoved = false;
    this.publishTime({ progress: 0, missed: null });
    const finds = this.findsOf(scan);
    const failedBefore = finds.failed;
    const landed = new Map<string, Cutaway>();
    const plan = this.planPast(scan, finds);
    if (plan) {
      await this.askPast(scan, finds, landed, plan, (progress) => {
        if (this.pastToken === token) this.publishTime({ progress });
      });
    }
    if (this.pastToken !== token) return;
    this.pastToken = null;
    this.pastLoading = null;
    if (!listOf(finds).length) {
      // Nothing to show: the map stays as it was, and the picker says so.
      const failed = !plan || finds.failed > failedBefore;
      this.publishTime({ missed: { scan, failed } });
      if (failed) {
        reportShown("past-scan", plan ? finds.lastError : new Error("No 3D map to look an earlier scan up on"), {
          scan, failedTiles: finds.failed - failedBefore,
        });
      }
      return;
    }
    this.past = { scan, finds };
    this.drapeAt(scan);
    this.applyLiveOnly();
    this.takePast(landed);
    this.publishTime({ missed: null });
    // Where the camera went meanwhile.
    if (this.pastMoved) void this.lookAgain();
  }

  /** Back to the newest scan: its storms, its radar, its cells and strikes. */
  private showLatest(): void {
    // A look still in flight lands nowhere; what it finds is kept for next time.
    this.pastToken = null;
    this.pastLoading = null;
    const was = this.past;
    this.past = null;
    if (was) {
      // Picked, the newest is drawn as soon as it is in, not after its parts' wait.
      this.listing.settle();
      this.clouds = this.liveClouds;
      this.pastFine.clear();
      this.forgetFaint();
      this.drapeAt(null);
      this.applyLiveOnly();
      this.ensureStrikes();
      void this.loadClouds();
      if (this.gl && this.styleReady) {
        this.ensureClouds(this.gl);
        this.applyStaleness();
      }
    }
    this.publishTime({ missed: null });
  }

  /**
   * Look the earlier scan on the map over again where the camera is now,
   * for storms it has not been looked for at, and fine tiles where its
   * coarse ones have come close. Not while another is being picked: that
   * one looks for itself, and again once it is on the map.
   */
  private async lookAgain(): Promise<void> {
    const past = this.past;
    if (!past || this.pastLoading !== null) return;
    const token = Symbol("look");
    this.pastToken = token;
    const landed = new Map<string, Cutaway>();
    const plan = this.planPast(past.scan, past.finds);
    if (plan) await this.askPast(past.scan, past.finds, landed, plan);
    if (this.pastToken !== token) return;
    this.pastToken = null;
    if (this.past === past) this.takePast(landed);
  }

  /**
   * An earlier scan's coarse tile tapped, with no fine tile under the finger
   * found yet: its fine tiles asked for, then the one under the finger
   * opened, as a tap on the newest scan's would. A tap elsewhere meanwhile
   * wins, as it does over a cell's track.
   */
  private async openPast(cloud: RadarVolume, lng: number, lat: number): Promise<void> {
    const past = this.past;
    if (!past || !cloud.tile) return;
    const token = Symbol("pick");
    this.picking = token;
    const [x, y] = coarseOf(cloud.tile);
    const landed = new Map<string, Cutaway>();
    await this.askPast(past.scan, past.finds, landed, { places: [{ network: networkOf(cloud), x, y }], fine: () => true });
    if (this.picking !== token || this.past !== past) return;
    this.picking = null;
    this.takePast(landed);
    const found = fineAt(this.clouds, lng, lat);
    if (found) this.selectVolume(found);
  }

  /** What is known of an earlier scan, kept as the most recently looked at. */
  private findsOf(scan: Scan): ScanFinds {
    const finds = this.pastFinds.get(scan) ?? noFinds();
    this.pastFinds.delete(scan);
    this.pastFinds.set(scan, finds);
    // The one on the map is never the oldest: it was just looked at.
    for (const old of this.pastFinds.keys()) {
      if (this.pastFinds.size <= (this.studio ? STUDIO_SCANS_KEPT : PAST_KEPT)) break;
      this.pastFinds.delete(old);
    }
    return finds;
  }

  /**
   * Which coarse tiles to ask an earlier scan for, from where the camera is,
   * and which of them to ask the fine tiles of: those standing large on
   * screen, nearest first, as far as the texture held would go. Null
   * before the map is up.
   */
  private planPast(scan: Scan, finds: ScanFinds): { places: Place[]; fine(place: Place, stormy: Quarter[]): boolean } | null {
    const gl = this.gl;
    if (!gl) return null;
    const { lng, lat } = gl.getCenter();
    const bounds = gl.getBounds();
    const radar = this.radarAt?.(scan);
    const { clientWidth: width, clientHeight: height } = gl.getContainer();
    // The coarse tiles whose middle is on screen, over the networks they can
    // be asked of: Germany's, and any other whose clock is known. Inside the
    // bounds proper as well: a point past the horizon projects to somewhere
    // meaningless, which can be on the canvas.
    const view = coarseTilesIn(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], { lon: lng, lat }, PAST_REACH,
    ).flatMap(([x, y]) => {
      const [lon, latitude] = tileCentre(COARSE_ZOOM, x, y);
      const { x: across, y: down } = gl.project([lon, latitude]);
      if (across < 0 || across > width || down < 0 || down > height) return [];
      const network = networkAt(latitude, lon) ?? "de";
      const known = network === "de" || this.networkClocks.has(network)
        || Boolean(radar?.networks[network as NetworkCode]?.upstream_time);
      return known ? [{ network, x, y }] : [];
    });
    // Where storms were: found in this scan already, and in the nearest newer one looked at, else the list.
    const placesOf = (volumes: RadarVolume[]) => volumes.flatMap((volume) => {
      // A fill tile is where no storm was.
      if (!volume.tile || volume.fill) return [];
      const [x, y] = coarseOf(volume.tile);
      return [{ network: networkOf(volume), x, y }];
    });
    const newer = [...this.pastFinds].filter(([other, known]) => other > scan && listOf(known).length > 0)
      .sort(([a], [b]) => a - b)[0];
    const storms = [...placesOf(listOf(finds)), ...placesOf(newer ? listOf(newer[1]) : this.liveClouds)];
    const places = placesToAsk({
      storms,
      view,
      inView: (place) => this.inView(gl, tileBounds(COARSE_ZOOM, place.x, place.y)),
      distance: (place) => {
        const [lon, latitude] = tileCentre(COARSE_ZOOM, place.x, place.y);
        return Math.hypot((lon - lng) * Math.cos((latitude * Math.PI) / 180), latitude - lat);
      },
      count: PAST_PLACES,
      viewCount: PAST_VIEW_PLACES,
      asked: (place) => finds.coarse.has(placeKey(place)),
    });
    let planned = 0;
    const fine = (place: Place, stormy: Quarter[]) => {
      // A quarter with a storm in it is about a tile's texture, or a core's four.
      const cost = stormy.length * TILE_TEXTURE_BYTES;
      if (!this.drawnFine(gl, [COARSE_ZOOM, place.x, place.y]) || planned + cost > RESIDENT_BYTES) return false;
      planned += cost;
      return true;
    };
    return { places, fine };
  }

  /** Ask an earlier scan for what `plan` names, adding to `finds`, with each volume worth drawing put in `landed`. */
  private async askPast(
    scan: Scan,
    finds: ScanFinds,
    landed: Map<string, Cutaway>,
    plan: { places: Place[]; fine(place: Place, stormy: Quarter[]): boolean },
    progress?: (share: number) => void,
  ): Promise<void> {
    const radar = this.radarAt?.(scan);
    await askScan({
      // Each network's own scan: from the radar draped for it, which says,
      // else counted on its clock.
      scanOf: (network) => {
        if (network === "de") return scan;
        const upstream = radar?.networks[network as NetworkCode]?.upstream_time;
        const clock = this.networkClocks.get(network);
        return upstream ?? (clock === undefined ? scan : scanOnClock(clock, scan));
      },
      template: this.volumePath ?? FALLBACK_TEMPLATE,
      places: plan.places,
      fine: plan.fine,
      fetch: (path) => this.fetchPast(path),
      faint: isFaint,
      landed: (volume, cutaway) => landed.set(volume.path, cutaway),
      progress,
    }, finds);
  }

  /** One of an earlier scan's volumes; null where there is none. Asked once however many looks want it. */
  private fetchPast(path: string): Promise<Cutaway | null> {
    let fetching = this.pastFetches.get(path);
    if (!fetching) {
      fetching = this.pastQueue(() => loadCutaway({ path, coverage: 0, tier: 2 }))
        .catch((error) => {
          if (error instanceof VolumeGone) return null;
          throw error;
        })
        .finally(() => this.pastFetches.delete(path));
      this.pastFetches.set(path, fetching);
    }
    return fetching;
  }

  /**
   * Put what is known of the earlier scan on the map: its list in place of
   * the newest's, with the volumes just found held, and the rest in view
   * loaded as any listed storm's are.
   */
  private takePast(landed: Map<string, Cutaway>): void {
    const past = this.past;
    if (!past) return;
    this.clouds = listOf(past.finds);
    this.pastFine.clear();
    for (const [key, tiles] of past.finds.fine) {
      const tile = past.finds.coarse.get(key)?.volume.tile;
      if (tiles.length && tile) this.pastFine.add(tileCode(tile[0], tile[1], tile[2]));
    }
    for (const volume of this.clouds) {
      const cutaway = landed.get(volume.path);
      if (!cutaway || this.cutaways.has(volume.path)) continue;
      this.cutaways.set(volume.path, {
        code: volume.code, cutaway, lon: volume.lon, lat: volume.lat, tier: tierOf(volume, cutaway), system: null,
      });
    }
    this.hold();
    void this.loadClouds();
    if (this.gl && this.styleReady) this.ensureClouds(this.gl);
  }

  /**
   * Where the flat map has the radar of an observed step, for an earlier
   * scan's storms to have their own under them: the caller owns the grid.
   * Without it, an earlier scan is shown with no radar under it.
   */
  setRadarHistory(at: (step: number) => PastRadar | null): void {
    this.radarAt = at;
  }

  /** Drape the radar of an earlier scan, or the newest again for null. */
  private drapeAt(scan: Scan | null): void {
    const frame = scan === null ? null : this.radarAt?.(scan) ?? null;
    this.drapedPast = scan === null ? null : { url: frame?.url ?? null, index: frame?.tiles, networks: frame?.networks ?? {} };
    // Held for `attach` while hidden, as the newest frame is.
    if (this.gl && this.styleReady && this.shown) {
      this.ensureRadar(this.gl);
      this.ensureNetworks(this.gl);
    }
  }

  /** Put the newest scan's own marks away while an earlier scan is on the map, and back after; see `LIVE_ONLY`. */
  private applyLiveOnly(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady) return;
    for (const id of LIVE_ONLY) {
      if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", this.past ? "none" : "visible");
    }
  }

  /** Tell the picker which scan is on the map, and what it is waiting for. */
  private publishTime(patch: Partial<CloudsTime> = {}): void {
    cloudsTime.update((time) => ({
      ...time,
      shown: this.past?.scan ?? null,
      loading: this.pastLoading,
      newest: this.latestScan(),
      ...patch,
    }));
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

    applyTerrain(gl, this.terrainShown, this.dark, this.drapeSize());
    this.ensureRadar(gl);
    this.ensureNetworks(gl);
    this.ensureCells(gl);
    this.ensureClouds(gl);
    this.ensureVolumes(gl);
    this.ensureStudio(gl);
    this.applyFlightLod(gl);
    this.ensureStrikes();
    this.ensureLabels(gl);
    this.ensureLocation(gl);
    this.applyStaleness();
    // A restyle brings every layer back visible, an earlier scan's or not.
    this.applyLiveOnly();
  }

  /**
   * DWD's frame, with the EUMETNET networks' countries cut out of it.
   *
   * The same cut the flat map's live frame gets (`networkHoles.ts`), for the
   * same reason: the networks' composites drape over those countries
   * (`ensureNetworks`), every palette is part transparent, and DWD showing
   * through underneath would blend into colours neither radar measured. The
   * holes are cut whether or not a network has a frame to fill them, as the
   * flat map does: a country whose radar is down shows nothing instead of
   * DWD's long-range view of it alone.
   *
   * MapLibre cannot clip a raster, so the tiles go through `maskedTiles.ts`.
   */
  private ensureRadar(gl: GlMap): void {
    for (const slot of DRAPE_SLOTS) this.ensureRadarIn(gl, slot);
  }

  /** `ensureRadar` for one of the drape's two sets of layers; see `drapeFor`. */
  private ensureRadarIn(gl: GlMap, slot: DrapeSlot): void {
    const id = drapeLayerId(RADAR_SOURCE, slot);
    const drape = this.drapeFor(slot);
    const url = drape?.url ?? null;
    if (!url) {
      // An earlier scan the grid has no frame for: no radar, rather than the
      // newest under storms from before it.
      if ((!drape || drape.past) && gl.getLayer(id)) {
        gl.setLayoutProperty(id, "visibility", "none");
        this.offGround.delete(id);
      }
      return;
    }

    let mask = this.radarMasks[slot];
    if (mask?.url !== url || mask.palette !== this.colormap) {
      forgetMaskedTiles(mask?.key);
      mask = {
        url,
        palette: this.colormap,
        ...registerMaskedTiles({
          template: url,
          index: drape!.index,
          erase: HOLES,
          palette: this.colormap,
        }),
      };
      this.radarMasks[slot] = mask;
    }
    const { tiles } = mask;

    const existing = gl.getSource(id);
    if (existing) {
      // Unchanged is left alone: `setTiles` reloads every tile on screen, and
      // this runs on every refresh and every return to this map.
      const source = existing as unknown as { tiles?: string[]; setTiles(tiles: string[]): void };
      if (source.tiles?.[0] !== tiles) source.setTiles([tiles]);
      this.showDrape(gl, id);
      return;
    }

    gl.addSource(id, {
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
      id,
      type: "raster",
      source: id,
      paint: this.drapePaint(slot),
    }, this.rasterAnchor(gl));
    if (this.radarOffGround) this.showDrape(gl, id);
  }

  /** Let go of every `masked://` registration of the drape's, both sets'. */
  private forgetDrapeMasks(): void {
    for (const mask of this.radarMasks) forgetMaskedTiles(mask?.key);
    for (const masks of this.networkMasks) {
      for (const mask of Object.values(masks)) forgetMaskedTiles(mask?.key);
    }
    this.radarMasks = [null, null];
    this.networkMasks = [{}, {}];
  }

  /** A draped radar layer's paint: at once, not eased, since a blend moves its opacity every frame. */
  private drapePaint(slot: DrapeSlot): RasterLayerSpecification["paint"] {
    return {
      "raster-opacity": this.drapeShown(slot),
      "raster-opacity-transition": { duration: 0, delay: 0 },
      "raster-resampling": "nearest",
    };
  }

  /**
   * What one of the drape's two sets of layers shows. Outside a blend the
   * first shows the scan on the map (an earlier one's, or the newest) and
   * the second nothing; in a blend each shows one of its two scans, the one
   * it already had where it can (see `applyDrapeBlend`). `past` says a
   * missing frame means no radar, not the newest one left as it was.
   */
  private drapeFor(slot: DrapeSlot): { url: string | null; index?: TileIndex | null; networks: PastRadar["networks"]; past: boolean } | null {
    if (this.drapeSlots) {
      const scan = this.drapeSlots[slot];
      const latest = this.latestScan();
      if (latest !== null && scan >= latest) {
        return { url: this.radarUrl, index: this.radarIndex, networks: this.networkFrames, past: false };
      }
      const frame = this.radarAt?.(scan) ?? null;
      return { url: frame?.url ?? null, index: frame?.tiles, networks: frame?.networks ?? {}, past: true };
    }
    if (slot === 1) return null;
    const past = this.drapedPast;
    return past
      ? { ...past, past: true }
      : { url: this.radarUrl, index: this.radarIndex, networks: this.networkFrames, past: false };
  }

  /**
   * Crossfade the radar draped under the storms between a blend's two
   * scans, as the storms go from one to the other; or show the one scan on
   * the map again.
   *
   * Two sets of layers, one over the other, each holding one scan: the one
   * holding a scan keeps it when the next pair comes up, so only the other
   * set loads, and it loads while its own scan is still faint. Their
   * opacities are worked out so the two together are the one drape's
   * opacity, each scan's share of it its weight in the blend. A crossfade,
   * not carried along the motion as the storms are: a raster is one picture
   * of the whole map, with no storms in it to carry. Under the clouds, at a
   * third of their opacity, the two frames of a moving storm read as a
   * smear behind it, not as two.
   */
  private applyDrapeBlend(): void {
    const blend = this.blend;
    let slots: [Scan, Scan] | null = null;
    if (blend) {
      const held = this.drapeSlots;
      slots = held && (held[1] === blend.from || held[0] === blend.to) && held[0] !== blend.from && held[1] !== blend.to
        ? [blend.to, blend.from]
        : [blend.from, blend.to];
    }
    const changed = slots?.[0] !== this.drapeSlots?.[0] || slots?.[1] !== this.drapeSlots?.[1];
    this.drapeSlots = slots;
    // In steps: see `DRAPE_STEPS`.
    const fraction = blend ? Math.round(blend.fraction * DRAPE_STEPS) / DRAPE_STEPS : 0;
    const upper = blend && slots ? (slots[1] === blend.to ? fraction : 1 - fraction) : 0;
    // The upper set at its share of the drape; the lower at what makes the two its whole.
    this.drapeOpacity = slots
      ? [(RADAR_OPACITY * (1 - upper)) / (1 - RADAR_OPACITY * upper), RADAR_OPACITY * upper]
      : [RADAR_OPACITY, 0];
    const gl = this.gl;
    if (!gl || !this.styleReady || !this.shown) return;
    if (changed) {
      this.ensureRadar(gl);
      this.ensureNetworks(gl);
    }
    for (const slot of DRAPE_SLOTS) {
      for (const id of [RADAR_SOURCE, ...NETWORKS.map(({ code }) => networkLayerId(code))].map((base) => drapeLayerId(base, slot))) {
        if (gl.getLayer(id) && gl.getPaintProperty(id, "raster-opacity") !== this.drapeShown(slot)) {
          gl.setPaintProperty(id, "raster-opacity", this.drapeShown(slot));
        }
        const away = this.radarOffGround && gl.getLayer(id) && gl.getLayoutProperty(id, "visibility") !== "none";
        if (away || (!this.radarOffGround && this.offGround.has(id))) this.showDrape(gl, id);
      }
    }
  }

  /**
   * Each network's newest composite, draped over the ground `extents.ts`
   * gives it and nowhere else. This is the other half of the cut `ensureRadar`
   * makes, so exactly one radar colours any pixel, as on the flat map.
   *
   * One source and one layer per network, kept and re-pointed rather than
   * rebuilt: a network's frame lands every minute or two, and `setTiles`
   * only reloads what is on screen.
   */
  private ensureNetworks(gl: GlMap): void {
    for (const slot of DRAPE_SLOTS) this.ensureNetworksIn(gl, slot);
  }

  /** `ensureNetworks` for one of the drape's two sets of layers; see `drapeFor`. */
  private ensureNetworksIn(gl: GlMap, slot: DrapeSlot): void {
    // An earlier scan's composites, as the grid has them for its step.
    const frames = this.drapeFor(slot)?.networks ?? {};
    const masks = this.networkMasks[slot];
    for (const network of NETWORKS) {
      const { code } = network;
      const id = drapeLayerId(networkLayerId(code), slot);
      const frame = frames[code];
      if (!frame) {
        if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", "none");
        this.offGround.delete(id);
        continue;
      }

      let mask = masks[code];
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
        masks[code] = mask;
      }

      const existing = gl.getSource(id);
      if (existing) {
        const source = existing as unknown as { tiles?: string[]; setTiles(tiles: string[]): void };
        if (source.tiles?.[0] !== mask.tiles) source.setTiles([mask.tiles]);
        this.showDrape(gl, id);
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
        paint: this.drapePaint(slot),
      }, this.rasterAnchor(gl));
      if (this.radarOffGround) this.showDrape(gl, id);
    }
  }

  /**
   * The relief's and the raster imagery's level of detail: sharp further off
   * while flying (`FLIGHT_LOD`), MapLibre's own otherwise. Sources come and go
   * with the style and the radar, so this runs again whenever they may have.
   */
  private applyFlightLod(gl: GlMap): void {
    const sources = gl.getStyle()?.sources ?? {};
    for (const [id, spec] of Object.entries(sources)) {
      if (spec.type !== "raster-dem" && spec.type !== "raster") continue;
      const source = gl.getSource(id) as { calculateTileZoom?: TileZoom } | undefined;
      if (this.flight) {
        gl.setSourceTileLodParams(isHandheld() ? FLIGHT_LOD.handheldLevels : FLIGHT_LOD.levels, FLIGHT_LOD.ratio, id);
        // Never as if looking level or up (`FLIGHT_LOD_LEAST_DOWN`), nor from lower than the eye is (`lodCamera`).
        const sharp = source?.calculateTileZoom;
        if (source && sharp) {
          source.calculateTileZoom = (zoom, across, up, away, fov) => {
            const camera = lodCamera(zoom, up, away, this.flightOver, FLIGHT_LOD_LEAST_RISE);
            return sharp(camera.zoom, across, camera.up, camera.away, fov);
          };
        }
        continue;
      }
      if (source?.calculateTileZoom) {
        source.calculateTileZoom = undefined;
        gl.triggerRepaint();
      }
    }
  }

  /** The terrain's drape size on a handheld device; MapLibre's own elsewhere. See gpuBudget.ts. */
  private drapeSize(): number | undefined {
    return isHandheld() ? HANDHELD_DRAPE_SIZE : undefined;
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
   * Where the flight's peaks go: over the storms, under the place names and
   * the reader's own dot, as the place names are.
   *
   * Under the storms, a storm behind a mountain covered its name as well as
   * one in front: a label writes no depth, so the clouds were drawn over it
   * wherever the summit did not stand in front of them, and the name was cut
   * along the ridge (November 2026). Among the ground's layers, as they were
   * first, a symbol split them into two drapes a tile and halved them all
   * (`budgetDrapes`).
   */
  private peaksAnchor(gl: GlMap): string | undefined {
    return [PLACE_LABELS, LOCATION_DOT].find((id) => gl.getLayer(id));
  }

  /**
   * Recent strikes, on the deck under the storms.
   *
   * Flat circles at ground level, not raised: a strike is a channel from
   * cloud to ground, so a mark on the ground is accurate, and it is the one
   * place it cannot be confused with the volume above it. Two circles per
   * strike (a soft wide one and a small bright core), so a cluster reads as a
   * glow instead of as gravel.
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
    const below = [PLACE_LABELS, LOCATION_DOT].find((id) => gl.getLayer(id));
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
    // The first strikes can land while an earlier scan is on the map.
    this.applyLiveOnly();
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
    gl.addLayer(layer, gl.getLayer(LOCATION_DOT) ? LOCATION_DOT : undefined);
    this.applyFlightLabels();
  }

  /**
   * The place names as a flight has them (`FLIGHT_LABELS`), at the size for
   * the height the aircraft is at; or, with no flight, as the map has them.
   */
  private applyFlightLabels(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady || !gl.getLayer(PLACE_LABELS)) return;
    const layer = placeLabels(this.dark ? darkLabels : lightLabels, this.nameKeys);
    const size = layer.layout?.["text-size"] as ExpressionSpecification;
    const flying = this.flight !== null;
    gl.setFilter(PLACE_LABELS, flying ? ["all", layer.filter, FLIGHT_LABELS] as FilterSpecification : layer.filter ?? null);
    gl.setLayoutProperty(PLACE_LABELS, "text-size", flying ? ["*", this.flightLabelSize, size] : size);
    gl.setLayoutProperty(PLACE_LABELS, "text-padding", flying ? FLIGHT_LABEL_ROOM_PX : 2);
  }

  /** Set the names to the size for a height over the ground, true metres, where that is another than they have. */
  private sizeFlightLabels(over: number): void {
    const band = LABEL_SIZES.findIndex(([, share]) => share === this.flightLabelSize);
    const from = band > 0 ? LABEL_SIZES[band - 1][0] : -Infinity;
    // Only once well into another band: at an edge the height wanders either side of it.
    if (over >= from - LABEL_SLACK_M && over < LABEL_SIZES[band][0] + LABEL_SLACK_M) return;
    this.flightLabelSize = LABEL_SIZES.find(([below]) => over < below)![1];
    this.applyFlightLabels();
  }

  /**
   * The client's position: the flat map's blue dot and its accuracy circle,
   * drawn the same way so the two maps agree on what it looks like.
   *
   * The dot last on the style, over the storms, strikes and place names, as
   * the flat map's sits over every layer. It faces the screen at a fixed size
   * however the map is tilted, since it marks a place and is not a thing on
   * the ground. The circle lies on the ground, because it is an area of it,
   * and is drawn with the ground under the storms.
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
    // On the ground under the storms: drawn last, over them, it cost a third
    // drape of every terrain tile. See `drapeAnchor`.
    gl.addLayer({
      id: LOCATION_ACCURACY,
      type: "fill",
      source: LOCATION_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "rgba(255, 255, 255, 0.4)", "fill-outline-color": "#3399cc" },
    }, drapeAnchor(gl.getStyle().layers));
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

  /**
   * The cell layers, added once and fed new data thereafter.
   *
   * One `fill-extrusion` layer per `RING_ALPHAS` tier over one source, and the order they are added
   * in is what makes them work. `fill-extrusion` writes depth even when it is
   * translucent, so anything drawn behind a see-through surface that went down
   * first is erased. The opaque interior therefore goes first and the
   * see-through outer shell second, where it depth-tests against the interior
   * and blends over it correctly. Swap them and every storm becomes a hollow
   * bag with nothing inside.
   */
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
        // A `match` instead of indexing into a literal array: MapLibre types
        // `at` as returning the array's element type, so a colour looked up
        // that way fails paint-property validation. Validation drops the layer
        // without throwing, so the footprint silently never draws.
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
    this.setFlying(false);
    // A look still in flight lands nowhere.
    this.pastToken = null;
    this.picking = null;
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    if (this.volumesTimer !== null) clearTimeout(this.volumesTimer);
    this.volumesTimer = null;
    if (this.listingTimer !== null) clearTimeout(this.listingTimer);
    this.listingTimer = null;
    this.volumes.stop();
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    for (const unsubscribe of this.unsubscribeStudio) unsubscribe();
    this.unsubscribeStudio = [];
    this.unsubscribeSelection?.();
    this.unsubscribeSelection = null;
    this.unsubscribeCut?.();
    this.unsubscribeCut = null;
    this.unsubscribeColormap?.();
    this.unsubscribeColormap = null;
    this.unsubscribeStyle?.();
    this.unsubscribeStyle = null;
    this.unsubscribeCellsWanted?.();
    this.unsubscribeCellsWanted = null;
    this.unsubscribeStep?.();
    this.unsubscribeStep = null;
    this.unsubscribeTerrain?.();
    this.unsubscribeTerrain = null;
    this.unsubscribeResolution?.();
    this.unsubscribeResolution = null;
    this.unsubscribeSweep?.();
    this.unsubscribeSweep = null;
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;
    stopSweep(false);
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.unsubscribePeel?.();
    this.unsubscribePeel = null;
    this.uncorrectCtrlClicks?.();
    this.uncorrectCtrlClicks = null;
    this.unmiddleDrag?.();
    this.unmiddleDrag = null;
    this.gl?.remove();
    this.gl = null;
    this.forgetDrapeMasks();
    this.detach();
    this.container = null;
  }
}
