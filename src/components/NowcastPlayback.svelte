<script lang="ts">
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faAngleDoubleDown } from "@fortawesome/free-solid-svg-icons/faAngleDoubleDown";
import { faAngleDoubleUp } from "@fortawesome/free-solid-svg-icons/faAngleDoubleUp";
import { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
import { faRetweet } from "@fortawesome/free-solid-svg-icons/faRetweet";
import { faLocationCrosshairs } from "@fortawesome/free-solid-svg-icons/faLocationCrosshairs";
import Icon from "./Icon.svelte";
import StateMachine from "javascript-state-machine";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { fly } from "svelte/transition";
import { onDestroy, onMount, tick } from "svelte";
import { CategoryScale, LinearScale, BarController, BarElement, Chart } from "chart.js";
import { BarWithErrorBarsChart } from "chartjs-chart-error-bars";
import {
  lastFocus, sharedActiveCap,
  cellLayerVisible,
  cycloneLayerVisible,
  latLon,
  lightningLayerVisible,
  bottomToolbarMode, radarColormap, precacheForecast,
  inspectLatLon, mapExtent4326, mapTapped, radarStale,
} from "../stores";

Chart.register(CategoryScale);
Chart.register(LinearScale);
Chart.register(BarController);
Chart.register(BarElement);
Chart.register(ChartDataLabels);

import { DeviceDetect as dd } from "../lib/DeviceDetect";
import type RadarCapability from "../caps/RadarCapability";
import type { GridConfig } from "../caps/RadarCapability";

import LastUpdated from "./LastUpdated.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import LiveIndicator from "./LiveIndicator.svelte";
import { _, locale } from "svelte-i18n";
import { get } from "svelte/store";
import { dbz2color } from "../lib/cmap_utils";
import {
  chRadarExtent4326,
  czRadarExtent4326,
  dwdRadarExtent4326,
  frRadarExtent4326,
  plRadarExtent4326,
} from "../layers/extents";
import { reverseGeocode } from "../lib/reverseGeocode";
import DismissableStrip from "./DismissableStrip.svelte";
import ChartSkeleton from "./ChartSkeleton.svelte";

export let cap: RadarCapability;

let gridConfig: GridConfig | null = null;

// Assigned when the client has no position; not rendered today.
let _showBars = true;

let userLatLon;
/** Manual subscriptions, so they are handed to onDestroy at the bottom. */
const subscriptions: (() => void)[] = [];

subscriptions.push(latLon.subscribe((latlonUpdate) => {
  userLatLon = latlonUpdate;
  if (!userLatLon) {
    _showBars = false;
  }
}));

let canvasVisible = true;
let showOpenControls = false;

let oldTimeStep = 0;

/**
 * The observation the scrubber is parked on while it is still tracking the
 * live edge, or null once the user has moved away from it.
 *
 * A new grid lands every few minutes. If the scrubber is sitting on what was
 * the newest observation, it should ride forward onto the new one -- that is
 * the "following live" case, and the map is showing that frame anyway. If the
 * user has dragged to an older frame, or out into the forecast, that position
 * is theirs and a refresh must leave it alone.
 */
let liveEdge: number | null = null;

let playPauseButton = faPlay;
let playTimeout;

/** The Shoelace <sl-range> scrubber. */
let slRange: (HTMLElement & { value: number }) | null = null;

let loop = true;
let historicActive = true;
let includeHistoric = false;
let canvas: HTMLCanvasElement;

let buttonSize = "small";
if (dd.isApp()) {
  buttonSize = "medium";
}
// window.onresize = () => {
//   if (window.innerWidth < 990) {
//     buttonSize = "medium";
//   } else {
//     buttonSize = "small";
//   }
// };

let autoPlay = false;
/** A bar chart; the error-bar dataset shape is not used (see redraw). */
let chart: BarWithErrorBarsChart<{ y: number }[], string> | null = null;

/**
 * The time axis, drawn as HTML under the plot instead of by Chart.js.
 *
 * Chart.js centres a tick label on its category, so the two labels that matter
 * most -- the ones saying how far back and how far forward the chart reaches --
 * hung half off the canvas and were clipped, and there is nowhere to pad them
 * to: the plot area has to span the scrubber's track exactly, or the bars stop
 * lining up with the minute the slider plays. Here the end labels are anchored
 * to the ends of the track and the rest are centred on their bar.
 *
 * `pct` is the position along the track, `minutes` the offset from now, and
 * `anchor` marks the two ends.
 */
let axisTicks: { pct: number; minutes: number; anchor: "start" | "end" | null }[] = [];

/** How close to an end a regular tick may sit before the end label wins, in %. */
const AXIS_EDGE_CLEAR = 9;

/** "-2h", "+45m", "+1h30m" -- and "now" for the zero mark. */
function formatOffset(minutes: number): string {
  if (minutes === 0) return $_("now");
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  if (abs % 60 === 0) return `${sign}${abs / 60}h`;
  if (abs < 60) return `${sign}${abs}m`;
  return `${sign}${Math.floor(abs / 60)}h${abs % 60}m`;
}

function redraw(config) {
  if (!config) return;
  console.log("Redrawing");
  const { grid } = config;
  if (!canvas) {
    console.log("Grid not yet initialized, skipping redraw");
    return;
  }
  // if (Object.values(grid).map((step) => step.dbz).reduce((a, b) => a + b, 0) === 0) {
  //   canvasVisible = false;
  //   return;
  // }
  // Truncated where the scrubber is, not where the grid is: the bars have to
  // line up with the slider under them, so a bar's position reads as the minute
  // the slider would be at. The unpublished tail is not plottable anyway -- its
  // steps carry no dbz -- so it would only have added flat bars nothing could
  // ever scrub to. Numeric sort: the default is lexicographic, which is only
  // harmless here because every key is a 10-digit timestamp.
  const lastPlayable = cap.getLastPlayableStep();
  const sortedKeys = Object.keys(grid)
    .map((e) => parseInt(e, 10))
    .sort((a, b) => a - b)
    .filter((step) => step <= lastPlayable);
  // with error bars:
  // return {y: grid[step].dbz, yMin: grid[step].dbz - grid[step].dbzMin, yMax: grid[step].dbz + grid[step].dbzMax};
  const d = sortedKeys.map((step) => (
    { y: Math.max(0, grid[step] != null ? grid[step].dbz : 0) }
  ));
  if (chart) chart.destroy();

  // How often the time axis is labelled, in minutes. The grid is on a 5-minute
  // step, so every interval here divides it exactly.
  let tickEvery = 30;
  if (dd.breakpoint() === "reduced") tickEvery = 60;
  if (dd.breakpoint() === "small") tickEvery = 60;

  /* The ends are always labelled, whatever they land on: the right-hand one is
     how far the forecast actually reaches, which is the nowcast's published
     horizon rather than a round +2h -- the last few steps are still being
     computed, and the chart stops where the scrubber does. Saying "+1h50m"
     when that is the truth beats the previous behaviour, which was to drop the
     label entirely because no category sat exactly on the hour. */
  const bars = sortedKeys.length;
  const minutesAt = (index: number) => Math.round((sortedKeys[index] - config.now) / 60);
  const ticks: typeof axisTicks = bars === 0 ? [] : [
    { pct: 0, minutes: minutesAt(0), anchor: "start" },
  ];
  for (let i = 1; i < bars - 1; i += 1) {
    const minutes = minutesAt(i);
    if (minutes % tickEvery !== 0) continue;
    // Centred on its bar, the way Chart.js placed it.
    const pct = ((i + 0.5) / bars) * 100;
    if (pct < AXIS_EDGE_CLEAR || pct > 100 - AXIS_EDGE_CLEAR) continue;
    ticks.push({ pct, minutes, anchor: null });
  }
  if (bars > 1) ticks.push({ pct: 100, minutes: minutesAt(bars - 1), anchor: "end" });
  axisTicks = ticks;

  // The ceiling the bars are drawn against. 95 dBZ is the top of the colour
  // table, not a rainfall anyone sees: a typical shower peaks around 20, so
  // every bar came out a fifth of the height it had room for -- which did not
  // matter while the chart was a transparent overlay and looks like a mistake
  // now that it sits in a bubble of its own. 45 dBZ is heavy rain; taking the
  // max with the peak means hail still never clips.
  const peak = Math.max(...d.map((step) => step.y));
  const scaleMax = Math.max(45, Math.ceil(peak));

  chart = new BarWithErrorBarsChart(canvas.getContext("2d")!, {
    data: {
      labels: sortedKeys.map((key) => ((key - config.now) / 60)).map((v) => `${v}`),
      datasets: [{
        data: d,
        barPercentage: 0.99,
        categoryPercentage: 0.99,
        backgroundColor: d.map(((value) => dbz2color(value.y, get(radarColormap))))
          .map(([r, g, b], index) => {
            if (grid[sortedKeys[index]] == null) {
              return `rgba(0, 0, 0, 1)`;
            }
            const certain = grid[sortedKeys[index]].source === "observation" ? 1 : 0.7;
            return `rgba(${r}, ${g}, ${b}, ${certain})`;
          }),
        borderColor: d.map((value, index) => (sortedKeys[index] === cap.getMostRecentObservation() ? "#ff0000" : getComputedStyle(document.body)
          .getPropertyValue("--sl-color-info-700"))),
        borderWidth: 1,
      }],
    },
    options: {
      animation: {
        duration: 0,
      },
      // animation: {
      //   onComplete: (chart) => {
      //     const chartInstance = chart,
      //             ctx = canvas.getContext("2d");

      //     ctx.font = fontString(
      //             18,
      //             "Italic",
      //             "Sans",
      //     );
      //     ctx.textAlign = "center";
      //     ctx.textBaseline = "bottom";
      //     console.log(chartInstance.data.datasets);

      //     chartInstance.data.datasets.forEach(function(dataset, i) {
      //       const meta = chartInstance.controller.getDatasetMeta(i);
      //       meta.data.forEach(function(bar, index) {
      //         const data = dataset.data[index];
      //         ctx.fillStyle = "#000";
      //         ctx.fillText(data, bar._model.x, bar._model.y - 2);
      //       });
      //     });
      //   }
      // },
      layout: {
        padding: {
          // No horizontal padding: the plot area has to span the canvas exactly,
          // because the canvas is positioned to span the scrubber's track.
          left: 0,
          right: 0,
          top: 4,
          bottom: 0,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // No per-bar labels: the time axis below the bars carries the when,
        // and the rotated pills that used to sit on top covered the map.
        datalabels: {
          display: false,
        },
},
      scales: {
        x: {
          /* The axis is drawn as HTML underneath the canvas, not by Chart.js --
             see axisTicks. The scale itself still has to exist, because it is
             what places the bars; it just reserves no room and paints nothing,
             so the plot area spans the scrubber's track exactly. */
          display: false,
          grid: {
            display: false,
          },
          border: {
            display: false,
          },
        },
        y: {
          type: "linear",
          // display, not just the ticks: a shown-but-empty scale still reserves
          // width, which offset every bar from the slider position it plays.
          display: false,
          grid: {
            display: false,
          },
          border: {
            display: false,
          },
          beginAtZero: true,
          ticks: {
            display: false,
          },
          max: scaleMax,
          min: 0,
        },
      },
    },
  });
}
$: redraw(gridConfig);

/**
 * The newest step the scrubber may reach.
 *
 * The grid always runs to +2h, but the tail of the nowcast is published behind
 * it and those steps have no tile. Left at gridConfig.end, both playback and a
 * drag would run the clock over a map that cannot change. Recomputed with each
 * new grid, so the range grows as the backend fills the tail in.
 */
$: lastPlayableStep = gridConfig ? cap.getLastPlayableStep() : undefined;

/**
 * Whether there is anything worth plotting: a step with measurable echo at the
 * client's position. Every dbz is null until a position has been shared, so
 * this keeps the strip away when there is no location either -- it used to
 * render a full-width row of zero-height bars over the map instead.
 */
$: hasPrecipitation = !!gridConfig
  && Object.values(gridConfig.grid).some((f) => f && f.dbz != null && f.dbz > 0);

/**
 * Whether the forecast strip is on screen.
 *
 * The strip itself -- glass dock, swipe-to-clear, Hide button, title row -- is
 * DismissableStrip, shared with the lightning histogram. What stays here is
 * which layer's question it is answering and when it is worth asking.
 *
 * Dismissal is not permanent. It lasts as long as the thing it was about: once
 * there is nothing to plot, or the player is opened again, the strip is
 * re-armed -- otherwise flicking it away once would hide every later shower for
 * the rest of the session, with no control anywhere to bring it back.
 */
let chartDismissed = false;

/**
 * Whether any of what is on screen has radar behind it.
 *
 * meteocool's live radar is DWD's composite plus MeteoSwiss's and
 * Meteo-France's, which stop at Germany, Switzerland, France and the reach
 * around them; every other layer is global. Someone opening the app on holiday
 * sees an empty map and no reason for it, which reads as the app being broken
 * rather than as a coverage boundary. Answered from the layers' own extents, so
 * it cannot drift from what actually gets drawn.
 *
 * Only when the viewport misses the box entirely -- half a screen of coverage
 * is still coverage, and a notice over it would be wrong.
 */
function overlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/* Every network's grid, not just DWD's: a viewport over Brittany or Corsica
   misses DWD's box entirely and is covered all the same, by Meteo-France. */
const radarExtents4326 = [
  dwdRadarExtent4326,
  chRadarExtent4326,
  frRadarExtent4326,
  czRadarExtent4326,
  plRadarExtent4326,
];

$: outOfCoverage = $sharedActiveCap === "radar"
  && $mapExtent4326 !== null
  && !radarExtents4326.some((extent) => overlaps(extent, $mapExtent4326));

let coverageDismissed = false;
/* Re-armed on the way back in, so panning out again says so again. */
$: if (!outOfCoverage) coverageDismissed = false;

/* A tapped point always gets an answer, even a flat one: the tap is a question,
   and a strip that refuses to appear reads as the tap not having registered.
   Without one, the strip only turns up when there is something to show. */
$: chartShowable = (hasPrecipitation || $inspectLatLon !== null)
  && $sharedActiveCap === "radar"
  // The coverage notice takes the slot: they share one position, and a forecast
  // for somewhere off screen is not the answer to "why is this map empty".
  && !outOfCoverage;
$: if (!chartShowable) chartDismissed = false;
$: if ($bottomToolbarMode === "player") chartDismissed = false;

/* Between a tap and the grid that answers it, the strip is up with the last
   point's bars still in it. Flagged here rather than read off the capability,
   because what matters is that the numbers on screen are about somewhere else
   -- not that a request happens to be open. */
let gridLoading = false;

function dismissChart() {
  chartDismissed = true;
  // The marker exists to feed this strip, so it goes with it -- which is also
  // the way back to sampling the client's own position.
  inspectLatLon.set(null);
}

/**
 * The tapped point's name for the title, once it comes back.
 *
 * The token guards against a slow lookup for an abandoned point landing after
 * a fast one for the current point -- the request is aborted too, but an abort
 * that arrives late still resolves.
 */
let placeName: string | null = null;
let placeToken = 0;

async function resolvePlace(
  point: [number, number] | null,
  language: string | null | undefined,
) {
  placeName = null;
  if (!point) return;
  const token = ++placeToken;
  const name = await reverseGeocode(point[0], point[1], language ?? "en");
  if (token === placeToken) placeName = name;
}

$: resolvePlace($inspectLatLon, $locale);

/* The place name is the title once there is one: a heading that says where, in
   a panel whose whole subject is already precipitation. Until then, and for the
   client's own position, the strip says what it is instead. */
$: chartTitle = $inspectLatLon
  ? (placeName ?? $_("precipitation_at_point"))
  : $_("precipitation_here");

/** Back to sampling the client's own position, without closing the strip. */
function returnToCurrentPosition() {
  inspectLatLon.set(null);
}

/* Tapping the map brings a cleared strip back -- otherwise the tap sets a
   marker, refetches the grid and shows nothing for it. LayerManager publishes
   the tap, because only the map can tell a tap from a pan.

   Component level, not inside an action: the strip mounts and unmounts every
   time it comes and goes, and a subscription made in there would stack up one
   live copy per appearance. */
subscriptions.push(mapTapped.subscribe((n) => {
  if (n > 0) chartDismissed = false;
}));

subscriptions.push(inspectLatLon.subscribe(() => { gridLoading = true; }));

/* Same reason as a tap: the bars on screen are about a different moment. The
   whole strip is laid out around "now", so once the clock has moved past the
   grid's own the axis under those bars is wrong and not just their age. Only
   the rising edge -- the grid that clears radarStale also clears this. */
subscriptions.push(radarStale.subscribe((value) => { if (value) gridLoading = true; }));

/* The canvas spans the scrubber's track while the player is open and the whole
   tray when it is collapsed, so its container changes width with the mode.
   Chart.js re-reads that on resize() and nowhere else, and the recreate in
   onShowScrollbar only runs when a chart already exists -- opening the player
   before the first one is built left it sized for the collapsed tray. */
$: if (chart && $bottomToolbarMode) tick().then(() => chart?.resize());
function updateSliderToLatest(_config) {
  if (!slRange) return;
  // Never mid-playback: that would throw a running sequence back to now.
  if (fsm.state === "playing") return;
  // Only from the frame that was the newest observation last time round.
  if (liveEdge === null || Number(slRange.value) !== liveEdge) return;
  const latest = cap.getMostRecentObservation();
  slRange.value = latest;
  liveEdge = latest;
}
$: updateSliderToLatest(gridConfig);

function canvasInit(elem: HTMLCanvasElement) {
  canvas = elem;
  redraw(gridConfig);
  return {
    destroy() {
      // The strip unmounts whenever the rain stops. Without this, redraw()
      // would go on building charts into a canvas that is no longer on the page.
      chart?.destroy();
      chart = null;
      canvas = null as unknown as HTMLCanvasElement;
    },
  };
}

const fsm = new StateMachine({
  init: "followLatest",
  transitions: [
    {
      name: "showScrollbar",
      from: "followLatest",
      to: "manualScrolling",
    },
    {
      name: "pressPlay",
      from: "manualScrolling",
      to: "playing",
    },
    {
      name: "pressPause",
      from: "playing",
      to: "manualScrolling",
    },
    {
      name: "hideScrollbar",
      from: "*",
      to: "followLatest",
    },
    {
      name: "hideScrollbar",
      from: "followLatest",
      to: "followLatest",
    },
  ],
  methods: {
    onShowScrollbar: () => {
      bottomToolbarMode.set("player");
      if ($precacheForecast === true) {
        cap.precacheAllForecasts();
      }
      if (chart) {
        const active = chart;
        canvasVisible = false;
        const xTicks = active.options.scales?.x?.ticks;
        if (xTicks) xTicks.display = true;
        setTimeout(() => {
          canvasVisible = true;
          active.update();
        }, 400);
      }
      playPauseButton = faPlay;
      // Opening parks the scrubber on the live edge, so it tracks refreshes
      // until the user drags it somewhere else.
      liveEdge = cap.getMostRecentObservation();
      if (slRange) slRange.value = liveEdge;
      setTimeout(() => {
        liveEdge = cap.getMostRecentObservation();
        if (slRange) slRange.value = liveEdge;
      }, 200);
      if (autoPlay) {
        setTimeout(() => {
          console.log("Triggering auto-play");
          if (cap.source && fsm.state === "manualScrolling") {
            fsm.pressPlay();
          } else {
            setTimeout(() => {
              // Workaround for #2279954594 (wtf is going on Android people) and #2217587657
              // pressPlay is only legal from manualScrolling: the player can be
              // closed, or play pressed by hand, inside this second, and the
              // state machine throws on an illegal transition.
              if (fsm.state !== "manualScrolling") return;
              console.log("Triggering deferred auto-play");
              fsm.pressPlay();
            }, 1000);
          }
        }, 500);
        autoPlay = false;
      }
    },
    onEnterWaitingState: (t) => {
      if (t.from === "playing") {
        autoPlay = true;
        // XXX deduplicate with onPressPause:
        if (playTimeout !== 0) window.clearTimeout(playTimeout);
        playTimeout = 0;
        playPauseButton = faPlay;
      }
    },
    onPressPlay: () => {
      const playTick = (ttl = 10) => {
        // Pause and close both cancel playTimeout; a tick that outlives them
        // would otherwise resume playback on its own.
        if (fsm.state !== "playing") return;
        if (!slRange) {
          // "Workaround" for #2320876836
          if (ttl < 1) {
            console.error("slRange element did not appear");
            return;
          }
          // Through playTimeout, so pause and close can cancel the retry chain.
          playTimeout = window.setTimeout(() => playTick(ttl - 1), 200);
          return;
        }
        let thisFrameDelayMs = 450;
        if (!slRange || !gridConfig) return;
        const sliderValueInt = Number(slRange.value);
        const lastStep = lastPlayableStep ?? gridConfig.end;
        if (sliderValueInt >= lastStep) {
          slRange.value = includeHistoric ? gridConfig.start : gridConfig.now;
        } else {
          slRange.value = sliderValueInt + 5 * 60;
        }
        if (sliderValueInt === 0) {
          thisFrameDelayMs = 800;
        }
        sliderChangedHandler(slRange.value);
        if (slRange.value !== gridConfig.now || loop) {
          playTimeout = window.setTimeout(playTick, thisFrameDelayMs);
        } else {
          playTimeout = 0;
          console.log("Pausing due to slider usage");
          fsm.pressPause();
        }
      };
      playTick();
      playPauseButton = faPause;
    },
    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout);
      playTimeout = 0;
      playPauseButton = faPlay;
    },
    onHideScrollbar: (transition) => {
      // Set unconditionally, before the early return. A hide() that arrives
      // while the machine is already in followLatest -- the idle-refocus
      // handler below, or the capability's loseFocus event -- would otherwise
      // leave bottomToolbarMode on "player" with nothing left that can move it
      // back: the tray stays open and its close button does nothing, because
      // every later hide() takes this same early return.
      bottomToolbarMode.set("collapsed");
      if (transition.from === "followLatest") return;
      oldTimeStep = 0;
      liveEdge = null;
      slRange = null;
      cap.resetToLatest();
      if (chart) {
        const active = chart;
        const xTicks = active.options.scales?.x?.ticks;
        if (xTicks) xTicks.display = false;
        canvasVisible = false;
        setTimeout(() => {
          canvasVisible = true;
          active.update();
        }, 400);
      }
    },
  },
});

function show() {
  if (fsm.state === "followLatest") {
    fsm.showScrollbar();
  }
}

function showAndPlay() {
  autoPlay = true;
  show();
}

function hide() {
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  fsm.hideScrollbar();
}

// Recorded when the grid updates; not currently rendered.
let _latest: number;

onMount(async () => {
  window.leaveForeground = () => {
    if (fsm.state === "playing") {
      console.log("Pausing due to window.leaveForeground();");
      fsm.pressPause();
    }
  };

  cap.addObserver((subject, data) => {
    console.log(`NowcastPlayback observed event ${subject}`);
    if (subject === "grid" && data) {
      gridConfig = data as GridConfig;
      gridLoading = false;
      showOpenControls = true;
      _latest = cap.getMostRecentObservation();
    }
    //   // const gridSteps = Object.keys(grid);
    //   let changed = false;
    //   // console.log(`Frontend grid: ${gridSteps.sort()}`);
    //   // console.log(`Backend grid: ${Object.keys(data).sort()}`);
    //   Object.keys(data)
    //           .forEach((key) => {
    //             if (key in grid) {
    //               grid[key].dbz = data[key].dbz;
    //               grid[key].dbzMin = data[key].dbzMin;
    //               grid[key].dbzMax = data[key].dbzMax;
    //               grid[key].url = data[key].url;
    //               grid[key].source = data[key].source;
    //               changed = true;
    //             }
    //           });
    //   if (changed) redraw();

    //   const mostRecentTimestamp = cap.getMostRecentObservation();
    //   if ($bottomToolbarMode !== 'player' && mostRecentTimestamp in grid) {
    //     cap.setUrl(grid[mostRecentTimestamp].url);
    //     capTimeIndicator.set(mostRecentTimestamp);
    //   }
    // }
    // if (subject === "historic") {
    //  historicLayers = data.sources;
    // } else if (subject === "nowcast") {
    //  nowcastLayers = data.sources;
    // } else {
    //  return;
    // }
    // if (historicLayers && nowcastLayers) {
    //   if (fsm.state === "waitingForServer") {
    //     fsm.showScrollbar();
    //   }
    //   const reversed = Object.values(historicLayers);
    //   reversed.reverse();
    //   rainValues = reversed
    //     .map((layer) => Math.round(layer.reported_intensity + 32.5))
    //     .concat(Object.values(nowcastLayers)
    //       .map((layer) => Math.round(layer.reported_intensity + 32.5)));
    //   setChart();
    // } else {
    //   switch (fsm.state) {
    //     case "manualScrolling":
    //       fsm.enterWaitingState();
    //       break;
    //     case "playing":
    //       autoPlay = true;
    //       fsm.enterWaitingState();
    //       break;
    //     default:
    //       break;
    //   }
    // }
  });
  cap.notifyObservers();

  cap.addObserver((event) => {
    if (event === "loseFocus") {
      hide();
    }
  });
});

function sliderChangedHandler(value, userInteraction = false) {
  if (Number.isNaN(value)) {
    console.log("sliderChangedHandler called with NaN");
    return;
  }
  if (value === oldTimeStep) return;

  if (userInteraction && fsm.state === "playing") {
    console.log("Pausing due to sliderChangedHandler");
    fsm.pressPause();
  }

  if (userInteraction && dd.isIos()) {
    const impact = value === 0 ? "impactMedium" : "impactLight";
    window.webkit?.messageHandlers.scriptHandler.postMessage(impact);
  }

  // Both callers land here -- a drag and a playback tick -- so this is the one
  // place that has to re-decide whether the scrubber is still on the live
  // edge. Dragging back onto the newest observation resumes tracking.
  liveEdge = value === cap.getMostRecentObservation() ? value : null;

  cap.setSource(value);
  // if (value in grid && 'url' in grid[value] && grid[value].url) {
  //   cap.setUrl(grid[value].url);
  //   capTimeIndicator.set(value);
  // }
  oldTimeStep = value;
}

function initSlider(elem) {
  elem.addEventListener("sl-change", (value) => sliderChangedHandler(value.target.value, true));
  slRange = elem;
  window.slr = slRange;
  // XXX why...
  // window.setTimeout(() => {
  //  slRange.value = `${gridNow}`;
  //  console.log(`${gridNow}`);
  // }, 200);
}

function playPause() {
  if (fsm.state === "playing") {
    console.log("Pausing due to button");
    fsm.pressPause();
  } else if (fsm.state === "manualScrolling") {
    fsm.pressPlay();
  }
}

function toggleLoop() {
  loop = !loop;
  historicActive = loop;
  if (!historicActive) includeHistoric = false;
}

function toggleHistoric() {
  includeHistoric = !includeHistoric;
}

function toggleLightning() {
  lightningLayerVisible.set(!$lightningLayerVisible);
}

function toggleCells() {
  cellLayerVisible.set(!$cellLayerVisible);
}

function toggleCyclones() {
  cycloneLayerVisible.set(!$cycloneLayerVisible);
}

let last = new Date();
subscriptions.push(lastFocus.subscribe((focus) => {
  if (focus.getTime() > (last.getTime() + 2 * 60 * 1000) && cap.trackingMode !== "live") {
    hide();
    cap.resetToLatest();
  }
  last = focus;
}));

onDestroy(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  chart?.destroy();
});
</script>

<style>
  /* The player inherits the tray material from :global(.bottomToolbar) in
     BottomToolbar.svelte. Heights are what Map.svelte measures. */
  /* Share the responsive height with the forecast strip above the tray.
     Map.svelte measures the tray to keep map padding in sync. */
  .timeslider {
    height: var(--mc-player-h);
    z-index: var(--mc-z-tray-player);
    padding: 8px var(--mc-tray-pad) 6px;
    overflow: hidden;
  }

  /* A tint on the open tray; collapsed controls add their own glass below. */
  .controlButton {
    width: var(--mc-control);
    height: var(--mc-control);
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--mc-tint);
    color: var(--mc-text);
    font-size: 15px;
    text-align: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .controlButton:hover {
    cursor: pointer;
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .controlButton:active {
    transform: scale(var(--mc-press));
    background: var(--mc-tint-active);
  }

  /* The two collapsed-state controls: standalone discs at the bottom corners,
     flanking the tray rather than sitting on it -- the same kind of control as
     the zoom capsule and the locate disc at the top right, and disjunct from
     the bar that carries the legend. BottomToolbar insets .lastUpdatedBottom by
     exactly this much so the two never overlap.

     Centred on the bar whatever height it is: that differs per breakpoint, so
     it comes from --mc-bar-h rather than a second copy of the number. */
  .buttonBar {
    position: absolute;
    bottom: calc(
      var(--mc-collapsed-bottom)
      + (var(--mc-bar-h) - var(--mc-control)) / 2
    );
    left: var(--mc-gutter);
    z-index: var(--mc-z-tray-buttons);
  }
  .buttonBar.right {
    left: unset;
    right: var(--mc-gutter);
  }

  /* These two are over the map, so they are glass rather than a tint. */
  .buttonBar .controlButton {
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
  }
  .buttonBar .controlButton:hover,
  .buttonBar .controlButton:active {
    background: var(--mc-glass-fill-strong);
  }

  /* ---------------------------------------------------------------------
     One grid for the whole player, three rows at every size:

         track     the scrubber, always full width
         controls  transport, layers, and the freshness line
         legend    the colour scale

     Only the columns and the set of visible items change per tier, so the
     tray keeps a single height and nothing reflows into a ragged wrap. An
     item that has no area in the current tier is display:none -- otherwise
     grid auto-places it and quietly adds a row.
     --------------------------------------------------------------------- */
  .player-grid {
    display: grid;
    height: 100%;
    align-content: center;
    align-items: center;
    column-gap: var(--mc-rail-gap);
    row-gap: 4px;
    /* Phone: transport, layers, and collapse share a row. */
    grid-template-columns: auto minmax(0, 1fr) var(--mc-control);
    grid-template-areas:
      "track     track  track"
      "transport layers close"
      "status    status status";
  }

  .track        { grid-area: track; min-width: 0; }
  .transport    { grid-area: transport; }
  .layers       { grid-area: layers; min-width: 0; }
  .close-inline { grid-area: close; }
  .status       { grid-area: status; min-width: 0; justify-self: center; }
  .layers sl-button-group { width: 100%; }
  .button-group-toolbar.layers sl-button-group::part(base) { display: flex; }
  .layers sl-button { flex: 1 1 0; min-width: 0; }
  .legend       { grid-area: legend; display: none; min-width: 0; }

  /* Keep collapse at the trailing edge at every width. */
  @media only screen and (min-width: 621px) {
    :global(html:not(.is-ios)) .player-grid {
      grid-template-columns: auto auto 1fr var(--mc-control);
      grid-template-areas:
        "track     track  track  track"
        "transport layers .      close"
        "legend    legend status close";
    }
    :global(html:not(.is-ios)) .legend { display: block; }
    :global(html:not(.is-ios)) .status { justify-self: end; }
    :global(html:not(.is-ios)) .close-inline {
      position: absolute;
      right: 6px;
      bottom: 6px;
    }
    :global(html:not(.is-ios)) .layers sl-button-group { width: auto; }
    :global(html:not(.is-ios)) .layers sl-button { flex: initial; }
    :global(html:not(.is-ios)) .range::part(input) { height: var(--track-height); }
  }

  /* Wide: labels on the layer buttons and the legend below. */
  @media only screen and (min-width: 1120px) {
    :global(html:not(.is-ios)) .player-grid {
      grid-template-columns: auto auto 1fr var(--mc-control);
      grid-template-areas:
        "track     track  track  track"
        "transport layers status close"
        "legend    legend legend close";
    }
  }

  /* Labels inside the layer buttons: wide tier only. */
  .wide-only { display: none; }
  @media only screen and (min-width: 1120px) {
    :global(html:not(.is-ios)) .wide-only { display: inline; }
  }

  /* sl-range is themed through its custom properties in glass.css. */
  .range {
    width: 100%;
    top: 0;
    margin: 4px 0 2px;
  }

  /* Grow the native input hit area while keeping the painted track thin. */
  .range::part(input) {
    height: 44px;
    background-size: 100% var(--track-height);
    background-position: center;
    background-repeat: no-repeat;
  }

  /* Segmented tint capsules. sl-button-group part: base. sl-button parts: base prefix label suffix */
  .button-group-toolbar sl-button-group::part(base) {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
  }
  .button-group-toolbar sl-button {
    margin-inline-start: 0;   /* the group's shadow :host pulls non-first buttons left by 1px */
  }
  .button-group-toolbar sl-button::part(base) {
    min-height: 32px;
    height: 32px;
    padding: 0 2px;
    border: 0;
    border-radius: var(--mc-radius-pill);   /* outer ::part wins over the group's first/inner/last radius zeroing */
    background: transparent;
    color: var(--mc-text);
    font: 600 13px/32px var(--mc-font);
    transition: background-color var(--mc-motion-fast), transform var(--mc-motion-fast) var(--mc-ease);
  }
  .button-group-toolbar sl-button::part(base)::after {
    display: none;   /* the group separator */
  }
  .button-group-toolbar sl-button:not([disabled])::part(base):hover {
    background: var(--mc-tint-hover);
  }
  .button-group-toolbar sl-button::part(base):active {
    transform: scale(var(--mc-press));
  }
  .button-group-toolbar sl-button[variant="primary"]::part(base) {
    background: var(--mc-accent);
    color: #fff;
  }
  .button-group-toolbar sl-button[variant="primary"]:not([disabled])::part(base):hover {
    background: var(--mc-accent-strong);
  }
  .button-group-toolbar sl-button[disabled]::part(base) {
    opacity: 0.4;
  }
  .button-group-toolbar sl-button::part(label) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
  }
  /* A text button needs the 12px above; an icon-only one is already a 32px
     .faIconButton box and would otherwise be 56px wide, which is what pushed
     the transport group to 206px and squeezed the row on a phone. */
  .button-group-toolbar sl-button.icon-btn::part(label) {
    padding: 0 4px;
  }

  .faIconButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 0;
    font-size: 16px;
  }

  /* The plot and scrubber share the same inset. */
  .barChart-plot {
    position: relative;
    height: 100%;
    margin: 0 var(--mc-tray-pad);
  }

  /* Prose in the strip, set like the body text of a system alert: secondary
     ink under the primary-ink title, at the same size as the rest of the tray.
     Same leading inset as the title, so the two read as one block. */
  .notice {
    margin: 2px calc(var(--mc-tray-pad) + 8px) 0;
    font: 400 12px/1.35 var(--mc-font);
    letter-spacing: -0.005em;
    color: var(--mc-text-2);
    overflow: hidden;
  }

  /* Short by the height of the axis row below it, which used to live inside the
     canvas as a Chart.js scale. */
  .barChart-canvas {
    height: calc(100% - 16px);
  }
  /* The canvas keeps its box while the skeleton is up -- Chart.js sizes itself
     from the element, and a display:none parent would measure it at zero. */
  .barChart-canvas.hidden {
    visibility: hidden;
  }
  .barChart-plot canvas {
    display: block;
  }

  /* Spans the track exactly, like the canvas above it, so a tick sits over the
     minute the scrubber would be at. */
  .axis {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 16px;
    pointer-events: none;
  }
  .tick {
    position: absolute;
    top: 0;
    /* Centred on its bar; the ends override this and sit flush instead, which
       is the whole reason the axis is not drawn on the canvas. */
    transform: translateX(-50%);
    white-space: nowrap;
    font: 600 10px/16px var(--mc-font);
    letter-spacing: -0.01em;
    color: inherit;
  }
  .tick.start,
  .tick.end {
    transform: none;
  }
  .tick.start {
    left: 0;
  }
  .tick.end {
    right: 0;
  }

  /* Nothing fell in the window. Sits over the plot rather than replacing it, so
     the strip keeps its height and the tray below does not move. */
  .empty {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    padding: 0 16px;
    text-align: center;
    color: var(--mc-text-2);
    font: 400 12px/1.35 var(--mc-font);
    letter-spacing: -0.005em;
  }

  @media only screen and (max-width: 620px) {
    .player-grid {
      column-gap: 4px;
    }
    .layers sl-button::part(label) {
      padding: 0 4px;
    }
    .timeslider {
      padding: 6px 8px 4px;
    }
    .range {
      margin-bottom: 0;
    }
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
      display: none;
    }
  }
</style>

<LiveIndicator {cap} />

{#if outOfCoverage && !coverageDismissed}
  <DismissableStrip
    title={$_("radar_no_coverage")}
    collapsed={$bottomToolbarMode !== "player"}
    on:dismiss={() => { coverageDismissed = true; }}>
    <p class="notice">{$_("radar_no_coverage_body")}</p>
  </DismissableStrip>
{/if}

{#if canvasVisible && chartShowable && !chartDismissed}
  <DismissableStrip
    title={chartTitle}
    linkLabel={$inspectLatLon && $latLon ? $_("show_for_my_location") : null}
    linkIcon={faLocationCrosshairs}
    collapsed={$bottomToolbarMode !== "player"}
    on:dismiss={dismissChart}
    on:link={returnToCurrentPosition}>
    <div class="barChart-plot">
      {#if gridLoading}
        <ChartSkeleton bars={25} />
      {:else if !hasPrecipitation}
        <p class="empty">{$_("precipitation_none")}</p>
      {/if}
      <div class="barChart-canvas" class:hidden={gridLoading || !hasPrecipitation}>
        <canvas use:canvasInit></canvas>
      </div>
      {#if !gridLoading && hasPrecipitation}
        <div class="axis" aria-hidden="true">
          {#each axisTicks as tick (tick.pct)}
            <span
              class="tick"
              class:start={tick.anchor === "start"}
              class:end={tick.anchor === "end"}
              style:left={tick.anchor === "end" ? null : `${tick.pct}%`}>
              {formatOffset(tick.minutes)}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </DismissableStrip>
{/if}
{#if $bottomToolbarMode === "player"}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 150, duration: 400 }}
    on:introstart={toolbarTransitionStart}
    on:outrostart={toolbarTransitionStart}
    on:introend={toolbarTransitionEnd}
    on:outroend={toolbarTransitionEnd}>
      <div class="player-grid">
        <div class="track">
          <sl-range min="{gridConfig?.start}" max="{lastPlayableStep}" step="{60 * 5}" class="range" use:initSlider tooltip="none"></sl-range>
        </div>

        <div class="transport button-group-toolbar">
          <sl-button-group label="Playback Controls">
            <sl-button size={buttonSize} class="icon-btn" on:click={playPause}>
              <div class="faIconButton">
                <Icon icon={playPauseButton} />
              </div>
            </sl-button>
            <sl-button size={buttonSize} class="icon-btn" variant="{loop ? "primary" : "default"}" on:click={toggleLoop}>
              <div class="faIconButton">
                <Icon icon={faRetweet} />
              </div>
            </sl-button>
            <sl-button size={buttonSize} class="icon-btn" variant="{includeHistoric ? "primary" : "default"}" disabled="{!historicActive}" on:click={toggleHistoric}>
              <div class="faIconButton">
                <Icon icon={faHistory} />
              </div>
            </sl-button>
          </sl-button-group>
        </div>

        <div class="layers button-group-toolbar">
          <sl-button-group label="Map Layers">
            <sl-button size={buttonSize} variant="{ $lightningLayerVisible ? "primary" : "default"}" on:click={toggleLightning}>⚡ <span class="wide-only">Lightning Strikes</span></sl-button>
            <sl-button size={buttonSize} variant="{ $cycloneLayerVisible ? "primary" : "default"}" on:click={toggleCyclones}>🌀 <span class="wide-only">Mesocyclones</span></sl-button>
            <sl-button size={buttonSize} variant="{ $cellLayerVisible ? "primary" : "default"}" on:click={toggleCells}>⛈ <span class="wide-only">Storm Cells</span></sl-button>
          </sl-button-group>
        </div>

        <button type="button" class="close-inline controlButton" on:click={hide}
          title="Collapse playback controls" aria-label="Collapse playback controls">
          <Icon icon={faAngleDoubleDown} />
        </button>

        <div class="status">
          <LastUpdated />
        </div>

        {#if !dd.isApp()}
          <div class="legend">
            <RadarScaleLine />
          </div>
        {/if}
      </div>
  </div>
{:else}
  {#if $sharedActiveCap === "radar"}
    {#if showOpenControls}
      <div class="buttonBar right">
        <button type="button" class="controlButton" on:click={show}
          title="Playback Controls" aria-label="Playback Controls">
          <Icon icon={faAngleDoubleUp} class="controlIcon" />
        </button>
      </div>
      <div class="buttonBar">
        <button type="button" class="controlButton" on:click={showAndPlay}
          title="Play" aria-label="Play">
          <Icon icon={faPlay} class="controlIcon" />
        </button>
      </div>
    {/if}
  {/if}
{/if}
