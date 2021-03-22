<script>
import Icon from "fa-svelte";
import { faGithubSquare } from "@fortawesome/free-brands-svg-icons/faGithubSquare";
import { fly } from "svelte/transition";
import LastUpdated from "./LastUpdated.svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { capDescription, satelliteLayer, showForecastPlaybutton, zoomlevel } from "../stores";

let s3Disabled = false;
let e;
zoomlevel.subscribe((z) => {
  if (z > 12) {
    satelliteLayer.set("sentinel2");
    if (e) e.checked = true;
    s3Disabled = true;
  } else {
    s3Disabled = false;
  }
});

function selectS2() {
  satelliteLayer.set("sentinel2");
  if (e) e.checked = true;
}

function selectS3() {
  satelliteLayer.set("sentinel3");
  if (e) e.checked = false;
}

function slider(elem) {
  e = elem;
  // elem.tooltipFormatter = (value) => `${value.toString()
  //  .padStart(2, 0)}:00`;
  /// / XXX fix dependency fuckup
  // elem.addEventListener("sl-change", (value) => window.weatherSliderChanged(value.target.value));
  elem.addEventListener("sl-change", (event) => {
    const satellite = event.target.checked ? "sentinel2" : "sentinel3";
    if (event.target.checked) {
      satelliteLayer.set(satellite);
    } else {
      satelliteLayer.set(satellite);
    }
  });
}

let description;
capDescription.subscribe((desc) => {
  description = desc;
});

let bottomToolbarVisible = true;
showForecastPlaybutton.subscribe((val) => {
  bottomToolbarVisible = val;
});
</script>

<style>
  :global(.bottomToolbar) {
    position: absolute;
    bottom: 0;
    left: 0;
    border-top-left-radius: 11px;
    border-top-right-radius: 11px;
    border-top: 1px solid var(--sl-color-gray-50);
    width: 100%;
    background-color: var(--sl-color-white);
  }

  .lastUpdatedBottom {
    height: 42px;
    bottom: env(safe-area-inset-bottom);
    z-index: 99;
    padding-top: 0.2em;
    padding-bottom: 0.2em;
  }

  .parentz {
    display: flex;
  }

  .left {
    height: 28px;
    text-align: center;
    float: left;
    cursor: pointer;
    text-decoration: underline;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
  }

  .right {
    height: 100%;
    text-align: right;
    white-space: nowrap;
    padding: 0;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
  }
  @media only screen and (max-width: 600px) {
    .app-logos {
      display: none;
    }
  }

  .center {
    flex: auto;
    padding: 0.5em;
    font-size: 9pt;
    position: relative;
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 90%;
    text-align: center;
  }

  :global(.githubIcon) {
    font-size: 33.6px;
    text-shadow: 3px 3px 0 #ffffff, -1px -1px 0 #ffffff, 1px -1px 0 #ffffff,
      -1px 1px 0 #ffffff, 1px 1px 0 #ffffff;
    color: var(--sl-color-info-700) !important;
    padding: 0;
    border-radius: 0;
    margin: 6.5px 0.2em 0 0;
    vertical-align: top;
  }

  .appstoreLogo {
    padding-left: 0px;
    display: inline;
  }

  .appstore-logo{
    margin-top: 8px;
    margin-left: 3px;
    height: 30px;
  }

  .sentinel-label {
    color: var(--sl-color-black);
  }
  .sentinel-label.pad {
    margin-right: 0.5em;
  }
  .sentinel-label > .resolution {
    font-size: 60%;
    opacity: 0.7;
  }

  .switch { }
</style>

<div
  class="bottomToolbar lastUpdatedBottom"
  transition:fly={{ y: 100, duration: 200 }}>
  <div class="parentz">
    <div class="left">
      <!-- empty -->
    </div>
    <div class="center">
      <!--sl-tag
        type="info"
        class="tag"
        size="medium"
        pill>
        ICON 12Z Run 10. Feb
      </sl-tag>
        <sl-tag
                type="info"
                class="tag"
                size="medium"
                pill>
      <sl-range min="0" max="24" value="{roundToHour(new Date())}" step="1" class="range-with-custom-formatter" use:slider></sl-range>
      </sl-tag-->
      {#if bottomToolbarVisible}
      <LastUpdated />
      {:else}
        <sl-tag size="medium" type="info">
          <span class="sentinel-label pad" on:click={selectS3}><span class="resolution">300m/2x day</span> Sentinel-3</span> <sl-switch class="switch" checked="true" use:slider disabled={s3Disabled}></sl-switch> <span class="sentinel-label" on:click={selectS2}>Sentinel-2 <span class="resolution">10m/5 days</span></span>
        </sl-tag>
      {/if}

    </div>
    {#if !dd.isApp()}
      <div class="right">
        <div class="app-logos">
          <div class="appstoreLogo">
            <a
                    target="_blank"
                    href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
            ><img
                    src="assets/ios-app-store.png"
                    alt="ios app store link"
                    class="appstore-logo"
            /></a>
          </div>
          <div class="appstoreLogo">
            <a
                    target="_blank"
                    href="https://play.google.com/store/apps/details?id=com.meteocool"
            ><img
                    class="appstore-logo"
                    alt="google play app store"
                    src="assets/google-play-store.png"
            /></a>
          </div>
          <div class="appstoreLogo">
            <a target="_blank" href="https://github.com/meteocool/core#meteocool"
            ><Icon icon={faGithubSquare} class="githubIcon" /></a>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
