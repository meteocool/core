<script lang="ts">
  import { onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
  import { get } from "svelte/store";
  import { _ } from "svelte-i18n";
  import {
    BarController, BarElement, CategoryScale, Chart, LinearScale,
  } from "chart.js";
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
  import StepScaleLine from "./scales/StepScaleLine.svelte";
  import Appendix from "./Appendix.svelte";
  import RadarScaleLine from "./scales/RadarScaleLine.svelte";
  import LightningScaleLine from "./scales/LightningScaleLine.svelte";
  import LightningChart from "./LightningChart.svelte";
  import AerosolScaleLine from "./scales/AerosolScaleLine.svelte";
  import { precipTypeNames } from "../colormaps";

  Chart.defaults.font.size = 10;
  // Chart.js's own grey is unreadable on the dark tray; the token flips with the theme.
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--mc-text-2").trim() || "#666";

  export let layerManager;

  // Assigned when a capability changes; not rendered today.
  let _description: string;

  // This chart is a bar chart. It previously registered the line controller and
  // element -- which it does not use -- and relied on NowcastPlayback having
  // registered the bar ones first, so it only rendered if that component had
  // been constructed already.
  Chart.register(BarController, BarElement, CategoryScale, LinearScale);

  let s3Disabled = false;
  let e;
  /* Handed back in onDestroy: the toolbar is torn down when the URL hides it
     and rebuilt when it comes back. */
  const subscriptions: (() => void)[] = [];
  subscriptions.push(zoomlevel.subscribe((z) => {
    if (z > 12) {
      satelliteLayer.set("sentinel2");
      if (e) e.checked = true;
      s3Disabled = true;
    } else {
      s3Disabled = false;
    }
  }));

  function cloudmask(elem) {
    elem.addEventListener("sl-change", (_event) => {
      satelliteLayerCloudy.set(!get(satelliteLayerCloudy));
    });
  }

  function labelsBorders(elem) {
    elem.addEventListener("sl-change", (event: Event) => {
      satelliteLayerLabels.set((event.target as HTMLInputElement).checked);
    });
  }

  function sentinel2(elem) {
    elem.addEventListener("sl-change", (event: Event) => {
      const satellite = (event.target as HTMLInputElement).checked ? "sentinel2" : "sentinel3";
      satelliteLayer.set(satellite);
    });
  }

  subscriptions.push(capDescription.subscribe((desc) => {
    _description = desc;
  }));

  let activeCap;
  subscriptions.push(sharedActiveCap.subscribe((val) => {
    activeCap = val;
  }));

  /*
   * No tray on the 3D map. It shows one timestep, so there is no player to
   * collapse into this bar, no scale it draws, and no "last updated" line of
   * its own -- which left a full-width strip of glass with a GitHub icon in
   * it, over the part of the map the storms stand on.
   *
   * Before the first capability is attached the store is still empty, so the
   * one that is about to be is asked instead; otherwise a link that opens on
   * the 3D map would show the bar for a frame and then fly it out.
   */
  $: showsBar = (activeCap || layerManager.startingCapability()) !== "cells3d";

  onDestroy(() => subscriptions.forEach((unsubscribe) => unsubscribe()));

</script>

<style>
    /* The tray material, shared with NowcastPlayback's .timeslider: a floating
       glass tray 8px off the edges, 8px above the safe-area inset. The blur
       must sit on this element -- it is the one carrying transition:fly, and a
       blurred child of a fading parent samples a blank backdrop. */
    :global(.bottomToolbar) {
        position: absolute;
        left: var(--mc-gutter);
        right: var(--mc-gutter);
        width: auto;
        bottom: calc(var(--mc-safe-bottom) + var(--mc-tray-gap));
        box-sizing: border-box;
        border: 1px solid var(--mc-glass-edge);
        border-radius: var(--mc-radius-tray);
        background: var(--mc-glass-fill-strong);
        -webkit-backdrop-filter: var(--mc-glass-backdrop);
        backdrop-filter: var(--mc-glass-backdrop);
        box-shadow: var(--mc-glass-ring-lg);
        color: var(--mc-text);
        font-family: var(--mc-font);
    }

    .lastUpdatedBottom {
        bottom: var(--mc-collapsed-bottom);
        height: var(--mc-bar-h);
        z-index: var(--mc-z-tray);
        padding: 0 12px;
    }

    /* NowcastPlayback's play and unfold discs are their own glass controls at
       the gutter, not items in this row, so the tray ends where they begin. */
    .lastUpdatedBottom.has-discs {
        left: calc(var(--mc-gutter) + var(--mc-control) + var(--mc-tray-gap));
        right: calc(var(--mc-gutter) + var(--mc-control) + var(--mc-tray-gap));
    }

    /* Desktop: fully covered by the open player, so release its blur once the
       player has flown in. Map.svelte measures .timeslider in player mode. */
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
        visibility: hidden;
        transition: visibility 0s linear 250ms;
    }

    /* The wrappers get the identical floating tray: the map showing under the
       bar is now the intent, not a strip to swallow. */
    :global(.is-app .bottomToolbar) {
        margin-bottom: 0;
    }

    /* Only a wrap point, and only on a phone. Left in the row on desktop it is a
       zero-width flex item that still collects the gap on both sides, which is
       what made the space between the legend and the status line twice every
       other gap in the row. */
    .break {
        display: none;
    }

    .parentz {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        height: 100%;
        gap: 2px 12px;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;   /* the tray has a fixed height; nothing may spill under its rounded edge */
    }

    .right {
        flex: 0 0 auto;
        height: auto;
        display: flex;
        align-items: center;
        white-space: nowrap;
        padding: 0;
        text-align: right;
    }

    @media only screen and (max-width: 650px) {
        .app-logos {
            display: none;
        }
    }

    .center {
        flex: 0 1 auto;
        min-width: 0;
        position: relative;
        padding: 0;
        font: 500 12px/1.2 var(--mc-font);
        text-align: center;
    }

    .palette {
        flex: 1 1 50%;
        min-width: 0;
        position: relative;
        height: auto;
        padding: 0;
        text-align: center;
    }

    .float {
        display: inline-flex;
        align-items: center;
        margin: 0 16px 0 0;
    }

    /* Phone. Last in the sheet on purpose: these rules share their specificity
       with the base ones above, so declared any earlier they lose to them and
       the whole block goes quietly inert -- which is what had happened to it,
       leaving the collapsed bar unwrapped and its freshness line overflowing. */
    @media only screen and (max-width: 620px) {
        .lastUpdatedBottom {
            padding: 6px 10px;
        }
        .parentz {
            flex-wrap: wrap;
            /* The scale and the "last updated" line are two short rows in a
               bar with a fixed height (shared with NowcastPlayback's flanking
               discs, which centre on it) -- space-between was pinning them to
               the top of that height rather than centring the pair, leaving
               dead air below. */
            align-content: center;
        }
        .palette {
            flex: 1 1 100%;
            height: auto;
            padding: 0 4px;
        }
        .center {
            flex: 1 1 100%;
            display: flex;
            justify-content: center;
            padding: 0;
        }
        .break {
            display: block;
            flex-basis: 100%;
            height: 0;
        }
        .palette {
            margin-left: 0 !important;
            margin-right: 0 !important;
        }
    }
</style>

<!-- Outside the bar, not in it: the strip is its own floating tray above this
     one, and nesting it would put it inside the bar's transition and clip. -->
<LightningChart {layerManager} />

{#if showsBar}
<div
        class="bottomToolbar lastUpdatedBottom"
        class:has-discs={activeCap === "radar" && $bottomToolbarMode === "collapsed"}
        class:player-open={$bottomToolbarMode === "player"}
        transition:fly={{ y: 100, duration: 200 }}
        on:introstart={toolbarTransitionStart}
        on:outrostart={toolbarTransitionStart}
        on:introend={toolbarTransitionEnd}
        on:outroend={toolbarTransitionEnd}>
    <div class="parentz">
        {#if activeCap === "radar" && $bottomToolbarMode === "collapsed"}
            <div class="palette">
                <RadarScaleLine/>
            </div>
        {/if}
        {#if activeCap === "precipTypes"}
            <div class="palette">
                <StepScaleLine steps="{precipTypeNames}" valueFormat={$_} title="Precipitation<br />Types" />
            </div>
        {/if}
        {#if activeCap === "aerosols"}
            <div class="palette">
                <AerosolScaleLine />
            </div>
        {/if}
        {#if activeCap === "lightning" && $bottomToolbarMode === "collapsed"}
            <div class="palette">
                <LightningScaleLine/>
            </div>
        {/if}
        <div class="break"></div>
        {#if activeCap !== "aerosols"}
            <div class="center">
                {#if (activeCap === "radar" || activeCap === "precipTypes") && $bottomToolbarMode === "collapsed" }
                    <LastUpdated/>
                {/if}
                {#if activeCap === "satellite"}
                    <div class="float">
                        <sl-checkbox checked="true" use:sentinel2 disabled={s3Disabled}>Sentinel-2</sl-checkbox>
                    </div>
                    <div class="float">
                        <sl-checkbox use:cloudmask disabled="{$satelliteLayer !== "sentinel2"}">Clouds</sl-checkbox>
                    </div>
                    <div class="float">
                        <sl-checkbox use:labelsBorders checked="true">Labels &amp; Borders</sl-checkbox>
                    </div>
                {/if}
            </div>
        {/if}
        {#if !dd.isApp()}
            <div class="right app-logos">
                <Appendix/>
            </div>
        {/if}
    </div>
</div>
{/if}
