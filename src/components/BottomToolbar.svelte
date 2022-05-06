<script>
  import { fly } from "svelte/transition";
  import { get } from "svelte/store";
  import { _ } from "svelte-i18n";
  import { Chart, LineController, Line, LineElement } from "chart.js";
  import { Polygon } from "ol/geom";
  import { transformExtent } from "ol/proj";
  import { fromExtent } from "ol/geom/Polygon";
  import { GeoJSON } from "ol/format";
  import LastUpdated from "./LastUpdated.svelte";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import {
    capDescription,
    satelliteLayer,
    sharedActiveCap,
    bottomToolbarMode,
    zoomlevel,
    satelliteLayerCloudy, satelliteLayerLabels, radarColormap, capLastUpdated, latLon,
  } from "../stores";
  import { precipTypeNames } from "../lib/cmaps";
  import StepScaleLine from "./scales/StepScaleLine.svelte";
  import Appendix from "./Appendix.svelte";
  import RadarScaleLine from "./scales/RadarScaleLine.svelte";
  import LightningScaleLine from "./scales/LightningScaleLine.svelte";
  import AerosolScaleLine from "./scales/AerosolScaleLine.svelte";
  import { v3APIBaseUrl } from "../urls";
  import { dwdPrecipTypes } from "../layers/radar";
  import { LightningColors } from '../colormaps';
  Chart.defaults.font.size = 10;

  export let layerManager;

  Chart.register(LineController);
  Chart.register(LineElement);

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

  let lightningCanvas;
  let chart;
  function redrawLightningChart(data) {
    if (chart) {
      chart.data.datasets[0].data = data;
      chart.options.scales.y.max = Math.max.apply(this, data);
      chart.update();
      return;
    }
    chart = new Chart(lightningCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: data.map((_, i) => (i === data.length - 1 ? "now" : `-${data.length - i} min`)),
        datasets: [
          {
            data,
            borderColor: "#ff0000",
            backgroundColor: data.map((_, i) => LightningColors[Math.min((data.length - i) - Math.max(-20 * (data.length - i), -30), LightningColors.length - 1)]),
            datalabels: {
              display: false,
            },
            cubicInterpolationMode: "monotone",
            tension: 0.4,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            display: false,
            labels: {
              font: {
                size: 3,
              },
            },
          },
        },
        hover: {
          animationDuration: 0,
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
        tooltips: {
          enabled: false,
        },
        legend: {
          display: false,
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false,
              tickMarkLength: 1,
              autoSkip: true,
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
              drawBorder: false,
            },
            min: 0,
            max: Math.max.apply(this, data),
            callback(value, index, values) {
              if (index === values.length - 1) return Math.min.apply(this, chart.data.datasets[0].data);
              if (index === 0) return Math.max.apply(this, chart.data.datasets[0].data);
              return "";
            },
          },
        },
      },
    });
  }

  let loading = false;
  let delayedLoader;

  function updateLightningChart() {
    const map = layerManager.getCurrentMap();
    const extent = transformExtent(map.getView().calculateExtent(map.getSize()), "EPSG:3857", "EPSG:4326");
    const p = fromExtent(extent);

    const URL = `${v3APIBaseUrl}/lightning/stats?`;
    fetch(URL + new URLSearchParams({
      bbox: JSON.stringify({ coordinates: p.getLinearRing(0).getCoordinates() }),
    }))
      .then((response) => response.json())
      .then((data) => {
        if (!data) return;
        redrawLightningChart(data.bins);
      })
      .catch((error) => {
        console.log(error);
      });
    delayedLoader = null;
    loading = false;
  }

  function lightningChartCanvas(elem) {
    lightningCanvas = elem;

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

    .lightningChart {
        height: 45px;
        width: 100%;
        margin-top: -4px;
    }

    .loading {
        opacity: 0.5;
    }
</style>

<div
        class="bottomToolbar lastUpdatedBottom"
        transition:fly={{ y: 100, duration: 200 }}>
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
                <AerosolScaleLine steps="{precipTypeNames}" valueFormat={$_}/>
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
                        <sl-checkbox use:cloudmask disabled="{$satelliteLayer !== 'sentinel2'}">Clouds</sl-checkbox>
                    </div>
                    <div class="float">
                        <sl-checkbox use:labelsBorders checked="true">Labels &amp; Borders</sl-checkbox>
                    </div>
                {/if}
                {#if activeCap === "lightning"}
                    <div class="lightningChart" class:loading>
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
