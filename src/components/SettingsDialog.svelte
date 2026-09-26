<script lang="ts">
import { _ } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
import { mapBaseLayer, radarColormap } from "../stores";
import { dbz2color } from "../lib/cmap_utils";

/**
 * The web's settings: the ones the apps push in through
 * `window.settings.injectSettings()` from their own settings screens, which a
 * browser has no screen for. Same keys, same values, same option lists -- see
 * ios/meteocool/lib/WebSettings.swift and its Base Map and Radar Color Map
 * pickers -- so the three platforms describe one set of preferences.
 *
 * Everything goes through `window.settings.set()`, which persists it and fires
 * the setting's callback, exactly as an injection from an app does.
 *
 * Two differences from the apps. The basemap can follow the system scheme,
 * which is the default and what "system" stores. And there is no Experimental
 * Features switch -- nothing in the web app reads it -- but a link to staging,
 * which is where the web's unreleased features actually are.
 */

const BASE_LAYERS = ["system", "light", "dark", "osm", "cyclosm"];
const COLOR_MAPS = ["classic", "nws", "pyart_stepseq", "homeyer", "lang"];

/** The ramp a colormap paints, drizzle to hail, as a CSS gradient. */
function swatch(cmap: string): string {
  const stops: string[] = [];
  for (let dbz = 5; dbz <= 70; dbz += 5) {
    const [r, g, b] = dbz2color(dbz, cmap);
    stops.push(`rgb(${r} ${g} ${b})`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const STAGING = "https://next.meteocool.com";
/** The older staging name, still served; a page opened on it is on staging too. */
const STAGING_ALIAS = "https://web.staging.meteocool.com";
const PRODUCTION = "https://meteocool.com";

/**
 * The other environment, opening on the same view: the query carries the
 * layer, the camera and whatever is selected (lib/urlState.ts). From staging
 * itself the link leads back to production.
 */
const onStaging = window.location.origin === STAGING || window.location.origin === STAGING_ALIAS;
const otherEnvironment = `${onStaging ? PRODUCTION : STAGING}/${window.location.search}${window.location.hash}`;

// Neither has a store: read once, and kept in step by whatever this sets. The
// basemap's store holds the resolved basemap, never "system", so the choice
// itself is read from the setting.
let rotation = window.settings.getBoolean("mapRotation");

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

</script>

<style>
  /* The panel is GlassPanel's, shared with About and Connection Details. This
     is the content: grouped lists in the system's style, a checkmark for the
     chosen row and a switch for each toggle. */
  h2 {
    font: 600 13px/1.3 var(--mc-font);
    color: var(--mc-text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 18px 4px 6px;
  }
  h2:first-child {
    margin-top: 4px;
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
    font: 500 15px/1.3 var(--mc-font);
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

  .detail {
    flex: none;
    color: var(--mc-text-2);
  }

  a.row,
  a.row:visited {
    color: var(--mc-text);
    text-decoration: none;
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
  {/if}

  <h2>{$_("settings.environment")}</h2>
  <div class="group">
    <a class="row" href={otherEnvironment} target="_blank" rel="noopener">
      <span class="label">{$_(onStaging ? "settings.production" : "settings.staging")}</span>
      <span class="detail" aria-hidden="true">↗</span>
    </a>
  </div>
  <p class="hint">{$_(onStaging ? "settings.production_hint" : "settings.staging_hint")}</p>
</GlassPanel>
