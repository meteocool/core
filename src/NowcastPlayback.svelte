<script>
    import Icon from 'fa-svelte'
    import { Timeline } from "vis-timeline";
    import {DataSet} from "vis-timeline/standalone";
    import {showTimeSlider} from "./stores"
    import {faPlay} from '@fortawesome/free-solid-svg-icons/faPlay'
    import {faPause} from '@fortawesome/free-solid-svg-icons/faPause'
    import {faUndoAlt} from '@fortawesome/free-solid-svg-icons/faUndoAlt'
    import {faArrowsAltH} from '@fortawesome/free-solid-svg-icons/faArrowsAltH';
    import { fly } from 'svelte/transition';
    import {reportToast} from "./lib/Toast";

    export let nowcast;
    export let cap;
    let target;
    let loadingIndicator = true;
    let playPaused = true;
    let currentForecastID = -1;
    let timeline;
    let playbackMarkerID;
    let playPauseButton = faPlay;
    let playing = false;
    let activeForecastTimeout;
    let lastSliderTime;
    let visible = false;
    let uiMessage = "Downloading Nowcast";
    let iconHTML;
    let baseTime;
    let warned = false;

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
    }

    function hide() {
      visible = false;
      setTimeout(() => {
        showTimeSlider.set(false);
      }, 200);
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

    function updateSlider(subject, body) {
      if (subject !== "update") {
        return;
      }

      if (!body.complete) {
        uiMessage = "Processing Nowcast";
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
      datasetItems.push({"id": 98, "type": "point", "content": "Published", "start": new Date((body.processedTime)*1000)});
      datasetItems.push({"id": 99, "type": "point", "content": "Acquired", "start": new Date((body.baseTime)*1000)});
      let items = new DataSet(datasetItems);
      baseTime = body.baseTime;

      // Configuration for the Timeline
      const options = {
        min: new Date((vals[0].absTime-60*60)*1000),
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
        cap.getMap().removeLayer(nowcast.mainLayer);
        if (!warned) {
          reportToast("You are now viewing forecasted data. To go back to measured radar data, close or reset the timeline.");
          warned = true;
        }
      }

      const newSliderTime = Math.floor(properties.time.getTime() / 1000);
      if (newSliderTime != lastSliderTime) {
        lastSliderTime = newSliderTime;
        const index = Object.values(nowcast.forecastLayers).map((item) => (item.absTime)).findIndex(t => t === lastSliderTime);
        if (index >= 0) {
          cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
          cap.getMap().addLayer(nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[index]].layer);
        }
        if (newSliderTime === baseTime) {
          document.getElementById("backButton").classList.add("buttonInactive");
        } else {
          document.getElementById("backButton").classList.remove("buttonInactive");
        }
      }
    }

    function setTimeSlider(timeline) {
      playbackMarkerID = timeline.addCustomTime(new Date((nowcast.forecastLayers["0"].absTime)*1000), "playbackMarker");
      timeline.setCustomTimeMarker("", "playbackMarker");
      timeline.on('timechange', timeChangeHandler);
      document.getElementById("backButton").classList.add("buttonInactive");
    }


    function play() {
      if (playing) {
        window.clearTimeout(activeForecastTimeout);
        playPauseButton = faPlay;
      } else {
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
      playbackMarkerID = timeline.addCustomTime(new Date((nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].absTime)*1000), "playbackMarker");
      activeForecastTimeout = window.setTimeout(() => { playTick(); }, 600);
    }

    function init(node) {
      nowcast.addObserver(updateSlider);
      target = document.getElementById("timesliderTarget");
    }

    function renderIcon(el) {
      iconHTML = el.innerHTML;
    }

</script>

<style>
    .timeslider {
        position: absolute;
        z-index: 99999;
        bottom: 0;
        left: 0;
        height: 10%;
        width: 100%;
        background-color: white;
        border-top-left-radius: 11px;
        border-top-right-radius: 11px;
        min-height: 100px;
        border-top: 1px solid lightgray;
    }

    .parent {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: 100%;
      justify-content: center;
      align-items: center;
    }

    /* XXX deduplicate */
    .lsToggle {
      width: 74px;
      height: 74px;
      background-color: #f8f9fa;
      border: 3px solid #333333;
      border-radius: 40px;
      position: absolute;
      top: 1vh;
      right: 1vh;
      text-align: center;
      vertical-align: center;
    }

    .lsToggle:hover {
      background-color: #666666;
      color: white;
      cursor: pointer;
    }

    div :global(.lsIcon) {
      font-size: 40px;
      position: absolute;
      top: 50%;
      left: 50%;
      -ms-transform: translate(-50%, -50%);
      transform: translate(-50%, -50%);
      stroke: white;
    }

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
    }

    .controlButton:hover {
      background-color: #333333;
      border: 1px solid #333333;
      color: white;
      cursor: pointer;
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

    :global(.vis-custom-time) > :global(.vis-custom-time-marker) {
      top: unset;
      bottom: 0;
      transform:translateX(-47%);
    }

    :global(.vis-custom-time) > :global(.vis-custom-time-marker):before {
      content: "↔︎";
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
</style>

<span use:renderIcon><Icon icon={faArrowsAltH}></Icon></span>

{#if document.currentScript.getAttribute('device') !== 'ios'}
  <div class="lsToggle" on:click={show} style="top: calc(1vh + 74px + 1vh + 6px);">
    <Icon icon={faPlay} class="lsIcon"></Icon>
  </div>
{/if}

{#if visible}
  <div class="timeslider" id="timeslider" use:init transition:fly="{{ y: 100, duration: 400 }}">
    <div class="controls">
      <div class="controlButton buttonDisabled" on:click={play} title="Play/Pause">
        <Icon icon={playPauseButton} class="controlIcon"></Icon>
      </div>
      <div class="controlButton buttonDisabled buttonInactive" on:click={reset} title="Go Back To Current Radar" id="backButton">
        <Icon icon={faUndoAlt} class="controlIcon"></Icon>
      </div>
    </div>
    {#if loadingIndicator}
    <div class="parent" id="loadingIndicator">
      <div style="display: inline-block;">
        <sl-spinner style="font-size: 2.5rem; float: left;"></sl-spinner>
        <div style="opacity: 0.6; float: left; font-size: 1.5rem; margin-left: 1.5rem; height: 2.5rem; line-height: 2.5rem; white-space: nowrap;">{uiMessage}...</div>
      </div>
    </div>
    {/if}
    <div id="timesliderTarget"></div>
  </div>
{/if}
