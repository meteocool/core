import { Map as OlMap } from "ol";
import { toLonLat, fromLonLat } from "ol/proj";
import type BaseLayer from "ol/layer/Base";
import type {
  DataDrivenPropertyValueSpecification, Map as GlMap, StyleSpecification,
} from "maplibre-gl";
import Capability from "./Capability";
import type { CapabilityOptions } from "./options";
import { basemapStyle } from "../layers/maplibreStyle";
import { darkTheme, lightTheme } from "../layers/base";
import { volumeCollection, footprintCollection } from "../lib/cellExtrusions";
import { DBZ_RAMP, RING_ALPHAS } from "../lib/cellVolume";
import { fetchCurrentCells } from "../api";
import { capDescription, colorSchemeDark, showForecastPlaybutton } from "../stores";
import { NOWCAST_OPACITY } from "../layers/ui";
import type { CellCurrent } from "../api";

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
const FOOTPRINT_SOURCE = "cell-footprints";
const RADAR_SOURCE = "radar";

/** The id of the one full-size map element; minimaps carry generated ids. */
const MAIN_MAP_ID = "map";

/** Opening tilted is the whole point; flat, this is just a slower 2D map. */
const INITIAL_PITCH = 55;

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
 * The reflectivity ramp as a MapLibre expression.
 *
 * Built at runtime from the shared ramp, so the 3D map, the popup's model and
 * anything else reading intensity agree on what 55 dBZ looks like. The
 * assertion is the same story as `severityColour`: a run-length shape cannot be
 * checked against the spec's fixed-arity tuple.
 */
function dbzRamp(): DataDrivenPropertyValueSpecification<string> {
  return [
    "interpolate", ["linear"], ["get", "dbz"],
    ...DBZ_RAMP.flatMap(([dbz, colour]) => [dbz, colour]),
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

export default class Cells3DCapability extends Capability {
  private gl: GlMap | null = null;

  /** The element MapLibre draws into, parented to whatever target is active. */
  private container: HTMLDivElement | null = null;

  private cells: CellCurrent[] = [];

  /** The radar frame to drape, as a tile URL template. Set by the caller. */
  private radarUrl: string | null = null;


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

  constructor(map: OlMap, additionalLayers: BaseLayer[], options: CapabilityOptions) {
    super(map, "cells3d", () => Cells3DCapability.announce(), additionalLayers);

    this.nanobar = options.nanobar;
    this.unsubscribeTheme = colorSchemeDark.subscribe((value) => {
      this.dark = Boolean(value);
      if (!this.gl) return;
      // setStyle discards every source and layer added on top of it; the
      // `style.load` handler above puts them back.
      this.styleReady = false;
      this.gl.setStyle(this.style());
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
    return basemapStyle(this.dark ? darkTheme : lightTheme);
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
    void this.attach(element as HTMLElement);
  }

  private async attach(host: HTMLElement): Promise<void> {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "maplibre-host";
    }
    if (this.container.parentElement !== host) host.appendChild(this.container);

    if (!this.gl) {
      const maplibre = await loadMapLibre();
      // Another attach may have won the race while the library was loading.
      if (this.gl) return;
      const view = this.map.getView();
      const centre = view.getCenter();
      const [lon, lat] = centre ? toLonLat(centre) : [10, 51];

      const gl = new maplibre.Map({
        container: this.container,
        style: this.style(),
        center: [lon, lat],
        zoom: (view.getZoom() ?? 6) - 1,
        pitch: INITIAL_PITCH,
        maxZoom: 13,
        attributionControl: { compact: true },
      });
      gl.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
      // Fires on the first style and again after every `setStyle`, which is
      // what a light/dark switch does -- and that discards everything added on
      // top of it, so this is also how the storms get put back.
      gl.on("style.load", () => {
        this.styleReady = true;
        this.applyData();
      });
      // Keep the shared View in step so switching back to the flat map lands
      // where this one was left, and so anything reading the viewport agrees.
      gl.on("moveend", () => this.pushCameraToView());
      this.gl = gl;
    } else {
      this.pullCameraFromView();
      this.gl.resize();
    }

    void this.refresh();
  }

  private detach(): void {
    if (this.container?.parentElement) this.container.parentElement.removeChild(this.container);
  }

  private pushCameraToView(): void {
    if (this.syncing || !this.gl) return;
    this.syncing = true;
    const centre = this.gl.getCenter();
    const view = this.map.getView();
    view.setCenter(fromLonLat([centre.lng, centre.lat]));
    view.setZoom(this.gl.getZoom() + 1);
    this.syncing = false;
  }

  private pullCameraFromView(): void {
    if (this.syncing || !this.gl) return;
    this.syncing = true;
    const view = this.map.getView();
    const centre = view.getCenter();
    if (centre) {
      const [lon, lat] = toLonLat(centre);
      this.gl.jumpTo({ center: [lon, lat], zoom: (view.getZoom() ?? 6) - 1 });
    }
    this.syncing = false;
  }

  /** Point the draped radar at a frame. Called with the same URL the 2D map uses. */
  setRadarUrl(url: string | null): void {
    this.radarUrl = url;
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

  /** Re-read the latest run. One timestep only: this map does not scrub. */
  async refresh(): Promise<void> {
    try {
      const current = await fetchCurrentCells(this.nanobar);
      this.cells = (current.cells ?? []) as CellCurrent[];
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
  }

  private ensureRadar(gl: GlMap): void {
    if (!this.radarUrl) return;

    const existing = gl.getSource(RADAR_SOURCE);
    if (existing) {
      (existing as unknown as { setTiles(tiles: string[]): void }).setTiles([this.tiles(this.radarUrl)]);
      return;
    }

    gl.addSource(RADAR_SOURCE, {
      type: "raster",
      tiles: [this.tiles(this.radarUrl)],
      tileSize: 512,
      minzoom: 3,
      maxzoom: 8,
      // The backend writes these with TMS row numbering, which OpenLayers
      // spells `{-y}` in the template and MapLibre spells with this flag.
      scheme: "tms",
    });
    gl.addLayer({
      id: RADAR_SOURCE,
      type: "raster",
      source: RADAR_SOURCE,
      paint: { "raster-opacity": NOWCAST_OPACITY, "raster-resampling": "nearest" },
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

    gl.addSource(CELL_SOURCE, { type: "geojson", data: volume });
    // Innermost tier first. Each is one `fill-extrusion` layer because
    // `fill-extrusion-opacity` takes no expression, and the order is what
    // makes the glass work: a tier drawn later blends over the tiers already
    // in the depth buffer, so the core is laid down before anything covers it.
    RING_ALPHAS.forEach((opacity, tier) => {
      gl.addLayer({
        id: `cell-volume-${tier}`,
        type: "fill-extrusion",
        source: CELL_SOURCE,
        filter: ["==", ["get", "tier"], tier],
        paint: {
          "fill-extrusion-color": dbzRamp(),
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "top"],
          "fill-extrusion-opacity": opacity,
        },
      });
    });
  }

  destroy(): void {
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.gl?.remove();
    this.gl = null;
    this.detach();
    this.container = null;
  }
}
