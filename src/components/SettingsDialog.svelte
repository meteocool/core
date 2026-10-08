<script lang="ts">
import { createEventDispatcher } from "svelte";
import { _ } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
import {
  cells3dVisible, cellLayerVisible, cycloneLayerVisible, fullResolution3d, lightningLayerVisible, mapBaseLayer,
  radarColormap, terrain3dVisible,
} from "../stores";
import { isHandheld } from "../lib/gpuBudget";
import { dbz2color } from "../lib/cmap_utils";
import { capabilityEnabled } from "../caps/enabled";

/**
 * The web's settings: the ones the apps push in through
 * `window.settings.injectSettings()` from their own settings screens, which a
 * browser has no screen for. Same keys, same values, same option lists (see
 * ios/meteocool/lib/WebSettings.swift and its Base Map and Radar Color Map
 * pickers), so the three platforms describe one set of preferences.
 *
 * Everything goes through `window.settings.set()`, which persists it and fires
 * the setting's callback, exactly as an injection from an app does.
 *
 * Three differences from the apps. The basemap can follow the system scheme,
 * which is the default and what "system" stores. The Mode picker cannot switch
 * the backend in place, so it opens the deployment that is the chosen mode,
 * where the apps reload against it. And the 3D map's KONRAD3D cells can be
 * turned on, which the apps have no screen for: there they stay off, as they
 * are by default.
 */

const BASE_LAYERS = ["system", "light", "dark", "osm", "cyclosm"];
const COLOR_MAPS = ["classic", "nws", "pyart_stepseq", "homeyer", "lang"];

const dispatch = createEventDispatcher<{ about: void }>();

/** The ramp a colormap paints, drizzle to hail, as a CSS gradient. */
function swatch(cmap: string): string {
  const stops: string[] = [];
  for (let dbz = 5; dbz <= 70; dbz += 5) {
    const [r, g, b] = dbz2color(dbz, cmap);
    stops.push(`rgb(${r} ${g} ${b})`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * The deployments, as the apps' Mode picker names them
 * (ios/meteocool/EnvironmentPickerViewController.swift). Choosing one opens it
 * on the same view: the query carries the layer, the camera and whatever is
 * selected (lib/urlState.ts).
 */
const MODES = [
  { id: "production", origin: "https://meteocool.com", aliases: ["https://www.meteocool.com"] },
  { id: "experimental", origin: "https://next.meteocool.com", aliases: ["https://web.staging.meteocool.com", "https://app.meteocool.com"] },
  { id: "demo", origin: "https://demo.meteocool.com", aliases: [] },
] as const;

/** By origin; a dev server or preview by what its build points at (urls.ts). */
const currentMode = MODES.find((m) => m.origin === window.location.origin
  || (m.aliases as readonly string[]).includes(window.location.origin))?.id
  ?? (import.meta.env.MODE === "demo" ? "demo" : import.meta.env.PROD && import.meta.env.MODE !== "staging" ? "production" : "experimental");

function setMode(mode: (typeof MODES)[number]) {
  if (mode.id === currentMode) return;
  window.location.assign(`${mode.origin}/${window.location.search}${window.location.hash}`);
}

// Neither has a store: read once, and kept in step by whatever this sets. The
// basemap's store holds the resolved basemap, never "system", so the choice
// itself is read from the setting.
let rotation = window.settings.getBoolean("mapRotation");
let solidGlass = window.settings.getBoolean("solidGlassWhileMoving");

/*
 * Two-finger rotation needs two fingers: without a multitouch screen there is
 * no gesture for the switch to turn on, so it is not offered. Asked of the
 * device rather than the pointer in use, so a touchscreen laptop still gets it.
 */
const multitouch = navigator.maxTouchPoints > 1;
let baseLayer = window.settings.getString<string>("mapBaseLayer", "system");

function setBaseLayer(value: string) {
  window.settings.set("mapBaseLayer", value);
  baseLayer = value;
}

function setColorMap(value: string) {
  window.settings.set("radarColorMapping", value);
}

function setRotation(value: boolean) {
  window.settings.set("mapRotation", value);
  rotation = value;
}

function setSolidGlass(value: boolean) {
  window.settings.set("solidGlassWhileMoving", value);
  solidGlass = value;
}

/* The radar map's overlays, named as its layer-switcher tile is. A layer
   kept on or off is a preference, so they are settings. Each store persists
   itself (App.svelte). */
const offersRadar = capabilityEnabled("radar");
$: overlays = [
  { store: lightningLayerVisible, on: $lightningLayerVisible, label: $_("chrome.playback.lightning") },
  { store: cycloneLayerVisible, on: $cycloneLayerVisible, label: $_("chrome.playback.mesocyclones") },
  { store: cellLayerVisible, on: $cellLayerVisible, label: $_("chrome.playback.cells") },
];

/** Only where the 3D map is offered at all. */
const offers3d = capabilityEnabled("cells3d");

function setCells3d(value: boolean) {
  window.settings.set("layer3dCells", value);
}

function setTerrain3d(value: boolean) {
  window.settings.set("layer3dTerrain", value);
}

/* Only where there is a cap to lift: a desktop always draws at full resolution. */
const handheld = isHandheld();

function setFullResolution3d(value: boolean) {
  window.settings.set("layer3dFullResolution", value);
}

</script>

<style>
  /* The panel is GlassPanel's, shared with About and Connection Details. This
     is the content: grouped lists in the system's style, a checkmark for the
     chosen row and a switch for each toggle. */
  /* The drawers' section heading (see StormPanel): bold, in the primary ink,
     a step above the rows, with air above it rather than a rule. */
  h2 {
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    margin: 24px 2px 10px;
  }
  h2:first-child {
    margin-top: 0;
  }

  .group {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 10px 14px;
    border: 0;
    background: transparent;
    color: var(--mc-text);
    font: 400 15px/1.3 var(--mc-font);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  .row + .row {
    border-top: 1px solid var(--mc-separator);
  }
  .row:hover {
    background: var(--mc-tint-hover);
  }
  .row:active {
    background: var(--mc-tint-active);
  }
  .row:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: -2px;
  }

  .label {
    flex: 1 1 auto;
  }

  /* A second line under the label, as the apps' subtitle cells have. */
  .sublabel {
    display: block;
    margin-top: 2px;
    color: var(--mc-text-2);
    font-size: 13px;
  }

  .detail {
    flex: none;
    color: var(--mc-text-2);
  }

  .check {
    flex: none;
    width: 18px;
    color: var(--mc-accent);
    font-weight: 700;
    text-align: center;
  }

  .ramp {
    flex: none;
    width: 72px;
    height: 10px;
    border-radius: 5px;
    box-shadow: inset 0 0 0 1px var(--mc-hairline);
  }

  /* A native checkbox drawn as a switch: keyboard, focus and the label's
     click all come with it. */
  .switch {
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    flex: none;
    width: 46px;
    height: 28px;
    margin: 0;
    border-radius: 14px;
    background: var(--mc-hairline);
    cursor: pointer;
    transition: background-color var(--mc-motion-fast);
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform var(--mc-motion-fast) var(--mc-ease);
  }
  .switch:checked {
    background: var(--mc-accent);
  }
  .switch:checked::after {
    transform: translateX(18px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }

  .hint {
    margin: 6px 4px 0;
    color: var(--mc-text-2);
    font-size: 12px;
    line-height: 1.4;
  }
</style>

<GlassPanel title={$_("settings.title")} on:close>
  <!-- About comes first; Logo swaps this sheet for About's. -->
  <div class="group">
    <button type="button" class="row" on:click={() => dispatch("about")}>
      <span class="label">{$_("settings.about")}</span>
      <span class="detail" aria-hidden="true">›</span>
    </button>
  </div>

  <h2 id="settings-basemap">{$_("settings.base_layer")}</h2>
  <div class="group" role="radiogroup" aria-labelledby="settings-basemap">
    {#each BASE_LAYERS as layer (layer)}
      <button
        type="button"
        class="row"
        role="radio"
        aria-checked={baseLayer === layer}
        on:click={() => setBaseLayer(layer)}>
        <span class="label">{$_(`settings.base_layers.${layer}`)}</span>
        {#if layer === "system"}
          <!-- What following the system currently comes out as. -->
          <span class="detail">{$_(`settings.base_layers.${$mapBaseLayer}`)}</span>
        {/if}
        <span class="check" aria-hidden="true">{baseLayer === layer ? "✓" : ""}</span>
      </button>
    {/each}
  </div>

  <h2 id="settings-colormap">{$_("settings.color_map")}</h2>
  <div class="group" role="radiogroup" aria-labelledby="settings-colormap">
    {#each COLOR_MAPS as cmap (cmap)}
      <button
        type="button"
        class="row"
        role="radio"
        aria-checked={$radarColormap === cmap}
        on:click={() => setColorMap(cmap)}>
        <span class="label">{$_(`settings.color_maps.${cmap}`)}</span>
        <span class="ramp" style:background={swatch(cmap)} aria-hidden="true"></span>
        <span class="check" aria-hidden="true">{$radarColormap === cmap ? "✓" : ""}</span>
      </button>
    {/each}
  </div>
  <p class="hint">{$_("settings.color_map_hint")}</p>

  {#if offersRadar}
    <h2>{$_("rain_and_thunderstorms")}</h2>
    <div class="group">
      {#each overlays as overlay (overlay.store)}
        <label class="row">
          <span class="label">{overlay.label}</span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={overlay.on}
            on:change={(event) => overlay.store.set(event.currentTarget.checked)} />
        </label>
      {/each}
    </div>
  {/if}

  <!-- Rotation is all the section holds, so without a multitouch screen it goes. -->
  {#if multitouch}
    <h2>{$_("settings.map")}</h2>
    <div class="group">
      <label class="row">
        <span class="label">{$_("settings.rotation")}</span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          checked={rotation}
          on:change={(event) => setRotation(event.currentTarget.checked)} />
      </label>
    </div>
    <p class="hint">{$_("settings.rotation_hint")}</p>
  {/if}

  {#if offers3d}
    <h2>{$_("settings.map_3d")}</h2>
    <div class="group">
      <label class="row">
        <span class="label">{$_("settings.konrad_cells")}</span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          checked={$cells3dVisible}
          on:change={(event) => setCells3d(event.currentTarget.checked)} />
      </label>
    </div>
    <p class="hint">{$_("settings.konrad_cells_hint")}</p>
    <div class="group">
      <label class="row">
        <span class="label">{$_("settings.terrain")}</span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          checked={$terrain3dVisible}
          on:change={(event) => setTerrain3d(event.currentTarget.checked)} />
      </label>
    </div>
    <p class="hint">{$_("settings.terrain_hint")}</p>
    {#if handheld}
      <div class="group">
        <label class="row">
          <span class="label">{$_("settings.full_resolution")}</span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={$fullResolution3d}
            on:change={(event) => setFullResolution3d(event.currentTarget.checked)} />
        </label>
      </div>
      <p class="hint">{$_("settings.full_resolution_hint")}</p>
    {/if}
  {/if}

  <!-- What costs frames or bandwidth, and can be traded away for them. -->
  <h2>{$_("settings.performance")}</h2>
  <div class="group">
    <label class="row">
      <span class="label">{$_("settings.solid_glass")}</span>
      <input
        type="checkbox"
        role="switch"
        class="switch"
        checked={solidGlass}
        on:change={(event) => setSolidGlass(event.currentTarget.checked)} />
    </label>
  </div>
  <p class="hint">{$_("settings.solid_glass_hint")}</p>

  <h2 id="settings-mode">{$_("settings.mode")}</h2>
  <div class="group" role="radiogroup" aria-labelledby="settings-mode">
    {#each MODES as mode (mode.id)}
      <button
        type="button"
        class="row"
        role="radio"
        aria-checked={currentMode === mode.id}
        on:click={() => setMode(mode)}>
        <span class="label">
          {$_(`settings.modes.${mode.id}`)}
          <span class="sublabel">{$_(`settings.modes.${mode.id}_detail`)}</span>
        </span>
        <span class="check" aria-hidden="true">{currentMode === mode.id ? "✓" : ""}</span>
      </button>
    {/each}
  </div>
  <p class="hint">{$_("settings.mode_hint")}</p>
</GlassPanel>
