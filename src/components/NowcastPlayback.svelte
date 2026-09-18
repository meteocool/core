<script lang="ts">
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faAngleDoubleDown } from "@fortawesome/free-solid-svg-icons/faAngleDoubleDown";
import { faAngleDoubleUp } from "@fortawesome/free-solid-svg-icons/faAngleDoubleUp";
import { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
import { faRetweet } from "@fortawesome/free-solid-svg-icons/faRetweet";
import Icon from "./Icon.svelte";
import StateMachine from "javascript-state-machine";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { fly, fade } from "svelte/transition";
import { onMount } from "svelte";
import { CategoryScale, LinearScale, BarController, BarElement, Chart } from "chart.js";
import { BarWithErrorBarsChart } from "chartjs-chart-error-bars";
import {
  lastFocus, sharedActiveCap,
  cycloneLayerVisible,
  latLon,
  lightningLayerVisible,
  bottomToolbarMode, radarColormap, precacheForecast,
} from "../stores";

Chart.register(CategoryScale);
Chart.register(LinearScale);
Chart.register(BarController);
Chart.register(BarElement);
Chart.register(ChartDataLabels);

import { setUIConstant } from "../layers/ui";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import type RadarCapability from "../caps/RadarCapability";
import type { GridConfig } from "../caps/RadarCapability";

import TimeIndicator from "./TimeIndicator.svelte";
import LastUpdated from "./LastUpdated.svelte";
import Appendix from "./Appendix.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import LiveIndicator from "./LiveIndicator.svelte";
import DevStatus from "./DevStatus.svelte";
import { _ } from "svelte-i18n";
import { get } from "svelte/store";
import { dbz2color } from "../lib/cmap_utils";

export let cap: RadarCapability;

let gridConfig: GridConfig | null = null;

// Assigned when the client has no position; not rendered today.
let _showBars = true;

let userLatLon;
latLon.subscribe((latlonUpdate) => {
  userLatLon = latlonUpdate;
  if (!userLatLon) {
    _showBars = false;
  }
});

let canvasVisible = true;
let showOpenControls = false;

let oldTimeStep = 0;

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
  const sortedKeys = Object.keys(grid).map((e) => parseInt(e, 10)).sort();
  // with error bars:
  // return {y: grid[step].dbz, yMin: grid[step].dbz - grid[step].dbzMin, yMax: grid[step].dbz + grid[step].dbzMax};
  const d = sortedKeys.map((step) => (
    { y: Math.max(0, grid[step] != null ? grid[step].dbz : 0) }
  ));
  if (chart) chart.destroy();

  let skip = 5;
  if (dd.breakpoint() === "reduced") {
    skip = 10;
  }
  if (dd.breakpoint() === "small") {
    skip = 20;
  }

  const values = d.map((step) => step.y);
  values.splice(-1);

  const dataMin = Math.min(...values);
  // XXX replace by local maxima/sliding window
  const max = Math.max(...values);
  const maxIndexes: number[] = [];
  values.forEach((item, index) => (item === max ? maxIndexes.push(index) : null));
  const disabled = values.every((e) => e === 0);

  const gridKeys = Object.keys(grid);
  const rendered: Record<string, boolean> = {};
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
        borderColor: d.map((value, index) => (gridKeys[index] === `${cap.getMostRecentObservation()}` ? "#ff0000" : getComputedStyle(document.body)
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
          left: 4,
          right: 4,
          top: 40,
          bottom: 0,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        datalabels: {
          clamp: true,
          textAlign(context) {
            if (context.dataIndex > 25) {
              return "end";
            }
            return "end";
          },
          align() {
            return "top";
          },
          anchor() {
            // if (context.dataIndex > 25) {
            //   return "start";
            // }
            return "end";
          },
          borderRadius: 4,
          color: "white",
          borderColor: "white",
          borderWidth: 1,
          rotation() {
            return 270;
          },
          backgroundColor(context) {
            return context.dataset.backgroundColor as string;
          },
          formatter: (val: { y: number }, context) => {
            const labels = (context.chart.data.labels ?? []) as string[];
            const points = context.chart.data.datasets[0].data as { y: number }[];
            if (disabled) {
              return null;
            }
            if (((context.dataIndex - 1) in rendered) || ((context.dataIndex - 2) in rendered)) {
              return null;
            }
            if (labels[context.dataIndex] === "0") {
              rendered[context.dataIndex] = true;
              return $_("now");
            }

            // XXX calculate slope instead
            if (context.dataIndex > 0) {
              try {
                if (points[context.dataIndex - 1].y - dataMin === 0 && val.y - dataMin > 0 && points[context.dataIndex + 1].y - dataMin !== 0) {
                  rendered[context.dataIndex] = true;
                  return `${labels[context.dataIndex]}m`;
                }

                if (val.y - dataMin > 0 && points[context.dataIndex + 1].y - dataMin === 0) {
                  rendered[context.dataIndex] = true;
                  return `${labels[context.dataIndex]}m`;
                }

                if (maxIndexes.includes(context.dataIndex)) {
                  rendered[context.dataIndex] = true;
                  return `${labels[context.dataIndex]}m`;
                }
              } catch (e) {
                console.error(e);
                return null;
              }
            }
            return null;
          },
          padding: 3,
          offset: 2,
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
            tickLength: 6,
          },
          afterFit: (scale) => {
            scale.height = 18;
            scale.paddingBottom = 0;
          },
          afterUpdate: (scale) => {
            scale.height = 18;
            scale.paddingBottom = 0;
          },
          ticks: {
            color: getComputedStyle(document.body)
              .getPropertyValue("--sl-color-info-700"),
            font: { size: 5 },
            autoSkip: false,
            callback(value) {
              const label = Number(this.getLabelForValue(Number(value)));
              if (label === 0) {
                return "now";
              }
              if (label === -120) {
                return "-2h";
              }
              if (label === -60) {
                return "-1h";
              }
              if (label === 60) {
                return "1h";
              }
              if (label === 120) {
                return "2h";
              }
              if (Math.abs(label) % skip === 0) {
                return label;
              }
              return "";
            },
            minRotation: 0,
            maxRotation: 0,
            padding: -4,
            display: $bottomToolbarMode === "player",
            autoSkipPadding: 0,
          },
        },
        y: {
          type: "linear",
          grid: {
            display: false,
          },
          beginAtZero: true,
          ticks: {
            display: false,
          },
          max: 95,
          min: 0,
        },
      },
    },
  });
}
$: redraw(gridConfig);
function updateSliderToLatest(_config) {
  if (slRange) slRange.value = cap.getMostRecentObservation();
}
$: updateSliderToLatest(gridConfig);

function canvasInit(elem: HTMLCanvasElement) {
  canvas = elem;
  if ($bottomToolbarMode === "player") {
    (canvas.parentNode as HTMLElement | null)?.classList.remove("barChartCanvasWithoutPlayback");
  }
  redraw(gridConfig);
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
      if (slRange) slRange.value = cap.getMostRecentObservation();
      setTimeout(() => {
        if (slRange) slRange.value = cap.getMostRecentObservation();
      }, 200);
      setUIConstant("toast-stack-offset", { "toast-stack-offset": "124px" });

      if (autoPlay) {
        setTimeout(() => {
          console.log("Triggering auto-play");
          if (cap.source && fsm.state === "manualScrolling") {
            fsm.pressPlay();
          } else {
            setTimeout(() => {
              // Workaround for #2279954594 (wtf is going on Android people) and #2217587657
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
        if (!slRange) {
          // "Workaround" for #2320876836
          if (ttl < 1) {
            console.error("slRange element did not appear");
            return;
          }
          setTimeout(() => playTick(ttl - 1), 200);
          return;
        }
        let thisFrameDelayMs = 450;
        if (!slRange || !gridConfig) return;
        const sliderValueInt = Number(slRange.value);
        if (sliderValueInt >= gridConfig.end) {
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
      if (transition.from === "followLatest") return;
      oldTimeStep = 0;
      slRange = null;
      cap.resetToLatest();
      if (canvas) (canvas.parentNode as HTMLElement | null)?.classList.add("barChartCanvasWithoutPlayback");
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
      setUIConstant("toast-stack-offset");

      bottomToolbarMode.set("collapsed");
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
  } else {
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

function toggleCyclones() {
  cycloneLayerVisible.set(!$cycloneLayerVisible);
}

let last = new Date();
lastFocus.subscribe((focus) => {
  if (focus.getTime() > (last.getTime() + 2 * 60 * 1000) && cap.trackingMode !== "live") {
    hide();
    cap.resetToLatest();
  }
  last = focus;
});
</script>

<style>
  /* The player inherits the tray material from :global(.bottomToolbar) in
     BottomToolbar.svelte. Heights are what Map.svelte measures. */
  /* Slider, controls row and the legend row need 104px; Map.svelte measures
     the tray rather than assuming a height, so the map's padding follows. */
  .timeslider {
    height: 104px;
    z-index: var(--mc-z-tray-player);
    padding: 8px 12px 6px;
    overflow: hidden;
  }

  /* collapsed-state floating discs, and the desktop in-tray play/close */
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

  /* Inside the floating collapsed tray: its bottom edge plus the 1px border. */
  .buttonBar {
    position: absolute;
    bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 1px);
    left: calc(var(--mc-gutter) + 12px);
    z-index: var(--mc-z-tray-buttons);
  }
  .buttonBar.right {
    left: calc(var(--mc-gutter) + 12px + var(--mc-control) + 8px);
    right: unset;
  }

  .flexbox {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-evenly;
  }
  .flexbox > .slider {
    flex: 1 1 85%;
    padding-right: 8px;
  }
  .flexbox > .buttonsInline {
    display: none;
  }
  .flexbox > .buttonsLeft {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 8px 0 0;
    min-width: 0;
  }

  /* sl-range is themed through its custom properties in glass.css. */
  .range {
    width: 100%;
    top: 0;
    margin: 4px 0 2px;
  }

  .checkbox {
    margin-top: 0;
    display: flex;
    align-items: center;
  }
  .gap {
    gap: 6px 12px;
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
  .button-group-toolbar sl-button::part(prefix) {
    padding-inline-start: 6px;
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

  /* Forecast bar chart: a transparent overlay, no material. Follows the tray up
     by the gap it now floats above the edge. */
  .barChartCanvas {
    position: absolute;
    bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 93px);
    left: 2.9%;
    width: 97%;
    height: 150px;
    pointer-events: none;
    margin-right: 0.5em;
    z-index: var(--mc-z-chart);
  }
  .barChartCanvasWithoutPlayback {
    bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 31px);
    width: 100% !important;
    left: 0;
  }

  @media only screen and (max-width: 620px) {
    .flexbox > .slider {
      margin-bottom: 0;
      padding-right: 0;
    }
    .range {
      margin-bottom: 0;
    }
    .barChartCanvas {
      bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 118px);
      left: 0;
      width: 99%;
    }
    .barChartCanvasWithoutPlayback {
      bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 73px);
    }
    .flexbox > .buttonsInline {
      display: flex;
    }
    .flexbox > .buttonsLeft {
      display: none;
    }
    .flexbox {
      gap: 6px;
      padding: 0;
      margin-top: 0;
    }

    /* A third of a phone screen for a slider and four buttons. The chart above
       moves up with it, and the collapsed "last updated" bar is hidden while
       the player is open, since the player shows the same timestamp. */
    .timeslider {
      height: 120px;
      padding: 6px 8px 4px;
    }
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
      display: none;
    }
    .hide-on-small-screens {
      display: none;
    }
    .break {
      flex-basis: 100%;
      height: 0;
    }
    .buttonBar {
      bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap) + 6px);
      left: calc(var(--mc-gutter) + 10px);
    }
    .buttonBar.right {
      left: unset;
      right: calc(var(--mc-gutter) + 10px);
    }
  }
</style>

<LiveIndicator />
{#if import.meta.env.DEV}
  <DevStatus />
{/if}

{#if canvasVisible && $sharedActiveCap === "radar"}
<div class="barChartCanvas barChartCanvasWithoutPlayback" id="barChartCanvas" out:fly={{ y: 60, duration: 200 }} in:fade={{ duration: 200 }}>
  <canvas use:canvasInit></canvas>
</div>
{/if}
{#if $bottomToolbarMode === "player"}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 150, duration: 400 }}
    on:introstart={toolbarTransitionStart}
    on:outrostart={toolbarTransitionStart}
    on:introend={toolbarTransitionEnd}
    on:outroend={toolbarTransitionEnd}>
      <div class="flexbox">
        <div class="buttonsLeft">
          <div class="controlButton" on:click={playPause} title="Play/Pause">
            <Icon icon={playPauseButton} class="controlIconInline" />
          </div>
          <div class="controlButton" on:click={hide} title="Close">
            <Icon icon={faAngleDoubleDown} class="controlIcon" />
          </div>
        </div>
        <div class="slider">
          <sl-range min="{gridConfig?.start}" max="{gridConfig?.end}" step="{60 * 5}" class="range" use:initSlider tooltip="none"></sl-range>
          <div class="flexbox gap">
            <div class="checkbox">
              <div class="button-group-toolbar" >
                <sl-button-group label="Playback Controls">
                  <sl-button size={buttonSize} on:click={playPause}>
                    <div class="faIconButton" slot="prefix">
                      &nbsp;<Icon icon={playPauseButton} />&nbsp;
                    </div>
                  </sl-button>
                  <sl-button size={buttonSize} variant="{loop ? "primary" : "default"}" on:click={toggleLoop}>
                    <div class="faIconButton">
                      <Icon icon={faRetweet} />
                    </div>
                  </sl-button>
                  <sl-button size={buttonSize} variant="{includeHistoric ? "primary" : "default"}" disabled="{!historicActive}" on:click={toggleHistoric}>
                    <div class="faIconButton">
                      <Icon icon={faHistory} />
                    </div>
                  </sl-button>
                </sl-button-group>
              </div>
            </div>
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="Map Layers">
                    <sl-button size={buttonSize} variant="{ $lightningLayerVisible ? "primary" : "default"}" on:click={toggleLightning}>⚡ <span class="hide-on-small-screens">Lightning Strikes</span></sl-button>
                    <sl-button size={buttonSize} variant="{ $cycloneLayerVisible ? "primary" : "default"}" on:click={toggleCyclones}>🌀 <span class="hide-on-small-screens">Mesocyclones</span></sl-button>
                  </sl-button-group>
                </div>
              </div>
              <div class="checkbox buttonsInline">
                <div class="button-group-toolbar">
                   <sl-button size={buttonSize} on:click={hide}>
                     <div class="faIconButton">
                       <Icon icon={faAngleDoubleDown} />️
                     </div>
                   </sl-button>
                </div>
              </div>
            {#if false}
              <div class="checkbox">
                <sl-select size={buttonSize}>
                  <sl-menu-item value="option-1" checked selected>DWD</sl-menu-item>
                  <sl-menu-item value="option-2">Rainymotion</sl-menu-item>
                </sl-select>
              </div>
            {/if}
            <div class="break"></div>
            <div class="checkbox">
              <TimeIndicator />
            </div>
            <div class="checkbox">
              <LastUpdated />
            </div>
            <div class="break"></div>
            {#if !dd.isApp()}
              <div class="checkbox hide-on-small-screens" style="flex-grow: 1;">
                <RadarScaleLine />
              </div>
              <div class="checkbox hide-on-small-screens">
                  <Appendix />
              </div>
            {/if}
          </div>
        </div>
      </div>
  </div>
{:else}
  {#if $sharedActiveCap === "radar"}
    {#if showOpenControls}
      <div on:click={show} class="buttonBar right">
        <div class="controlButton" title="Playback Controls">
          <div class="playHover">
            <Icon icon={faAngleDoubleUp} class="controlIcon" />
          </div>
        </div>
      </div>
  <div on:click={showAndPlay} class="buttonBar">
    <div class="controlButton" title="Play/Pause">
      <div class="playHover">
        <Icon icon={faPlay} class="controlIcon" />
      </div>
    </div>
  </div>
    {/if}
  {/if}
{/if}
