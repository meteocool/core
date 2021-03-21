<script>
// Here be dragons
import { capTimeIndicator, latLon, lightningLayerVisible, showForecastPlaybutton, showTimeSlider } from '../stores';
import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faAngleDoubleDown } from '@fortawesome/free-solid-svg-icons/faAngleDoubleDown';
import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
import { faRetweet } from '@fortawesome/free-solid-svg-icons/faRetweet';
import { fly } from 'svelte/transition';
import { _ } from 'svelte-i18n';
import StateMachine from 'javascript-state-machine';
import { onMount } from 'svelte';
import LastUpdated from './LastUpdated.svelte';
import { format } from 'date-fns';
import Chart from 'chart.js';
import { meteocoolClassic } from '../colormaps';
import getDfnLocale from '../locale/locale';
import TimeIndicator from './TimeIndicator.svelte';
import { setUIConstant } from '../layers/ui';
import Icon from 'fa-svelte';
import { DeviceDetect as dd } from '../lib/DeviceDetect';

export let cap;

let userLatLon;
let showBars = true;
latLon.subscribe((latlonUpdate) => {
  userLatLon = latlonUpdate;
  if (!userLatLon) {
    showBars = false;
  }
});

let open = false; // Drawer open/closed. Displays open button if false
let warned = false; // True if user has been warned about forecast != measurement
let loadingIndicator = true; // If true, show loading indicator instead of slider
let oldTimeStep = 0;

let playPauseButton = faPlay;
const uiMessage = $_("downloading_nowcast");
let playTimeout;

let nowcastLayers; // Set by the callback from Nowcast.js
let historicLayers; // ditto

let slRange = null;
let oldUrls;

let loop = true;
let historicActive = true;
let includeHistoric = false;
let canvas;
let rainValues;

let buttonSize = "small";
if (dd.isApp()) {
  buttonSize = "medium";
}

let lightningEnabled = false;
lightningLayerVisible.subscribe((value) => {
  lightningEnabled = value;
});

onMount(async () => {
  cap.addObserver((subject, data) => {
    console.log(`NowcastPlayback observed event ${subject}`);
    if (subject === "historic") {
      historicLayers = data.sources;
    } else if (subject === "nowcast") {
      nowcastLayers = data.sources;
    } else {
      return;
    }
    if (historicLayers && nowcastLayers) {
      if (fsm.state === "waitingForServer") {
        fsm.showScrollbar();
      }
      const reversed = Object.values(historicLayers);
      reversed.reverse();
      rainValues = reversed
        .map((layer) => Math.round(layer.reported_intensity + 32.5))
        .concat(Object.values(nowcastLayers)
        .map((layer) => Math.round(layer.reported_intensity + 32.5)));
      setChart();
    }
  });
  cap.addObserver((event) => {
    if (event === "loseFocus") {
      hide();
    }
  });
});

function setChart() {
  if (!canvas) return;
  // eslint-disable-next-line no-new
  new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Array(49)
        .fill()
        .map((_, i) => `${-120 + i * 5}`),
      datasets: [{
        data: rainValues,
        barPercentage: 0.99,
        categoryPercentage: 0.99,
        backgroundColor: rainValues.map(((value) => meteocoolClassic[Math.round(value * 2)]))
          .map(maybe => maybe ? maybe : [0, 0, 0, 0])
          .map(([r, g, b, _]) => `rgba(${r}, ${g}, ${b}, 1)`),
        borderColor: getComputedStyle(document.body)
          .getPropertyValue("--sl-color-info-700"),
        borderWidth: 1,
      }],
    },
    options: {
      layout: {
        padding: {
          left: 0,
          right: 0,
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
      scales: {
        xAxes: [{
          gridLines: {
            display: false,
          },
          ticks: {
            fontColor: getComputedStyle(document.body)
              .getPropertyValue("--sl-color-info-700"),
            fontSize: 9,
            autoSkip: true,
            maxRotation: 90,
            minRotation: 0,
          },
        }],
        yAxes: [{
          gridLines: {
            display: false,
          },
          scaleLabel: {
            display: false,
            labelString: "Intensity",
          },
          ticks: {
            display: false,
          },
        }],
      },
    },
  });
}

function canvasInit(elem) {
  canvas = elem;
  setChart();
}

let fsm = new StateMachine({
  init: "followLatest",
  transitions: [
    {
      name: "showScrollbar",
      from: "followLatest",
      to: "manualScrolling",
    },
    {
      name: "showScrollbar",
      from: "waitingForServer",
      to: "manualScrolling",
    },
    {
      name: "waitForServer",
      from: "followLatest",
      to: "waitingForServer",
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
    onWaitForServer: (param) => {
      console.log("FSM ===== waiting for server");
      loadingIndicator = true;
      setTimeout(() => showTimeSlider.set(true), 200);
      // cssGetclass(".sl-toast-stack").style.bottom = "calc(env(safe-area-inset-bottom) + 98px)";
      open = true;
    },
    onShowScrollbar: (transition) => {
      console.log("FSM ===== waiting for server");
      loadingIndicator = false;
      playPauseButton = faPlay;
      open = true;
      oldUrls = cap.source.getUrls();
      setTimeout(() => showTimeSlider.set(true), 200);
      if (slRange) slRange.value = 0;
      setUIConstant("toast-stack-offset", "124px");
      capTimeIndicator.set(cap.getUpstreamTime());
    },
    onPressPlay: () => {
      const playTick = () => {
        let thisFrameDelayMs = 450;
        if (slRange.value >= 120) {
          slRange.value = includeHistoric ? -120 : 0;
        } else {
          slRange.value += 5;
        }
        if (slRange.value === 0) {
          thisFrameDelayMs = 800;
        }
        sliderChangedHandler(slRange.value);
        if (slRange.value !== 0 || loop) {
          playTimeout = window.setTimeout(playTick, thisFrameDelayMs);
        } else {
          playTimeout = 0;
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
      open = false;
      oldTimeStep = 0;
      warned = false;
      setUIConstant("toast-stack-offset");
      loadingIndicator = true;
      setTimeout(() => {
        showTimeSlider.set(false);
      }, 200);
      cap.source.setUrl(cap.lastSourceUrl);
    },
  },
});
window.fsm = fsm;

function initSlider(elem) {
  elem.addEventListener("sl-change", (value) => sliderChangedHandler(value.target.value, true));
  slRange = elem;
}

function show() {
  if (fsm.state === "followLatest") {
    if (historicLayers && nowcastLayers) {
      fsm.showScrollbar();
    } else {
      fsm.waitForServer();
    }
  }
}

function hide() {
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  fsm.hideScrollbar();
}

function sliderChangedHandler(value, userInteraction = false) {
  if (value === oldTimeStep) return;

  if (userInteraction && fsm.state === 'playing') {
    fsm.pressPause();
  }

  if (value === 0) {
    cap.source.setUrl(cap.lastSourceUrl);
  } else if (value > 0) {
    cap.source.setUrl(nowcastLayers[value].url);
  } else {
    cap.source.setUrl(historicLayers[value].url);
  }
  oldTimeStep = value;
  capTimeIndicator.set(cap.getUpstreamTime() + value * 60);
}

function playPause() {
  if (fsm.state === "playing") {
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

const hasHover = !window.matchMedia("(hover: none)").matches;

function toggleLightning() {
  lightningLayerVisible.set(!lightningEnabled);
}

let bottomToolbarVisible = true;
showForecastPlaybutton.subscribe((val) => {
  bottomToolbarVisible = val;
});
</script>

<style>
  .timeslider {
    height: 90px;
    z-index: 999999;
    padding-top: 6px;
  }

  @media (orientation: portrait) {
    .timeslider {
      height: 170px;
      padding-top: 0px;
    }
  }

  .parent {
    display: flex;
    flex-direction: column;
    justify-content: center;
    translate: translateY(50%);
    align-items: center;
  }

  /* timeline controls */

  .controlButton {
    width: 1em;
    height: 1em;
    padding: 0.5em;
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

  .spinner {
    font-size: 2.5rem;
    float: left;
    --indicator-color: rgb(52,120,246);
    --track-color: var(--sl-color-gray-200);
  }

  .loadingIndicator {
    display: inline-block;
    transform: translateY(40%);
  }

  .buttonBar {
    position: absolute;
    bottom: calc(0.2em + env(safe-area-inset-bottom));
    left: 0.3em;
    z-index: 999999;
  }

  .textBlock {
    display: inline-block;
  }

  .text {
      opacity: 0.6;
      float: left;
      margin-left: 1.5rem;
      height: 2.5rem;
      white-space: nowrap;
      vertical-align: text-top;
      color:var(--sl-color-black);
  }

  .bottomText {
    clear:both;
    font-size: 0.9rem;
    margin-top: -0.7em;
  }

  .topText {
    margin-top: -0.3em;
    font-size: 1.5rem;
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


  @media (orientation: portrait) {
    .gap > * {
      margin-bottom: 16px;
      margin-right: 18px;
    }
    .flexbox {
      padding-left: 1%;
      padding-right: 1%;
    }
  }

  .flexbox > .slider {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 85%;
    /*background-color: green;*/
  }

  .flexbox > .buttonsInline {
    display: none;
  }

  @media (orientation: portrait) {
    .flexbox > .buttonsInline {
      display: unset;
    }
  }

  @media (orientation: portrait) {
    .flexbox > .buttonsLeft {
      display: none;
    }
  }

  .flexbox > .buttonsLeft {
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
    min-width: 30px;
    margin-right: 1%;
    /*background-color: yellow;*/
  }
  .flexbox > .checkbox {
      /* background-color: blue; */
  }

  .range {
    width: 98%;
    top: 10px;
    margin-bottom: 5px;
  }
  @media (orientation: portrait) {
      .range {
        top: 5px;
      }
  }

  .barChartCanvas {
    position: absolute;
    bottom: 72px;
    z-index: 99999;
    width: 96%;
    height: 60px;
    pointer-events: none;
    transform: translateX(-1.1%);
  }
  /* XXX consolidate media queries into one place */
  @media (orientation: portrait) {
    .barChartCanvas {
      bottom: 151px;
      height: 60px;
      width: 100%;
    }
    .faIconButton {
      font-size: 125%;
      margin-top: 2px;
    }
  }
</style>

{#if bottomToolbarVisible}
  {#if open}
    <div
      class="bottomToolbar timeslider"
      transition:fly={{ y: 100, duration: 400 }}>
      {#if loadingIndicator}
        <div class="parent" id="loadingIndicator">
          <div class="loadingIndicator">
            <sl-spinner class="spinner"/>
            <div class="textBlock">
              <div class="text topText">
                {uiMessage}...
              </div>
              <div class="text bottomText">
                {$_("last_radar")} {format(new Date(cap.upstreamTime * 1000), "Pp", { locale: getDfnLocale() })}
              </div>
            </div>
          </div>
        </div>
      {:else}
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
            <div class="barChartCanvas">
              <canvas use:canvasInit></canvas>
            </div>
            <sl-range min="-120" max="120" value="0" step="5" class="range" use:initSlider tooltip="none"></sl-range>
            <div class="flexbox gap">
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="Playback Controls">
                    {#if !dd.isApp()}
                      <!-- XXX this is sadly necessary because sl tooltip throws some weird exception on mobile, even if disabled -->
                      <sl-tooltip content="Play" disabled={!hasHover}>
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
                    <sl-tooltip content="Automatically Loop Playback" disabled={!hasHover}>
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
                    <sl-tooltip content="Include Last 2 Hours in Playback Loop" disabled={!hasHover}>
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
                        <sl-button size={buttonSize} type="{ lightningEnabled ? 'primary' : 'default'}" on:click={toggleLightning}>⚡ Lightning Strikes</sl-button>
                      </sl-tooltip>
                      <sl-tooltip content="Show Mesocyclones (if any)">
                        <sl-button size={buttonSize} type="default">🌀 Mesocyclones</sl-button>
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
              <div class="checkbox">
                <TimeIndicator />
              </div>
              <div class="checkbox buttonsInline">
                <div class="button-group-toolbar">
                  {#if !dd.isApp()}
                    <sl-tooltip content="Close" disabled={!hasHover}>
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
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div on:click={show} class="buttonBar">
      <div class="controlButton" title="Play/Pause">
        <div class="playHover">
          <Icon icon={faPlay} class="controlIcon" />
        </div>
      </div>
    </div>
  {/if}
{/if}
