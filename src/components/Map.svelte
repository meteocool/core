<script lang="ts">
  import McLayerSwitcher from "./McLayerSwitcher.svelte";
  import "ol/ol.css";
  import { layerswitcherVisible, bottomToolbarMode } from "../stores";
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";

  export let layerManager;
  let mapID;

  let visible;
  const unsubscribeVisible = layerswitcherVisible.subscribe((value) => {
    visible = value;
  });

  function changeLayer(newLayer) {
    layerManager.setTarget(newLayer.detail, mapID);
  }

  /**
   * Upper bound on how long to keep re-measuring after a toolbar transition.
   *
   * The bars animate with `fly`, which is a transform: their box never changes,
   * so a ResizeObserver on them sees nothing, and a height measured when the
   * animation starts is wrong for the 200-400ms it runs. So re-measure each
   * frame until the answer stops moving.
   *
   * Settling is the real stop condition; this is only a ceiling, so a
   * transition that never reports its end -- Svelte does not always deliver
   * `outroend` for an element it is destroying -- cannot leave a frame loop
   * running forever.
   */
  const TRANSITION_POLL_MAX_FRAMES = 90;

  /** Identical measurements in a row before the layout counts as settled. */
  const SETTLED_FRAMES = 3;

  let resizeFrame: number | undefined;
  let transitionFrame: number | undefined;
  let transitionFramesLeft = 0;
  let lastOccluded = -1;
  let stableFrames = 0;
  let toolbarObserver: ResizeObserver | undefined;

  /** Coalesce several triggers in one frame into a single measurement. */
  function scheduleMapResize() {
    if (resizeFrame !== undefined) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      applyMapHeight();
    });
  }

  /**
   * Size the map to the space the bottom bars leave it.
   *
   * Measured rather than hardcoded. The old fixed `calc(100% - 88px)` was only
   * ever right for the desktop player: below 620px the player is 120px, in the
   * wrappers the bar grows to swallow `env(safe-area-inset-bottom)`, and that
   * inset differs per device. Anything fixed is wrong for two of those three.
   *
   * `innerHeight - rect.top` rather than `rect.height`, so a bar that is itself
   * offset by a safe-area inset still yields the space it actually occludes.
   */
  function applyMapHeight() {
    const mapElement = document.getElementById(mapID);
    if (!mapElement) return;
    const mode = get(bottomToolbarMode);

    let occluded = 0;
    if (mode !== "hidden") {
      const toolbar = document.querySelector<HTMLElement>(".bottomToolbar.lastUpdatedBottom");
      const player = document.querySelector<HTMLElement>(".timeslider");
      const bar = mode === "player" ? (player ?? toolbar) : toolbar;
      if (bar) {
        const rect = bar.getBoundingClientRect();
        occluded = Math.max(0, Math.round(window.innerHeight - rect.top));
      }
    }

    document.documentElement.style.setProperty("--bottom-toolbar-height", `${occluded}px`);

    // Full-bleed map: the tray is glass and needs the map beneath it. The strip
    // it covers becomes view padding, so centring, fit() and the geolocation
    // marker land in the visible part rather than under the bar. The View is
    // shared by every map, hence maps[0] rather than the current capability,
    // which is not set yet on the first measurement.
    mapElement.style.height = "100%";
    const view = layerManager.maps[0]?.getView();
    if (view) view.padding = [0, 0, occluded, 0];

    layerManager.forEachMap((m) => m.updateSize());
    return occluded;
  }

  /** Re-measure every frame until the height stops changing, or we run out. */
  function pollUntilSettled() {
    if (transitionFrame !== undefined) return;
    const step = () => {
      const occluded = applyMapHeight();
      transitionFramesLeft -= 1;

      if (occluded === lastOccluded) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastOccluded = occluded ?? -1;
      }

      if (stableFrames >= SETTLED_FRAMES || transitionFramesLeft <= 0) {
        transitionFrame = undefined;
        return;
      }
      transitionFrame = requestAnimationFrame(step);
    };
    transitionFrame = requestAnimationFrame(step);
  }

  function startTransitionPoll() {
    transitionFramesLeft = TRANSITION_POLL_MAX_FRAMES;
    stableFrames = 0;
    lastOccluded = -1;
    pollUntilSettled();
  }

  /**
   * Both phases restart the poll. `end` is not a signal that measuring can
   * stop: Svelte fires it as the animation finishes and the box is only final a
   * frame or two later, and for an element it is destroying `outroend` may not
   * arrive at all. Settling, not the event, is what ends the loop.
   */
  function onToolbarTransition() {
    startTransitionPoll();
  }

  function mapInit(node: HTMLElement) {
    mapID = node.id;
    // Every MiniMap's action claims its capability's map as a preview, and an
    // OpenLayers Map has exactly one target -- so the default has to be applied
    // once they have all run, or the main map is left empty and whichever
    // MiniMap initialised last becomes the active capability. Svelte 3 ran
    // child actions first and this happened to hold; Svelte 5 runs the parent's
    // first, so wait for the mount flush rather than relying on the order.
    tick().then(() => layerManager.setDefaultTarget(mapID));

    const unsubscribeMode = bottomToolbarMode.subscribe(() => startTransitionPoll());

    // Catches the toolbar's own content changing height (a scale line swapping,
    // the lightning chart appearing). Transform-only motion is handled by the
    // transition events above, which ResizeObserver cannot see.
    if (typeof ResizeObserver !== "undefined") {
      toolbarObserver = new ResizeObserver(() => scheduleMapResize());
      syncToolbarObserver();
    }

    window.addEventListener("mc:toolbar-transition", onToolbarTransition);
    window.addEventListener("resize", scheduleMapResize);
    scheduleMapResize();

    return {
      destroy() {
        unsubscribeMode();
        unsubscribeVisible();
        window.removeEventListener("mc:toolbar-transition", onToolbarTransition);
        window.removeEventListener("resize", scheduleMapResize);
        toolbarObserver?.disconnect();
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        if (transitionFrame !== undefined) cancelAnimationFrame(transitionFrame);
      },
    };
  }

  /**
   * Re-attach the observer to whatever bars exist now.
   *
   * Svelte destroys and recreates the toolbar as `bottomToolbarMode` changes,
   * so an observer wired up once is observing detached nodes by the second
   * toggle.
   */
  let observed = new Set<Element>();
  function syncToolbarObserver() {
    if (!toolbarObserver) return;
    const nodes = new Set<Element>(document.querySelectorAll(".bottomToolbar, .timeslider"));
    observed.forEach((node) => {
      if (!nodes.has(node)) toolbarObserver!.unobserve(node);
    });
    nodes.forEach((node) => {
      if (!observed.has(node)) toolbarObserver!.observe(node);
    });
    observed = nodes;
  }

  // The bars come and go with the mode, so re-attach whenever it changes.
  bottomToolbarMode.subscribe(() => tick().then(syncToolbarObserver));

</script>

<style>
  /* Full-bleed: the tray floats over live map pixels. The strip it covers is
     handed to OpenLayers as View.padding in applyMapHeight(). */
  #map {
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    z-index: var(--mc-z-map);
    /* The containing block for the 3D map's canvas, which lays itself over
       this element rather than replacing it. Without a positioned ancestor it
       resolves against the viewport and covers the bottom tray as well. */
    position: relative;
  }

  :global(:root) {
    /* still written by App.svelte for ?toolbar=no; no longer read */
    --attributions-bottom-padding: 0.9em;
    /* under the 44px switcher disc, on the same top line */
    --ol-controls-top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
  }

  /* Material for the controls lives in src/glass.css; only positions here. */
  :global(.ol-zoom) {
    top: var(--ol-controls-top);
    right: var(--mc-gutter);
    left: auto;
    bottom: auto;
  }

  :global(.ol-geolocate) {
    /* The zoom capsule's height: two buttons of (module - 2px), the 1px
       separator between them and the control's own 2px of border, which comes
       to exactly two modules less one. */
    top: calc(var(--ol-controls-top) + 2 * var(--mc-control-lg) - 1px + var(--mc-gutter));
    right: var(--mc-gutter);
    left: auto;
    bottom: auto;
    border-radius: 50%;
  }
  :global(.ol-geolocate button) {
    font-size: 22px;
  }

  /* The wrappers ship their own zoom and locate controls. */
  :global(.is-app .ol-zoom),
  :global(.is-app .ol-rotate) {
    display: none;
  }
</style>

<div id="map" use:mapInit />
<!-- The component still mounts in the wrappers even though layerswitcherVisible
     is forced to "no" there: it is what defines window.openLayerswitcher, which
     the native buttons call. Its own toggle button is hidden inside. -->
{#if visible === "yes" || dd.isApp()}
  <McLayerSwitcher {layerManager} on:changeLayer={changeLayer} />
{/if}
