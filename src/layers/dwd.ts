import Feature from "ol/Feature";
import Fill from "ol/style/Fill";
import Style from "ol/style/Style";
import LinearRing from "ol/geom/LinearRing";
import type Polygon from "ol/geom/Polygon";
import { derived } from "svelte/store";
import TileLayer from "./webglTile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import ValueTileSource, { staleOnlyWhileLoading } from "./valueTiles";
import { blitzortungAttribution, dwdAttribution } from "./attributions";
import {
  beExclusiveCoverage, chExclusiveCoverage, czExclusiveCoverage, dkExclusiveCoverage, dwdCoverageInv, dwdRadarExtent,
  eeExclusiveCoverage, fiExclusiveCoverage, frExclusiveCoverage, hrExclusiveCoverage, ltExclusiveCoverage,
  ieExclusiveCoverage, nlExclusiveCoverage, noExclusiveCoverage, plExclusiveCoverage, radarCoverageInv, seExclusiveCoverage,
  skExclusiveCoverage,
} from "./extents";
import { nowcastCoverage, onForecastStep } from "../stores";
import type { CountryNetwork } from "../api/events";
import { isDarkBasemap, watchBasemap } from "./casing";
import { tileBaseUrl } from "../urls";
import { trackTileLoads } from "../lib/tileStatus";
import { drawnTileId, rvp6Style } from "../lib/rvp6";
import type { ValueTiles } from "../lib/rvp6";
import { hgClassStyle } from "../lib/hgClasses";
import type { ClassTiles } from "../api";
import { NOWCAST_OPACITY } from "./ui";
import { radarTileCache } from "../lib/gpuBudget";
import { groupRings } from "../lib/ringGroups";

/** What a layer is built for: one frame's tile set, and what its bytes mean. */
export interface TileFrame {
  tile_id: string;
  bucket?: string;
  values?: ValueTiles | null;
}

/** The palette DWD's frames are drawn in, by the name the settings store it under. */
let palette = "classic";

// Zoom 9 for the observed frame, HX at 250 m; a forecast step is WN at 1 km
// and stops at 8, and answers 9 out of its own 8 (lib/tileIndex.ts). The
// server serves 512 px tiles, and `interpolate: false` keeps every radar
// pixel a square of its own class.
const commonDWDParameters = {
  attributions: [dwdAttribution, blitzortungAttribution],
  minZoom: 3,
  maxZoom: 9,
  tileSize: 512,
  transition: 0,
  interpolate: false,
};

/**
 * The tile URL for a `RadarFrame`-shaped `{tile_id}` in one bucket.
 *
 * Shared by every network's reflectivity layer: DWD's and the EUMETNET ones
 * alike hand the client the same `RadarFrame` shape, so this is the one place
 * that turns it into a tile source URL.
 * A frame's value tiles are at the same place, under `values.tile_id`.
 */
export const tileSourceUrl = (bucket: string, tileId: string) =>
  `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;

/** The value layers built, so a palette change restyles them in place. */
const valueLayers = new Set<TileLayer>();

/**
 * The layer DWD's frames are drawn through, built on one of them.
 *
 * Playback re-points its source at every step (`ValueTileSource.setUrl`),
 * which also cuts the EUMETNET networks' countries out of the observed
 * steps those networks have frames for: see `networkHoles.ts` for why. The
 * palette is the layer's style, a 256-entry lookup on the GPU, the same
 * cost in every palette.
 */
export function dwdValueLayer(frame: TileFrame): [TileLayer, ValueTileSource, string] {
  const tileId = drawnTileId(frame);
  const url = tileSourceUrl(frame.bucket ?? "meteoradar", tileId);
  const source = trackTileLoads(new ValueTileSource({ ...commonDWDParameters, url, holed: true }));
  source.set("tile_id", tileId);
  const layer = staleOnlyWhileLoading(new TileLayer({
    source,
    style: rvp6Style(palette),
    zIndex: 80,
    opacity: NOWCAST_OPACITY,
    cacheSize: radarTileCache(512),
    extent: dwdRadarExtent,
  }));
  layer.set("tile_id", tileId);
  valueLayers.add(layer);
  return [layer, source, url];
}

export function setDwdCmap(colorMapString: string) {
  palette = colorMapString;
  for (const layer of valueLayers) {
    // Disposed: OpenLayers takes the source away.
    if (!layer.getSource()) valueLayers.delete(layer);
    else layer.setStyle(rvp6Style(palette));
  }
}

/** The dark wash over everywhere neither radar network reaches. */
/**
 * How hard the "no radar here" wash is laid on, by what it is laid on.
 *
 * It is a black wash, so its strength has to follow the basemap: a tenth of
 * black over the light earth (#f6f4f0) is an obvious step down, and the same
 * tenth over the dark one (#1c1f24) is almost nothing. That left the boundary
 * between "no radar" and "no rain" invisible on exactly the basemap where the
 * distinction matters most, because both read as dark.
 *
 * Two fifths in the dark, against a tenth in the light. A quarter was still
 * too faint to notice there (2026-10-11): against a near-black ground the
 * same black buys far less, so the dark wash has to be laid on much harder
 * to read as the same step.
 */
const WASH_LIGHT = "rgba(0, 0, 0, 0.1)";
const WASH_DARK = "rgba(0, 0, 0, 0.4)";

const washFor = (basemap: string): string => (isDarkBasemap(basemap) ? WASH_DARK : WASH_LIGHT);

/**
 * The one Fill every coverage wash shares, and the layers drawing it.
 *
 * Mutated in place rather than rebuilt, for the same reason the place labels
 * are: the factory is called once per capability and each call's layer holds a
 * reference to the Style, so replacing it would leave all but one of them
 * pointing at the old colour. One module-level subscription rather than one
 * per layer, so nothing has to be unsubscribed.
 */
const washFill = new Fill({ color: WASH_LIGHT });
const washLayers = new Set<VectorLayer>();

watchBasemap(washFor, (colour) => {
  washFill.setColor(colour);
  // OpenLayers has no way to notice a mutated style; without this the old
  // wash stays on screen until something else invalidates the layer.
  washLayers.forEach((layer) => layer.changed());
});

/**
 * The ground each network's nowcast is drawn on: its composite's, `network.ts`.
 */
const NOWCAST_GROUND: Record<CountryNetwork, number[][][]> = {
  ch: chExclusiveCoverage,
  fr: frExclusiveCoverage,
  cz: czExclusiveCoverage,
  pl: plExclusiveCoverage,
  be: beExclusiveCoverage,
  sk: skExclusiveCoverage,
  lt: ltExclusiveCoverage,
  ee: eeExclusiveCoverage,
  hr: hrExclusiveCoverage,
  dk: dkExclusiveCoverage,
  nl: nlExclusiveCoverage,
  fi: fiExclusiveCoverage,
  se: seExclusiveCoverage,
  no: noExclusiveCoverage,
  ie: ieExclusiveCoverage,
};

/** A scratch canvas the cut wash is drawn on before it is laid on the map's. */
let scratch: HTMLCanvasElement | null = null;

/**
 * The forecast step's wash with meteocool's nowcast cut out of it as well as
 * DWD's reach: the world, and each ground after it cut away from it one at a
 * time, all of a ground's rings at once, so its holes (another country's
 * islands in Denmark's sea) stay washed.
 *
 * Not a plain fill. Each network's ground overlaps DWD's reach inside its own
 * borders, and under the nonzero rule two holes over one pixel count back to
 * filled: exactly the ground both forecasts reach would be washed as having
 * none. So the wash is drawn on a canvas of its own, its holes erased from it
 * separately, and the result laid on the map. Hit detection draws nothing:
 * nothing asks the wash what was tapped.
 */
const cutWash = new Style({
  renderer(coordinates, state) {
    const rings = coordinates as number[][][];
    const { context } = state;
    const { width, height } = context.canvas;
    scratch ??= document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const cut = scratch.getContext("2d");
    if (!cut || rings.length === 0) return;
    cut.setTransform(context.getTransform());
    // Several rings in one path, filled under the nonzero rule: a ground's holes stay holes.
    const trace = (group: number[][][]) => {
      cut.beginPath();
      for (const ring of group) {
        ring.forEach(([x, y], i) => (i === 0 ? cut.moveTo(x, y) : cut.lineTo(x, y)));
        cut.closePath();
      }
      cut.fill();
    };
    cut.fillStyle = String(washFill.getColor());
    trace([rings[0]]);
    // Erased by an opaque fill: `destination-out` takes away as much as it is opaque.
    cut.globalCompositeOperation = "destination-out";
    cut.fillStyle = "#000";
    groupRings(rings.slice(1), washGroups).forEach(trace);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(scratch, 0, 0);
    context.restore();
  },
  hitDetectionRenderer() {},
});

/** The cut wash's geometry for a set of networks, and its rings' grouping, built once per set. */
const cutGeometries = new Map<string, { geometry: Polygon; groups: number[] }>();

function nowcastWashGeometry(networks: readonly CountryNetwork[]): { geometry: Polygon; groups: number[] } {
  const key = networks.join();
  let cut = cutGeometries.get(key);
  if (!cut) {
    const geometry = dwdCoverageInv.clone();
    // DWD's reach, then each network's ground: one cut each, however many rings it has.
    const groups = [geometry.getLinearRingCount() - 1];
    for (const network of networks) {
      const ground = NOWCAST_GROUND[network];
      for (const ring of ground) geometry.appendLinearRing(new LinearRing(ring));
      groups.push(ground.length);
    }
    cut = { geometry, groups };
    cutGeometries.set(key, cut);
  }
  return cut;
}

/**
 * The washes that follow the player onto a forecast step, and what they cover.
 *
 * WN is DWD's alone: on its steps every other network's country has nothing
 * drawn for that time, so the wash covers all but DWD's reach
 * (`dwdCoverageInv`), and goes back to every network's as soon as the player
 * is on the present or the past again. With meteocool's nowcast on, the
 * ground of each network whose run has a lead at the step is left clear as
 * well (`cutWash`). One module-level subscription, as for the colour above.
 */
const forecastWashes = new Set<Feature>();
let washGeometry: Polygon = radarCoverageInv;
let washStyle: Style | undefined;
/** How many of the cut wash's rings, after the world's, `cutWash` erases together, ground by ground. */
let washGroups: number[] = [];

derived([onForecastStep, nowcastCoverage], ([forecast, nowcast]) => ({ forecast, runs: nowcast?.shown ?? [] }))
  .subscribe(({ forecast, runs }) => {
    const cut = forecast && runs.length > 0 ? nowcastWashGeometry(runs) : null;
    washGeometry = !forecast ? radarCoverageInv : cut ? cut.geometry : dwdCoverageInv;
    washGroups = cut?.groups ?? [];
    washStyle = cut ? cutWash : undefined;
    forecastWashes.forEach((feature) => {
      feature.setGeometry(washGeometry);
      feature.setStyle(washStyle);
    });
  });

/**
 * The dark wash over everywhere no network reaches.
 *
 * `followsForecast` for the radar map's, the one map with a forecast: there
 * it shrinks to DWD's reach on a forecast step. A map without one keeps the
 * whole coverage whatever the radar player was last left on.
 */
export const radolanOverlay = ({ followsForecast = false } = {}) => {
  const feature = new Feature({
    geometry: followsForecast ? washGeometry : radarCoverageInv,
    name: "DarkOverlay",
  });
  if (followsForecast) {
    feature.setStyle(washStyle);
    forecastWashes.add(feature);
  }
  const layer = new VectorLayer({
    zIndex: 1000,
    renderBuffer: 500,
    source: new VectorSource({ features: [feature] }),
    style: new Style({ fill: washFill }),
  });
  washLayers.add(layer);
  return layer;
};

/**
 * The precipitation-type layer for its newest frame: a byte per HG class
 * (lib/hgClasses.ts), coloured on the GPU.
 */
export const dwdPrecipTypes = (frame: { tile_id: string; values?: ClassTiles | null }, bucket = "meteoradar") => {
  const source = trackTileLoads(new ValueTileSource({
    url: tileSourceUrl(bucket, frame.values?.tile_id ?? frame.tile_id),
    attributions: [dwdAttribution],
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tileSize: 512,
    // Classes, not intensities: blending snow into hail past zoom 8 draws a colour no class has.
    interpolate: false,
  }));
  return staleOnlyWhileLoading(new TileLayer({ source, style: hgClassStyle(), zIndex: 3, opacity: NOWCAST_OPACITY, cacheSize: radarTileCache(256) }));
};
