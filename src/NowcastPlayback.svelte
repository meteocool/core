<script>
    import Icon from 'fa-svelte'
    import { Timeline } from "vis-timeline";
    import {DataSet} from "vis-timeline/standalone";
    import {showTimeSlider} from "./stores"
    import {faPlay} from '@fortawesome/free-solid-svg-icons/faPlay'
    import {faPause} from '@fortawesome/free-solid-svg-icons/faPause'
    import {faUndoAlt} from '@fortawesome/free-solid-svg-icons/faUndoAlt'
    import {faArrowsAltH} from '@fortawesome/free-solid-svg-icons/faArrowsAltH';
    import {faGithubSquare} from '@fortawesome/free-brands-svg-icons/faGithubSquare';
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
    let historicLayers = [];
    let historicLayersObj;

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
        } else {
          console.log(historicLayersObj);
          console.log(lastSliderTime);
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
      nowcast.addObserver(updateSliderNowcast);
      nowcast.addObserver(updateSliderHistoric);
      target = document.getElementById("timesliderTarget");
    }

    function renderIcon(el) {
      iconHTML = el.innerHTML;
    }

</script>

<style>
    .githubIcon {
       font-size: 30px;
    }

    .bottomToolbar {
      position: absolute;
      bottom: 0;
      left: 0;
      background-color: white;
      border-top-left-radius: 11px;
      border-top-right-radius: 11px;
      border-top: 1px solid lightgray;
      width: 100%;
    }

    .timeslider {
        height: 10%;
        min-height: 100px;
        z-index: 999;
    }

    .lastUpdatedBottom {
      min-height: 15px;
      z-index: 99;
      padding-top: 0.2em;
      padding-bottom: 0.2em;
    }

    .parentz {
      column-count: 2;
      column-gap: 50%;
    }

    .left{
      transform: translateY(50%);
    }
    .right{
      height: 100%;
      text-align: right;
    }

    .parent {
      display: flex;
      flex-direction: column;
      justify-content: center;
      justify-content: center;
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


    /* vis.js timeline styling */
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

    .appstoreLogo {
      margin-left: 0.1em;
      padding-left: 0px;
      display: inline;
    }

    @media only screen and (max-width: 600px) {
        .right {
          display: none;
        }
    }
</style>

<span use:renderIcon><Icon icon={faArrowsAltH}></Icon></span>

<div class="bottomToolbar lastUpdatedBottom" transition:fly="{{ y: 100, duration: 200 }}">
  <div class="parentz">
    <div class="section">
      <div class="left">
        <div on:click={show} style="height: 28px; width: 28px; text-align: center; float: left; cursor: pointer; text-decoration: underline;">
          <Icon icon={faPlay}></Icon>
        </div>
        <div on:click={show} style="padding-left: 1%; cursor: pointer;">
          <div>Play...</div>
        </div>
      </div>
      <div class="right">
        <div class="appstoreLogo"><a target="_blank" href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"><img src="assets/ios-app-store.png" alt="ios app store link" class="appstore-logo" style="height: 30px;"></a></div>
        <div class="appstoreLogo"><a target="_blank" href="https://play.google.com/store/apps/details?id=com.meteocool"><img class="appstore-logo" alt="google play app store" src="assets/google-play-store.png" style="height: 30px;"></a></div>
        <div class="appstoreLogo"><a target="_blank" href="https://github.com/meteocool/core"><Icon icon={faGithubSquare} class="githubIcon"></Icon></a></div>
      </div>
    </div>
  </div>

</div>

{#if visible}
  <div class="bottomToolbar timeslider" id="timeslider" use:init transition:fly="{{ y: 100, duration: 400 }}">
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
