<script>
import { fly } from "svelte/transition";
import LastUpdated from "./LastUpdated.svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import {
  capDescription,
  satelliteLayer,
  sharedActiveCap,
  bottomToolbarMode,
  zoomlevel,
  satelliteLayerCloudy, satelliteLayerLabels,
} from "../stores";
import { precipTypeNames } from "../lib/cmaps";
import StepScaleLine from "./scales/StepScaleLine.svelte";
import Appendix from "./Appendix.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';

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

function cloudmask(elem) {
  elem.addEventListener("sl-change", (event) => {
    satelliteLayerCloudy.set(!get(satelliteLayerCloudy));
  });
}

function labelsBorders(elem) {
  elem.addEventListener("sl-change", (event) => {
    satelliteLayerLabels.set(event.target.checked);
  });
}

function sentinel2(elem) {
  elem.addEventListener("sl-change", (event) => {
    const satellite = event.target.checked ? "sentinel2" : "sentinel3";
    satelliteLayer.set(satellite);
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

  .float {
    display: inline-block;
    margin-right: 2em;
    margin-top: 0.5em;
    margin-bottom: 1.5em;
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
          <StepScaleLine steps="{precipTypeNames}" valueFormat={$_} />
        </div>
      {/if}
    <div class="break"></div>
    <div class="center">
      {#if (activeCap === "radar" || activeCap === "precipTypes") && $bottomToolbarMode === "collapsed" }
          <LastUpdated />
      {/if}
      {#if activeCap === "satellite"}
        <div class="float">
          <sl-checkbox checked="true" use:sentinel2 disabled={s3Disabled}>Sentinel-2</sl-checkbox>
        </div>
        <div class="float">
          <sl-checkbox use:cloudmask disabled="{$satelliteLayer !== 'sentinel2'}">Clouds</sl-checkbox>
        </div>
        <div class="float">
          <sl-checkbox use:labelsBorders checked="true">Labels &amp; Borders</sl-checkbox>
        </div>
      {/if}
    </div>
    {#if !dd.isApp()}
      <div class="right app-logos">
        <Appendix />
      </div>
    {/if}
  </div>
</div>
