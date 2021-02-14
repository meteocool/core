<script>
  import Icon from 'fa-svelte';
  import { capTimeIndicator, showTimeSlider } from './stores';
  import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
  import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
  import { faArrowsAltH } from '@fortawesome/free-solid-svg-icons/faArrowsAltH';
  import { faTimesCircle } from '@fortawesome/free-solid-svg-icons/faTimesCircle';
  import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
  import { fly } from 'svelte/transition';
  import { reportToast } from './lib/Toast';
  import { _ } from 'svelte-i18n';
  import StateMachine from 'javascript-state-machine';
  import { onMount } from 'svelte';
  import LastUpdated from './components/LastUpdated.svelte';
  import {format} from 'date-fns';

  export let cap;
  export let device;

  let open = false; // Drawer open/closed. Displays open button if false
  let warned = false; // True if user has been warned about forecast != measurement
  let loadingIndicator = true; // If true, show loading indicator instead of slider
  let oldTimeStep = 0;

  let playPauseButton = faPlay;
  let uiMessage = $_('downloading_nowcast');
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

  onMount(async () => {
    cap.addObserver((subject, data) => {
      console.log(`observed ${subject}`);
      if (subject === 'historic') {
        historicLayers = data.sources;
      }
      if (subject === 'nowcast') {
        nowcastLayers = data.sources;
      }
      if (nowcastLayers && historicLayers) {
        fsm.showScrollbar();
      }
    });
    cap.addObserver((event) => {
      if (event === 'loseFocus') {
        console.log('radar lost focus');
        hide();
      }
    });
  });

  let fsm = new StateMachine({
    init: 'followLatest',
    transitions: [
      {
        name: 'showScrollbar',
        from: 'followLatest',
        to: 'manualScrolling'
      },
      {
        name: 'showScrollbar',
        from: 'waitingForServer',
        to: 'manualScrolling'
      },
      {
        name: 'waitForServer',
        from: 'followLatest',
        to: 'waitingForServer'
      },
      {
        name: 'pressPlay',
        from: 'manualScrolling',
        to: 'playing'
      },
      {
        name: 'pressPause',
        from: 'playing',
        to: 'manualScrolling'
      },
      {
        name: 'hideScrollbar',
        from: '*',
        to: 'followLatest'
      },
    ],
    methods: {
      onWaitForServer: (param) => {
        console.log('FSM ===== waiting for server');
        loadingIndicator = true;
        setTimeout(() => showTimeSlider.set(true), 200);
        //cssGetclass(".sl-toast-stack").style.bottom = "calc(env(safe-area-inset-bottom) + 98px)";
        open = true;
        cap.downloadHistoric();
        cap.downloadNowcast();
      },
      onShowScrollbar: (transition) => {
        console.log('FSM ===== waiting for server');
        loadingIndicator = false;
        oldUrls = cap.source.getUrls();
        if (slRange) slRange.value = 0;
        document.documentElement.style.setProperty('--toast-stack-offset', '100px');
      },
      onPressPlay: (transition) => {
        let playTick = () => {
          if (slRange.value >= 120) {
            slRange.value = includeHistoric ? -120 : 0;
          } else {
            slRange.value = slRange.value + 5;
          }
          capTimeIndicator.set(format(new Date((cap.getUpstreamTime() + slRange.value*60)*1000), "⏱ HH:mm, dd MMM"));
          sliderChangedHandler(slRange.value);
          if (slRange.value !== 0 || loop) {
            playTimeout = window.setTimeout(playTick, 500);
          } else {
            playTimeout = 0;
            fsm.pressPause();
          }
        };
        playTick();
        playPauseButton = faPause;
      },
      onPressPause: (transition) => {
        if (playTimeout !== 0) window.clearTimeout(playTimeout);
        playTimeout = 0;
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
    elem.tooltipFormatter = value => {
      if (value === 0) {
        return 'Latest Radar Image';
      }
      return `${value.toString()[0] !== '-' ? '+' : ''}${value.toString()}m`;
    };
    elem.addEventListener('sl-change', (value) => sliderChangedHandler(value.target.value));
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
      if (value > 0) {
        cap.source.setUrl(nowcastLayers[value].url);
        warnNotMostRecent();
      } else {
        cap.source.setUrl(historicLayers[value].url);
      }
    }
    oldTimeStep = value;
  }

  function warnNotMostRecent() {
    if (!warned) {
      reportToast($_('forcastPlaying'));
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

  function toggleLoop(el) {
    loop = !loop;
    historicActive = loop;
    if (!historicActive) includeHistoric = false;
  }

  function toggleHistoric(el) {
    includeHistoric = !includeHistoric;
  }
</script>

<style>
  .timeslider {
    height: 90px;
    z-index: 999999;
    padding-top: 5px;
  }

  @media (orientation: portrait) {
    .timeslider {
      height: 180px;
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

  .flexbox {
    display: flex;
    flex-wrap: wrap;
  }

  .gap {
    gap: 30px;
  }

  .flexbox > .slider {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 85%;
    padding-left: 2%;
    /*background-color: green;*/
  }

  .flexbox > .model {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 12%;
    padding-right: 1%;
    padding-left: 1%;
    /*background-color: red;*/
  }

  .flexbox > .buttons {
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
    min-width: 30px;
    /*background-color: yellow;*/
  }
  .flexbox > .checkbox {
      /* background-color: blue; */
  }

  :global(:global) {
    --track-height: 12px;
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
              {$_("last_radar")} then and then
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="flexbox">
        <div class="buttons">
          <div class="controlButton" on:click={playPause} title="Play/Pause">
            <Icon icon={playPauseButton} class="controlIcon" />
          </div>
          <div class="controlButton" on:click={hide} title="Close">
            <Icon icon={faTimesCircle} class="controlIcon" />
          </div>
        </div>
        <div class="slider">
          <sl-range style="width: 98%;" min="-120" max="120" value="0" step="5" class="range-with-custom-formatter" use:initSlider></sl-range>
          <div class="flexbox gap">
            <div class="checkbox">
              <div class="button-group-toolbar">
                <sl-button-group label="History">
                  <sl-tooltip content="Automatically Loop Playback">
                    <sl-button size="small" type="{loop ? 'primary' : 'default'}" on:click={toggleLoop} >🔁 Loop️</sl-button>
                  </sl-tooltip>
                  <sl-tooltip content="Include Last 2 Hours in Playback Loop">
                    <sl-button size="small" type="{includeHistoric ? 'primary' : 'default'}" disabled="{!historicActive}" on:click={toggleHistoric}><Icon icon={faHistory} />  Historic</sl-button>
                  </sl-tooltip>
                </sl-button-group>
              </div>
            </div>
            {#if device !== "ios"}
              <div class="checkbox">
                <div class="button-group-toolbar">
                  <sl-button-group label="History">
                    <sl-tooltip content="Show Lightning Strikes (if any)">
                      <sl-button size="small" type="primary">⚡ Lightning Strikes</sl-button>
                    </sl-tooltip>
                    <sl-tooltip content="Show Mesocyclones (if any)">
                      <sl-button size="small" type="primary">🌀 Mesocyclones</sl-button>
                    </sl-tooltip>
                  </sl-button-group>
                </div>
              </div>
            {/if}
            {#if false}
              <div class="checkbox">
                <sl-select size="small">
                  <sl-menu-item value="option-1" checked selected>DWD</sl-menu-item>
                  <sl-menu-item value="option-2">Rainymotion</sl-menu-item>
                </sl-select>
              </div>
            {/if}
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

