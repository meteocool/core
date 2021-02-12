<script>
  import Icon from "fa-svelte";
  import { showTimeSlider } from "./stores";
  import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
  import { faArrowsAltH } from "@fortawesome/free-solid-svg-icons/faArrowsAltH";
  import { fly } from "svelte/transition";
  import { reportToast } from "./lib/Toast";
  import { _ } from "svelte-i18n";
  import StateMachine from "javascript-state-machine";
  import { onMount } from 'svelte';

  export let cap;

  let open = false; // Drawer open/closed. Displays open button if false
  let warned = false; // True if user has been warned about forecast != measurement
  let loadingIndicator = true; // If true, show loading indicator instead of slider
  let oldTimeStep = 0;

  let playPauseButton = faPlay;
  let uiMessage = $_("downloading_nowcast");
  let iconHTML;
  let baseTime;
  let playTimeout;

  let nowcastLayers; // Set by the callback from Nowcast.js
  let historicLayers; // ditto

  let slRange = null;
  let oldUrls;

  onMount(async () => {
    cap.addObserver((subject, data) => {
      console.log(`observed ${subject}`);
      if (subject === "historic") {
        historicLayers = data.sources;
      }
      if (subject === "nowcast") {
        nowcastLayers = data.sources;
      }
      if (nowcastLayers && historicLayers) {
        fsm.showScrollbar();
      }
    });
    cap.addObserver((event) => {
      if (event === "loseFocus") {
        console.log("radar lost focus");
        hide();
      }
    });
  });

  let fsm = new StateMachine({
    init: 'followLatest',
    transitions: [
      { name: 'showScrollbar', from: 'followLatest', to: 'manualScrolling' },
      { name: 'showScrollbar', from: 'waitingForServer', to: 'manualScrolling' },
      { name: 'waitForServer', from: 'followLatest', to: 'waitingForServer' },
      { name: 'pressPlay', from: 'manualScrolling', to: 'playing' },
      { name: 'pressPause', from: 'playing', to: 'manualScrolling' },
      { name: 'hideScrollbar', from: '*', to: 'followLatest' },
    ],
    methods: {
      onWaitForServer: (param) => {
        console.log("FSM ===== waiting for server");
        loadingIndicator = true;
        setTimeout(() => showTimeSlider.set(true), 200);
        //cssGetclass(".sl-toast-stack").style.bottom = "calc(env(safe-area-inset-bottom) + 98px)";
        open = true;
        cap.downloadHistoric();
        cap.downloadNowcast();
      },
      onShowScrollbar: (transition) => {
        console.log("FSM ===== waiting for server");
        loadingIndicator = false;
        oldUrls = cap.source.getUrls();
        if (slRange) slRange.value = 0;
      },
      onPressPlay: (transition) => {
        let playTick = () => {
          if (slRange.value >= 120) {
            slRange.value = -120;
          }
          slRange.value = slRange.value + 5;
          sliderChangedHandler(slRange.value);
          playTimeout = window.setTimeout(playTick, 500);
        };
        playTick();
        playPauseButton = faPause;
      },
      onPressPause: (transition) => {
        window.clearTimeout(playTimeout);
        playPauseButton = faPlay;
      },
      onHideScrollbar: (transition) => {
        open = false;
        oldTimeStep = 0;
        warned = false;
        loadingIndicator = true;
        setTimeout(() => {
          showTimeSlider.set(false);
        }, 200);
        //cssGetclass(".sl-toast-stack").style.bottom = "calc(env(safe-area-inset-bottom) + 45px)";
      },
    }
  });
  window.fsm = fsm;

  function initSlider(elem) {
    elem.tooltipFormatter = value => `${value.toString().padStart(2, 0)}`;
    elem.addEventListener("sl-change", (value) => sliderChangedHandler(value.target.value));
    slRange = elem;
  }

  function show() {
    if (fsm.state === 'followLatest') {
      fsm.waitForServer();
    }
  }

  function hide() {
    fsm.hideScrollbar();
  }

  function sliderChangedHandler(value) {
    if (value === oldTimeStep) return;

    if (value === 0) {
      cap.source.setUrl(nowcastLayers[value].url);
    } else {
      warnNotMostRecent();
      console.log(value);
      if (value > 0) {
        cap.source.setUrl(nowcastLayers[value].url);
      } else {
        cap.source.setUrl(historicLayers[value].url);
      }
    }
    oldTimeStep = value;
  }

  function warnNotMostRecent() {
    if (!warned) {
      reportToast($_("forcastPlaying"));
      warned = true;
    }
  }

  function playPause() {
    if (fsm.state === 'playing') {
      fsm.pressPause();
    } else {
      fsm.pressPlay();
    }
  }

  function renderIcon(el) {
    iconHTML = el.innerHTML;
  }
</script>

<style>
  /* deduplicate with bottomtoolbar.svelte XXX */
  .bottomToolbar {
    position: absolute;
    bottom: 0;
    left: 0;
    border-top-left-radius: 11px;
    border-top-right-radius: 11px;
    border-top: 1px solid var(--sl-color-gray-50);
    width: 100%;
    background-color: var(--sl-color-white);
  }

  .timeslider {
    height: 10%;
    min-height: 100px;
    z-index: 999999;
  }

  @media (orientation: portrait) {
    .timeslider {
      height: 20%;
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
  .controls {
    width: 3em;
    display: flex;
    flex-direction: column;
    float: left;
    margin-top: 0.5em;
    margin-left: 0.6em;
    margin-right: 0.25em;
  }

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

  .buttonDisabled {
    cursor: not-allowed !important;
    background-color: #eeeeee !important;
    border: 1px solid #aaaaaa !important;
    color: #666666 !important;
  }

  .spinner{
    font-size: 2.5rem;
    float: left;
    --indicator-color: rgb(52,120,246);
    --track-color: var(--sl-color-gray-200);
  }

  .loadingIndicator{
    display: inline-block;
    transform: translateY(66%);
  }

  .buttonBar{
    position: absolute;
    bottom: calc(0.2em + env(safe-area-inset-bottom));
    left: 0.3em;
    z-index: 999999;
  }

  .textBlock{
    display: inline-block;
  }

  .text{
      opacity: 0.6;
      float: left;
      margin-left: 1.5rem;
      height: 2.5rem;
      white-space: nowrap;
      vertical-align: text-top;
      color:var(--sl-color-black);
  }
  .bottomText{
    clear:both;
    font-size: 0.9rem;
    margin-top: -0.7em;
  }

  .topText{
    margin-top: -0.3em;
    font-size: 1.5rem;
  }
</style>

<span use:renderIcon><Icon icon={faArrowsAltH} /></span>

{#if open}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 100, duration: 400 }}>
    <div class="controls">
      <div
        class="controlButton buttonDisabled"
        on:click={playPause}
        title="Play/Pause">
        <Icon icon={playPauseButton} class="controlIcon" />
      </div>
    </div>
    {#if loadingIndicator}
      <div class="parent" id="loadingIndicator">
        <div class="loadingIndicator">
          <sl-spinner class="spinner"/>
          <div class="textBlock">
            <div class="text topText">
              {uiMessage}...
            </div>
            <div class="text bottomText">
              {$_("last_radar")} then and then
            </div>
          </div>
        </div>
      </div>
    {:else}
      <sl-range style="width: 90%; margin-left: 10%;" min="-120" max="120" value="0" step="5" class="range-with-custom-formatter" use:initSlider></sl-range>
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

