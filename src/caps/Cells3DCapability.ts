import { Map as OlMap } from "ol";
import { toLonLat, fromLonLat } from "ol/proj";
import type Point from "ol/geom/Point";
import type BaseLayer from "ol/layer/Base";
import type {
  DataDrivenPropertyValueSpecification, ExpressionSpecification, Map as GlMap, StyleSpecification,
} from "maplibre-gl";
import Capability from "./Capability";
import type { CapabilityOptions } from "./options";
import { basemapStyle, muteTheme } from "../layers/maplibreStyle";
import { blitzortungAttribution, dwdAttribution } from "../layers/attributions";
import { darkTheme, lightTheme } from "../layers/base";
import { volumeCollection, footprintCollection } from "../lib/cellExtrusions";
import { loadCutaway } from "../lib/cellCutaway";
import { makeCloudsLayer } from "../layers/cellVolumeLayer";
import type { CloudsLayer } from "../layers/cellVolumeLayer";
import type { Cutaway } from "../lib/cellCutaway";
import { dbzStops, RING_ALPHAS } from "../lib/cellVolume";
import { fetchCellTrack, fetchCurrentCells, fetchCurrentVolumes } from "../api";
import {
  capDescription, cellDetails, colorSchemeDark, cutRotationDeg, cutSweepDeg, mapView, radarColormap, selectedCell, selectedVolume,
  sharedActiveCap, showForecastPlaybutton, smallScreen,
} from "../stores";
import { get } from "svelte/store";
import { nextSelection } from "../lib/cellSelection";
import { normaliseCut } from "../lib/cutAngle";
import { startSweep, stopSweep } from "../lib/cutSweep";
import { elementCentre, setElementCentre } from "../lib/viewCentre";
import { DeviceDetect as dd } from "../lib/DeviceDetect";

import { trimToLastRun } from "../lib/cellTrack";
import type { CellCurrent, CellTrack, CellTrackProperties, CellVolume, RadarVolume } from "../api";
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
  const [lib, worker] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);

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

/** The layers a tap can land on to mean "that storm". */
const PICKABLE = ["cell-volume-0", "cell-volume-1", "cell-footprint", "cloud-marker"];

/** Every storm core with a volume, as a point per core. */
const CLOUD_SOURCE = "clouds";

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
 * The box a volume fills, in kilometres either side of its centre.
 *
 * Mirrors `voxels.HALF_WIDTH_M` on the worker. Used only to decide which
 * extruded cells stand inside the storm being drawn, so a mismatch hides a
 * tier too many or too few rather than breaking anything.
 */
const BOX_HALF_KM = 20;

/**
 * How long a strike stays on this map.
 *
 * The flat map's own buffer fades them over thirty minutes. Here they are
 * shown only as a recent-activity halo around the cells that are producing
 * them, and half an hour of accumulation over a squall line is a solid smear
 * -- ten minutes keeps it to what is happening now.
 */
const STRIKE_MINUTES = 10;

/** How often a burst of strikes is redrawn at most; see `scheduleStrikes`. */
const STRIKE_REDRAW_MS = 1000;

/** The id of the one full-size map element; minimaps carry generated ids. */
const MAIN_MAP_ID = "map";

/** Opening tilted is the whole point; flat, this is just a slower 2D map. */
const INITIAL_PITCH = 55;

/**
 * The tilt an opened storm is looked at from, on a phone: low, so the cut
 * stands up in front of the reader, short of the horizon filling the screen.
 */
const OPEN_PITCH = 76;

/** How far from the opening tilt the map can be at closing and still count as not re-tilted. */
const PITCH_KEPT_DEG = 4;

/** How much of the room the storm is given, leaving it a margin. */
const OPEN_FILL = 0.9;

/** The map controls and the logo along the top, which the storm stays below. */
const OPEN_TOP_PX = 64;

/** The share of the screen the phone's detail sheet covers at rest. */
const OPEN_SHEET_FRACTION = 0.32;

/** How long a camera set by a link or a history step is kept over a storm opened after it. */
const CAMERA_KEPT_MS = 3000;

/** MapLibre's vertical field of view, radians: its default, which this map keeps. */
const MAPLIBRE_FOV = (36.8699 * Math.PI) / 180;

/** Metres per pixel at zoom 0 on the equator, for MapLibre's 512px tiles. */
const WORLD_METRES_AT_ZOOM_0 = 40_075_016.686 / 512;

/** Kilometres in a degree of latitude, and of longitude at the equator; close enough to frame with. */
const KM_PER_DEGREE = 111.32;

/** Where a link asks the camera to be, in the flat map's zoom levels like `mapView`. */
export interface CameraRequest {
  lat?: number;
  lon?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
}

/** DWD severity classes, in the colours their own charts use. */
const SEVERITY_COLOURS = ["#2f9e44", "#f0b429", "#e03131", "#9c36b5"];

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

export default class Cells3DCapability extends Capability {
  private gl: GlMap | null = null;

  /** The element MapLibre draws into, parented to whatever target is active. */
  private container: HTMLDivElement | null = null;

  private cells: CellCurrent[] = [];

  /** Every storm core with a volume in the newest scan, KONRAD3D cell or not. */
  private clouds: RadarVolume[] = [];

  /** The radar frame to drape, as a tile URL template. Set by the caller. */
  private radarUrl: string | null = null;

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
  private cutaways = new Map<string, { code: string; cutaway: Cutaway; lon: number; lat: number }>();

  /** Which storm is open, and which way its slice runs before the reader turns it. */
  private opened: { code: string; heading: number | null } | null = null;

  /** The newest load, so a slow one finishing late cannot undo a newer list. */
  private loadToken: symbol | null = null;

  /** When a link or a history step last pointed the camera; see `frameOpened`. */
  private cameraSetAt = -Infinity;

  /**
   * The tilt the map had before an opened storm lowered it, to go back to on
   * closing; null when no storm has lowered it. The first one's, across a walk
   * from storm to storm: the reader's own view is the one before any of them.
   */
  private pitchBeforeOpen: number | null = null;

  /** The newest open, so a volume still loading cannot reopen over a newer choice. */
  private openToken: symbol | null = null;

  private unsubscribeVolume: (() => void) | null = null;

  private unsubscribeCut: (() => void) | null = null;

  private unsubscribeColormap: (() => void) | null = null;

  private unsubscribeSweep: (() => void) | null = null;

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

  /**
   * Preview in a thumbnail without giving up the main map.
   *
   * The switcher's tile draws the ordinary OpenLayers map, which is both
   * cheaper than a second WebGL context and a truthful picture of where the
   * storms are. What it must not do is take the MapLibre canvas down: the
   * tiles are live while the switcher is open, and if this capability is the
   * one currently showing, its map is still underneath and has to be there
   * when the switcher closes again. Only `willLoseFocus` detaches.
   */
  setPreviewTarget(target: string | HTMLElement | undefined): void {
    super.setTarget(target);
  }

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

    if (!this.gl) {
      const maplibre = await loadMapLibre();
      // Another attach may have won the race while the library was loading.
      if (this.gl) return;
      this.maplibre = maplibre;
      const view = this.map.getView();
      const centre = elementCentre(view);
      const [lon, lat] = centre ? toLonLat(centre) : [10, 51];
      const asked = this.requestedCamera ?? {};
      this.requestedCamera = null;

      const gl = new maplibre.Map({
        container: this.container,
        style: this.style(),
        center: [asked.lon ?? lon, asked.lat ?? lat],
        zoom: (asked.zoom ?? view.getZoom() ?? 6) - 1,
        pitch: asked.pitch ?? INITIAL_PITCH,
        bearing: asked.bearing ?? 0,
        maxZoom: 13,
        // MapLibre stops at 60 unless told otherwise, which is a view from a
        // hilltop; an opened storm is looked at from lower -- see frameOpened.
        maxPitch: 85,
        // Spelled out rather than behind an (i), like the flat map's; see the
        // attribution rules in glass.css.
        attributionControl: { compact: false },
      });
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
      // Fires on the first style and again after every `setStyle`, which is
      // what a light/dark switch does -- and that discards everything added on
      // top of it, so this is also how the storms get put back.
      gl.on("style.load", () => {
        this.styleReady = true;
        // `setStyle` throws the volumes away with every other layer. The
        // loaded fields are kept, so `applyData` puts the same storms back
        // without fetching them again, and the open one is cut again.
        this.cloudsLayer = null;
        this.applyData();
        this.applyCut();
      });
      // Keep the shared View in step so switching back to the flat map lands
      // where this one was left, and so anything reading the viewport agrees.
      // The tilt and heading only this map has go out with it, for the URL.
      gl.on("moveend", () => {
        this.pushCameraToView();
        if (get(sharedActiveCap) === this.getName()) mapView.set(this.currentView());
      });
      // Tapping a storm opens the same popup the flat map opens, and tapping
      // past one closes it -- the panel is rendered above whichever map is
      // showing, so it needs no separate plumbing here.
      gl.on("click", (event) => {
        const hits = gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) });
        // A KONRAD3D cell first, when both are under the finger: it has a
        // history and a heading, and the popup it opens carries the cutaway
        // anyway if the cell stands inside a volume.
        const cell = hits.find((feature) => feature.layer.id !== "cloud-marker" && feature.properties?.code);
        const cloud = hits.find((feature) => feature.layer.id === "cloud-marker");
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
          selectedVolume.set(cloud?.properties?.code
            ? this.clouds.find((c) => c.code === cloud.properties.code) ?? null
            : null);
        }
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
      this.pullCameraFromView();
      this.gl.resize();
      // Catch up on what was held back while hidden: the theme, then the
      // newest radar frame and strikes, which need no fetch of their own.
      if (this.styleStale) this.restyle();
      else this.applyData();
      this.applyCut();
    }

    // Switched away again while MapLibre was loading.
    if (!this.shown) return;

    // Whatever the reader picked on the flat map meanwhile.
    const track = get(selectedCell);
    const cloud = get(selectedVolume);
    void this.open(track ? this.targetOfTrack(track) : cloud ? this.targetOfCloud(cloud) : null);
    void this.refresh();
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
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    this.detach();
    super.willLoseFocus();
  }

  /**
   * Back up to the tilt the reader had, once the storm that lowered it closes.
   *
   * Looking at a cut from low down is right while it is open and wrong for a
   * map: the far half of the screen is horizon. Only the tilt goes back -- the
   * reader may well want to stay where the storm was -- and only if it is
   * still the one the opening set: a reader who tilted the map themselves
   * since has chosen a view, and it is kept.
   */
  private restorePitch(): void {
    const gl = this.gl;
    const before = this.pitchBeforeOpen;
    this.pitchBeforeOpen = null;
    if (!gl || before === null) return;
    if (Math.abs(gl.getPitch() - OPEN_PITCH) > PITCH_KEPT_DEG) return;
    gl.easeTo({ pitch: before, duration: 700 });
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
    const boxes = [...this.cutaways.values()];
    if (!boxes.length) return [];
    return this.cells
      .filter((cell) => boxes.some((box) => {
        const kmPerLon = 111.32 * Math.cos((box.lat * Math.PI) / 180);
        return Math.abs((cell.lon - box.lon) * kmPerLon) <= BOX_HALF_KM
          && Math.abs((cell.lat - box.lat) * 110.57) <= BOX_HALF_KM;
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
      this.restorePitch();
      return;
    }
    let entry = this.cutaways.get(target.volume.path);
    if (!entry) {
      try {
        const cutaway = await loadCutaway(target.volume);
        entry = { code: target.code, cutaway, lon: target.lon, lat: target.lat };
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
    this.opened = { code: entry.code, heading: target.heading };
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
      // camera is two motions where one reads.
      if (get(sharedActiveCap) === this.getName()) startSweep();
    });
  }

  /**
   * Stand the camera in front of an opened storm's cut, on a phone.
   *
   * On a phone the panel's own rendering of the storm is gone -- the map is
   * the picture -- so opening a storm frames it the way that rendering did:
   * close enough that the cross-section spans the screen, from low down, so
   * the cut stands up as a wall of weather rather than lying flat as a map,
   * and square on to it, so what is shown is the face and not its edge. It is
   * placed in the part of the screen the sheet leaves, with room for its top.
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
    if (!gl || !this.opened || !get(smallScreen) || get(sharedActiveCap) !== this.getName()) return;
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

    // The storm itself rather than its box: the box is a fixed 40 km, the
    // storm rarely is. Its width is what the cut shows of it -- its extent
    // along the plane -- and its height is from the ground to its top; the
    // storm's centre is measured from the middle of the box, which stands on
    // the ground.
    const { header, centreKm, halfKm, extentM } = cutaway;
    const latRad = (header.lat * Math.PI) / 180;
    const lon = header.lon + centreKm[0] / (KM_PER_DEGREE * Math.cos(latRad));
    const lat = header.lat + centreKm[1] / KM_PER_DEGREE;
    const along = (direction * Math.PI) / 180;
    const widthM = 2000 * (halfKm[0] * Math.abs(Math.sin(along)) + halfKm[1] * Math.abs(Math.cos(along)));
    const heightM = extentM[2] / 2 + 1000 * (centreKm[2] + halfKm[2]);

    // Metres per pixel that fit both where the storm will stand. Across, a
    // plane square to the camera is drawn at the scale of the ground under
    // it; upwards it is foreshortened by the tilt.
    const { clientWidth: width, clientHeight: height } = gl.getContainer();
    const top = OPEN_TOP_PX;
    const bottom = height * (1 - OPEN_SHEET_FRACTION);
    const tilt = (OPEN_PITCH * Math.PI) / 180;
    const atFoot = Math.max(
      widthM / (width * OPEN_FILL),
      (heightM * Math.sin(tilt)) / ((bottom - top) * OPEN_FILL),
    );
    // The storm's foot, so that the whole of it sits between the controls
    // and the sheet: halfway down that gap, plus half its own height.
    const foot = (top + bottom) / 2 + (heightM * Math.sin(tilt)) / atFoot / 2;
    // A zoom is a scale at the middle of the screen, and at this tilt the
    // scale changes fast up the screen: the ground under a point above the
    // middle is further off, by the ratio of the two rays' cosines to the
    // vertical. Asked for at the middle, a storm standing a hundred pixels
    // higher came out a third smaller than it was meant to.
    const focal = height / 2 / Math.tan(MAPLIBRE_FOV / 2);
    const above = Math.atan((height / 2 - foot) / focal);
    const atMiddle = (atFoot * Math.cos(tilt + above)) / Math.cos(tilt);
    const zoom = Math.min(Math.log2((WORLD_METRES_AT_ZOOM_0 * Math.cos(latRad)) / atMiddle), gl.getMaxZoom());

    this.pitchBeforeOpen ??= gl.getPitch();
    gl.easeTo({
      center: [lon, lat],
      zoom,
      pitch: OPEN_PITCH,
      bearing: bearing + off,
      offset: [0, foot - height / 2],
      duration: 900,
    });
  }

  /** Repaint every storm, ring and tier in the radar palette the settings now name. */
  private applyColormap(name: string): void {
    if (name === this.colormap) return;
    this.colormap = name;
    this.cloudsLayer?.setColormap(name);
    const gl = this.gl;
    if (!gl || !this.styleReady) return;
    if (gl.getLayer("cloud-marker")) gl.setPaintProperty("cloud-marker", "circle-stroke-color", dbzRamp(name));
    RING_ALPHAS.forEach((_opacity, tier) => {
      const id = `cell-volume-${tier}`;
      if (gl.getLayer(id)) gl.setPaintProperty(id, "fill-extrusion-color", dbzRamp(name));
    });
    gl.triggerRepaint();
  }

  /** Tell the layer which storm is open, and which way its slice now runs. */
  private applyCut(): void {
    const turn = get(cutRotationDeg) + get(cutSweepDeg);
    this.cloudsLayer?.setCut(this.opened?.code ?? null, (this.opened?.heading ?? 0) + turn);
    if (this.shown) this.gl?.triggerRepaint();
  }

  /**
   * Load every listed storm's volume, a few at a time, keeping the ones held.
   *
   * Each storm appears as its volume arrives rather than all of them at the
   * end. Volumes no longer listed are dropped, except the one that is open:
   * taking the storm a reader is looking at away between two refreshes would
   * look like the popup had broken.
   */
  private async loadClouds(): Promise<void> {
    const token = Symbol("clouds");
    this.loadToken = token;
    const listed = new Set(this.clouds.map((cloud) => cloud.path));
    for (const [path, entry] of this.cutaways) {
      if (!listed.has(path) && entry.code !== this.opened?.code) this.cutaways.delete(path);
    }
    this.pushClouds();

    const missing = this.clouds.filter((cloud) => !this.cutaways.has(cloud.path));
    for (let i = 0; i < missing.length; i += VOLUME_FETCHES) {
      const batch = missing.slice(i, i + VOLUME_FETCHES);
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
        this.cutaways.set(cloud.path, { code: cloud.code, cutaway, lon: cloud.lon, lat: cloud.lat });
      }
      this.pushClouds();
      // Switched away: the rest waits for `attach`, whose refresh fetches
      // whatever is still missing.
      if (!this.shown) return;
    }
  }

  /** Hand the layer every loaded storm, and let the tiers inside them stand down. */
  private pushClouds(): void {
    this.cloudsLayer?.setClouds([...this.cutaways.values()].map(({ code, cutaway }) => ({ code, cutaway })));
    this.applyTierFilters();
    if (this.shown) this.gl?.triggerRepaint();
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
   * Every storm core with a volume, as a ring lying on the ground under it.
   *
   * This is what makes a cloud tappable when KONRAD3D never reported it. Flat
   * on the map rather than standing up, so it marks where a volume is without
   * competing with the extruded cells for the same space, and coloured by the
   * core's peak on the same ramp so a strong core reads as strong before it is
   * opened. Sized in pixels, so it stays a target a finger can hit at any
   * zoom.
   */
  private ensureClouds(gl: GlMap): void {
    const data = {
      type: "FeatureCollection" as const,
      features: this.clouds.map((cloud) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [cloud.lon, cloud.lat] },
        properties: { code: cloud.code, dbz: cloud.peak_dbz ?? 40 },
      })),
    };
    const source = gl.getSource(CLOUD_SOURCE);
    if (source) {
      (source as unknown as { setData(data: unknown): void }).setData(data);
      return;
    }
    gl.addSource(CLOUD_SOURCE, { type: "geojson", data, attribution: dwdAttribution });
    gl.addLayer({
      id: "cloud-marker",
      type: "circle",
      source: CLOUD_SOURCE,
      paint: {
        "circle-pitch-alignment": "map",
        "circle-radius": 11,
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": dbzRamp(this.colormap),
        "circle-stroke-opacity": 0.9,
      },
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
   */
  async restoreCloud(path: string): Promise<RadarVolume | null> {
    await (this.firstRefresh ?? this.refresh());
    const listed = this.clouds.find((cloud) => cloud.path === path);
    if (listed) return listed;
    try {
      const cutaway = await loadCutaway({ path, coverage: 0 });
      const { header } = cutaway;
      // Held like a listed one, so opening it does not fetch it a second time.
      this.cutaways.set(path, { code: header.code, cutaway, lon: header.lon, lat: header.lat });
      this.pushClouds();
      return {
        path,
        code: header.code,
        lon: header.lon,
        lat: header.lat,
        reference_time: header.reference_time,
        coverage: header.coverage,
        sites: header.sites,
      };
    } catch {
      return null;
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

  /** Point the draped radar at a frame. Called with the same URL the 2D map uses. */
  setRadarUrl(url: string | null): void {
    this.radarUrl = url;
    // Held for `attach`: a hidden map would load the whole frame's tiles.
    if (!this.shown) return;
    const source = this.gl?.getSource(RADAR_SOURCE);
    if (source && "setTiles" in source && url) {
      (source as unknown as { setTiles(tiles: string[]): void }).setTiles([this.tiles(url)]);
    } else if (this.gl?.isStyleLoaded()) {
      this.applyData();
    }
  }

  /**
   * MapLibre spells the flipped row `{y}` with `scheme: "tms"`, where
   * OpenLayers spells it `{-y}` in the template itself.
   */
  private tiles(url: string): string {
    return url.replace("{-y}", "{y}");
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
    try {
      const [current, clouds] = await Promise.all([
        fetchCurrentCells(this.nanobar),
        // Its own failure is not the cells' failure: a map with storms and no
        // cutaways is worth drawing, so an error here is an empty list.
        fetchCurrentVolumes().catch(() => ({ volumes: [] })),
      ]);
      this.cells = (current.cells ?? []) as CellCurrent[];
      this.clouds = (clouds.volumes ?? []) as RadarVolume[];
      void this.loadClouds();
    } catch {
      // Already reported by the API wrapper; an empty 3D map is not worth a
      // second message on top of it.
      return;
    }
    this.applyData();
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

    this.ensureRadar(gl);
    this.ensureCells(gl);
    this.ensureClouds(gl);
    this.ensureVolumes(gl);
    this.ensureStrikes();
  }

  private ensureRadar(gl: GlMap): void {
    if (!this.radarUrl) return;

    const existing = gl.getSource(RADAR_SOURCE);
    if (existing) {
      // Unchanged is left alone: `setTiles` reloads every tile on screen, and
      // this runs on every refresh and every return to this map.
      const source = existing as unknown as { tiles?: string[]; setTiles(tiles: string[]): void };
      const tiles = this.tiles(this.radarUrl);
      if (source.tiles?.[0] !== tiles) source.setTiles([tiles]);
      return;
    }

    gl.addSource(RADAR_SOURCE, {
      type: "raster",
      tiles: [this.tiles(this.radarUrl)],
      tileSize: 512,
      minzoom: 3,
      maxzoom: 8,
      attribution: dwdAttribution,
      // The backend writes these with TMS row numbering, which OpenLayers
      // spells `{-y}` in the template and MapLibre spells with this flag.
      scheme: "tms",
    });
    gl.addLayer({
      id: RADAR_SOURCE,
      type: "raster",
      source: RADAR_SOURCE,
      paint: { "raster-opacity": RADAR_OPACITY, "raster-resampling": "nearest" },
    });
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
    gl.addLayer({
      id: "strike-glow",
      type: "circle",
      source: STRIKE_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 14],
        "circle-color": "#ffd166",
        "circle-blur": 1,
        "circle-opacity": ["*", 0.5, fade] as never,
      },
    });
    gl.addLayer({
      id: "strike-core",
      type: "circle",
      source: STRIKE_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 12, 3.4],
        "circle-color": "#fff8e1",
        "circle-stroke-color": "#f7b500",
        "circle-stroke-width": 1,
        "circle-opacity": fade,
        "circle-stroke-opacity": fade,
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
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "top"],
          "fill-extrusion-opacity": opacity,
        },
      });
    });
  }

  destroy(): void {
    if (this.strikeTimer !== null) clearTimeout(this.strikeTimer);
    this.strikeTimer = null;
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.unsubscribeSelection?.();
    this.unsubscribeSelection = null;
    this.unsubscribeCut?.();
    this.unsubscribeCut = null;
    this.unsubscribeColormap?.();
    this.unsubscribeColormap = null;
    this.unsubscribeSweep?.();
    this.unsubscribeSweep = null;
    stopSweep(false);
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.gl?.remove();
    this.gl = null;
    this.detach();
    this.container = null;
  }
}
