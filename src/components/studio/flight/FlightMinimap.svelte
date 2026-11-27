<script module lang="ts">
/* What the reader chose of the map, kept for the flight: V goes round the views, and comes back to the same map. */
let chosenRange = 2;
let chosenHeadingUp = true;
</script>

<script lang="ts">
/**
 * The map of a flight seen from outside: from the seat the navigation
 * display says where the weather is, and outside there is no panel to look
 * at. A small round map with the aircraft in its middle (minimap.ts), on
 * the flight deck.
 *
 * The radar on it is the picture the map drapes on the ground, in the same
 * tiles (layers/maskedTiles.ts), a handful at a time and kept while they
 * are under the aircraft; where there is none to draw, the listed storms as
 * the navigation display paints them.
 *
 * Drawn when the flight deck says a frame has come (`draw`), and then only
 * if the picture has moved by enough to see, or something on it changed.
 * A click on the map steps its range; the small button on its corner turns
 * it heading up or north up.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { loadMaskedTile } from "../../../layers/maskedTiles";
import { distanceM } from "../../../lib/studio/flight/geo";
import { coresOf } from "../../../lib/studio/flight/marks";
import type { StormMark } from "../../../lib/studio/flight/marks";
import type { Pilot, Telemetry } from "../../../lib/studio/flight/pilot";
import { prepare } from "./instruments";
import { drawChart, RANGES_NM, shiftSince, TileStore, tilesOver, tileUrl, tileZoom } from "./minimap";
import type { Chart, ChartContent, ChartStrike, Tile } from "./minimap";
import type { TrafficShared } from "../../../lib/studio/flight/airspace/shared";

export let pilot: Pilot;
/** The other aircraft of the board's airspace, marked on the map; none without a board. */
export let traffic: TrafficShared | null = null;

/** How long a strike on the ground stays on the map, and a flicker in the cloud, seconds flown. */
const STRIKE_S = 45;
const FLICKER_S = 1.2;
/** How far the aircraft goes between two points of the way it has come, metres, and how many are kept. */
const TRACK_STEP_M = 400;
const TRACK_POINTS = 240;
/** A step longer than this is not flown, metres: the flight was cut to another start. */
const TRACK_JUMP_M = 8000;
/** The picture is drawn again once it has moved this far, screen pixels, and this often whatever has moved, ms. */
const REDRAW_PX = 0.6;
const REDRAW_MS = 500;
const TRAFFIC_REDRAW_MS = 250;
/** How often the slower things are asked again, ms: which radar is on the ground, which storms are marked. */
const SLOW_MS = 1000;

let canvas: HTMLCanvasElement | null = null;
let box: HTMLDivElement | null = null;
let size = 0;
let range = chosenRange;
let headingUp = chosenHeadingUp;

let drawn: Chart | null = null;
let drawnAt = -Infinity;
let stale = true;
let again: number | null = null;

let track: Array<[number, number]> = [];
let strikes: Array<{ lon: number; lat: number; born: number; ground: boolean; key: string }> = [];
let cores: StormMark[] = [];
let templates: string[] = [];
let slowAt = -Infinity;
/** The radar last drawn whole: shown until a newer frame's tiles, or another zoom's, have all come. */
let whole: { templates: string[]; zoom: number } | null = null;

const tiles = new TileStore<ImageBitmap>(
  (url) => loadMaskedTile(url).then(({ data }) => data),
  (picture) => picture.close(),
  () => redrawSoon(),
);

/** Draw again on the next frame of the page's, whether or not the flight has one coming: a paused flight has none. */
function redrawSoon(): void {
  stale = true;
  if (again !== null) return;
  again = requestAnimationFrame(() => {
    again = null;
    draw(pilot.telemetry);
  });
}

/** The addresses last asked for, and what they were worked out from: the same tiles are under the aircraft for minutes. */
let wanted: { from: string[]; key: string; urls: Array<{ url: string; tile: Tile }> } | null = null;

/** The radar's tiles over the map: the newest frame's once all of them are here, and until then the ones last drawn. */
function radarOver(chart: Chart, ratio: number, now: number): ChartContent["radar"] {
  const zoom = tileZoom(chart, ratio);
  const addresses = (from: string[], at: number) => {
    const over = tilesOver(chart, at);
    return from.flatMap((template) => over.map((tile) => ({ url: tileUrl(template, tile), tile })));
  };
  const gather = (urls: Array<{ url: string; tile: Tile }>, ask: boolean) => {
    let complete = true;
    const pictures: ChartContent["radar"] = [];
    for (const { url, tile } of urls) {
      const picture = ask ? tiles.get(url, now) : tiles.peek(url, now);
      if (picture === undefined) complete = false;
      else if (picture) pictures.push({ picture, tile });
    }
    return { pictures, complete };
  };
  const key = tilesOver(chart, zoom).join(" ");
  if (!wanted || wanted.from !== templates || wanted.key !== key) wanted = { from: templates, key, urls: addresses(templates, zoom) };
  const newest = gather(wanted.urls, true);
  if (newest.complete || !whole) {
    if (newest.complete) whole = { templates, zoom };
    return newest.pictures;
  }
  return gather(addresses(whole.templates, whole.zoom), false).pictures;
}

/** What need not be looked at every frame. */
function slow(telemetry: Telemetry, now: number): void {
  slowAt = now;
  const next = pilot.radarTiles();
  if (next.length !== templates.length || next.some((template, i) => template !== templates[i])) {
    templates = next;
    stale = true;
  }
  cores = coresOf(telemetry.storms);
}

/** Note where the aircraft is, and the lightning under way: every frame, drawn or not. */
function follow(telemetry: Telemetry): void {
  const { state, time } = telemetry;
  const last = track[track.length - 1];
  const gone = last ? distanceM(last[0], last[1], state.lon, state.lat) : Infinity;
  if (gone > TRACK_JUMP_M) track = [[state.lon, state.lat]];
  else if (gone >= TRACK_STEP_M) {
    track.push([state.lon, state.lat]);
    if (track.length > TRACK_POINTS) track.shift();
  }
  for (const flash of pilot.flashing()) {
    const key = `${flash.born}/${flash.seed}`;
    if (strikes.some((strike) => strike.key === key)) continue;
    strikes.push({ lon: flash.lon, lat: flash.lat, born: flash.born, ground: flash.ground, key });
    stale = true;
  }
  // A flight begun again counts its seconds from the same clock: nothing here is from after now.
  strikes = strikes.filter((strike) => time - strike.born < (strike.ground ? STRIKE_S : FLICKER_S));
}

/** A frame of the flight: the map drawn again if it would look any different. */
export function draw(telemetry: Telemetry): void {
  follow(telemetry);
  if (!canvas || size < 20) return;
  const now = performance.now();
  if (now - slowAt >= SLOW_MS) slow(telemetry, now);
  const { state } = telemetry;
  const chart: Chart = {
    lon: state.lon, lat: state.lat, heading: state.heading, headingUp, rangeNm: RANGES_NM[range], radius: size / 2,
  };
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  // Other aircraft move on their own: the map is drawn again for them at least every so often.
  if (!stale && now - drawnAt < (traffic?.traffic.list.length ? TRAFFIC_REDRAW_MS : REDRAW_MS) && shiftSince(chart, drawn) * ratio < REDRAW_PX) return;
  const context = prepare(canvas, size, size);
  if (!context) return;
  const radar = radarOver(chart, ratio, now);
  const { time } = telemetry;
  const inspected = telemetry.marks.find((seen) => seen.inspected)?.mark ?? null;
  const charted = drawChart(context, chart, {
    radar,
    storms: templates.length ? null : telemetry.storms,
    cores,
    target: telemetry.target,
    inspected,
    cut: telemetry.cut,
    track,
    strikes: strikes.map((strike): ChartStrike => ({
      lon: strike.lon, lat: strike.lat, ground: strike.ground, age: (time - strike.born) / (strike.ground ? STRIKE_S : FLICKER_S),
    })),
    others: traffic?.traffic.list ?? [],
  });
  if (traffic) traffic.charted = charted;
  drawn = chart;
  drawnAt = now;
  stale = false;
}

function setRange(next: number): void {
  range = next;
  chosenRange = next;
  redrawSoon();
}
function nextRange(): void {
  setRange((range + 1) % RANGES_NM.length);
}
/** The wheel over the map: nearer or further, as it is over the view. */
function wheel(event: WheelEvent): void {
  event.preventDefault();
  const next = Math.min(Math.max(range + Math.sign(event.deltaY), 0), RANGES_NM.length - 1);
  if (next !== range) setRange(next);
}
function turn(): void {
  headingUp = !headingUp;
  chosenHeadingUp = headingUp;
  redrawSoon();
}

let resize: ResizeObserver | null = null;
onMount(() => {
  resize = new ResizeObserver(() => {
    size = box?.clientWidth ?? 0;
    redrawSoon();
  });
  if (box) resize.observe(box);
});
onDestroy(() => {
  resize?.disconnect();
  if (again !== null) cancelAnimationFrame(again);
  tiles.dispose();
});
</script>

<div class="flight-minimap" role="group" aria-label={$_("studio.flight.minimap.title")} bind:this={box}>
  <button type="button" class="chart" tabindex="-1" on:click={nextRange} on:wheel={wheel}
    title={$_("studio.flight.minimap.range_title", { values: { nm: RANGES_NM[range] } })}
    aria-label={$_("studio.flight.minimap.range", { values: { nm: RANGES_NM[range] } })}>
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
  </button>
  <button type="button" class="up" tabindex="-1" on:click={turn}
    title={$_(headingUp ? "studio.flight.minimap.heading_up_title" : "studio.flight.minimap.north_up_title")}
    aria-label={$_(headingUp ? "studio.flight.minimap.heading_up_title" : "studio.flight.minimap.north_up_title")}>
    {$_(headingUp ? "studio.flight.minimap.heading_up" : "studio.flight.minimap.north_up")}<span aria-hidden="true">↑</span>
  </button>
</div>

<style>
  /* A round instrument, in the readouts' dark glass; where it stands is the deck's to say. */
  .flight-minimap {
    width: var(--flight-minimap-size, 196px);
    height: var(--flight-minimap-size, 196px);
    pointer-events: none;
  }
  .chart {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 1px solid rgba(242, 244, 247, 0.22);
    border-radius: 50%;
    box-sizing: border-box;
    /* Darker than a readout's glass: the radar's faint colours are read against it, and bright ground behind would wash them out. */
    background: rgba(5, 7, 10, 0.74);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    cursor: pointer;
    pointer-events: auto;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  /* Which way is up: a small pill on the map's corner, where the circle leaves the square free. */
  .up {
    position: absolute;
    top: -4px;
    right: -6px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: 11px;
    background: rgba(5, 7, 10, 0.62);
    color: #f2f4f7;
    font: 700 10px/1 var(--mc-font);
    letter-spacing: 0.05em;
    cursor: pointer;
    pointer-events: auto;
  }
  .chart:hover { border-color: rgba(242, 244, 247, 0.45); }
  .up:hover { background: rgba(5, 7, 10, 0.8); }
  .chart:focus-visible, .up:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
</style>
