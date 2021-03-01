<script>
import { faRedoAlt } from '@fortawesome/free-solid-svg-icons/faRedoAlt';
import { capTimeIndicator, lightningLayerVisible, showTimeSlider } from '../stores';
import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faArrowsAltH } from '@fortawesome/free-solid-svg-icons/faArrowsAltH';
import { faTimesCircle } from '@fortawesome/free-solid-svg-icons/faTimesCircle';
import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
import { fly } from 'svelte/transition';
import { reportToast } from '../lib/Toast';
import { _ } from 'svelte-i18n';
import StateMachine from 'javascript-state-machine';
import { onMount } from 'svelte';
import LastUpdated from './LastUpdated.svelte';
import { format } from 'date-fns';
import Chart from 'chart.js';
import { meteocoolClassic } from '../colormaps';
import getDfnLocale from '../locale/locale';
import TimeIndicator from './TimeIndicator.svelte';
import { resetUIConstant, setUIConstant } from '../layers/ui';
import Icon from 'fa-svelte';

export let cap;
export let device;

let open = false; // Drawer open/closed. Displays open button if false
let warned = false; // True if user has been warned about forecast != measurement
let loadingIndicator = true; // If true, show loading indicator instead of slider
let oldTimeStep = 0;

let playPauseButton = faPlay;
const uiMessage = $_("downloading_nowcast");
let iconHTML;
let baseTime;
let playTimeout;

let nowcastLayers; // Set by the callback from Nowcast.js
let historicLayers; // ditto

let slRange = null;
let oldUrls;

let loop = true;
let historicActive = true;
let includeHistoric = false;
let canvas;

let buttonSize = "small";
if (device === "ios" || device === "android") {
  buttonSize = "medium";
}

let lightningEnabled = false;
lightningLayerVisible.subscribe((value) => {
  lightningEnabled = value;
});

onMount(async () => {
  cap.addObserver((subject, data) => {
    console.log(`observed ${subject}`);
    if (subject === "historic") {
      historicLayers = data.sources;
    } else if (subject === "nowcast") {
      nowcastLayers = data.sources;
    } else {
      return;
    }
    if (nowcastLayers && historicLayers) {
      fsm.showScrollbar();
    }
  });
  cap.addObserver((event) => {
    if (event === "loseFocus") {
      hide();
    }
  });
});

function canvasInit(elem) {
  canvas = elem;
  const values = Object.values(historicLayers)
    .map((layer) => Math.round(layer.reported_intensity + 32.5))
    .concat(Object.values(nowcastLayers)
      .map((layer) => Math.round(layer.reported_intensity + 32.5)));
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line no-new
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: Array(49)
        .fill()
        .map((_, i) => `${-120 + i * 5}`),
      datasets: [{
        data: values,
        backgroundColor: values.map(((value) => meteocoolClassic[Math.round(value * 2)]))
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
          type: "logarithmic",
          ticks: {
            display: false,
          },
        }],
      },
    },
  });
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
      cap.downloadHistoric();
      cap.downloadNowcast();
    },
    onShowScrollbar: (transition) => {
      console.log("FSM ===== waiting for server");
      loadingIndicator = false;
      oldUrls = cap.source.getUrls();
      if (slRange) slRange.value = 0;
      setUIConstant("toast-stack-offset", "124px");
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
        capTimeIndicator.set(format(new Date((cap.getUpstreamTime() + slRange.value * 60) * 1000), "⏱ HH:mm"));
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
      resetUIConstant("toast-stack-offset");
      loadingIndicator = true;
      setTimeout(() => {
        showTimeSlider.set(false);
      }, 200);
      cap.source.setUrl(cap.lastSourceUrl);
    },
  },
});
window.fsm = fsm;

function warnNotMostRecent() {
  if (!warned) {
    reportToast($_("forcastPlaying"));
    warned = true;
  }
}

function initSlider(elem) {
  /*
  elem.tooltipFormatter = value => {
    if (value === 0) {
      return 'Latest Radar Image';
    }
    return `${value.toString()[0] !== '-' ? '+' : ''}${value.toString()}m`;
  };
  */
  elem.addEventListener("sl-change", (value) => sliderChangedHandler(value.target.value));
  slRange = elem;
}

function show() {
  if (fsm.state === "followLatest") {
    fsm.waitForServer();
  }
}

function hide() {
  fsm.hideScrollbar();
}

function sliderChangedHandler(value) {
  if (value === oldTimeStep) return;

  if (value === 0) {
    cap.source.setUrl(cap.lastSourceUrl);
  } else if (value > 0) {
    cap.source.setUrl(nowcastLayers[value].url);
    warnNotMostRecent();
  } else {
    cap.source.setUrl(historicLayers[value].url);
  }
  oldTimeStep = value;
}

function playPause() {
  if (fsm.state === "playing") {
    fsm.pressPause();
  } else {
    fsm.pressPlay();
  }
}

function renderIcon(el) {
  iconHTML = el.innerHTML;
}

function toggleLoop(el) {
  loop = !loop;
  historicActive = loop;
  if (!historicActive) includeHistoric = false;
}

function toggleHistoric(el) {
  includeHistoric = !includeHistoric;
}

const hasHover = !window.matchMedia("(hover: none)").matches;

function toggleLightning() {
  lightningLayerVisible.set(!lightningEnabled);
}
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
  /*
  //.controls {
  //  width: 3em;
  //  display: flex;
  //  flex-direction: column;
  //  float: left;
  //  margin-top: 0.5em;
  //  margin-left: 0.6em;
  //  margin-right: 0.25em;
  //}
    */

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
        top: 4px;
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
  @media (orientation: portrait) {
    .barChartCanvas {
      bottom: 151px;
      height: 38px;
      width: 100%;
    }
  }
</style>

<span use:renderIcon><Icon icon={faArrowsAltH} /></span>

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
              {$_("last_radar")} {format(new Date(cap.upstreamTime), "Pp", { locale: getDfnLocale() })}
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
            <Icon icon={faTimesCircle} class="controlIcon" />
          </div>
        </div>
        <div class="slider">
          <div class="barChartCanvas">
            <canvas id="myChart" use:canvasInit></canvas>
          </div>
          <sl-range min="-120" max="120" value="0" step="5" class="range" use:initSlider tooltip="none"></sl-range>
          <div class="flexbox gap">
            <div class="checkbox">
              <div class="button-group-toolbar">
                <sl-button-group label="Playback Controls">
                  <sl-tooltip content="Play" disabled={!hasHover}>
                    <sl-button size={buttonSize} on:click={playPause}>
                      <Icon icon={playPauseButton} class="faIconButton" />
                    </sl-button>
                  </sl-tooltip>
                  <sl-tooltip content="Automatically Loop Playback" disabled={!hasHover}>
                    <sl-button size={buttonSize} type="{loop ? 'primary' : 'default'}" on:click={toggleLoop}>
                      <Icon icon={faRedoAlt} class="faIconButton" />️
                    </sl-button>
                  </sl-tooltip>
                  <sl-tooltip content="Include Last 2 Hours in Playback Loop" disabled={!hasHover}>
                    <sl-button size={buttonSize} type="{includeHistoric ? 'primary' : 'default'}" disabled="{!historicActive}" on:click={toggleHistoric}>
                      <div class="faIconButton">
                        <Icon icon={faHistory} />
                      </div>
                    </sl-button>
                  </sl-tooltip>
                </sl-button-group>
              </div>
            </div>
            <div class="checkbox buttonsInline">
              <div class="button-group-toolbar">
                <sl-tooltip content="Close" disabled={!hasHover}>
                  <sl-button size={buttonSize} on:click={hide} ><Icon icon={faTimesCircle} />️</sl-button>
                </sl-tooltip>
              </div>
            </div>
            {#if device !== "ios" && device !== "android"}
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
              <LastUpdated />
            </div>
            <div class="checkbox">
              <TimeIndicator device={device} />
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

