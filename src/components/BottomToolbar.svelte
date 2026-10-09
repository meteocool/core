<script lang="ts">
  import { onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
  import { _ } from "svelte-i18n";
  import {
    BarController, BarElement, CategoryScale, Chart, LinearScale,
  } from "chart.js";
  import LastUpdated from "./LastUpdated.svelte";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import {
    capDescription,
    sharedActiveCap,
    bottomToolbarMode,
  } from "../stores";
  import StepScaleLine from "./scales/StepScaleLine.svelte";
  import Appendix from "./Appendix.svelte";
  import LightningScaleLine from "./scales/LightningScaleLine.svelte";
  import LightningChart from "./LightningChart.svelte";
  import { precipTypeNames } from "../colormaps";

  Chart.defaults.font.size = 10;
  // Chart.js's own grey is unreadable on the dark tray; the token flips with the theme.
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--mc-text-2").trim() || "#666";

  export let layerManager;

  // Assigned when a capability changes; not rendered today.
  let _description: string;

  // This chart is a bar chart. It registers the bar controller and element
  // itself, so it renders whether or not NowcastPlayback has been constructed
  // first.
  Chart.register(BarController, BarElement, CategoryScale, LinearScale);

  /* Handed back in onDestroy: the toolbar is torn down when the URL hides it
     and rebuilt when it comes back. */
  const subscriptions: (() => void)[] = [];

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
   * its own. The tray would be a full-width strip of glass with a GitHub icon
   * in it, over the part of the map the storms stand on.
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
       must sit on this element: it is the one carrying transition:fly, and a
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

    /* Desktop: fully covered by the open player, so release its blur once the
       player has flown in. Map.svelte measures .timeslider in player mode. */
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
        visibility: hidden;
        transition: visibility 0s linear 250ms;
    }

    /* The wrappers get the identical floating tray: the map is meant to show
       under the bar. */
    :global(.is-app .bottomToolbar) {
        margin-bottom: 0;
    }

    /* Only a wrap point, and only on a phone. Left in the row on desktop it is a
       zero-width flex item that still collects the gap on both sides, which
       makes the space between the legend and the status line twice every
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

    /* Phone. Last in the sheet on purpose: these rules share their specificity
       with the base ones above, so declared any earlier they lose to them and
       the whole block goes inert, leaving the collapsed bar unwrapped and its
       freshness line overflowing. */
    @media only screen and (max-width: 620px) {
        .lastUpdatedBottom {
            padding: 6px 10px;
        }
        .parentz {
            flex-wrap: wrap;
            /* The scale and the "last updated" line are two short rows in a
               bar with a fixed height (shared with NowcastPlayback's flanking
               discs, which centre on it). space-between would pin them to the
               top of that height instead of centring the pair, leaving dead
               air below. */
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
        class:player-open={$bottomToolbarMode === "player"}
        transition:fly={{ y: 100, duration: 200 }}
        on:introstart={toolbarTransitionStart}
        on:outrostart={toolbarTransitionStart}
        on:introend={toolbarTransitionEnd}
        on:outroend={toolbarTransitionEnd}>
    <!-- Nothing of the radar's: its scale is in the player, which is its tray. -->
    <div class="parentz">
        {#if activeCap === "precipTypes"}
            <div class="palette">
                <StepScaleLine steps="{precipTypeNames}" valueFormat={$_} title={$_("chrome.scales.precipitation_types")} />
            </div>
        {/if}
        {#if activeCap === "lightning" && $bottomToolbarMode === "collapsed"}
            <div class="palette">
                <LightningScaleLine/>
            </div>
        {/if}
        <div class="break"></div>
        <div class="center">
            <!-- Not the radar's: its product picker says how old each product is. -->
            {#if activeCap === "precipTypes" && $bottomToolbarMode === "collapsed" }
                <LastUpdated/>
            {/if}
        </div>
        {#if !dd.isApp()}
            <div class="right app-logos">
                <Appendix/>
            </div>
        {/if}
    </div>
</div>
{/if}
