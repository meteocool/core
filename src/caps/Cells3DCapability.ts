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
import { darkTheme, lightTheme } from "../layers/base";
import { volumeCollection, footprintCollection } from "../lib/cellExtrusions";
import { loadCutaway } from "../lib/cellCutaway";
import { makeCellVolumeLayer } from "../layers/cellVolumeLayer";
import type { CellVolumeLayer } from "../layers/cellVolumeLayer";
import { DBZ_RAMP, RING_ALPHAS } from "../lib/cellVolume";
import { fetchCellTrack, fetchCurrentCells } from "../api";
import { capDescription, colorSchemeDark, selectedCell, showForecastPlaybutton } from "../stores";

import { trimToLastRun } from "../lib/cellTrack";
import type { CellCurrent, CellTrack, CellTrackProperties } from "../api";
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
const VOLUME_LAYER = "cell-volume-raymarched";
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
const PICKABLE = ["cell-volume-0", "cell-volume-1", "cell-footprint"];

/**
 * How long a strike stays on this map.
 *
 * The flat map's own buffer fades them over thirty minutes. Here they are
 * shown only as a recent-activity halo around the cells that are producing
 * them, and half an hour of accumulation over a squall line is a solid smear
 * -- ten minutes keeps it to what is happening now.
 */
const STRIKE_MINUTES = 10;

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

  /** The raymarched volume for the selected storm, while one is showing. */
  private volumeLayer: CellVolumeLayer | null = null;

  /** Whose volume that is, so the extruded tiers know to stand down. */
  private volumeCode: string | null = null;

  /** Guards against a slow fetch landing after the selection has moved on. */
  private volumeToken: symbol | null = null;

  /** MapLibre, once it has loaded; the volume layer needs its Mercator maths. */
  private maplibre: Awaited<ReturnType<typeof loadMapLibre>> | null = null;

  constructor(map: OlMap, additionalLayers: BaseLayer[], options: CapabilityOptions) {
    super(map, "cells3d", () => Cells3DCapability.announce(), additionalLayers);

    this.nanobar = options.nanobar;
    this.unsubscribeSelection = selectedCell.subscribe((track) => {
      void this.showVolume(track);
    });
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
    return basemapStyle(muteTheme(this.dark ? darkTheme : lightTheme));
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
      // Tapping a storm opens the same popup the flat map opens, and tapping
      // past one closes it -- the panel is rendered above whichever map is
      // showing, so it needs no separate plumbing here.
      gl.on("click", (event) => {
        const hit = gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) })
          .find((feature) => feature.properties?.code);
        const code = hit?.properties?.code;
        if (code) void this.select(String(code));
        else selectedCell.set(null);
      });
      gl.on("mousemove", (event) => {
        const over = gl.queryRenderedFeatures(event.point, { layers: this.pickable(gl) }).length > 0;
        gl.getCanvas().style.cursor = over ? "pointer" : "";
      });
      this.gl = gl;
    } else {
      this.pullCameraFromView();
      this.gl.resize();
    }

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
    this.detach();
    super.willLoseFocus();
  }

  private detach(): void {
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
   * Every cell but one. The storm whose volume is being raymarched is drawn
   * by the volume and nothing else: the shells are the same storm a second
   * time, measured a different way, and `fill-extrusion` writes depth even
   * when it is translucent -- so left in place they punch the tier boundaries
   * straight through the volume they are supposed to be describing.
   */
  private tierFilter(tier: number): ExpressionSpecification {
    const mine: ExpressionSpecification = ["==", ["get", "tier"], tier];
    if (!this.volumeCode) return mine;
    return ["all", mine, ["!=", ["get", "code"], this.volumeCode]];
  }

  private applyTierFilters(): void {
    const gl = this.gl;
    if (!gl || !this.styleReady) return;
    RING_ALPHAS.forEach((_opacity, tier) => {
      if (gl.getLayer(`cell-volume-${tier}`)) gl.setFilter(`cell-volume-${tier}`, this.tierFilter(tier));
    });
  }

  /**
   * Put the selected storm's volume on the map, or take the last one off.
   *
   * Most cells have no volume -- it is built for the strongest few, and only
   * where the radars sampled them well enough -- so the ordinary answer here
   * is to remove whatever was showing and stop.
   */
  private async showVolume(track: CellTrackProperties | null): Promise<void> {
    const volume = track?.volume ?? null;
    const token = Symbol("volume");
    this.volumeToken = token;

    if (!volume || !track) { this.clearVolume(); return; }
    if (this.volumeCode === track.code) {
      // Same storm, new run: the cut may have turned with it.
      this.volumeLayer?.setHeading(this.headingOf(track));
      this.gl?.triggerRepaint();
      return;
    }

    let cutaway;
    try {
      cutaway = await loadCutaway(volume);
    } catch {
      // A volume that will not load is a volume the reader never sees; the
      // extruded tiers are still there and still say what they always did.
      if (this.volumeToken === token) this.clearVolume();
      return;
    }
    // The selection may have moved on, or this map may have been put away.
    if (this.volumeToken !== token || !this.gl || !this.maplibre || !this.styleReady) return;

    this.clearVolume();
    const layer = makeCellVolumeLayer(
      VOLUME_LAYER, cutaway, this.headingOf(track), this.maplibre.MercatorCoordinate,
    );
    this.gl.addLayer(layer);
    this.volumeLayer = layer;
    this.volumeCode = track.code;
    this.applyTierFilters();
  }

  /** Where the storm is going, which is the direction the cut runs along. */
  private headingOf(track: CellTrackProperties): number | null {
    const series = track.series ?? [];
    return series[series.length - 1]?.heading_deg ?? null;
  }

  private clearVolume(): void {
    if (this.gl?.getLayer(VOLUME_LAYER)) this.gl.removeLayer(VOLUME_LAYER);
    this.volumeLayer = null;
    this.volumeCode = null;
    this.applyTierFilters();
  }

  private async select(code: string): Promise<void> {
    const token = Symbol("pick");
    this.picking = token;
    try {
      const answer = await fetchCellTrack(code, this.nanobar);
      if (this.picking !== token) return;
      const track = answer as unknown as CellTrack | undefined;
      if (track?.properties) selectedCell.set(trimToLastRun(track).properties);
    } catch {
      // Already reported by the API wrapper; a popup that does not open is
      // not worth a second message on top of it.
    }
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

  /**
   * Read strikes from the flat map's own buffer.
   *
   * Given the source rather than the strikes themselves so this map picks up
   * every arrival without App.svelte having to forward each one; the source
   * fires `change` as the buffer adds and evicts.
   */
  setStrikeSource(source: VectorSource): void {
    this.strikes = source;
    source.on("change", () => this.ensureStrikes());
    this.ensureStrikes();
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
    this.ensureStrikes();
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

    gl.addSource(STRIKE_SOURCE, { type: "geojson", data });
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
        filter: this.tierFilter(tier),
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
    this.unsubscribeSelection?.();
    this.unsubscribeSelection = null;
    this.gl?.remove();
    this.gl = null;
    this.detach();
    this.container = null;
  }
}
