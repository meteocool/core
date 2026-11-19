<script lang="ts">
/**
 * Studio's tools: the section planes, the camera, the basemap, and how the
 * clouds are drawn (their style, lib/cloudStyle.ts, and their peel). A
 * panel down the left edge, as a CAD program's inspector is.
 *
 * The planes are the scene's own (lib/studio/planes.ts): added here where
 * the camera is looking, then turned, leaned, pushed and thinned to a slab
 * with the selected one's controls. A plane that stands on the ground is
 * also dragged by its handle on the map.
 */
import { _ } from "svelte-i18n";
import logo from "../../assets/logo.svg";
import { faTrash } from "@fortawesome/free-solid-svg-icons/faTrash";
import { faRightLeft } from "@fortawesome/free-solid-svg-icons/faRightLeft";
import { faEye } from "@fortawesome/free-solid-svg-icons/faEye";
import { faEyeSlash } from "@fortawesome/free-solid-svg-icons/faEyeSlash";
import { faVideo } from "@fortawesome/free-solid-svg-icons/faVideo";
import { faCamera } from "@fortawesome/free-solid-svg-icons/faCamera";
import { faCircleDot } from "@fortawesome/free-solid-svg-icons/faCircleDot";
import { BASE_LAYERS } from "../../lib/baseLayers";
import { mapBaseLayer } from "../../stores";
import Icon from "../Icon.svelte";
import Segmented from "../Segmented.svelte";
import CloseDisc from "../CloseDisc.svelte";
import { cloudStyle, peelLevel, peelManual } from "../../stores";
import { CLOUD_STYLES, isMapStyle } from "../../lib/cloudStyle";
import StyleGlyph from "../StyleGlyph.svelte";
import type { CloudStyle } from "../../lib/cloudStyle";
import type { Director } from "../../lib/studio/director";
import { LENSES, LENS_FOV, lensOf, VIEWS } from "../../lib/studio/camera";
import type { LensName } from "../../lib/studio/camera";
import {
  flipped, foldDegrees, isLevel, MAX_PLANES, nextPlaneId, planeAt, PLANE_TOP_KM, pushed,
} from "../../lib/studio/planes";
import type { SectionPlane } from "../../lib/studio/planes";
import { STUDIO_BASEMAP, studioFov, studioPlanes, studioScene, studioSelectedPlane } from "../../lib/studio/store";

export let director: Director;
export let onclose: () => void;

/** As thick as a new slab is, and as thin and thick as one goes, km. */
const SLAB_KM = 4;
const SLAB_RANGE: [number, number] = [0.5, 30];
/** As far as the push slider carries a plane to either side before it is let go, km. */
const PUSH_KM = 40;

/* What the add buttons start with: the plane they add, seen edge on, an
   upright dash and a level one. In Font Awesome's shape, for Icon.svelte. */
const UPRIGHT_GLYPH = { icon: [512, 512, [], "", "M256 48a48 48 0 0 1 48 48v320a48 48 0 0 1-96 0V96a48 48 0 0 1 48-48z"] };
const LEVEL_GLYPH = { icon: [512, 512, [], "", "M48 256a48 48 0 0 1 48-48h320a48 48 0 0 1 0 96H96a48 48 0 0 1-48-48z"] };

/**
 * The basemaps Settings offers, in its order: following the system, then
 * every one drawn, less the old name the light one still answers to.
 */
const BASEMAPS = ["system", ...BASE_LAYERS.filter((name) => name !== "topographic")];

/* Studio's own basemap, the `studioBaseLayer` setting, which starts on the
   imagery (STUDIO_BASEMAP) and is kept apart from the map's. The store holds
   the basemap it resolves to, never "system", so the choice itself is read
   from the setting, again whenever the store moves. */
const chosenBasemap = (_resolved?: string) => window.settings.getString<string>("studioBaseLayer", STUDIO_BASEMAP);
let basemap = chosenBasemap();
$: basemap = chosenBasemap($mapBaseLayer);

function setBasemap(event: Event) {
  basemap = (event.currentTarget as HTMLSelectElement).value;
  window.settings.set("studioBaseLayer", basemap);
}

$: selected = $studioPlanes.find((plane) => plane.id === $studioSelectedPlane) ?? null;
$: lens = lensOf($studioFov);

function add(kind: "upright" | "level") {
  const camera = director.capture()?.camera;
  if (!camera || $studioPlanes.length >= MAX_PLANES) return;
  // An id no keyframe knows either, or the new plane would move as an old one did.
  const used = $studioScene.keyframes.flatMap((keyframe) => keyframe.planes.map((plane) => plane.id));
  const plane = planeAt(nextPlaneId($studioPlanes, used), camera, kind);
  studioPlanes.update((planes) => [...planes, plane]);
  studioSelectedPlane.set(plane.id);
}

function change(patch: Partial<SectionPlane> | ((plane: SectionPlane) => SectionPlane)) {
  const id = $studioSelectedPlane;
  studioPlanes.update((planes) => planes.map((plane) => {
    if (plane.id !== id) return plane;
    return typeof patch === "function" ? patch(plane) : { ...plane, ...patch };
  }));
}

/** Take a plane out of the scene; if it was the selected one, the first left is selected. */
function remove(id: number) {
  let left: SectionPlane[] = [];
  studioPlanes.update((planes) => (left = planes.filter((plane) => plane.id !== id)));
  if ($studioSelectedPlane === id) studioSelectedPlane.set(left[0]?.id ?? null);
}

/** Turn the selected plane to face the camera, so its cut is what is looked at. */
function faceCamera() {
  const camera = director.capture()?.camera;
  if (camera) change({ facingDeg: foldDegrees(camera.bearing + 180) });
}

/* The push slider springs back: it carries the plane along the way it faces
   while held, from where the plane stood when it was taken hold of, and is
   back in the middle once let go, ready to carry it further. */
let pushFrom: SectionPlane | null = null;
let pushKm = 0;
function push(event: Event) {
  if (!selected) return;
  pushFrom ??= selected;
  pushKm = Number((event.currentTarget as HTMLInputElement).value);
  const from = pushFrom;
  change((plane) => ({ ...plane, ...pushed({ ...from, facingDeg: plane.facingDeg, tiltDeg: plane.tiltDeg }, pushKm) }));
}
function letGo() {
  pushFrom = null;
  pushKm = 0;
}

const number = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);

/** What a plane is called in the list: how it stands, and which way. */
function nameOf(plane: SectionPlane): string {
  if (isLevel(plane)) return $_("studio.plane.level_at", { values: { km: plane.heightKm.toFixed(1) } });
  return $_("studio.plane.upright_at", { values: { deg: Math.round(plane.facingDeg) } });
}

function setLens(name: LensName) {
  studioFov.set(LENS_FOV[name]);
}

/**
 * The reader's own choice, kept as the map's pill keeps it (the
 * `layer3dStyle` setting) when the map offers it too. A Studio style goes to
 * the store alone, and leaving Studio hands the map back its own.
 */
function setStyle(style: CloudStyle) {
  cloudStyle.set(style);
  if (isMapStyle(style)) window.settings.set("layer3dStyle", style);
}

function peel(event: Event) {
  peelManual.set(true);
  peelLevel.set(number(event));
}
</script>

<section class="panel glass glass-tray glass-reading" aria-label={$_("studio.title")}>
  <header>
    <h2><img src={logo} alt="" class="logo" /><span><span class="brand">meteocool</span> Studio</span></h2>
    <CloseDisc on:click={onclose} />
  </header>

  <div class="body">
    <h3>{$_("studio.planes")}</h3>
    <div class="row">
      <button type="button" class="chip" disabled={$studioPlanes.length >= MAX_PLANES} on:click={() => add("upright")}>
        <Icon icon={UPRIGHT_GLYPH} /> {$_("studio.plane.upright")}
      </button>
      <button type="button" class="chip" disabled={$studioPlanes.length >= MAX_PLANES} on:click={() => add("level")}>
        <Icon icon={LEVEL_GLYPH} /> {$_("studio.plane.level")}
      </button>
    </div>
    {#if $studioPlanes.length}
      <ul class="planes">
        {#each $studioPlanes as plane (plane.id)}
          <li>
            <button
              type="button"
              class="plane"
              class:on={plane.id === $studioSelectedPlane}
              class:off={!plane.enabled}
              aria-pressed={plane.id === $studioSelectedPlane}
              on:click={() => studioSelectedPlane.set(plane.id)}>
              <span class="tag">{plane.id}</span>{nameOf(plane)}
            </button>
            <button type="button" class="drop" on:click={() => remove(plane.id)}
              aria-label={$_("studio.plane.remove", { values: { id: plane.id } })}
              title={$_("studio.plane.remove", { values: { id: plane.id } })}>
              <Icon icon={faTrash} />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">{$_("studio.plane.none")}</p>
    {/if}

    {#if selected}
      <div class="controls">
        {#if !isLevel(selected)}
          <label>
            <span>{$_("studio.plane.facing")}</span>
            <input type="range" min="0" max="359" step="1" value={Math.round(selected.facingDeg) % 360}
              on:input={(event) => change({ facingDeg: number(event) })} />
            <output>{Math.round(selected.facingDeg) % 360}°</output>
          </label>
        {/if}
        <label>
          <span>{$_("studio.plane.tilt")}</span>
          <input type="range" min="-90" max="90" step="1" value={selected.tiltDeg}
            on:input={(event) => change({ tiltDeg: number(event) })} />
          <output>{Math.round(selected.tiltDeg)}°</output>
        </label>
        {#if selected.tiltDeg !== 0}
          <label>
            <span>{$_("studio.plane.height")}</span>
            <input type="range" min="0" max={PLANE_TOP_KM} step="0.1" value={selected.heightKm}
              on:input={(event) => change({ heightKm: number(event) })} />
            <output>{selected.heightKm.toFixed(1)} km</output>
          </label>
        {/if}
        {#if !isLevel(selected)}
          <label>
            <span>{$_("studio.plane.push")}</span>
            <input type="range" class="spring" min={-PUSH_KM} max={PUSH_KM} step="0.25" value={pushKm}
              on:input={push} on:change={letGo} />
            <output>{pushKm > 0 ? "+" : ""}{pushKm.toFixed(1)} km</output>
          </label>
        {/if}
        <label>
          <span>
            <input type="checkbox" checked={selected.slabKm !== null}
              on:change={(event) => change({ slabKm: event.currentTarget.checked ? SLAB_KM : null })} />
            {$_("studio.plane.slab")}
          </span>
          <input type="range" min={SLAB_RANGE[0]} max={SLAB_RANGE[1]} step="0.5" value={selected.slabKm ?? SLAB_KM}
            disabled={selected.slabKm === null}
            on:input={(event) => change({ slabKm: number(event) })} />
          <output>{selected.slabKm === null ? "" : `${selected.slabKm.toFixed(1)} km`}</output>
        </label>
        <div class="row">
          <button type="button" class="chip" on:click={() => change(flipped)} title={$_("studio.plane.flip_title")}>
            <Icon icon={faRightLeft} /> {$_("studio.plane.flip")}
          </button>
          {#if !isLevel(selected)}
            <button type="button" class="chip" on:click={faceCamera} title={$_("studio.plane.face_camera_title")}>
              <Icon icon={faVideo} /> {$_("studio.plane.face_camera")}
            </button>
          {/if}
          <button type="button" class="chip icon" on:click={() => change({ enabled: !selected?.enabled })}
            aria-label={$_(selected.enabled ? "studio.plane.hide" : "studio.plane.show")}
            title={$_(selected.enabled ? "studio.plane.hide" : "studio.plane.show")}>
            <Icon icon={selected.enabled ? faEye : faEyeSlash} />
          </button>
        </div>
      </div>
    {/if}

    <h3><Icon icon={faCamera} /> {$_("studio.camera")}</h3>
    <div class="views" role="group" aria-label={$_("studio.view.aria")}>
      {#each VIEWS as view (view)}
        <button type="button" class="chip" on:click={() => director.lookFrom(view)} title={$_(`studio.view.${view}_title`)}>
          {$_(`studio.view.${view}`)}
        </button>
      {/each}
    </div>
    <div class="lens">
      <span class="caption"><Icon icon={faCircleDot} /> {$_("studio.lens.label")}</span>
      <Segmented
        compact
        stretch
        label={$_("studio.lens.label")}
        options={LENSES.map((name) => ({ value: name, label: $_(`studio.lens.${name}`) }))}
        value={lens ?? "normal"}
        on:change={(event) => setLens(event.detail)} />
    </div>

    <h3 id="studio-basemap">{$_("studio.basemap")}</h3>
    <select class="basemap" value={basemap} aria-labelledby="studio-basemap" on:change={setBasemap}>
      {#each BASEMAPS as name (name)}
        <option value={name}>
          {$_(`settings.base_layers.${name}`)}{name === "system" ? ` · ${$_(`settings.base_layers.${$mapBaseLayer}`)}` : ""}
        </option>
      {/each}
    </select>

    <h3>{$_("studio.clouds")}</h3>
    <div class="lens">
      <span class="caption" id="studio-style">{$_("style_3d.title")}</span>
      <!-- Every style, the shells among them, each as the map's pill draws it. -->
      <div class="styles" role="radiogroup" aria-labelledby="studio-style">
        {#each CLOUD_STYLES as style (style)}
          <button type="button" class="style" role="radio" aria-checked={$cloudStyle === style}
            class:on={$cloudStyle === style} on:click={() => setStyle(style)}>
            <StyleGlyph {style} small />
            <span>{$_(`style_3d.${style}`)}</span>
          </button>
        {/each}
      </div>
      {#if $cloudStyle === "shells" && !$studioPlanes.length}
        <p class="hint">{$_("studio.shells_hint")}</p>
      {/if}
    </div>
    <div class="controls">
      <label>
        <span>{$_("guide_3d.peel")}</span>
        <input type="range" min="0" max="1" step="0.01" value={$peelLevel} aria-label={$_("guide_3d.peel_aria")}
          on:input={peel} />
        <output>{Math.round($peelLevel * 100)}%</output>
      </label>
    </div>
  </div>
</section>

<style>
  .panel {
    position: absolute;
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
    left: calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    z-index: var(--mc-z-chrome);
    display: flex;
    flex-direction: column;
    width: 296px;
    max-height: calc(100% - var(--mc-top-stack) - var(--mc-control-lg) - 3 * var(--mc-gutter) - var(--studio-dock-h, 0px));
    box-sizing: border-box;
    color: var(--mc-text);
    font: 13px/1.35 var(--mc-font);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 4px 16px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
  }
  /* As the top-left logo draws it, a size down for the panel's title. */
  .logo {
    flex: none;
    width: 24px;
    height: 24px;
    filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.28));
  }
  .brand { font-weight: 400; color: var(--mc-text-2); }
  .body {
    min-height: 0;
    overflow-y: auto;
    padding: 0 16px 14px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 14px 0 8px;
    font: 600 11px/1 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--mc-text-2);
  }
  .hint {
    margin: 8px 0 0;
    color: var(--mc-text-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .views {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    white-space: nowrap;
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:active { transform: scale(var(--mc-press)); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip:disabled { cursor: default; opacity: 0.45; }
  .chip.icon { width: var(--mc-pill-h); padding: 0; }
  .chip :global(svg) { width: 11px; height: 11px; }

  .planes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .planes li {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .plane {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: transparent;
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    text-align: left;
    cursor: pointer;
  }
  .plane:hover { background: var(--mc-tint); }
  .plane.on { background: color-mix(in srgb, var(--studio-accent) 22%, transparent); }
  .plane.off { color: var(--mc-text-3); }
  .plane:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  /* Every row's own way out, not only the selected one's. */
  .drop {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: transparent;
    color: var(--mc-text-2);
    cursor: pointer;
  }
  .drop :global(svg) { width: 12px; height: 12px; }
  .drop:hover { background: var(--mc-tint); color: #ff453a; }
  .drop:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  .tag {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--studio-accent);
    color: #1c1c1e;
    font: 700 11px/1 var(--mc-font);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  .controls label {
    display: grid;
    grid-template-columns: 84px 1fr 54px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .controls label > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--mc-text-2);
  }
  .controls .row { margin-top: 4px; }
  output {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--mc-text);
  }
  input[type="range"] {
    min-width: 0;
    width: 100%;
    height: 20px;
    margin: 0;
    accent-color: var(--studio-accent);
    cursor: pointer;
  }
  input[type="checkbox"] {
    margin: 0;
    accent-color: var(--studio-accent);
  }
  .lens {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  .caption {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--mc-text-2);
  }
  h3 :global(svg), .caption :global(svg) { width: 11px; height: 11px; }
  .basemap {
    width: 100%;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 8px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
  }
  .basemap:hover { background: var(--mc-tint-hover); }
  .basemap:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  /* The storm styles: a picture over its name, as many to a row as fit. */
  .styles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: 4px;
  }
  .style {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 6px 2px 5px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
    color: var(--mc-text-2);
    font: 600 11px/1.1 var(--mc-font);
    cursor: pointer;
  }
  .style span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .style:hover { background: var(--mc-tint-hover); color: var(--mc-text); }
  .style.on {
    background: color-mix(in srgb, var(--studio-accent) 22%, transparent);
    box-shadow: inset 0 0 0 1.5px var(--studio-accent);
    color: var(--mc-text);
  }
  .style:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
</style>
