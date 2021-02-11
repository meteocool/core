<script>
  import Icon from "fa-svelte";
  import { showTimeSlider } from "./stores";
  import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
  import { faArrowsAltH } from "@fortawesome/free-solid-svg-icons/faArrowsAltH";
  import { fly } from "svelte/transition";
  import { reportToast } from "./lib/Toast";
  import { cssGetclass } from "./lib/css";
  import { _ } from "svelte-i18n";
  import StateMachine from "javascript-state-machine";
  import { onMount } from 'svelte';
  import { dwdLayer } from './layers/radar';

  export let cap;
  let target;
  let loadingIndicator = true;
  let currentForecastID = -1;
  let timeline;
  let playPauseButton = faPlay;
  let playing = false;
  let activeForecastTimeout;
  let lastSliderTime;
  let visible = false;
  let uiMessage = $_("downloading_nowcast");
  let iconHTML;
  let baseTime;
  let warned = false;

  let nowcastLayers; // Set by the callback from Nowcast.js
  let historicLayers; // ditto

  let sliderLayer; // Layer for forecast & historic steps, initialized by observer cb
  let sliderSource; // Source short cut for sliderLayer

  let thatForecastSource;
  let tlItems;

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
    // close playback when switching to another layer, save some memory
    //cap.addObserver((event) => {
    //  if (event === "loseFocus") {
    //    console.log("radar lost focus");
    //    reset();
    //    hide();
    //  }
    //});
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
        visible = true;
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
          window.setTimeout(playTick, 500);
        };
        playTick();
        playPauseButton = faPause;
      },
      onHideScrollbar: (transition) => {
        visible = false;
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

  let oldTimeStep = 0;

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
      //if (oldTimeStep === 0) {
      //  cap.getMap().removeLayer(nowcast.mainLayer);
      //  cap.getMap().addLayer(sliderLayer);
      //}
    }
    oldTimeStep = value;
  }

  //  const newSliderTime = Math.floor(properties.time.getTime() / 1000);
  //  if (newSliderTime != lastSliderTime) {
  //    lastSliderTime = newSliderTime;
  //    const index = Object.values(nowcast.forecastLayers)
  //            .map((item) => item.absTime)
  //            .findIndex((t) => t === lastSliderTime);
  //    } else {
  //      if (lastSliderTime.toString() in historicLayersObj) {
  //        thatForecastSource.setUrls(historicLayersObj[lastSliderTime].source.getUrls());
  //      }
  //    }
  //    if (newSliderTime === baseTime) {
  //      //document.getElementById("backButton").classList.add("buttonInactive");
  //    } else {
  //      //document
  //      //  .getElementById("backButton")
  //      //  .classList.remove("buttonInactive");
  //    }
  //  }
  //}


  function reset() {
    //if (!lastSliderTime) return;
    //timeline.removeCustomTime("playbackMarker");
    //cap
    //  .getMap()
    //  .getLayers()
    //  .getArray()
    //  .filter((layer) => layer.get("nowcastLayer"))
    //  .forEach((layer) => cap.getMap().removeLayer(layer));
    //cap.getMap().addLayer(nowcast.mainLayer);
    //setTimeSlider(timeline);
    //lastSliderTime = undefined;
    //warned = false;
  }

  //function updateSliderHistoric(subject, body) {
  //  if (subject !== "historic") {
  //    return;
  //  }
  //  historicLayers = [];
  //  historicLayersObj = body.layers;
  //  Object.entries(body.layers).reverse().forEach((entry, i) => {
  //    const [absTime, layer] = entry;
  //    if (i < 1000) {
  //      historicLayers.push({
  //        id: 10000 + i,
  //        type: "background",
  //        start: new Date(absTime * 1000),
  //        style: "background: #00ff00;",
  //      });
  //    }
  //  });
  //  //let items = new DataSet(tlItems.concat(historicLayers));
  //  timeline.setItems(items);
  //}

  //  let vals = Object.values(body.layers);
  //  let datasetItems = vals.map((val, i) => ({
  //    id: i,
  //    start: new Date(val.absTime * 1000),
  //    end: new Date((val.absTime + 5 * 60) * 1000),
  //    //style : i%2 == 0 ? "background: #eeffee;" : "background: #ddffdd;",
  //    style: "background: #33508A;",
  //  }));
  //  datasetItems.push({
  //    id: 998,
  //    type: "point",
  //    content: $_("published"),
  //    start: new Date(body.processedTime * 1000),
  //  });
  //  datasetItems.push({
  //    id: 999,
  //    type: "point",
  //    content: $_("acquired"),
  //    start: new Date(body.baseTime * 1000),
  //  });
  //  baseTime = body.baseTime;

  //  // Configuration for the Timeline
  //  const options = {
  //    min: new Date((vals[0].absTime - 12 * 60 * 60) * 1000),
  //    max: new Date((vals[vals.length - 1].absTime + 60 * 60) * 1000),
  //    zoomFriction: 20,
  //    horizontalScroll: true,
  //    zoomKey: "ctrlKey",
  //    height: Math.max(parseInt(window.innerHeight * 0.1), 100),
  //    selectable: false,
  //    type: "background",
  //    margin: { axis: 0, item: { horizontal: 0, vertical: -5 } },
  //  };

  //  loadingIndicator = false;

  //  // Create a Timeline
  //  timeline = new Timeline(target, datasetItems, options);
  //  tlItems = datasetItems;
  //  setTimeSlider(timeline);
  //  Array.prototype.forEach.call(
  //    document.getElementsByClassName("controlButton"),
  //    (button) => button.classList.remove("buttonDisabled"),
  //  );
  //}

  //function setTimeSlider(timeline) {
  //  timeline.addCustomTime(
  //    new Date(nowcast.forecastLayers["0"].absTime * 1000),
  //    "playbackMarker",
  //  );
  //  timeline.setCustomTimeMarker($_("trackingMostRecent"), "playbackMarker");
  //  timeline.on("timechange", timeChangeHandler);
  //  //document.getElementById("backButton").classList.add("buttonInactive");
  //}

  function warnNotMostRecent() {
    if (!warned) {
      reportToast($_("forcastPlaying"));
      warned = true;
    }
  }

  function play() {
    fsm.pressPlay();
    //if (playing) {
    //  window.clearTimeout(self.activeForecastTimeout);
    //  self.activeForecastTimeout = 0;
    //  playPauseButton = faPlay;
    //  playing = false;
    //  timeline.setCustomTimeMarker("↔", "playbackMarker");
    //  timeline.on("timechange", (param) => {timeChangeHandler(param)});
    //  warnNotMostRecent();
  }

  function playTick() {
    //if (!nowcast.downloaded) {
    //  console.log("not all forecasts downloaded yet");
    //  return;
    //}

    if (currentForecastID === Object.keys(nowcast.forecastLayers).length - 1) {
      // we're past the last downloaded layer, so end the play
      cap.getMap().addLayer(nowcast.mainLayer);
      cap
        .getMap()
        .getLayers()
        .getArray()
        .filter((layer) => layer.get("nowcastLayer"))
        .forEach((layer) => cap.getMap().removeLayer(layer));
      currentForecastID = -1;
      playPauseButton = faPlay;
      timeline.removeCustomTime("playbackMarker");
      playing = false;
      setTimeSlider(timeline);
      return;
    }

    timeline.removeCustomTime("playbackMarker");
    if (currentForecastID < 0) {
      // play not yet in progress, remove main layer
      cap.getMap().removeLayer(nowcast.mainLayer);
      playPauseButton = faPause;
      playing = true;
      cap.getMap().addLayer(nowcast.forecastLayers[0].layer);
      thatForecastSource = nowcast.forecastLayers[0].source;
    }

    currentForecastID++;
    thatForecastSource.setUrls(nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].source.getUrls());
    timeline.addCustomTime(
      new Date(
        nowcast.forecastLayers[
          Object.keys(nowcast.forecastLayers)[currentForecastID]
        ].absTime * 1000,
      ),
      "playbackMarker",
    );
    timeline.setCustomTimeMarker("↔", "playbackMarker");
    self.activeForecastTimeout = window.setTimeout(() => {
      playTick();
    }, 600);
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

  #timesliderTarget {
    width: 100%;
    position: static !important;
  }

  /* vis.js timeline styling */
  :global(.vis-custom-time) > :global(.vis-custom-time-marker) {
    top: unset;
    bottom: 0;
    transform: translateX(-47%);
  }

  :global(.vis-custom-time) > :global(.vis-custom-time-marker):before {
    content: " ";
  }

  :global(.vis-group) {
    background: repeating-linear-gradient(
      45deg,
      #f0d1df,
      #f0d1df 10px,
      #cd7482 10px,
      #cd7482 20px
    );
  }

  :global(.vis-item-content) {
    color: white;
    font-size: 85%;
  }

  :global(.vis-time-axis .vis-text) {
    color: var(--sl-color-black);
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

{#if !visible}
  <div on:click={show} class="buttonBar">
    <div class="controlButton" title="Play/Pause">
      <div class="playHover">
        <Icon icon={faPlay} class="controlIcon" />
      </div>
    </div>
  </div>
{/if}

{#if visible}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 100, duration: 400 }}>
    <div class="controls">
      <div
        class="controlButton buttonDisabled"
        on:click={play}
        title="Play/Pause">
        <Icon icon={playPauseButton} class="controlIcon" />
      </div>
    </div>
    <span on:click={play}>PLAY</span>
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
      <sl-range min="-120" max="120" value="0" step="5" class="range-with-custom-formatter" use:initSlider></sl-range>
    {/if}
  </div>
{/if}
