<script>
import { fly } from "svelte/transition";
import LastUpdated from "./LastUpdated.svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { capDescription, satelliteLayer, sharedActiveCap, bottomToolbarMode, zoomlevel } from "../stores";
import { precipTypeNames } from "../lib/cmaps";
import StepScaleLine from "./scales/StepScaleLine.svelte";
import Appendix from "./Appendix.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";

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

let activeCap;
sharedActiveCap.subscribe((val) => {
  activeCap = val;
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

  @media only screen and (max-width: 620px) {
      :global(.bottomToolbar) {
      height: 84px !important;
      padding-top: 0px;
    }
    .break {
      flex-basis: 100%;
      height: 0;
    }
    .left {
      display: none;
    }
    .palette {
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
  }

  .lastUpdatedBottom {
    height: 42px;
    bottom: env(safe-area-inset-bottom);
    z-index: 4;
    padding-top: 0.2em;
    padding-bottom: 0.2em;
  }

  .parentz {
    display: flex;
    flex-wrap: wrap;
    padding-top: 0.4em;
    gap: 1px;
  }

  .left {
    height: 28px;
    text-align: center;
    float: left;
    cursor: pointer;
    text-decoration: underline;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 6%;
    min-width: 84px;
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
  @media only screen and (max-width: 650px) {
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
    flex-basis: 2%;
    text-align: center;
    padding-top: 0;
  }

  .palette {
    flex: auto;
    padding: 0.5em;
    padding-top: 0;
    position: relative;
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 50%;
    text-align: center;
    height: 32px;
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
</style>

<div
  class="bottomToolbar lastUpdatedBottom"
  transition:fly={{ y: 100, duration: 200 }}>
  <div class="parentz">
    <div class="left">
      <!-- empty -->
    </div>
      {#if activeCap === "radar" && $bottomToolbarMode === "collapsed"}
        <div class="palette">
          <RadarScaleLine />
        </div>
      {/if}
      {#if activeCap === "precipTypes"}
        <div class="palette">
          <StepScaleLine steps="{precipTypeNames}" />
        </div>
      {/if}
    <div class="break"></div>
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
      {#if (activeCap === "radar" || activeCap === "precipTypes") && $bottomToolbarMode === "collapsed" }
          <LastUpdated />
      {/if}
      {#if activeCap === "satellite"}
        <sl-tag size="medium" type="info">
          <span class="sentinel-label pad" on:click={selectS3}><span class="resolution">300m/2x day</span> Sentinel-3</span> <sl-switch class="switch" checked="true" use:slider disabled={s3Disabled}></sl-switch> <span class="sentinel-label" on:click={selectS2}>Sentinel-2 <span class="resolution">10m/5 days</span></span>
        </sl-tag>
      {/if}
      {#if activeCap === "precipTypes"}
          <!-- needs a legend -->
      {/if}

    </div>
    {#if !dd.isApp()}
      <div class="right app-logos">
        <Appendix />
      </div>
    {/if}
  </div>
</div>
