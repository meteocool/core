<script>
    import Icon from 'fa-svelte'
    import { Timeline } from "vis-timeline";
    import {DataSet} from "vis-timeline/standalone";
    import {colorSchemeLight, showTimeSlider} from "./stores"
    import {faPlay} from '@fortawesome/free-solid-svg-icons/faPlay'
    import {faPause} from '@fortawesome/free-solid-svg-icons/faPause'
    import {faArrowsAltH} from '@fortawesome/free-solid-svg-icons/faArrowsAltH';
    import { fly } from 'svelte/transition';
    import {reportToast} from "./lib/Toast";
    import { cssGetclass } from './lib/css';
    import { _ } from 'svelte-i18n';

    export let nowcast;
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
    let uiMessage = "Downloading Nowcast";
    let iconHTML;
    let baseTime;
    let warned = false;
    let historicLayers = [];
    let historicLayersObj;
    let colorSchemeLightLocal = true;

    // XXX refactor with fsm

    function show() {
      if (visible) {
        hide();
        return;
      }
      visible = true;
      setTimeout(() => {
        showTimeSlider.set(true);
        nowcast.downloadNowcast();
      }, 200);
      cssGetclass(".sl-toast-stack").style.bottom="calc(env(safe-area-inset-bottom) + 90px)";
    }

    function hide() {
      visible = false;
      setTimeout(() => {
        showTimeSlider.set(false);
      }, 200);
      cssGetclass(".sl-toast-stack").style.bottom="calc(env(safe-area-inset-bottom) + 42px)";
    }

    function reset() {
      if (!lastSliderTime) return;
      timeline.removeCustomTime("playbackMarker");
      cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
      cap.getMap().addLayer(nowcast.mainLayer);
      setTimeSlider(timeline);
      lastSliderTime = undefined;
      warned = false;
    }

    function updateSliderHistoric(subject, body) {
      if (subject !== "historic") {
        return;
      }
      return;
      historicLayers = [];
      historicLayersObj = body.layers;
      Object.entries(body.layers).forEach((entry, i) => {
        const [absTime, layer] = entry;
        if (i < 1000) {
          historicLayers.push({
            id: 10000 + i,
            type: "background",
            start: new Date(absTime * 1000),
            end: new Date((absTime + 5 * 60) * 1000),
            style : "background: #00ff00;",
          });
        }
      })
    }

    function updateSliderNowcast(subject, body) {
      if (subject !== "update") {
        return;
      }

      if (!body.complete) {
        uiMessage = $_('processing_nowcast');
        return;
      }

      let vals = Object.values(body.layers);
      let datasetItems = vals.map((val, i) => ({
        id: i,
        start: new Date((val.absTime)*1000),
        end: new Date((val.absTime+5*60)*1000),
        //style : i%2 == 0 ? "background: #eeffee;" : "background: #ddffdd;",
        style : "background: #33508A;",
      }));
      datasetItems.push({"id": 998, "type": "point", "content": "Published", "start": new Date((body.processedTime)*1000)});
      datasetItems.push({"id": 999, "type": "point", "content": "Acquired", "start": new Date((body.baseTime)*1000)});
      let items = new DataSet(datasetItems.concat(historicLayers));
      baseTime = body.baseTime;

      // Configuration for the Timeline
      const options = {
        min: new Date((vals[0].absTime-12*60*60)*1000),
        max: new Date((vals[vals.length-1].absTime+60*60)*1000),
        zoomFriction: 20,
        horizontalScroll: true,
        zoomKey: 'ctrlKey',
        height: Math.max(parseInt(window.innerHeight*0.1), 100),
        selectable: false,
        type: "background",
        margin: {axis:0,item:{horizontal:0,vertical:-5}},
      };

      loadingIndicator = false;

      // Create a Timeline
      timeline = new Timeline(target, items, options);
      setTimeSlider(timeline);
      Array.prototype.forEach.call(document.getElementsByClassName("controlButton"), (button) => button.classList.remove("buttonDisabled"));
    }

    function timeChangeHandler(properties) {
      if (!lastSliderTime) {
        timeline.setCustomTimeMarker("↔", "playbackMarker");
        cap.getMap().removeLayer(nowcast.mainLayer);
        warnNotMostRecent();
      }

      const newSliderTime = Math.floor(properties.time.getTime() / 1000);
      if (newSliderTime != lastSliderTime) {
        lastSliderTime = newSliderTime;
        const index = Object.values(nowcast.forecastLayers).map((item) => (item.absTime)).findIndex(t => t === lastSliderTime);
        if (index >= 0) {
          cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
          cap.getMap().addLayer(nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[index]].layer);
        } else {
          if (lastSliderTime.toString() in historicLayersObj) {
            cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
            cap.getMap().addLayer(historicLayersObj[lastSliderTime].layer);
          }
        }
        if (newSliderTime === baseTime) {
          document.getElementById("backButton").classList.add("buttonInactive");
        } else {
          document.getElementById("backButton").classList.remove("buttonInactive");
        }
      }
    }

    function setTimeSlider(timeline) {
      timeline.addCustomTime(new Date((nowcast.forecastLayers["0"].absTime)*1000), "playbackMarker");
      timeline.setCustomTimeMarker("Tracking Most Recent", "playbackMarker");
      timeline.on('timechange', timeChangeHandler);
      document.getElementById("backButton").classList.add("buttonInactive");
    }

    function warnNotMostRecent() {
      if (!warned) {
        reportToast("You are now viewing forecasted data.\nTo go back to the most recent radar observation, reset ↺ the timeline.");
        warned = true;
      }
    }

    function play() {
      if (playing) {
        window.clearTimeout(self.activeForecastTimeout);
        self.activeForecastTimeout = 0;
        playPauseButton = faPlay;
        playing = false;
        timeline.setCustomTimeMarker("↔", "playbackMarker");
        timeline.on('timechange', timeChangeHandler);
        warnNotMostRecent();
      } else {
        playing = true;
        playPauseButton = faPause;
        timeline.on('timechange', () => {});
        playTick();
      }
    }

    function playTick() {
      if (!nowcast.downloaded) {
        console.log('not all forecasts downloaded yet');
        return;
      }

      if (currentForecastID === Object.keys(nowcast.forecastLayers).length - 1) {
        // we're past the last downloaded layer, so end the play
        cap.getMap().addLayer(nowcast.mainLayer);
        cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
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
      } else {
        // remove previous layer
        cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
      }
      currentForecastID++;
      cap.getMap().addLayer(nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].layer);
      timeline.addCustomTime(new Date((nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].absTime)*1000), "playbackMarker");
      timeline.setCustomTimeMarker("↔", "playbackMarker");
      self.activeForecastTimeout = window.setTimeout(() => { playTick(); }, 600);
    }

    function init(node) {
      nowcast.addObserver(updateSliderNowcast);
      nowcast.addObserver(updateSliderHistoric);
      // close playback when switching to another layer, save some memory
      cap.addObserver((event) => {if (event === "loseFocus") {
        console.log("radar lost focus");
        reset();
        hide();
      }});
      target = document.getElementById("timesliderTarget");
    }

    function renderIcon(el) {
      iconHTML = el.innerHTML;
    }

    colorSchemeLight.subscribe(value => {colorSchemeLightLocal = value; console.log("Test2: " + colorSchemeLightLocal);});
</script>

<style>
    /* deduplicate with bottomtoolbar.svelte XXX */
    .bottomToolbar {
      position: absolute;
      bottom: 0;
      left: 0;
      border-top-left-radius: 11px;
      border-top-right-radius: 11px;
      border-top: 1px solid lightgray;
      width: 100%;
    }

    .bottomToolbar.lightScheme {
      background-color: white;
    }

    .bottomToolbar.darkScheme {
      background-color: rgb(63, 63, 63);
    }

    .timeslider {
        height: 10%;
        min-height: 100px;
        z-index: 999999;
        display: none;
    }

    @media (orientation: portrait) {
      .timeslider {
        height: 80%;
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
      display:flex;
      flex-direction:column;
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
      flex:1 1 auto;
      text-align:center;
      margin: 0.25em;
      cursor: pointer;
    }

    .controlButton.lightScheme{
      color:black;
    }
    .controlButton.darkScheme{
      color:white;
    }

    .controlButton:hover {
      cursor: pointer;
    }

    .controlButton.lightScheme:hover{
      background-color: black;
      border: 1px solid black;
      color: white;
    }
    .controlButton.darkScheme:hover{
      background-color: white;
      border: 1px solid white;
      color: black;
    }

    .buttonDisabled {
      cursor: not-allowed !important;
      background-color: #eeeeee !important;
      border: 1px solid #AAAAAA !important;
      color: #666666 !important;
    }

    .buttonInactive {
      opacity: 0.5;
    }

    #timesliderTarget {
      width: 100%;
      position: static !important;
    }

    /* vis.js timeline styling */
    :global(.vis-custom-time) > :global(.vis-custom-time-marker) {
      top: unset;
      bottom: 0;
      transform:translateX(-47%);
    }

    :global(.vis-custom-time) > :global(.vis-custom-time-marker):before {
      content: " ";
    }

    :global(.vis-group) {
      background: repeating-linear-gradient(
              45deg,
              #F0D1DF,
              #F0D1DF 10px,
              #CD7482 10px,
              #CD7482 20px
      );
    }

    :global(.vis-item-content) {
      color: white;
      font-size: 85%;
    }

    div :global(.githubIcon) {
      font-size: 32px;
      text-shadow:
              3px 3px 0 #ffffff,
              -1px -1px 0 #ffffff,
              1px -1px 0 #ffffff,
              -1px 1px 0 #ffffff,
              1px 1px 0 #ffffff;
      color: black !important;
      padding: 0;
      margin: 6px 0.2em 0 0;
    }
</style>

<span use:renderIcon><Icon icon={faArrowsAltH}></Icon></span>

<div on:click={show} style="position: absolute; bottom: calc(-0.2em + env(safe-area-inset-bottom)); left: 0.3em; z-index: 999999;">
  <div class="{colorSchemeLightLocal ? 'controlButton lightScheme' : 'controlButton darkScheme'}" title="Play/Pause">
    <div class="playHover">
      <Icon icon={faPlay} class="controlIcon"></Icon>
    </div>
    <!--div class="playLabel">
      <div style="text-decoration: inherit; margin-top: -1.6em; float: left; font-size: 1.2rem; height: 2.5rem;">Load &amp; Play</div>
      <div style="text-decoration: inherit; margin-top: -1.5em; float: left; clear:both; font-size: 0.7rem; height: 2.5rem;">Radar Nowcast...</div>
    </div-->
  </div>
</div>

{#if visible}
  <div class="{colorSchemeLightLocal ? 'bottomToolbar lightScheme' : 'bottomToolbar darkScheme'} timeslider" use:init transition:fly="{{ y: 100, duration: 400 }}">
    <div class="controls">
      <div class="{colorSchemeLightLocal ? 'controlButton lightScheme' : 'controlButton darkScheme'} buttonDisabled" on:click={play} title="Play/Pause">
        <Icon icon={playPauseButton} class="controlIcon"></Icon>
      </div>
    </div>
    {#if loadingIndicator}
      <div class="parent" id="loadingIndicator">
        <div style="display: inline-block; transform: translateY(66%);">
          <sl-spinner style="font-size: 2.5rem; float: left;"></sl-spinner>
          <div style="display: inline-block;">
            <div style="margin-top: -0.3em; opacity: 0.6; float: left; font-size: 1.5rem; margin-left: 1.5rem; height: 2.5rem; white-space: nowrap; vertical-align: text-top;">{uiMessage}...</div>
            <div style="margin-top: -0.7em; opacity: 0.6; float: left; clear:both; font-size: 0.9rem; margin-left: 1.5rem; height: 2.5rem; white-space: nowrap; vertical-align: text-top;">{$_('last_radar')} then and then</div>
          </div>
        </div>
      </div>
    {/if}
    <div id="timesliderTarget"></div>
  </div>
{/if}
