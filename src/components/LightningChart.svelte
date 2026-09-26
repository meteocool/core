<script lang="ts">
/**
 * The lightning histogram: strikes per minute over the last half hour, for
 * whatever the map is currently showing.
 *
 * Moved out of the bottom bar into its own glass strip, the same one the radar
 * forecast uses, so the two layers read as the same app. It was sharing a row
 * with the colour scale and the repo links, which left it about 45px tall and
 * its axis labels overlapping the legend beside it.
 *
 * The one real difference from the radar strip: this covers the viewport's
 * bounding box, not a point. So the title names the area at whatever scale the
 * zoom is actually showing -- a city close in, a state or a country further
 * out -- and there is no "My Location" action, because a viewport is not
 * somewhere you can return from.
 */
import { onDestroy } from "svelte";
import { get } from "svelte/store";
import { _, locale } from "svelte-i18n";
import { Chart } from "chart.js";
import { toLonLat, transformExtent } from "ol/proj";
import { unByKey } from "ol/Observable";
import type { Map } from "ol";
import type { EventsKey } from "ol/events";
import { fromExtent } from "ol/geom/Polygon";
import { fetchLightningStats } from "../api";
import { LightningColors } from "../colormaps";
import { mapTapped, sharedActiveCap } from "../stores";
import { reverseGeocode, scaleForZoom } from "../lib/reverseGeocode";
import DismissableStrip from "./DismissableStrip.svelte";
import ChartSkeleton from "./ChartSkeleton.svelte";

export let layerManager;

/** How many minutes the histogram covers, one bar each. */
const BINS = 30;

let chart;
let loading = true;
let unavailable = false;
let noLightning = false;
let delayedLoader: ReturnType<typeof setTimeout> | null = null;

let dismissed = false;
$: if ($sharedActiveCap !== "lightning") dismissed = false;

const subscriptions = [
  // Tapping the map is asking about what is on it; bring a cleared strip back.
  mapTapped.subscribe((n) => { if (n > 0) dismissed = false; }),
];
onDestroy(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (delayedLoader) clearTimeout(delayedLoader);
  detachMap();
});

/**
 * The current map's bounding box as a ring, in lat/lon.
 *
 * Null unless the map has actually been laid out. A map exists before it has a
 * size -- it is created up front and only gets a target when its layer comes on
 * screen -- and calculateExtent() with no size returns a zero-area extent
 * around the centre, which fromExtent() happily turns into a degenerate ring: a
 * point, sent to the backend as the area to count strikes in. The answer comes
 * back empty, and the strip draws it as "no lightning in this area" when the
 * truth is that nobody has asked about an area yet.
 *
 * update() already bails on null, so refusing here stops the request at source.
 */
function viewportRing() {
  const map = layerManager?.getCurrentMap?.();
  if (!map) return null;
  const size = map.getSize();
  if (!size || size[0] <= 0 || size[1] <= 0) return null;
  const extent = transformExtent(
    map.getView().calculateExtent(size),
    "EPSG:3857",
    "EPSG:4326",
  );
  return fromExtent(extent).getLinearRing(0)?.getCoordinates() ?? null;
}

/* The name of what is on screen. Geocoded from the centre of the view, at the
   granularity the zoom justifies -- naming a whole country after the village
   under the middle pixel would be worse than not naming it at all. */
let placeName: string | null = null;
let placeToken = 0;

async function resolvePlace() {
  const map = layerManager?.getCurrentMap?.();
  if (!map) return;
  const view = map.getView();
  const centre = view.getCenter();
  if (!centre) return;
  const [lon, lat] = toLonLat(centre);
  const token = ++placeToken;
  const name = await reverseGeocode(
    lat,
    lon,
    get(locale) ?? "en",
    scaleForZoom(view.getZoom() ?? 0),
    "lightning",
  );
  if (token === placeToken) placeName = name;
}

$: title = placeName
  ? $_("lightning_in", { values: { place: placeName } })
  : $_("lightning_in_view");

function redraw(data: number[]) {
  if (!chart?.options.scales?.y) return;
  chart.data.datasets[0].data = data;
  chart.options.scales.y.max = Math.max(...data);
  chart.update();
}

/** How long to wait for a map that exists but has not been laid out yet. */
const LAYOUT_RETRY_MS = 250;

async function update() {
  const polygon = viewportRing();
  if (!polygon) {
    /* Not an error and not an empty result: the map is on its way onto the
       page. Come back for it, because the moveend that would otherwise be the
       next prompt may never fire -- nothing has to move for a map to finish
       being laid out. The skeleton stays up in the meantime, which is the
       honest reading. */
    if (delayedLoader) clearTimeout(delayedLoader);
    delayedLoader = setTimeout(() => { delayedLoader = null; update(); }, LAYOUT_RETRY_MS);
    return;
  }
  resolvePlace();
  try {
    const data = await fetchLightningStats(polygon);
    unavailable = false;
    noLightning = data.bins.reduce((total, bin) => total + bin, 0) === 0;
    if (!noLightning) redraw(data.bins);
  } catch {
    noLightning = true;
    unavailable = true;
  } finally {
    delayedLoader = null;
    loading = false;
  }
}

function canvasInit(elem: HTMLCanvasElement) {
  chart = new Chart(elem.getContext("2d")!, {
    type: "bar",
    data: {
      labels: Array(BINS).fill(null)
        .map((_unused, i) => (i === BINS - 1 ? "now" : `-${BINS - i} min`)),
      datasets: [
        {
          data: Array(BINS).fill(0),
          backgroundColor: Array(BINS).fill(null).map((_unused, i) => LightningColors[
            Math.min((BINS - i) - Math.max(-20 * (BINS - i), -30), LightningColors.length - 1)
          ]),
          datalabels: { display: false },
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      layout: { padding: { left: 0, right: 0, top: 4, bottom: 0 } },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false, tickLength: 1 },
          // Chart.js 4 split the axis rule out of `grid`; left on, it drew a
          // fixed hairline across the glass that did not move with the map.
          border: { display: false },
          ticks: { padding: 0, maxRotation: 0, minRotation: 0, autoSkipPadding: 24 },
        },
        y: {
          type: "linear",
          grid: { display: false },
          border: { display: false },
          min: 0,
          max: 300,
          ticks: {
            callback(_value, index, values) {
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
  update();
  return {
    destroy() {
      chart?.destroy();
      chart = null;
    },
  };
}

/**
 * Reload when the view settles, not while it is moving: every intermediate
 * frame of a pan would be its own query over a box nobody is looking at yet.
 *
 * Attached when the lightning layer becomes the one on screen rather than on
 * mount: this component exists for the whole session, and at mount there is no
 * current capability for LayerManager to hand back a map for. Detached again on
 * the way out, because OpenLayers listeners outlive whatever added them -- the
 * version in the bottom bar added a pair per canvas mount and removed neither.
 */
let attachedMap: Map | null = null;
let moveKeys: EventsKey[] = [];

function detachMap() {
  /* Before the early return: the layout retry reschedules itself, so a pending
     one outlives the layer it was waiting for and would eventually query
     whatever map the app has switched to. */
  if (delayedLoader) {
    clearTimeout(delayedLoader);
    delayedLoader = null;
  }
  const map = attachedMap;
  if (!map) return;
  moveKeys.forEach((key) => unByKey(key));
  moveKeys = [];
  attachedMap = null;
}

function attachMap(map: Map) {
  detachMap();
  attachedMap = map;
  moveKeys = [
    map.on("movestart", () => {
      if (delayedLoader) {
        clearTimeout(delayedLoader);
        delayedLoader = null;
      }
      loading = true;
    }),
    map.on("moveend", () => {
      if (delayedLoader) return;
      delayedLoader = setTimeout(() => update(), 650);
    }),
  ];
  update();
}

$: {
  if ($sharedActiveCap === "lightning") {
    const map = layerManager?.getCurrentMap?.();
    if (map && map !== attachedMap) attachMap(map);
  } else {
    detachMap();
  }
}

</script>

<style>
  /* The plot spans the strip, inset only by the tray padding: unlike the radar
     strip there is no scrubber underneath for the bars to line up with. */
  .plot {
    position: relative;
    height: 100%;
    margin: 0 var(--mc-tray-pad);
  }
  .canvas-wrap {
    height: 100%;
  }
  .canvas-wrap canvas {
    display: block;
  }

  .dim {
    opacity: 0.4;
  }
  /* The canvas keeps its box while the skeleton is up -- Chart.js sizes itself
     from the element, and a display:none parent would measure it at zero and
     draw the first frame into a 0x0 canvas. */
  .canvas-wrap.hidden {
    visibility: hidden;
  }

  /* Sits over the plot rather than replacing it, so the strip keeps its height
     and nothing below it moves when the answer arrives. */
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--mc-text);
    font: 600 12px/1.3 var(--mc-font);
  }
</style>

{#if $sharedActiveCap === "lightning" && !dismissed}
  <DismissableStrip {title} collapsed on:dismiss={() => { dismissed = true; }}>
    <div class="plot">
      {#if loading}
        <ChartSkeleton bars={BINS} />
      {:else if noLightning}
        <div class="empty">
          {unavailable ? $_("lightning_unavailable") : $_("lightning_none")}
        </div>
      {/if}
      <div class="canvas-wrap" class:hidden={loading} class:dim={noLightning || unavailable}>
        <canvas use:canvasInit></canvas>
      </div>
    </div>
  </DismissableStrip>
{/if}
