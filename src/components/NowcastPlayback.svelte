<script>
import {
  FaPlay,
  FaPause,
  FaAngleDoubleDown,
  FaAngleDoubleUp,
  FaHistory,
  FaRetweet
} from "../lib/IconRegistry";
import StateMachine from "javascript-state-machine";
import { fly, fade } from "svelte/transition";
import { onMount, onDestroy } from "svelte";
import {
  lastFocus, sharedActiveCap,
  cycloneLayerVisible,
  latLon,
  lightningLayerVisible,
  bottomToolbarMode, radarColormap, precacheForecast,
} from "../stores";

// Chart.js setup with auto-registration
let chartLibraryLoaded = false;
let Chart, BarWithErrorBarsChart, ChartDataLabels;

async function loadChartLibrary() {
  if (chartLibraryLoaded) return;

  try {
    // Import Chart.js with auto-registration
    const chartjsModule = await import("chart.js/auto");
    const chartErrorBarsModule = await import("chartjs-chart-error-bars");
    const chartDataLabelsModule = await import("chartjs-plugin-datalabels");

    // Extract the needed classes
    Chart = chartjsModule.Chart;
    BarWithErrorBarsChart = chartErrorBarsModule.BarWithErrorBarsChart;
    ChartDataLabels = chartDataLabelsModule.default;

    // Register additional plugin
    Chart.register(ChartDataLabels);

    chartLibraryLoaded = true;
  } catch (error) {
    logger.error("Failed to load Chart.js library:", error);
  }
}

import { setUIConstant } from "../layers/ui";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { logger } from "../lib/logger.js";

// Capability-specific caching mechanism
const capabilityCache = new Map();

// Invalidate cache for a specific capability
function invalidateCapabilityCache(cap) {
  if (!cap) return;
  const cacheKey = cap.constructor.name + '_' + (cap.id || 'default');
  capabilityCache.delete(cacheKey);
}

// Cached version that prevents redundant calls within time window  
function getCachedMostRecent(cap, cacheTimeMs = 200) {
  if (!cap) return null;
  
  const cacheKey = cap.constructor.name + '_' + (cap.id || 'default');
  const now = Date.now();
  const cached = capabilityCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp < cacheTimeMs)) {
    return cached.value;
  }
  
  try {
    const value = cap?.getMostRecentObservation?.() || null;
    capabilityCache.set(cacheKey, { value, timestamp: now });
    return value;
  } catch (error) {
    logger.warn('Failed to get most recent observation:', error);
    return cached?.value || null; // Fallback to stale cache on error
  }
}

import TimeIndicator from "./TimeIndicator.svelte";
import LastUpdated from "./LastUpdated.svelte";
import Appendix from "./Appendix.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import LiveIndicator from "./LiveIndicator.svelte";
import DevStatus from "./DevStatus.svelte";
import { _ } from "svelte-i18n";
import { get } from "svelte/store";
import { dbz2color } from "../lib/cmap_utils";

let { cap } = $props();

// console.log("NowcastPlayback.svelte initialized with cap:", cap);

let gridConfig = $state(null);

let userLatLon = $state();
let showBars = $state(true);
latLon.subscribe((latlonUpdate) => {
  userLatLon = latlonUpdate;
  if (!userLatLon) {
    showBars = false;
  }
});

let canvasVisible = $state(true);
let showOpenControls = $state(false);

let oldTimeStep = $state(0);

let playPauseButton = $state(FaPlay);
let playTimeout;
let domEventListeners = [];

let slRange = $state(null);

let loop = $state(true);
let historicActive = $state(true);
let includeHistoric = $state(false);
let canvas;

let buttonSize = $state("small");
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
let chart = null;

async function redraw(config) {
  if (!config) return;
  logger.log("Redrawing");
  const { grid } = config;
  if (!canvas) {
    logger.log("Grid not yet initialized, skipping redraw");
    return;
  }

  // Lazy load Chart.js when needed
  await loadChartLibrary();
  if (!chartLibraryLoaded) {
    logger.error("Chart.js library failed to load");
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
  const maxIndexes = [];
  values.forEach((item, index) => (item === max ? maxIndexes.push(index) : null));
  const disabled = values.every((e) => e === 0);

  const gridKeys = Object.keys(grid);
  const rendered = {};
  chart = new BarWithErrorBarsChart(canvas.getContext("2d"), {
    data: {
      labels: sortedKeys.map((key) => {
        if (!config.now) return "0";
        const minutes = (key - config.now) / 60;
        return isNaN(minutes) ? "0" : `${minutes}`;
      }),
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
        borderColor: d.map((value, index) => {
          const mostRecent = getCachedMostRecent(cap);
          return (mostRecent !== null && gridKeys[index] === `${mostRecent}`) ? "#ff0000" : getComputedStyle(document.body)
            .getPropertyValue("--sl-color-info-700");
        }),
        borderWidth: 1,
      }],
    },
    options: {
      animation: {
        duration: 0,
      },
      hover: {
        animationDuration: 0,
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
          left: 30,
          right: 4,
          top: 40,
          bottom: 0,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
      legend: {
        display: false,
      },
      tooltips: {
        enabled: false,
      },
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
            // Return the specific color for this data point, not the entire array
            return context.dataset.backgroundColor[context.dataIndex];
          },
          formatter: (val, context) => {
            if (disabled) {
              return null;
            }
            if (((context.dataIndex - 1) in rendered) || ((context.dataIndex - 2) in rendered)) {
              return null;
            }
            
            const label = context.chart.data.labels[context.dataIndex];
            if (label === "0") {
              rendered[context.dataIndex] = true;
              return $_("now");
            }

            // XXX calculate slope instead
            if (context.dataIndex > 0) {
              try {
                if (context.chart.data.datasets[0].data[context.dataIndex - 1].y - dataMin === 0 && val.y - dataMin > 0 && context.chart.data.datasets[0].data[context.dataIndex + 1].y - dataMin !== 0) {
                  rendered[context.dataIndex] = true;
                  return label !== undefined ? `${label}m` : null;
                }

                if (val.y - dataMin > 0 && context.chart.data.datasets[0].data[context.dataIndex + 1].y - dataMin === 0) {
                  rendered[context.dataIndex] = true;
                  return label !== undefined ? `${label}m` : null;
                }

                if (maxIndexes.includes(context.dataIndex)) {
                  rendered[context.dataIndex] = true;
                  return label !== undefined ? `${label}m` : null;
                }
              } catch (e) {
                logger.error(e);
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
            tickMarkLength: 6,
            drawBorder: false,
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
            fontSize: 5,
            autoSkip: false,
            callback(value) {
              const label = this.getLabelForValue(value);
              if (label === 0) {
                return "now";
              }
              if (label == -120) {
                return "-2h";
              }
              if (label == -60) {
                return "-1h";
              }
              if (label == 60) {
                return "1h";
              }
              if (label == 120) {
                return "2h";
              }
              if (Math.abs(label) % skip === 0) {
                return label;
              }
              return "";
            },
            minRotation: 0,
            maxRotation: 0,
            responsive: true,
            padding: 10,
            display: $bottomToolbarMode === "player",
            autoSkipPadding: 0,
          },
        },
        y: {
          type: "linear",
          grid: {
            display: false,
            drawBorder: false,
          },
          ticks: {
            display: false,
            beginAtZero: true,
          },
          max: 95,
          min: 0,
        },
      },
    },
  });
}
$effect(() => {
  redraw(gridConfig);
});

function updateSliderToLatest(config) {
  if (!config || !slRange) return;
  
  // Use gridConfig.now (current time) as the default position
  const targetValue = config.now;
  slRange.value = `${targetValue}`;
}

$effect(() => {
  updateSliderToLatest(gridConfig);
  // Also ensure slider is positioned correctly when gridConfig changes
  if (slRange && gridConfig && gridConfig.now) {
    slRange.value = `${gridConfig.now}`;
  }
});

function canvasInit(elem) {
  canvas = elem;
  if ($bottomToolbarMode === "player") {
    canvas.parentNode.classList.remove("barChartCanvasWithoutPlayback");
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
        canvasVisible = false;
        chart.options.scales.x.ticks.display = true;
        setTimeout(() => {
          canvasVisible = true;
          chart.update();
        }, 400);
      }
      playPauseButton = FaPlay;
      // Reset slider to current time position when stopping playback
      if (slRange && gridConfig) {
        slRange.value = `${gridConfig.now}`;
        // Delayed update for stability
        setTimeout(() => {
          if (slRange && gridConfig) slRange.value = `${gridConfig.now}`;
        }, 200);
      }
      setUIConstant("toast-stack-offset", "124px");

      if (autoPlay) {
        setTimeout(() => {
          logger.log("Triggering auto-play");
          try {
            if (cap.source && fsm.state === "manualScrolling") {
              fsm.pressPlay();
            } else {
              setTimeout(() => {
                // Workaround for #2279954594 (wtf is going on Android people) and #2217587657
                logger.log("Triggering deferred auto-play");
                try {
                  fsm.pressPlay();
                } catch (error) {
                  logger.warn("Failed to trigger deferred auto-play from state:", fsm.state, error);
                }
              }, 1000);
            }
          } catch (error) {
            logger.warn("Failed to trigger auto-play from state:", fsm.state, error);
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
        playPauseButton = FaPlay;
      }
    },
    onPressPlay: () => {
      const playTick = (ttl = 10) => {
        if (!slRange) {
          // "Workaround" for #2320876836
          if (ttl < 1) {
            logger.error("slRange element did not appear");
            return;
          }
          setTimeout(() => playTick(ttl - 1), 200);
          return;
        }
        let thisFrameDelayMs = 450;
        const sliderValueInt = parseInt(slRange.value, 10);
        if (sliderValueInt >= gridConfig.end) {
          slRange.value = (includeHistoric ? gridConfig.start : gridConfig.now).toString();
        } else {
          slRange.value = (sliderValueInt + 5 * 60).toString();
        }
        if (sliderValueInt === 0) {
          thisFrameDelayMs = 800;
        }
        sliderChangedHandler(slRange.value);
        if (slRange.value !== gridConfig.now || loop) {
          playTimeout = window.setTimeout(playTick, thisFrameDelayMs);
        } else {
          playTimeout = 0;
          logger.log("Pausing due to slider usage");
          try {
            fsm.pressPause();
          } catch (error) {
            logger.warn("Failed to pause from playTick, state:", fsm.state, error);
          }
        }
      };
      playTick();
      playPauseButton = FaPause;
    },
    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout);
      playTimeout = 0;
      playPauseButton = FaPlay;
    },
    onHideScrollbar: (transition) => {
      if (transition.from === "followLatest") return;
      oldTimeStep = 0;
      slRange = null;
      invalidateCapabilityCache(cap);
      cap.resetToLatest();
      if (canvas) canvas.parentNode.classList.add("barChartCanvasWithoutPlayback");
      if (chart) {
        chart.options.scales.x.ticks.display = false;
        canvasVisible = false;
        setTimeout(() => {
          canvasVisible = true;
          chart.update();
        }, 400);
      }
      setUIConstant("toast-stack-offset");

      bottomToolbarMode.set("collapsed");
    },
  },
});

function show() {
  if (fsm.state === "followLatest") {
    try {
      fsm.showScrollbar();
    } catch (error) {
      logger.warn("Failed to show scrollbar from state:", fsm.state, error);
    }
  }
}

function showAndPlay() {
  autoPlay = true;
  show();
}

function hide() {
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  try {
    fsm.hideScrollbar();
  } catch (error) {
    logger.warn("Failed to hide scrollbar from state:", fsm.state, error);
  }
}

let latest;

onMount(async () => {
  window.leaveForeground = () => {
    if (fsm.state === "playing") {
      logger.log("Pausing due to window.leaveForeground();");
      fsm.pressPause();
    }
  };

  cap.addObserver((subject, data) => {
    // console.log(`NowcastPlayback observed event ${subject}`);
    if (subject === "grid" && data) {
      gridConfig = data;
      showOpenControls = true;
      // Invalidate cache when new grid data arrives as it may change most recent observation
      invalidateCapabilityCache(cap);
      latest = getCachedMostRecent(cap);
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
    logger.log("sliderChangedHandler called with NaN");
    return;
  }
  if (value === oldTimeStep) return;

  if (userInteraction && fsm.state === "playing") {
    logger.log("Pausing due to sliderChangedHandler");
    try {
      fsm.pressPause();
    } catch (error) {
      logger.warn("Failed to pause from state:", fsm.state, error);
    }
  }

  if (userInteraction && dd.isIos()) {
    let impact = "Light";
    if (value === 0) {
      impact = "Medium";
    }
    window.webkit.messageHandlers.scriptHandler.postMessage(`impact${impact}`);
  }

  cap.setSource(value);
  // if (value in grid && 'url' in grid[value] && grid[value].url) {
  //   cap.setUrl(grid[value].url);
  //   capTimeIndicator.set(value);
  // }
  oldTimeStep = value;
}

function initSlider(elem) {
  const listener = (value) => sliderChangedHandler(value.target.value, true);
  elem.addEventListener("sl-change", listener);
  domEventListeners.push({ target: elem, type: "sl-change", listener });
  slRange = elem;
  window.slr = slRange;
  
  // Always try to initialize slider to current time after a short delay
  setTimeout(() => {
    if (slRange && gridConfig) {
      slRange.value = `${gridConfig.now}`;
    }
  }, 100);
}

function playPause() {
  if (fsm.state === "playing") {
    logger.log("Pausing due to button");
    try {
      fsm.pressPause();
    } catch (error) {
      logger.warn("Failed to pause from button, state:", fsm.state, error);
    }
  } else {
    try {
      fsm.pressPlay();
    } catch (error) {
      logger.warn("Failed to play from button, state:", fsm.state, error);
    }
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
    invalidateCapabilityCache(cap);
    cap.resetToLatest();
  }
  last = focus;
});

onDestroy(() => {
  // Clean up timeouts
  if (playTimeout !== 0) {
    clearTimeout(playTimeout);
    playTimeout = 0;
  }

  // Clean up DOM event listeners
  domEventListeners.forEach(({ target, type, listener }) => {
    target.removeEventListener(type, listener);
  });
  domEventListeners = [];

  // Clean up chart if it exists
  if (chart) {
    try {
      chart.destroy();
    } catch (error) {
      logger.warn("Error destroying chart:", error);
    }
    chart = null;
  }

  // Clean up global references
  if (window.slr === slRange) {
    window.slr = null;
  }
});
</script>

<style>
  .timeslider {
    height: 100px;
    z-index: 6;
    padding-top: 6px;
  }

  /* timeline controls */

  .controlButton {
    width: 1em;
    height: 1em;
    padding: 0.50em;
    border: 1px solid grey;
    border-radius: 5px;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0.3em 0.25em 0.4em 0.25em;
    cursor: pointer;
    color: var(--sl-color-black);
    position: relative;
  }

  .controlButton:hover {
    cursor: pointer;
    background-color: var(--sl-color-black);
    border: 1px solid var(--sl-color-black);
    color: var(--sl-color-white);
  }

  .buttonBar {
    position: absolute;
    bottom: env(safe-area-inset-bottom);
    left: 0.3em;
    z-index: 4;
  }

  .buttonBar.right {
    left: 3em;
    right: unset;
  }

  .flexbox {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-evenly;
  }

  .flexbox > .slider {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 85%;
    padding-right: 1em;
  }

  .flexbox > .buttonsInline {
    display: none;
  }

  .flexbox > .buttonsLeft {
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
    min-width: 30px;
    margin-right: 0.5%;
    margin-left: 0.5%;
  }

  .range {
    width: 100%;
    top: 5px;
  }

  .checkbox {
    margin-top: 4px;
  }

  .iconButton {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    position: relative;
  }

  /* Ensure consistent Lucide icon sizing within buttons */
  .iconButton :global(svg) {
    width: 14px !important;
    height: 14px !important;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  /* Ensure icons in controlButton are also properly centered */
  .controlButton :global(svg) {
    width: 14px !important;
    height: 14px !important;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  /* Ensure playHover div is properly positioned */
  .playHover {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    position: relative;
  }

  .playHover :global(svg) {
    width: 14px !important;
    height: 14px !important;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }


  .barChartCanvas {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom) + 79px);
    width: 100%;
    left: 0;
    height: 150px;
    pointer-events: none;
    z-index: 7;
  }

  .barChartCanvasWithoutPlayback {
    bottom: calc(env(safe-area-inset-bottom) + 31px);
    width: 100% !important;
    left: 0;
  }

  .gap {
    gap: 18px;
  }

  @media only screen and (max-width: 620px) {
    .flexbox > .slider {
      margin-bottom: 0px;
      padding-right: 0.1em;
    }

    .range {
      margin-bottom: 0px;
    }

    .barChartCanvas {
      bottom: 142px;
      left: 0;
      width: 100%;
    }
    .barChartCanvasWithoutPlayback {
      bottom: calc(env(safe-area-inset-bottom) + 73px);
    }

    .flexbox > .buttonsInline {
      display: unset;
    }

    .flexbox > .buttonsLeft {
      display: none;
    }

    .flexbox {
      gap: 5px !important;
      padding-left: 1%;
      padding-right: 1%;
      margin-top: -2px;
    }

    .timeslider {
      height: 153px !important;
    }

    .hide-on-small-screens {
      display: none;
    }

    .break {
      flex-basis: 100%;
      height: 0;
    }

    .buttonBar.right {
      left: unset;
      right: 0.3em;
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
    transition:fly={{ y: 150, duration: 400 }}>
      <div class="flexbox">
        <div class="buttonsLeft">
          <div class="controlButton" onclick={playPause} title="Play/Pause" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && playPause()}>
            {#if playPauseButton === FaPlay}<FaPlay class="controlIconInline" />{:else}<FaPause class="controlIconInline" />{/if}
          </div>
          <div class="controlButton" onclick={hide} title="Close" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && hide()}>
            <FaAngleDoubleDown class="controlIcon" />
          </div>
        </div>
        <div class="slider">
          <sl-range min={gridConfig.start} max={gridConfig.end} value={gridConfig.now} step={60 * 5} class="range" use:initSlider tooltip="none" style="--thumb-size: 21px;"></sl-range>
          <div class="flexbox gap">
            <div class="checkbox">
              <div class="button-group-toolbar" >
                <sl-button-group label="Playback Controls">
                  <sl-button size={buttonSize} onclick={playPause} style="--sl-button-font-size-small: 16px; --sl-button-font-size-medium: 16px;">
                    <div class="iconButton" slot="prefix">
                      {#if playPauseButton === FaPlay}<FaPlay />{:else}<FaPause />{/if}
                    </div>
                  </sl-button>
                  <sl-button size={buttonSize} type={loop ? 'primary' : 'default'} onclick={toggleLoop} style="--sl-button-font-size-small: 22px; --sl-button-font-size-medium: 22px;">
                    <div class="iconButton">
                      <FaRetweet />
                    </div>
                  </sl-button>
                  <sl-button size={buttonSize} type={includeHistoric ? 'primary' : 'default'} disabled={!historicActive} onclick={toggleHistoric}  style="--sl-button-font-size-small: 15px; --sl-button-font-size-medium: 15px;">
                    <div class="iconButton">
                      <FaHistory />
                    </div>
                  </sl-button>
                </sl-button-group>
              </div>
            </div>
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="Map Layers">
                    <sl-button size={buttonSize} type={$lightningLayerVisible ? 'primary' : 'default'} onclick={toggleLightning}>⚡ <span class="hide-on-small-screens">Lightning Strikes</span></sl-button>
                    <sl-button size={buttonSize} type={$cycloneLayerVisible ? 'primary' : 'default'} onclick={toggleCyclones}>🌀 <span class="hide-on-small-screens">Mesocyclones</span></sl-button>
                  </sl-button-group>
                </div>
              </div>
              <div class="checkbox buttonsInline">
                <div class="button-group-toolbar">
                   <sl-button size={buttonSize} onclick={hide}>
                     <div class="iconButton">
                       <FaAngleDoubleDown />
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
      <div onclick={show} class="buttonBar right" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && show()}>
        <div class="controlButton" title="Playback Controls">
          <div class="playHover">
            <FaAngleDoubleUp class="controlIcon" />
          </div>
        </div>
      </div>
  <div onclick={showAndPlay} class="buttonBar" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && showAndPlay()}>
    <div class="controlButton" title="Play/Pause">
      <div class="playHover">
        <FaPlay class="controlIcon" />
      </div>
    </div>
  </div>
    {/if}
  {/if}
{/if}
