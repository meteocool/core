<script>
  import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
  import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
  import { faAngleDoubleDown } from '@fortawesome/free-solid-svg-icons/faAngleDoubleDown';
  import { faAngleDoubleUp } from '@fortawesome/free-solid-svg-icons/faAngleDoubleUp';
  import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
  import { faRetweet } from '@fortawesome/free-solid-svg-icons/faRetweet';

  import { fly, fade } from 'svelte/transition';
  import { onMount } from 'svelte';
  import Icon from 'fa-svelte';

  import StateMachine from 'javascript-state-machine';
  import { CategoryScale, LinearScale, BarController, BarElement } from 'chart.js';
  import { BarWithErrorBarsChart } from 'chartjs-chart-error-bars';

  Chart.register(CategoryScale);
  Chart.register(LinearScale);
  Chart.register(BarController);
  Chart.register(BarElement);

  import { Chart } from 'chart.js';

  import { meteocoolClassic } from '../colormaps';
  import { setUIConstant } from '../layers/ui';
  import { DeviceDetect as dd } from '../lib/DeviceDetect';


  import { _ } from "svelte-i18n";
  import legendClouds from '../../public/assets/legend_clouds.svg';
  import legendRain from '../../public/assets/legend_rain.svg';
  import legendHail from '../../public/assets/legend_hail.svg';
  import legendThunderstorm from '../../public/assets/legend_thunderstorm.svg';


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
  import ScaleLine from './ScaleLine.svelte';

  export let cap;
  let grid = {};
  let start;
  let end;
  let nSteps;
  let gridNow;

  // Initialize grid
  function generateGrid() {
    gridNow = new Date().getTime() / 1000;
    gridNow -= (gridNow % (60 * 5));
    start = gridNow - (60 * 120);
    end = gridNow + (60 * 120);
    nSteps = ((end - start) / (60 * 5)) + 1;

    [...Array(nSteps)
            .keys()].map((i) => new Date(start + i * (5 * 60)))
            .forEach((step) => {
              grid[step.getTime()] = {
                dbz: 0,
                url: null,
              };
            });
  }

  generateGrid();

  let userLatLon;
  let showBars = true;
  latLon.subscribe((latlonUpdate) => {
    userLatLon = latlonUpdate;
    if (!userLatLon) {
      showBars = false;
    }
  });

  let canvasVisible = true;

  let oldTimeStep = 0;

  let playPauseButton = faPlay;
  let playTimeout;

  let slRange = null;

  let loop = true;
  let historicActive = true;
  let includeHistoric = false;
  let canvas;

  let buttonSize = 'small';
  if (dd.isApp()) {
    buttonSize = 'medium';
  }

  let autoPlay = false;
  let chart = null;

  function redraw() {
    if (!canvas) {
      console.log('Grid not yet initialized, skipping redraw');
      return;
    }
    if (Object.values(grid)
            .map((step) => step.dbz)
            .reduce((a, b) => a + b, 0) === 0) {
      canvasVisible = false;
      return;
    }
    canvasVisible = true;
    const sortedKeys = Object.keys(grid)
            .map((e) => parseInt(e, 10))
            .sort();
    const d = sortedKeys.map((step) => {
      if (!grid[step]) {
        return { y: 0 };
      }
      if (grid[step].dbz && grid[step].source !== 'observation') {
        //return {y: grid[step].dbz, yMin: grid[step].dbz - grid[step].dbzMin, yMax: grid[step].dbz + grid[step].dbzMax};
        return { y: grid[step].dbz };
      } else if (grid[step].dbz) {
        return { y: grid[step].dbz };
      }
      return { y: 0 };
    });
    if (chart) chart.destroy();

    const gridKeys = Object.keys(grid);
    const isApp = dd.isApp();
    chart = new BarWithErrorBarsChart(canvas.getContext('2d'), {
      data: {
        labels: sortedKeys.map((key) => ((key - gridNow) / 60)),
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
          borderColor: d.map((value, index) => gridKeys[index] === `${gridNow}` ? '#ff0000' : getComputedStyle(document.body)
                  .getPropertyValue('--sl-color-info-700')),
          borderWidth: 1,
        }],
      },
      options: {
        animation: {
          duration: 0
        },
        hover: {
          animationDuration: 0
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
            left: 0,
            right: 8,
            top: 0,
            bottom: 0,
          },
        },
        responsive: true,
        maintainAspectRatio: false,
        legend: {
          display: true,
        },
        tooltips: {
          enabled: true,
        },
        scales: {
          x: {
            grid: {
              display: false,
              tickMarkLength: 6,
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
              fontColor: getComputedStyle(document.body)
                      .getPropertyValue('--sl-color-info-700'),
              fontSize: 5,
              autoSkip: false,
              callback: function (value) {
                const label = this.getLabelForValue(value);
                if (label === 0) {
                  return 'now';
                }
                if (Math.abs(label) % (isApp ? 20 : 5) === 0) {
                  if (label > 0) {
                    return `+${label}`;
                  }
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
            },
            max: 95,
            min: 0,
          },
        },
      },
    });
  }

  function canvasInit(elem) {
    canvas = elem;
    if ($bottomToolbarMode === 'player') {
      canvas.parentNode.classList.remove('barChartCanvasWithoutPlayback');
    }
    redraw();
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
        if (slRange) slRange.value = `${gridNow}`;
        setUIConstant('toast-stack-offset', '124px');
        capTimeIndicator.set(gridNow);

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
          if (sliderValueInt >= end) {
            slRange.value = (includeHistoric ? start : start).toString();
          } else {
            slRange.value = (sliderValueInt + 5 * 60).toString();
          }
          if (sliderValueInt === 0) {
            thisFrameDelayMs = 800;
          }
          sliderChangedHandler(slRange.value);
          if (slRange.value !== gridNow || loop) {
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
            document.getElementById('barChartCanvas')
                    .classList
                    .remove('barChartCanvasWithoutPlayback');
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

  function updateBars(data) {
    const gridSteps = Object.keys(grid);
    let changed = false;
    // console.log(`Frontend grid: ${gridSteps.sort()}`);
    // console.log(`Backend grid: ${Object.keys(data).sort()}`);
    Object.keys(data)
            .forEach((key) => {
              if (key in grid) {
                grid[key].dbz = data[key].dbz;
                grid[key].dbzMin = data[key].dbzMin;
                grid[key].dbzMax = data[key].dbzMax;
                grid[key].url = data[key].url;
                grid[key].source = data[key].source;
                changed = true;
              }
            });
    if (changed) redraw();
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
      if (subject === 'radar') {
        updateBars(data);
      }
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

    return;
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

    if (value in grid && 'url' in grid[value] && grid[value].url) {
      cap.setUrl(grid[value].url);
      capTimeIndicator.set(value);
    } else {
      capTimeIndicator.set(0);
      // Set slider color to invalid XXX
    }
    oldTimeStep = value;
  }

  function initSlider(elem) {
    elem.addEventListener('sl-change', (value) => sliderChangedHandler(value.target.value, true));
    slRange = elem;
    window.slr = slRange;
    // XXX why...
    window.setTimeout(() => {
      slRange = `${gridNow}`;
      console.log(`${gridNow}`);
    }, 200);
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
    margin-top: 0.3em;
    border: 1px solid grey;
    border-radius: 5px;
    flex: 1 1 auto;
    text-align: center;
    margin: 0.25em;
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
    bottom: calc(0.2em + env(safe-area-inset-bottom));
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
    margin-right: 1%;
  }

  .range {
    width: 98%;
    margin-bottom: 7px;
  }

  .barChartCanvas {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom) + 77px);
    width: 96%;
    padding-right: 2%;
    left: 2%;
    height: 80px;
    pointer-events: none;
    margin-right: 0.5em;
    z-index: 99999999;
  }

  .barChartCanvasWithoutPlayback {
    bottom: calc(env(safe-area-inset-bottom) + 31px);
    width: 100% !important;
    left: 0;
  }

  @media (orientation: portrait) {
    .barChartCanvas {
      bottom: calc(env(safe-area-inset-bottom) + 108px);
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
  }

  @media only screen and (max-width: 600px) {
    .buttonBar.right {
      left: unset;
      right: 0.3em;
    }
  }
</style>

{#if canvasVisible}
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
          <sl-range min="{start}" max="{end}" step="{60 * 5}" class="range" use:initSlider tooltip="none" style="--thumb-size: 26px;"></sl-range>
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
            {#if !dd.isApp()}
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="Map Layers">
                    <sl-tooltip content="Show Lightning Strikes (if any)">
                      <sl-button size={buttonSize} type="{ $lightningLayerVisible ? 'primary' : 'default'}" on:click={toggleLightning}>⚡ Lightning Strikes</sl-button>
                    </sl-tooltip>
                    <sl-tooltip content="Show Mesocyclones (if any)">
                      <sl-button size={buttonSize} type="{ $cycloneLayerVisible ? 'primary' : 'default'}" on:click={toggleCyclones}>🌀 Mesocyclones</sl-button>
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
              <div class="checkbox">
                 <Appendix />
              </div>
              <div class="checkbox">
                <ScaleLine style="width: 100%;" valueFormat={ (fmt) => {
        switch (fmt) {
          case "64":
            return " ";
          case "74":
            return `<img src=${legendClouds} alt='${$_("drizzle")}' class="legend-icon"/> <span class='legendLabel'>${$_("drizzle")}</span>`;
          case "94":
            return `<img src=${legendRain} alt='${$_("rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("rain")}</span>`;
          case "104":
            return `<img src=${legendThunderstorm} alt='${$_("heavy_rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("heavy_rain")}</span>`;
          case "114":
            return `<img src=${legendHail} alt='${$_("hail")}' class="legend-icon"/> <span class='legendLabel'>${$_("hail")}</span>`;
          default:
            return "";
        }
      } } palette="58:a3a06728;59:a8a57032;60:acac7946;61:b1b18250;62:b6b88c64;63:bcbd936e;64:c1c39c82;65:c1c39c8c;66:cacdaaa0;67:cccfafaa;68:cccfb3be;69:c8ccb3c8;70:bfc3b3dc;71:bfc3b3e6;72:b8bdb3fa;73:b5bab3ff;74:acb3b3ff;75:aaafb3ff;76:a3aab3ff;77:a0a8b3ff;78:9aa1b3ff;79:97a0b3ff;80:909ab3ff;81:939ab5ff;82:8791b1ff;83:838eb1ff;84:7c89afff;85:7785aeff;86:7080aaff;87:6b7caaff;88:5e72a7ff;89:5e72a7ff;90:566da3ff;91:5269a3ff;92:4b64a1ff;93:4660a0ff;94:4260a1ff;95:4467a5ff;96:4975aeff;97:4d7cb1ff;98:508abaff;99:5491bfff;100:599ec6ff;101:5ba5caff;102:60b3d4ff;103:62bad8ff;104:67c8dfff;105:69cfe4ff;106:67d6d6ff;107:60d6c4ff;108:52d6a1ff;109:4bd690ff;110:3bd66dff;111:34d65bff;112:11d116ff;113:0fcd16ff;114:0fc316ff;115:0fbf15ff;116:0fb613ff;117:0eb313ff;118:0eaa13ff;119:0ca511ff;120:0c9e11ff;121:0c9911ff;122:0c900fff;123:0a8c0fff;124:0a830eff;125:0a800eff;126:0a770cff;127:08720cff;128:086b0aff;129:08660aff;130:085d08ff;131:1c6708ff;132:467c08ff;133:5b8707ff;134:839c05ff;135:97a805ff;136:c1bc05ff;137:d6c603ff;138:ffe200ff;139:ffd800ff;140:ffc800ff;141:ffc300ff;142:ffb500ff;143:ffb000ff;144:ffa700ff;145:ff9e00ff;146:ff9300ff;147:ff8900ff;148:ff7f00ff;149:ff0000ff;150:f00000ff;151:e90000ff;152:db0000ff;153:d40000ff;154:c60000ff;155:bf0000ff;156:b10000ff;157:aa0000ff;158:9a0000ff;159:930000ff;160:850000ff;161:7e0000ff;162:700000ff;163:ffffffff;164:ffe9ffff;165:ffdfffff;166:ffc8ffff;167:ffbdffff;168:ffa8ffff;169:ff9cffff;170:ff75ffff;171:fb6bfdff;172:f656f6ff;173:f24bf4ff;174:ed36efff;175:e92aebff;176:e416e6ff;177:e10ae2ff;178:ac00fbff;179:a300f6ff;180:9300efff;181:8700e9ff;182:7900e2ff;183:7200ddff;184:6200d6ff;185:6200d6ff" />

              </div>
            {/if}
          </div>
        </div>
      </div>
  </div>
{:else}
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
