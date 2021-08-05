<script>
import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faAngleDoubleDown } from '@fortawesome/free-solid-svg-icons/faAngleDoubleDown';
import { faAngleDoubleUp } from '@fortawesome/free-solid-svg-icons/faAngleDoubleUp';
import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
import { faRetweet } from '@fortawesome/free-solid-svg-icons/faRetweet';
import { sharedActiveCap } from '../stores';

import { fly, fade } from 'svelte/transition';
import { onMount } from 'svelte';
import Icon from 'fa-svelte';

import StateMachine from 'javascript-state-machine';
import { CategoryScale, LinearScale, BarController, BarElement } from 'chart.js';
import { BarWithErrorBarsChart } from 'chartjs-chart-error-bars';
import ChartDataLabels from 'chartjs-plugin-datalabels';

Chart.register(CategoryScale);
Chart.register(LinearScale);
Chart.register(BarController);
Chart.register(BarElement);
Chart.register(ChartDataLabels);

import { Chart } from 'chart.js';

import { meteocoolClassic } from '../colormaps';
import { setUIConstant } from '../layers/ui';
import { DeviceDetect as dd } from '../lib/DeviceDetect';

import {
  capTimeIndicator,
  cycloneLayerVisible,
  latLon,
  lightningLayerVisible,
  bottomToolbarMode
} from '../stores';

import TimeIndicator from './TimeIndicator.svelte';
import LastUpdated from './LastUpdated.svelte';
import Appendix from './Appendix.svelte';
import RadarScaleLine from './scales/RadarScaleLine.svelte';
import LiveIndicator from './LiveIndicator.svelte';

export let cap;

let gridConfig = null;

let userLatLon;
let showBars = true;
latLon.subscribe((latlonUpdate) => {
  userLatLon = latlonUpdate;
  if (!userLatLon) {
    showBars = false;
  }
});

let canvasVisible = true;
let showOpenControls = false;


let oldTimeStep = 0;

let playPauseButton = faPlay;
let playTimeout;

let slRange = null;

let loop = true;
let historicActive = true;
let includeHistoric = false;
let canvas;

let buttonSize = "small";
if (dd.isApp()) {
  buttonSize = "medium";
}

let autoPlay = false;
let chart = null;

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
  const d = sortedKeys.map((step) => ({ y: Math.max(0, grid[step].dbz) }));
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
  values.forEach((item, index) => item === max ? maxIndexes.push(index): null);

  const gridKeys = Object.keys(grid);
  let rendered = {};
  chart = new BarWithErrorBarsChart(canvas.getContext("2d"), {
    data: {
      labels: sortedKeys.map((key) => ((key - config.now) / 60)).map((v) => `${v}`),
      datasets: [{
        data: d,
        barPercentage: 0.99,
        categoryPercentage: 0.99,
        backgroundColor: d.map(((value) => meteocoolClassic[Math.round((value.y + 32.5) * 2)]))
                .map((maybe) => maybe || [0, 0, 0, 0])
                .map(([r, g, b], index) => {
                  const certain = grid[sortedKeys[index]].source === 'observation' ? 1 : 0.7;
                  return `rgba(${r}, ${g}, ${b}, ${certain})`;
                }),
        borderColor: d.map((value, index) => gridKeys[index] === `${cap.getMostRecentObservation()}` ? '#ff0000' : getComputedStyle(document.body)
                .getPropertyValue('--sl-color-info-700')),
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
          left: 8,
          right: 8,
          top: 0,
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
          textAlign: function (context) {
            if (context.dataIndex > 25) {
              return "end";
            }
            return "end";
          },
          align: function (context) {
            return "top";
          },
          anchor: function (context) {
            // if (context.dataIndex > 25) {
            //   return "start";
            // }
            return "end";
          },
          borderRadius: 4,
          color: 'white',
          borderColor: 'white',
          borderWidth: 1,
          rotation: function (context) {
            return 270;
          },
          backgroundColor: function (context) {
            return context.dataset.backgroundColor;
          },
          formatter: (val, context) => {
            if (context.dataIndex == 0) {
              rendered[context.dataIndex] = true;
              return "2h ago";
            }

            if (context.chart.data.labels[context.dataIndex] === "0") {
              rendered[context.dataIndex] = true;
              return "Now";
            }

            if (context.dataIndex == 48) {
              rendered[context.dataIndex] = true;
              return "In 2h";
            }

            // XXX calculate slope instead
            if (context.chart.data.datasets[0].data[context.dataIndex-1].y-dataMin === 0 && val.y-dataMin > 0 && context.chart.data.datasets[0].data[context.dataIndex+1].y-dataMin !== 0 && !((context.dataIndex-1) in rendered) && !((context.dataIndex-2) in rendered)) {
              rendered[context.dataIndex] = true;
              return `${context.chart.data.labels[context.dataIndex]}m`;
            }

            if (val.y-dataMin > 0 && context.chart.data.datasets[0].data[context.dataIndex+1].y-dataMin === 0  && !((context.dataIndex-1) in rendered) && !((context.dataIndex-2) in rendered)) {
              rendered[context.dataIndex] = true;
              return `${context.chart.data.labels[context.dataIndex]}m`;
            }

            if (maxIndexes.includes(context.dataIndex)) {
              rendered[context.dataIndex] = true;
              return `${context.chart.data.labels[context.dataIndex]}m`;
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
            scale.paddingTop = 0;
            scale.paddingBottom = 0;
          },
          afterUpdate: (scale) => {
            scale.height = 18;
            scale.paddingTop = 0;
            scale.paddingBottom = 0;
          },
          ticks: {
            color: getComputedStyle(document.body)
                    .getPropertyValue('--sl-color-info-700'),
            fontSize: 5,
            autoSkip: false,
            callback: function (value) {
              const label = this.getLabelForValue(value);
              if (label === 0) {
                return 'now';
              }
              if (label == -120) {
                return "2h ago";
              }
              if (label == 120) {
                return "In 2h";
              }
              if (Math.abs(label) % skip === 0) {
                return label;
              }
              return '';
            },
            minRotation: 0,
            maxRotation: 0,
            responsive: true,
            padding: -4,
            display: $bottomToolbarMode === 'player',
            autoSkipPadding: 0,
          },
        },
        y: {
          type: 'linear',
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
$: redraw(gridConfig);

function canvasInit(elem) {
  canvas = elem;
  if ($bottomToolbarMode === 'player') {
    canvas.parentNode.classList.remove('barChartCanvasWithoutPlayback');
  }
  redraw(gridConfig);
}

const fsm = new StateMachine({
  init: 'followLatest',
  transitions: [
    {
      name: 'showScrollbar',
      from: 'followLatest',
      to: 'manualScrolling',
    },
    {
      name: 'pressPlay',
      from: 'manualScrolling',
      to: 'playing',
    },
    {
      name: 'pressPause',
      from: 'playing',
      to: 'manualScrolling',
    },
    {
      name: 'hideScrollbar',
      from: '*',
      to: 'followLatest',
    },
    {
      name: 'hideScrollbar',
      from: 'followLatest',
      to: 'followLatest',
    },
  ],
  methods: {
    onShowScrollbar: () => {
      bottomToolbarMode.set('player');
      if (chart) {
        canvasVisible = false;
        chart.options.scales.x.ticks.display = true;
        setTimeout(() => {
          canvasVisible = true;
          chart.update();
        }, 400);
      }
      playPauseButton = faPlay;
      if (slRange) slRange.value = `${gridConfig.now}`;
      setTimeout(() => {
        if (slRange) slRange.value = `${gridConfig.now}`;
      }, 200);
      setUIConstant('toast-stack-offset', '124px');
      capTimeIndicator.set(gridConfig.now);

      if (autoPlay) {
        setTimeout(() => {
          console.log('Triggering auto-play');
          if (cap.source && fsm.state === 'manualScrolling') {
            fsm.pressPlay();
          } else {
            setTimeout(() => {
              // Workaround for #2279954594 (wtf is going on Android people) and #2217587657
              console.log('Triggering deferred auto-play');
              fsm.pressPlay();
            }, 1000);
          }
        }, 500);
        autoPlay = false;
      }
    },
    onEnterWaitingState: (t) => {
      if (t.from === 'playing') {
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
            console.error('slRange element did not appear');
            return;
          }
          setTimeout(() => playTick(ttl - 1), 200);
          return;
        }
        let thisFrameDelayMs = 450;
        const sliderValueInt = parseInt(slRange.value, 10);
        if (sliderValueInt >= gridConfig.end) {
          slRange.value = (includeHistoric ? gridConfig.start: gridConfig.now).toString();
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
          console.log('Pausing due to slider usage');
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
      if (transition.from === 'followLatest') return;
      oldTimeStep = 0;
      slRange = null;
      if (chart) {
        chart.options.scales.x.ticks.display = false;
        canvasVisible = false;
        setTimeout(() => {
          canvasVisible = true;
          chart.update();
        }, 400);
      }
      setUIConstant('toast-stack-offset');

      setTimeout(() => {
        bottomToolbarMode.set('collapsed');
      }, 200);
      // cap.source.setUrl(cap.lastSourceUrl); XXX
    },
  },
});

function show() {
  if (fsm.state === 'followLatest') {
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


onMount(async () => {
  window.leaveForeground = () => {
    if (fsm.state === 'playing') {
      console.log('Pausing due to window.leaveForeground();');
      fsm.pressPause();
    }
  };

  cap.addObserver((subject, data) => {
    console.log(`NowcastPlayback observed event ${subject}`);
    if (subject === 'grid' && data) {
      gridConfig = data;
      showOpenControls = true;
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
    //if (subject === "historic") {
    //  historicLayers = data.sources;
    //} else if (subject === "nowcast") {
    //  nowcastLayers = data.sources;
    //} else {
    //  return;
    //}
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
    if (event === 'loseFocus') {
      hide();
    }
  });
});

function sliderChangedHandler(value, userInteraction = false) {
  if (value === oldTimeStep) return;

  if (userInteraction && fsm.state === 'playing') {
    console.log('Pausing due to sliderChangedHandler');
    fsm.pressPause();
  }

  if (userInteraction && dd.isIos()) {
    let impact = 'Light';
    if (value === 0) {
      impact = 'Medium';
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
  elem.addEventListener('sl-change', (value) => sliderChangedHandler(value.target.value, true));
  slRange = elem;
  window.slr = slRange;
  // XXX why...
  //window.setTimeout(() => {
  //  slRange.value = `${gridNow}`;
  //  console.log(`${gridNow}`);
  //}, 200);
}

function playPause() {
  if (fsm.state === 'playing') {
    console.log('Pausing due to button');
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
</script>

<style>
  .timeslider {
    height: 90px;
    z-index: 999999;
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
    text-align: center;
    margin: 0.3em 0.25em 0.5em 0.25em;
    cursor: pointer;
    color: var(--sl-color-black);
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
    z-index: 999999;
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

  .gap > * {
    margin-bottom: 30px;
    margin-right: 30px;
  }

  .flexbox > .slider {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 85%;
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
    width: 98.75%;
    top: 5px;
  }

  .checkbox {
    margin-top: 4px;
  }

  .barChartCanvas {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom) + 79px);
    width: 96%;
    padding-right: 2%;
    left: 3.5%;
    height: 80px;
    pointer-events: none;
    margin-right: 0.5em;
    z-index: 9999999;
  }

  .barChartCanvasWithoutPlayback {
    bottom: calc(env(safe-area-inset-bottom) + 31px);
    width: 100% !important;
    left: 0;
  }

  @media (orientation: portrait) {
    .range {
      margin-bottom: 5px;
      top: 7px;
    }

    .barChartCanvas {
      bottom: 142px;
      left: 0.5%;
      width: 99%;
    }
    .barChartCanvasWithoutPlayback {
      bottom: calc(env(safe-area-inset-bottom) + 73px);
    }

    .faIconButton {
      font-size: 125%;
      margin-top: 2px;
    }

    .flexbox > .buttonsInline {
      display: unset;
    }

    .flexbox > .buttonsLeft {
      display: none;
    }

    .gap > * {
      margin-bottom: 16px;
      margin-right: 18px;
    }

    .flexbox {
      padding-left: 1%;
      padding-right: 1%;
    }

    .timeslider {
      height: 153px !important;
    }

    .hide-on-small-screens {
      display: none;
    }
  }

  @media only screen and (max-width: 600px) {
    .buttonBar.right {
      left: unset;
      right: 0.3em;
    }
  }
</style>

<LiveIndicator />

{#if canvasVisible && $sharedActiveCap === "radar"}
<div class="barChartCanvas barChartCanvasWithoutPlayback" id="barChartCanvas" out:fly={{ y: 60, duration: 200 }} in:fade={{duration: 200}}>
  <canvas use:canvasInit></canvas>
</div>
{/if}
{#if $bottomToolbarMode === "player"}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 100, duration: 400 }}>
      <div class="flexbox">
        <div class="buttonsLeft">
          <div class="controlButton" on:click={playPause} title="Play/Pause">
            <Icon icon={playPauseButton} class="controlIcon" />
          </div>
          <div class="controlButton" on:click={hide} title="Close">
            <Icon icon={faAngleDoubleDown} class="controlIcon" />
          </div>
        </div>
        <div class="slider">
          <sl-range min="{gridConfig.start}" max="{gridConfig.end}" step="{60 * 5}" class="range" use:initSlider tooltip="none" style="--thumb-size: 25px;"></sl-range>
          <div class="flexbox gap">
            <div class="checkbox">
              <TimeIndicator />
            </div>
            <div class="checkbox">
              <div class="button-group-toolbar">
                <sl-button-group label="Playback Controls">
                  {#if !dd.isApp()}
                    <!-- XXX this is sadly necessary because sl tooltip throws some weird exception on mobile, even if disabled -->
                    <sl-tooltip content="Play">
                      <sl-button size={buttonSize} on:click={playPause}>
                        <div class="faIconButton">
                          <Icon icon={playPauseButton} />
                        </div>
                      </sl-button>
                    </sl-tooltip>
                  {:else}
                    <sl-button size={buttonSize} on:click={playPause}>
                      <div class="faIconButton">
                        <Icon icon={playPauseButton} />
                      </div>
                    </sl-button>
                  {/if}
                  {#if !dd.isApp()}
                  <sl-tooltip content="Automatically Loop Playback">
                    <sl-button size={buttonSize} type="{loop ? 'primary' : 'default'}" on:click={toggleLoop}>
                      <div class="faIconButton">
                        <Icon icon={faRetweet} />
                      </div>
                    </sl-button>
                  </sl-tooltip>
                  {:else}
                    <sl-button size={buttonSize} type="{loop ? 'primary' : 'default'}" on:click={toggleLoop}>
                      <div class="faIconButton">
                        <Icon icon={faRetweet} />
                      </div>
                    </sl-button>
                  {/if}
                  {#if !dd.isApp()}
                  <sl-tooltip content="Include Last 2 Hours in Playback Loop">
                    <sl-button size={buttonSize} type="{includeHistoric ? 'primary' : 'default'}" disabled="{!historicActive}" on:click={toggleHistoric}>
                      <div class="faIconButton">
                        <Icon icon={faHistory} />
                      </div>
                    </sl-button>
                  </sl-tooltip>
                  {:else}
                    <sl-button size={buttonSize} type="{includeHistoric ? 'primary' : 'default'}" disabled="{!historicActive}" on:click={toggleHistoric}>
                      <div class="faIconButton">
                        <Icon icon={faHistory} />
                      </div>
                    </sl-button>
                  {/if}
                </sl-button-group>
              </div>
            </div>
            {#if !dd.isIos()}
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="Map Layers">
                    <sl-tooltip content="Show Lightning Strikes (if any)">
                      <sl-button size={buttonSize} type="{ $lightningLayerVisible ? 'primary' : 'default'}" on:click={toggleLightning}>⚡ <span class="hide-on-small-screens">Lightning Strikes</span></sl-button>
                    </sl-tooltip>
                    <sl-tooltip content="Show Mesocyclones (if any)">
                      <sl-button size={buttonSize} type="{ $cycloneLayerVisible ? 'primary' : 'default'}" on:click={toggleCyclones}>🌀 <span class="hide-on-small-screens">Mesocyclones</span></sl-button>
                    </sl-tooltip>
                  </sl-button-group>
                </div>
              </div>
            {/if}
            {#if false}
              <div class="checkbox">
                <sl-select size={buttonSize}>
                  <sl-menu-item value="option-1" checked selected>DWD</sl-menu-item>
                  <sl-menu-item value="option-2">Rainymotion</sl-menu-item>
                </sl-select>
              </div>
            {/if}
            <div class="checkbox buttonsInline">
              <div class="button-group-toolbar">
                {#if !dd.isApp()}
                  <sl-tooltip content="Close">
                    <sl-button size={buttonSize} on:click={hide}>
                      <div class="faIconButton">
                        <Icon icon={faAngleDoubleDown} />️
                      </div>
                    </sl-button>
                  </sl-tooltip>
                {:else}
                  <sl-button size={buttonSize} on:click={hide}>
                    <div class="faIconButton">
                      <Icon icon={faAngleDoubleDown} />️
                    </div>
                  </sl-button>
                {/if}
              </div>
            </div>
            <div class="checkbox">
              <LastUpdated />
            </div>
            {#if !dd.isApp()}
              <div class="checkbox hide-on-small-screens" style="flex-grow: 1;">
                <RadarScaleLine />
              </div>
              <div class="checkbox hide-on-small-screens" style="margin-right: 8px;">
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
