<script lang="ts">
  import { fly } from "svelte/transition";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
  import { get } from "svelte/store";
  import { _ } from "svelte-i18n";
  import {
    BarController, BarElement, CategoryScale, Chart, LinearScale,
  } from "chart.js";
  import { transformExtent } from "ol/proj";
  import { fromExtent } from "ol/geom/Polygon";
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
  import AerosolScaleLine from "./scales/AerosolScaleLine.svelte";
  import { fetchLightningStats } from "../api";
  import { LightningColors, precipTypeNames } from "../colormaps";

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

  capDescription.subscribe((desc) => {
    _description = desc;
  });

  let activeCap;
  sharedActiveCap.subscribe((val) => {
    activeCap = val;
  });

  let lightningCanvas;
  let chart;
  function redrawLightningChart(data: number[]) {
    if (chart?.options.scales?.y) {
      chart.data.datasets[0].data = data;
      chart.options.scales.y.max = Math.max(...data);
      chart.update();
    }
  }

  let loading = true;
  let unavailable = false;
  let noLightning = false;
  let delayedLoader;

  async function updateLightningChart() {
    const map = layerManager.getCurrentMap();
    const extent = transformExtent(map.getView().calculateExtent(map.getSize()), "EPSG:3857", "EPSG:4326");
    const ring = fromExtent(extent).getLinearRing(0);
    if (!ring) return;
    const polygon = ring.getCoordinates();

    try {
      const data = await fetchLightningStats(polygon);
      unavailable = false;
      noLightning = data.bins.reduce((total, bin) => total + bin, 0) === 0;
      if (!noLightning) redrawLightningChart(data.bins);
    } catch {
      noLightning = true;
      unavailable = true;
    } finally {
      delayedLoader = null;
      loading = false;
    }
  }

  function lightningChartCanvas(elem) {
    lightningCanvas = elem;

    chart = new Chart(lightningCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Array(30).fill(null).map((_, i) => (i === 30 - 1 ? "now" : `-${30 - i} min`)),
        datasets: [
          {
            data: [
              222,
              151,
              141,
              184,
              155,
              125,
              296,
              148,
              199,
              151,
              144,
              219,
              133,
              158,
              184,
              194,
              166,
              140,
              166,
              125,
              123,
              154,
              115,
              158,
              207,
              117,
              193,
              113,
              215,
              164,
            ],
            backgroundColor: Array(30).fill(null).map((_, i) => LightningColors[Math.min((30 - i) - Math.max(-20 * (30 - i), -30), LightningColors.length - 1)]),
            datalabels: {
              display: false,
            },
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          // Chart.js 3 moved tooltip here; at the options root it was ignored.
          tooltip: { enabled: true },
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: 0,
            bottom: -2,
          },
        },
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: {
              display: false,
              tickLength: 1,
            },
            ticks: {
              padding: -5,
              maxRotation: 0,
              minRotation: 0,
            },
            afterFit: (scale) => {
              scale.height = 20;
              scale.paddingBottom = 0;
            },
            afterUpdate: (scale) => {
              scale.height = 20;
              scale.paddingBottom = 0;
            },
          },
          y: {
            type: "linear",
            grid: {
              display: false,
            },
            min: 0,
            max: 300,
            // In Chart.js 4 the tick formatter lives under `ticks`, not on the
            // scale, so this never ran where it used to sit.
            ticks: {
              callback(value, index, values) {
                // Not the outer `chart`: this runs during construction, before
                // the assignment. `this` is the scale, but guard it anyway --
                // this callback sat at the wrong nesting level for years and
                // has never actually executed before now.
                const data = this?.chart?.data?.datasets?.[0]?.data as number[] | undefined;
                if (!data?.length) return "";
                if (index === values.length - 1) return Math.min(...data);
                if (index === 0) return Math.max(...data);
                return "";
              },
            },
          },
        },
      },
    });

    layerManager.getCurrentMap().on("movestart", () => {
      if (get(sharedActiveCap) !== "lightning") return;
      if (delayedLoader) {
        clearTimeout(delayedLoader);
        delayedLoader = null;
      }
      loading = true;
    });

    layerManager.getCurrentMap().on("moveend", () => {
      if (get(sharedActiveCap) !== "lightning") return;
      if (delayedLoader) {
        return;
      }
      delayedLoader = setTimeout(() => updateLightningChart(), 650);
    });
  }
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
        height: 42px;
        z-index: var(--mc-z-tray);
        padding: 0 12px;
    }

    /* Desktop: fully covered by the open player, so release its blur once the
       player has flown in. Map.svelte measures .timeslider in player mode. */
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
        visibility: hidden;
        transition: visibility 0s linear 250ms;
    }

    @media only screen and (max-width: 620px) {
        .lastUpdatedBottom {
            height: 84px;
            padding: 6px 10px;
        }
        .parentz {
            flex-wrap: wrap;
            align-content: space-between;
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
            /* clear the play and expand discs in the tray's bottom corners */
            padding: 0 52px;
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

    /* The wrappers get the identical floating tray: the map showing under the
       bar is now the intent, not a strip to swallow. */
    :global(.is-app .bottomToolbar) {
        margin-bottom: 0;
    }

    .parentz {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        height: 100%;
        gap: 2px 4px;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;   /* the tray has a fixed height; nothing may spill under its rounded edge */
    }

    /* spacer for NowcastPlayback's two floating discs (desktop only) */
    .left {
        flex: 0 0 auto;
        width: 100px;
        height: 1px;
        float: none;
        cursor: default;
        text-decoration: none;
    }

    .right {
        flex: 0 0 auto;
        height: auto;
        display: flex;
        align-items: center;
        white-space: nowrap;
        padding: 0 0 0 8px;
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
        padding: 0 8px;
        font: 500 12px/1.2 var(--mc-font);
        text-align: center;
    }

    .palette {
        flex: 1 1 50%;
        min-width: 0;
        position: relative;
        height: 32px;
        padding: 0 8px;
        text-align: center;
    }

    .float {
        display: inline-flex;
        align-items: center;
        margin: 0 16px 0 0;
    }

    .lightningChart {
        height: 45px;
        width: 100%;
        margin-top: -4px;
        z-index: 99;
    }

    .loading {
        opacity: 0.55;
    }

    .lightning_chart_overlay_opacity {
        opacity: 0.4;
    }

    .lightning-chart-overlay {
        position: absolute;
        top: 10px;
        left: 0;
        width: 100%;
        text-align: center;
        color: var(--mc-text);
        font: 600 12px/1.3 var(--mc-font);
        text-shadow: none;
        z-index: 100;
    }
</style>

<div
        class="bottomToolbar lastUpdatedBottom"
        class:player-open={$bottomToolbarMode === "player"}
        transition:fly={{ y: 100, duration: 200 }}
        on:introstart={toolbarTransitionStart}
        on:outrostart={toolbarTransitionStart}
        on:introend={toolbarTransitionEnd}
        on:outroend={toolbarTransitionEnd}>
    <div class="parentz">
        {#if activeCap === "radar" && $bottomToolbarMode === "collapsed"}
            <div class="left">
                <!-- empty -->
            </div>
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
                {#if activeCap === "lightning"}
                    {#if noLightning}
                        <div class="lightning-chart-overlay">
                            {#if unavailable}
                                Statistics currently unavailable.
                            {:else}
                                No recent lightning in this area. ⚡️
                            {/if}
                        </div>
                    {/if}
                    <div class="lightningChart" class:loading class:lightning_chart_overlay_opacity={noLightning || unavailable}>
                        <canvas use:lightningChartCanvas></canvas>
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
