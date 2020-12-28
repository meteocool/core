<script>
    import Icon from 'fa-svelte'
    import { Timeline } from "vis-timeline";
    import {DataSet} from "vis-timeline/standalone";
    import {uiState} from "./stores"
    import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay'
    import { faPause } from '@fortawesome/free-solid-svg-icons/faPause'
    import { faShareSquare } from '@fortawesome/free-solid-svg-icons/faShareSquare'

    export let nowcast;
    export let cap;
    let target;
    let par;
    let loadingIndicator;
    let playPaused = true;
    let currentForecastID = -1;
    let timeline;
    let playbackMarkerID;
    let playPauseButton = faPlay;

    //uiState.subscribe(obj => {
    //    if (obj.nowcastPlayback == true) {
    //        show();
    //    } else {
    //        hide();
    //    }
    //});

    function show() {
      if (par) par.style.display="block";
      uiState.set("nowcastPlayback", true);
      nowcast.downloadNowcast();
    }

    function hide() {
      if (par) par.style.display="none";
    }

    function updateSlider(subject, body) {
      if (subject !== "update") {
        return;
      }

      loadingIndicator.style.display="none";

      const tzOffset = new Date().getTimezoneOffset()*60;
      let vals = Object.values(body.layers);
      //let datasetItems = []
      let datasetItems = vals.map((val, i) => ({
        "id": i,
        "start": new Date((val.absTime)*1000),
        "end": new Date((val.absTime+5*60)*1000),
      }));
      datasetItems.push({"id": 98, "type": "point", "content": "Radar Published", "start": new Date((body.processedTime)*1000)});
      datasetItems.push({"id": 99, "type": "point", "content": "Radar Acquisition", "start": new Date((body.baseTime)*1000)});
      console.log(datasetItems);
      let items = new DataSet(datasetItems);

      // Configuration for the Timeline
      const options = {
        min: new Date((vals[0].absTime-60*60)*1000),
        max: new Date((vals[vals.length-1].absTime+60*60)*1000),
        //stack: false,
        zoomFriction: 20,
        horizontalScroll: true,
        zoomKey: 'ctrlKey',
        height: Math.max(parseInt(window.innerHeight*0.1), 100),
        selectable: false,
        type: "background",
        margin: {axis:0,item:{horizontal:0,vertical:-5}},
      };

      // Create a Timeline
      timeline = new Timeline(target, items, options);
    }

    window.play = play;

    function play() {
      if (!nowcast.downloaded) {
        console.log('not all forecasts downloaded yet');
        return;
      }

      if (currentForecastID === Object.keys(nowcast.forecastLayers).length - 1) {
        // we're past the last downloaded layer, so end the play
        cap.getMap().addLayer(nowcast.mainLayer);
        cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
        currentForecastID = -1;
        playPaused = false;
        playPauseButton = faPlay;
        if (playbackMarkerID) timeline.removeCustomTime(playbackMarkerID);
        playbackMarkerID = undefined;
        // UI Hooks XXX
        return;
      }

      if (currentForecastID < 0) {
        // play not yet in progress, remove main layer
        cap.getMap().removeLayer(nowcast.mainLayer);
        playPauseButton = faPause;
        // this.hook('scriptHandler', 'playStarted');
        //if (!this.enableIOSHooks) {
        //  $('#forecastTimeWrapper').css('display', 'block');
        //}
      } else {
        // remove previous layer
        if (playbackMarkerID) timeline.removeCustomTime(playbackMarkerID);
        cap.getMap().getLayers().getArray().filter((layer) => layer.get('nowcastLayer')).forEach((layer) => cap.getMap().removeLayer(layer));
      }
      currentForecastID++;
      cap.getMap().addLayer(nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].layer);
      playbackMarkerID = timeline.addCustomTime(new Date((nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].absTime)*1000), "playbackMarker");
      timeline.setCustomTimeMarker(new Date((nowcast.forecastLayers[Object.keys(nowcast.forecastLayers)[currentForecastID]].absTime)*1000), "playbackMarker");

      //if (this.currentForecastNo >= 0) {
      //  const layerTime = (parseInt(this.forecastLayers[this.currentForecastNo].version) + (this.currentForecastNo + 1) * 5 * 60) * 1000;
      //  const dt = new Date(layerTime);
      //  const dtStr = `${(`0${dt.getHours()}`).slice(-2)}:${(`0${dt.getMinutes()}`).slice(-2)}`;
      //  $('.forecastTimeInner').html(dtStr);
      //  this.hook('layerTimeHandler', layerTime);
      //}
      let activeForecastTimeout = window.setTimeout(() => { play(); }, 500);
    }

    function init(node) {
      nowcast.addObserver(updateSlider);
      par = document.getElementById(node.id);
      target = document.getElementById("timesliderTarget");
      loadingIndicator = document.getElementById("loadingIndicator");
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
        display: none;
        min-height: 100px;
        border: 0px;
    }

    .parent {
      float: left;
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

    #timesliderTarget {
      width: 100%;
      position: static !important;
    }

</style>

{#if document.currentScript.getAttribute('device') !== 'ios'}
  <div class="lsToggle" on:click={show} style="top: calc(1vh + 74px + 1vh + 6px);">
    <Icon icon={faPlay} class="lsIcon"></Icon>
  </div>
{/if}

<div class="timeslider" id="timeslider" use:init>
  <div class="controls">
    <div class="controlButton" on:click={play}>
      <Icon icon={playPauseButton} class="controlIcon" on:click={play}></Icon>
    </div>
    <div class="controlButton">
      <Icon icon={faShareSquare} class="controlIcon"></Icon>
    </div>
  </div>
  <div class="parent" id="loadingIndicator">
    <div style="display: inline-block;">
      <sl-spinner style="font-size: 2.5rem; float: left;"></sl-spinner>
      <div style="opacity: 0.6; float: left; font-size: 1.5rem; margin-left: 1.5rem; height: 2.5rem; line-height: 2.5rem; white-space: nowrap;">Nowcast is being processed.</div>
    </div>
  </div>
  <div id="timesliderTarget"></div>
</div>
