<script lang="ts">
/**
 * What the 3D map's controls do and what its marks mean, in a card in a
 * desktop's bottom-left corner, closed into a "?" pill.
 *
 * The 3D map is the one map here a reader cannot read by having seen a radar
 * map before: clouds that peel away and grow back, boxes on the ground, some
 * storms faint, and a mouse that needs its right button to tilt.
 * Without the card nothing on screen says what any of it is. It says so once,
 * beside the map rather than over the storms; closed, it stays closed across visits, and
 * the pill is the way back to it.
 *
 * The swatches are drawn from the same constants and the same palette the map
 * paints with, so the legend cannot drift from what it explains.
 *
 * In the wrappers too, whose native chrome has no legend. On a phone it
 * starts as the pill, and gives way to the storm's sheet, which is where that
 * corner goes when a storm opens.
 */
import { onDestroy } from "svelte";
import { get } from "svelte/store";
import { fade, scale } from "svelte/transition";
import { _ } from "svelte-i18n";
import CloseDisc from "./CloseDisc.svelte";
import { cells3dVisible, radarColormap, selectedCell, selectedVolume, smallScreen } from "../stores";
import { dbzColour, dbzStops } from "../lib/cellVolume";
import { BAND_NAMES } from "../lib/cellMetrics";
import { SEVERITY_COLOURS } from "../layers/cells";
import { VERTICAL_SCALE } from "../layers/terrain";
import { currentLocale } from "../locale/t";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { RING_OPACITY, STRIKE_COLOURS, STRIKE_MINUTES } from "../caps/Cells3DCapability";
import { PEEL_MAX_WIDTH } from "./PeelSlider.svelte";

/** Set once the reader closes the card, so it opens only when asked from then on. */
const CLOSED_KEY = "mc-3d-guide-closed";

function wasClosed(): boolean {
  try { return localStorage.getItem(CLOSED_KEY) === "1"; } catch { return false; }
}

function remember(closed: boolean): void {
  try {
    if (closed) localStorage.setItem(CLOSED_KEY, "1");
    else localStorage.removeItem(CLOSED_KEY);
  } catch { /* storage blocked: the card opens again next visit, which is all that is lost */ }
}

/* Open on a first visit where there is room beside the map for it; a phone's
   map would be most of the way under it. */
let open = !wasClosed() && !get(smallScreen);

function close() {
  open = false;
  remember(true);
}

function show() {
  open = true;
  remember(false);
}

/*
 * A storm opening puts the card away: the storm is framed in the room the
 * panel leaves, the card's corner included, and the panel is where it is
 * explained. Not remembered (the reader did not close it), and not undone
 * when the storm closes, which would be the card jumping back unasked.
 */
$: storm = Boolean($selectedCell || $selectedVolume);
$: if (storm) open = false;

/** The reflectivity the scale spans, as `dbzStops` samples it. */
const SCALE_MIN = 10;
const SCALE_MAX = 70;
const TICKS = [20, 40, 60];

const at = (dbz: number) => ((dbz - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
const rgb = (dbz: number, colormap: string) => `rgb(${dbzColour(dbz, colormap).join(", ")})`;

$: ramp = `linear-gradient(to right, ${dbzStops($radarColormap).map(([dbz, colour]) => `${colour} ${at(dbz)}%`).join(", ")})`;

/* A cloud is three shells, faint envelope to strong core, as the map shades
   one, in the palette the settings name. */
$: shells = [30, 45, 58].map((dbz) => rgb(dbz, $radarColormap));
$: ringColour = rgb(40, $radarColormap);

/*
 * How much of the bottom edge the card or the pill takes, for what stands on
 * that edge beside it: the scan picker's list (ScanPicker).
 */
let cardWidth = 0;
let pillWidth = 0;

/*
 * Whether the peel slider, centred on the bottom edge (PeelSlider), leaves the
 * corner free: then the pill and the card stand on the edge itself, rather
 * than a slider's height above a gap. Too narrow, as on a phone, the slider
 * runs from edge to edge and they stand on it.
 */
const GUTTER = 8;
let viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
/* The card's own width before it has laid out, so it does not open on the
   edge and then jump up onto the slider. */
const CARD_MAX_WIDTH = 344;
$: besidePeel = (viewportWidth - PEEL_MAX_WIDTH) / 2
  >= (open ? cardWidth || CARD_MAX_WIDTH : pillWidth) + 2 * GUTTER;
$: document.documentElement.style.setProperty(
  "--mc-guide-3d-inset", `calc(${open ? cardWidth : pillWidth}px + 2 * var(--mc-gutter))`,
);
onDestroy(() => document.documentElement.style.removeProperty("--mc-guide-3d-inset"));

/** Whether to name the control key as a Mac's keyboard does. */
const mac = dd.isMac();

/* A touch screen as the main pointer has no cursor, right button, wheel or
   control key, so the gestures drawn for those are left out; the compass is
   a button on screen either way. A touchscreen laptop's pointer is fine. */
const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
/* The web's compass disc; the apps draw their own over the webview, so the
   row would explain a button that is not there. */
const compass = !dd.isApp();
</script>

<!-- One cloud, as a swatch: three nested shells, centred in a 32x24 box. -->
{#snippet cloud(colours: string[], opacity = 1)}
  <g opacity={opacity}>
    <ellipse cx="16" cy="13" rx="12" ry="8" fill={colours[0]} opacity="0.55" />
    <ellipse cx="15" cy="12" rx="7.5" ry="5.5" fill={colours[1]} opacity="0.8" />
    <ellipse cx="14.5" cy="11" rx="3.5" ry="3" fill={colours[2]} />
  </g>
{/snippet}

<!-- A storm's box on the ground, seen at the map's tilt, with the 3D tag on its spin axis. -->
{#snippet box(colour: string, opacity: number)}
  <g opacity={opacity}>
    <path d="M3 20H23L29 9H9Z" fill="none" stroke={colour} stroke-width="1.5" stroke-linejoin="round" />
    <rect class="tag" x="10.5" y="11.5" width="11" height="6" rx="3" />
    <circle cx="13.6" cy="14.5" r="1.5" fill={colour} />
  </g>
{/snippet}

<!-- The pointer, tip at the origin. -->
{#snippet cursor(x: number, y: number)}
  <path transform="translate({x} {y})" class="solid" d="M0 0V15.5L3.9 12.1 6.6 18.2 9.1 17.1 6.5 11.1 11.6 10.9Z" />
{/snippet}

<!-- A mouse, with the button the gesture holds filled in. -->
{#snippet mouse(held: "right" | "wheel")}
  <rect x="3.5" y="2.5" width="10" height="17" rx="5" />
  <path d="M3.5 9H13.5" />
  {#if held === "right"}
    <path d="M8.5 2.5V9" />
    <path class="solid" d="M8.5 2.5A5 5 0 0 1 13.5 7.5V9H8.5Z" />
  {:else}
    <rect class="solid" x="7.6" y="3.8" width="1.8" height="3.8" rx="0.9" />
  {/if}
{/snippet}

<!-- Moved in any direction while held. -->
{#snippet anyway()}
  <path d="M25 5.5V16.5M19.5 11H30.5M23.2 7.3 25 5.5 26.8 7.3M23.2 14.7 25 16.5 26.8 14.7M21.3 9.2 19.5 11 21.3 12.8M28.7 9.2 30.5 11 28.7 12.8" />
{/snippet}

{#snippet glyph(kind: "drag" | "right-drag" | "scroll" | "click")}
  <svg class="glyph" viewBox="0 0 32 24" aria-hidden="true">
    {#if kind === "drag"}
      {@render cursor(3, 2.5)}
      {@render anyway()}
    {:else if kind === "right-drag"}
      {@render mouse("right")}
      {@render anyway()}
    {:else if kind === "scroll"}
      {@render mouse("wheel")}
      <path d="M24 4V18M21.5 6.5 24 4 26.5 6.5M21.5 15.5 24 18 26.5 15.5" />
    {:else}
      {@render cursor(13, 5)}
      <path d="M10.5 5H7.5M11.2 3.2 9.4 1.4M13 2.6V0.8" />
    {/if}
  </svg>
{/snippet}

<!-- A gesture as a key cap, named for whoever cannot see the picture. -->
{#snippet gesture(kind: "drag" | "right-drag" | "scroll" | "click", label: string)}
  <kbd class="cap" role="img" aria-label={label} title={label}>{@render glyph(kind)}</kbd>
{/snippet}

{#snippet ctrlDrag()}
  <span class="combo" role="img" aria-label={$_("guide_3d.ctrl_drag")} title={$_("guide_3d.ctrl_drag")}>
    <kbd class:symbol={mac}>{mac ? "⌃" : $_("guide_3d.ctrl")}</kbd>
    <span class="plus" aria-hidden="true">+</span>
    <kbd class="cap">{@render glyph("drag")}</kbd>
  </span>
{/snippet}

<svelte:window bind:innerWidth={viewportWidth} />

{#if open}
  <section
    class="guide glass glass-tray glass-reading"
    class:beside-peel={besidePeel}
    aria-labelledby="guide-3d-title"
    bind:offsetWidth={cardWidth}
    transition:scale={{ start: 0.96, duration: 160 }}>
    <header>
      <h2 id="guide-3d-title">{$_("guide_3d.title")}</h2>
      <CloseDisc material="chrome" on:click={close} />
    </header>

    <div class="body">
      {#if !touch || compass}
      <h3>{$_("guide_3d.controls")}</h3>
      <dl class="controls">
        {#if !touch}
        <dt>{@render gesture("drag", $_("guide_3d.drag"))}</dt>
        <dd>{$_("guide_3d.move")}</dd>
        <dt>
          <!-- A Mac's way first: ⌃-click is its right click, and a trackpad
               has no right button to hold down. -->
          {#if mac}
            {@render ctrlDrag()}
            <span class="or">{$_("guide_3d.or")}</span>
            {@render gesture("right-drag", $_("guide_3d.right_drag"))}
          {:else}
            {@render gesture("right-drag", $_("guide_3d.right_drag"))}
            <span class="or">{$_("guide_3d.or")}</span>
            {@render ctrlDrag()}
          {/if}
        </dt>
        <dd>{$_("guide_3d.turn")}</dd>
        <dt>{@render gesture("scroll", $_("guide_3d.scroll"))}</dt>
        <dd>{$_("guide_3d.zoom")}</dd>
        <dt>{@render gesture("click", $_("guide_3d.click"))}</dt>
        <dd>{$_("guide_3d.click_storm")}</dd>
        {/if}
        {#if compass}
        <dt>
          <span class="compass" role="img" aria-label={$_("guide_3d.compass")}>
            <svg viewBox="0 0 29 29" aria-hidden="true">
              <path fill="#ff453a" d="m10.5 14 4-8 4 8z" />
              <path fill="#8e8e93" d="m10.5 16 4 8 4-8z" />
            </svg>
          </span>
        </dt>
        <dd>{$_("guide_3d.compass_does")}</dd>
        {/if}
      </dl>
      {/if}

      <h3>{$_("guide_3d.legend")}</h3>
      <ul class="legend">
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">{@render cloud(shells)}</svg>
          <div>
            <strong>{$_("guide_3d.clouds")}</strong>
            <span>{$_("guide_3d.clouds_body")}</span>
            <div class="scale" role="img" aria-label={$_("guide_3d.scale_aria", { values: { min: SCALE_MIN, max: SCALE_MAX } })}>
              <div class="ramp" style:background={ramp}></div>
              <div class="ticks" aria-hidden="true">
                {#each TICKS as tick (tick)}
                  <span style:left="{at(tick)}%">{tick}</span>
                {/each}
                <span class="unit">dBZ</span>
              </div>
            </div>
          </div>
        </li>
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">{@render box(ringColour, RING_OPACITY.openable)}</svg>
          <div>
            <strong>{$_("guide_3d.box")}</strong>
            <span>{$_("guide_3d.box_body")}</span>
          </div>
        </li>
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
            <!-- A cut storm: the near half gone, the face it leaves standing. -->
            <path d="M16 3 A12 9 0 0 0 16 21 Z" fill={shells[0]} opacity="0.55" />
            <path d="M16 6.5 A7 6 0 0 0 16 18.5 Z" fill={shells[1]} opacity="0.85" />
            <path d="M16 9 A3.5 3.2 0 0 0 16 15.4 Z" fill={shells[2]} />
            <line x1="16" y1="2" x2="16" y2="22" stroke="currentColor" stroke-width="1.2" opacity="0.7" />
          </svg>
          <div>
            <strong>{$_("guide_3d.cut")}</strong>
            <span>{$_("guide_3d.cut_body")}</span>
          </div>
        </li>
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
            {@render cloud(shells, RING_OPACITY.unopenable)}
            {@render box(ringColour, RING_OPACITY.unopenable)}
          </svg>
          <div>
            <strong>{$_("guide_3d.faint")}</strong>
            <span>{$_("guide_3d.faint_body")}</span>
          </div>
        </li>
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
            <defs>
              <radialGradient id="guide-3d-glow">
                <stop offset="0" stop-color={STRIKE_COLOURS.glow} stop-opacity="0.75" />
                <stop offset="1" stop-color={STRIKE_COLOURS.glow} stop-opacity="0" />
              </radialGradient>
            </defs>
            <circle cx="12" cy="14" r="8" fill="url(#guide-3d-glow)" />
            <circle cx="12" cy="14" r="2.4" fill={STRIKE_COLOURS.core} stroke={STRIKE_COLOURS.rim} />
            <circle cx="22" cy="9" r="6" fill="url(#guide-3d-glow)" opacity="0.5" />
            <circle cx="22" cy="9" r="1.8" fill={STRIKE_COLOURS.core} stroke={STRIKE_COLOURS.rim} opacity="0.5" />
          </svg>
          <div>
            <strong>{$_("guide_3d.lightning")}</strong>
            <span>{$_("guide_3d.lightning_body", { values: { minutes: STRIKE_MINUTES } })}</span>
          </div>
        </li>
        <li>
          <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
            <!-- The draped radar: a patch of the ramp, lying flat. -->
            <path d="M7 8 H29 L25 19 H3 Z" fill={shells[0]} opacity="0.45" />
            <path d="M13 10.5 H23 L21 16.5 H11 Z" fill={shells[1]} opacity="0.5" />
          </svg>
          <div>
            <strong>{$_("guide_3d.ground")}</strong>
            <span>{$_("guide_3d.ground_body")}</span>
          </div>
        </li>
        {#if $cells3dVisible}
          <li>
            <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
              <!-- Stacked tiers, glassy shell over a solid core, on a footprint. -->
              <ellipse cx="16" cy="19" rx="12" ry="4" fill="none" stroke={SEVERITY_COLOURS[2]} stroke-width="1.2" opacity="0.7" />
              <rect x="7" y="7" width="18" height="12" rx="1" fill={shells[0]} opacity="0.3" />
              <rect x="12" y="3" width="8" height="16" rx="1" fill={shells[2]} />
            </svg>
            <div>
              <strong>{$_("guide_3d.cells")}</strong>
              <span>{$_("guide_3d.cells_body")}</span>
              <span class="bands">
                {#each BAND_NAMES as band, severity (band)}
                  <span class="band"><i style:background={SEVERITY_COLOURS[severity]}></i>{$_(`storm.band.${band}`)}</span>
                {/each}
              </span>
            </div>
          </li>
        {/if}
      </ul>
      <p class="note">{$_("guide_3d.heights", { values: { scale: VERTICAL_SCALE.toLocaleString(currentLocale()) } })}</p>
    </div>
  </section>
{:else if !(storm && $smallScreen)}
  <button
    type="button"
    class="pill glass glass-pill"
    class:beside-peel={besidePeel}
    aria-label={$_("guide_3d.open")}
    title={$_("guide_3d.open")}
    bind:offsetWidth={pillWidth}
    on:click={show}
    in:fade={{ duration: 120 }}>
    <span class="mark" aria-hidden="true">?</span>
    <span>{$_("guide_3d.pill")}</span>
  </button>
{/if}

<style>
  /* Bottom left, where the flat map keeps its tray and the 3D map has none:
     clear of the control column on the right and the storm panel at the top
     right. The attribution keeps to the right of it; see Map.svelte. */
  .guide,
  .pill {
    position: absolute;
    left: calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    /* Above the peel slider, which takes the bottom edge (PeelSlider). */
    bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter) + var(--mc-peel-h, 0px));
    z-index: var(--mc-z-chrome);
  }
  /* Level with the slider instead, where it leaves the corner free. */
  .guide.beside-peel,
  .pill.beside-peel {
    bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter));
  }

  .guide {
    display: flex;
    flex-direction: column;
    width: min(344px, calc(100% - 2 * var(--mc-gutter))); /* CARD_MAX_WIDTH */
    /* Under the top line's chrome, at the shortest. */
    max-height: calc(100% - var(--mc-top-stack) - var(--mc-control-lg) - 2 * var(--mc-gutter) - var(--mc-safe-bottom) - var(--mc-peel-h, 0px));
    box-sizing: border-box;
    transform-origin: bottom left;
  }

  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    padding: 12px 12px 2px var(--mc-drawer-pad);
  }
  h2 {
    margin: 0;
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
  }

  .body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--mc-fade-top) var(--mc-drawer-pad) 16px;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--mc-fade-top));
    mask-image: linear-gradient(to bottom, transparent, #000 var(--mc-fade-top));
    font: 400 13px/1.35 var(--mc-font);
  }

  h3 {
    margin: 0 0 8px;
    font: var(--mc-type-label);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--mc-text-2);
  }
  h3:not(:first-child) {
    margin-top: 16px;
  }

  .controls {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px 12px;
    margin: 0;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  dd {
    margin: 0;
  }
  /* Key caps: a key's name, or a picture of a gesture in the same cap. */
  kbd {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-width: 26px;
    height: 26px;
    padding: 0 7px;
    border-radius: 7px;
    background: var(--mc-tint);
    box-shadow: inset 0 0 0 0.5px var(--mc-separator), 0 1px 0 var(--mc-separator);
    font: 600 12px/1 var(--mc-font);
    white-space: nowrap;
  }
  kbd.cap {
    padding: 0 4px;
  }
  /* ⌃ is a small glyph in most faces; at the name's size it reads as a speck. */
  kbd.symbol {
    font-size: 15px;
  }
  .glyph {
    width: 30px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .glyph :global(.solid) {
    fill: currentColor;
    stroke: none;
  }
  .combo {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .plus,
  .or {
    font: var(--mc-type-label);
    color: var(--mc-text-2);
  }
  /* The compass disc in miniature, needle and all, so it is recognisably the
     button in the column on the right. */
  .compass {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--mc-tint);
    box-shadow: inset 0 0 0 0.5px var(--mc-separator);
  }
  .compass svg {
    width: 22px;
    height: 22px;
  }

  .legend {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .legend li {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 10px;
    align-items: start;
  }
  .swatch {
    width: 32px;
    height: 24px;
    color: var(--mc-text);
  }
  /* The 3D tag, as the map draws it: a pale pill with a faint edge. */
  .swatch :global(.tag) {
    fill: var(--mc-glass-fill-solid);
    stroke: currentColor;
    stroke-opacity: 0.25;
    stroke-width: 0.8;
  }
  .legend strong {
    font-weight: 600;
  }
  .legend span {
    color: var(--mc-text-2);
  }

  .scale {
    margin-top: 6px;
  }
  .ramp {
    height: 6px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 0.5px var(--mc-separator);
  }
  .ticks {
    position: relative;
    height: 14px;
    margin-top: 2px;
    font: 500 10px/14px var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
  }
  .ticks .unit {
    right: 0;
    transform: none;
  }

  .bands {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 4px;
  }
  .legend .band {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: var(--mc-type-label);
  }
  .band i {
    width: 10px;
    height: 3px;
    border-radius: 1.5px;
  }

  .note {
    margin: 12px 0 0;
    font: var(--mc-type-label);
    color: var(--mc-text-2);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px 0 5px;
    font: var(--mc-type-label);
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast), transform var(--mc-motion-fast) var(--mc-ease);
  }
  .pill:hover {
    background: var(--mc-glass-fill-strong);
  }
  .pill:active {
    transform: scale(var(--mc-press));
  }
  .pill:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--mc-tint);
    font: 700 13px/1 var(--mc-font);
  }

  /* A phone runs the credits up the right edge (Map.svelte); the card stops
     short of them. */
  @media only screen and (max-width: 620px) {
    .guide {
      width: calc(100% - var(--mc-gutter) - 32px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pill {
      transition: none;
    }
    .pill:active {
      transform: none;
    }
  }
</style>
