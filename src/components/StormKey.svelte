<script lang="ts">
/**
 * What the storm marks on the flat map mean, behind a pill in the player.
 *
 * The map draws two trackers' storms side by side over Germany: DWD's
 * KONRAD3D, with a forecast, hail and rotation, and meteocool's own, which
 * has none of those and covers every network. Their shapes tell them apart
 * (layers/cells.ts), and nothing on screen said so; nor what the colours,
 * rings, dotted joins, badges and "3D" tags are. This says it, once, where
 * the radar's own colour scale already is.
 *
 * The swatches are drawn from the constants the map paints with, so the key
 * cannot drift from the marks it explains. A popover rather than a card that
 * stays: it is looked up, not read alongside the map.
 *
 * Each row switches its mark off the map, and each strength chip its
 * storms (`hiddenStormMarks`); the pill carries a dot while any is off, so a
 * map with storms missing says why.
 */
import { onDestroy, tick } from "svelte";
import { _ } from "svelte-i18n";
import CloseDisc from "./CloseDisc.svelte";
import SourceBadge from "./SourceBadge.svelte";
import { cycloneLayerVisible, hiddenStormMarks, smallScreen } from "../stores";
import type { StormMarkToggle } from "../stores";
import { DIAMOND_REACH, SEVERITY_COLOURS } from "../layers/cells";
import { BAND_NAMES } from "../lib/cellMetrics";
import { hideNativeControls } from "../lib/nativeBridge";
import { topStackPx } from "../lib/safeArea";
import mesocycloneIcon from "../assets/mesocyclone.png";

/** Space kept between the card and the window's edges, and above the pill. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
let card: HTMLDivElement | undefined;
let left = MARGIN;
let bottom = 0;
/** The room above the pill and under the top chrome (the safe area), which the card scrolls within. */
let maxHeight = 0;

async function show() {
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  maxHeight = rect.top - MARGIN - Math.max(MARGIN, topStackPx());
  open = true;
  await tick();
  if (!card) return;
  // Over the pill, kept inside the window; on a phone the stylesheet makes
  // it the window's width.
  const width = card.offsetWidth;
  left = Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN));
}

function close(refocus = false) {
  open = false;
  if (refocus) tick().then(() => trigger?.focus());
}

/** Anything outside the card and its pill closes it, as a popover does. */
function outside(event: PointerEvent) {
  if (!open) return;
  const target = event.target as Node;
  if (card?.contains(target) || trigger?.contains(target)) return;
  close();
}

function keydown(event: KeyboardEvent) {
  if (!open || event.key !== "Escape") return;
  event.stopPropagation();
  close(true);
}

/* The apps' buttons float down the right edge, outside the page: they go
   while the card is up, as they do for the product menu. */
let releaseControls: (() => void) | null = null;
function hideControls(hide: boolean) {
  if (hide && !releaseControls) releaseControls = hideNativeControls();
  else if (!hide && releaseControls) {
    releaseControls();
    releaseControls = null;
  }
}
$: hideControls(open);
onDestroy(() => hideControls(false));

function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

/** Turn one kind of mark, a tracker's storms or a strength's on or off. */
function flip(mark: StormMarkToggle) {
  hiddenStormMarks.update((hidden) => new Set(
    hidden.has(mark) ? [...hidden].filter((other) => other !== mark) : [...hidden, mark],
  ));
}

/** A strong storm's colour, for the swatches that are about something else. */
const STRONG = SEVERITY_COLOURS[2];
const MODERATE = SEVERITY_COLOURS[1];
/** The diamond's half-diagonal for a circle of radius 6 in the swatches, as the map scales it. */
const D = 7 * DIAMOND_REACH;
/** A smaller one, with a badge above it. */
const B = 5 * DIAMOND_REACH;
</script>

<svelte:window on:pointerdown={outside} on:keydown={keydown} on:resize={() => close()} />

<button
  bind:this={trigger}
  type="button"
  class="pill"
  aria-haspopup="dialog"
  aria-expanded={open}
  class:filtered={$hiddenStormMarks.size > 0 || !$cycloneLayerVisible}
  title={$_("storm.key.open")}
  on:click={() => (open ? close() : show())}>
  <svg viewBox="0 0 22 12" aria-hidden="true">
    <path d="M6 1 11 6 6 11 1 6Z" fill={STRONG} />
    <circle cx="16.5" cy="6" r="4.5" fill={MODERATE} />
  </svg>
  <span>{$_("storm.key.pill")}</span>
</button>

<!-- A row's switch: on while the map draws that mark. -->
{#snippet toggle(mark: StormMarkToggle)}
  <input type="checkbox" role="switch" class="switch" checked={!$hiddenStormMarks.has(mark)}
    aria-label={$_("storm.key.show", { values: { mark: $_(`storm.key.${mark}`) } })}
    on:change={() => flip(mark)} />
{/snippet}

{#if open}
  <div
    bind:this={card}
    use:portal
    class="card glass glass-strong"
    class:phone={$smallScreen}
    role="dialog"
    aria-labelledby="storm-key-title"
    style:left={$smallScreen ? undefined : `${left}px`}
    style:bottom={`${bottom}px`}
    style:max-height={`${maxHeight}px`}>
    <header>
      <h2 id="storm-key-title">{$_("storm.key.title")}</h2>
      <CloseDisc material="chrome" on:click={() => close(true)} />
    </header>

    <ul>
      <li class:off={$hiddenStormMarks.has("dwd")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <path d="M16 {12 - D} {16 + D} 12 16 {12 + D} {16 - D} 12Z" fill={STRONG} stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
        <div>
          <strong>{$_("storm.key.dwd")} <SourceBadge source="dwd" /></strong>
          <span>{$_("storm.key.dwd_body")}</span>
        </div>
        {@render toggle("dwd")}
      </li>
      <li class:off={$hiddenStormMarks.has("meteocool")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <circle cx="16" cy="12" r="7" fill={STRONG} stroke="#fff" stroke-width="1.5" />
        </svg>
        <div>
          <strong>{$_("storm.key.meteocool")} <SourceBadge source="meteocool" /></strong>
          <span>{$_("storm.key.meteocool_body")}</span>
        </div>
        {@render toggle("meteocool")}
      </li>
      <li>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          {#each SEVERITY_COLOURS as colour, i (colour)}
            <circle cx={5 + i * 7.3} cy="12" r="3.2" fill={colour} />
          {/each}
        </svg>
        <div>
          <strong>{$_("storm.key.strength")}</strong>
          <span class="bands">
            {#each SEVERITY_COLOURS as colour, i (colour)}
              <button type="button" class="band" aria-pressed={!$hiddenStormMarks.has(BAND_NAMES[i])}
                on:click={() => flip(BAND_NAMES[i])}>
                <i style:background={colour}></i>{$_(`storm.band.${BAND_NAMES[i]}`)}
              </button>
            {/each}
          </span>
        </div>
      </li>
      <li class:off={$hiddenStormMarks.has("live")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <circle cx="16" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3.2 2.6" opacity="0.8" />
          <circle cx="16" cy="12" r="5" fill={MODERATE} stroke="#fff" stroke-width="1.5" />
        </svg>
        <div>
          <strong>{$_("storm.key.live")}</strong>
          <span>{$_("storm.key.live_body")}</span>
        </div>
        {@render toggle("live")}
      </li>
      <li class:off={$hiddenStormMarks.has("path")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <path d="M2 18 L12 14 L20 11" fill="none" stroke={MODERATE} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="24" cy="9.5" r="4.5" fill={MODERATE} stroke="#fff" stroke-width="1.5" />
        </svg>
        <div>
          <strong>{$_("storm.key.path")}</strong>
          <span>{$_("storm.key.path_body")}</span>
        </div>
        {@render toggle("path")}
      </li>
      <li class:off={$hiddenStormMarks.has("join")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <path d="M3 18 L29 6" fill="none" stroke={MODERATE} stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.1 5" />
        </svg>
        <div>
          <strong>{$_("storm.key.join")}</strong>
          <span>{$_("storm.key.join_body")}</span>
        </div>
        {@render toggle("join")}
      </li>
      <li class:off={$hiddenStormMarks.has("hail")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <path d="M16 {16 - B} {16 + B} 16 16 {16 + B} {16 - B} 16Z" fill={STRONG} stroke="#e03131" stroke-width="2.6" stroke-linejoin="round" />
          <text x="16" y="9" text-anchor="middle" class="glyph" fill={STRONG}>✦</text>
        </svg>
        <div>
          <strong>{$_("storm.key.hail")}</strong>
          <span>{$_("storm.key.hail_body")}</span>
        </div>
        {@render toggle("hail")}
      </li>
      <li class:off={$hiddenStormMarks.has("rotation")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <path d="M16 {16 - B} {16 + B} 16 16 {16 + B} {16 - B} 16Z" fill={STRONG} stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
          <text x="16" y="9" text-anchor="middle" class="glyph" fill={STRONG}>↻</text>
        </svg>
        <div>
          <strong>{$_("storm.key.rotation")}</strong>
          <span>{$_("storm.key.rotation_body")}</span>
        </div>
        {@render toggle("rotation")}
      </li>
      <li class:off={$hiddenStormMarks.has("forecast")}>
        <svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
          <ellipse cx="18" cy="12" rx="12" ry="8" fill="none" stroke={MODERATE} stroke-width="1.6" stroke-dasharray="4 3" />
          <ellipse cx="13" cy="12" rx="6" ry="4" fill="none" stroke={MODERATE} stroke-width="1.6" stroke-dasharray="4 3" />
          <circle cx="13" cy="12" r="1.6" fill={MODERATE} />
          <circle cx="20" cy="12" r="1.6" fill={MODERATE} />
        </svg>
        <div>
          <strong>{$_("storm.key.forecast")}</strong>
          <span>{$_("storm.key.forecast_body")}</span>
        </div>
        {@render toggle("forecast")}
      </li>
      <li class:off={$hiddenStormMarks.has("volume")}>
        <svg class="swatch" viewBox="0 0 34 18" aria-hidden="true">
          <rect class="tag" x="0.5" y="0.5" width="33" height="17" rx="8.5" />
          <path d="M10 4 L14.5 6.5 L14.5 11.5 L10 14 L5.5 11.5 L5.5 6.5 Z" fill={STRONG} />
          <text class="tag-text" x="23.5" y="12.6" text-anchor="middle">3D</text>
        </svg>
        <div>
          <strong>{$_("storm.key.volume")}</strong>
          <span>{$_("storm.key.volume_body")}</span>
        </div>
        {@render toggle("volume")}
      </li>
      <li class:off={!$cycloneLayerVisible}>
        <img class="swatch" src={mesocycloneIcon} alt="" />
        <div>
          <strong>{$_("storm.key.mesocyclone")}</strong>
          <span>{$_("storm.key.mesocyclone_body")}</span>
        </div>
        <input type="checkbox" role="switch" class="switch" checked={$cycloneLayerVisible}
          aria-label={$_("storm.key.show", { values: { mark: $_("storm.key.mesocyclone") } })}
          on:change={(e) => cycloneLayerVisible.set(e.currentTarget.checked)} />
      </li>
    </ul>
  </div>
{/if}

<style>
  button {
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
  }
  /* The product picker's pill, beside it in the player's head. */
  .pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    box-sizing: border-box;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 11px/1 var(--mc-font);
    white-space: nowrap;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .pill svg { width: 18px; height: 10px; }

  .card {
    position: fixed;
    z-index: var(--mc-z-dialog);
    width: min(340px, calc(100vw - 16px));
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 14px 8px;
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-ring-lg);
    font-family: var(--mc-font);
    color: var(--mc-text);
  }
  .card.phone {
    left: 8px;
    right: 8px;
    width: auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0;
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 0;
  }
  li + li { border-top: 0.5px solid var(--mc-separator); }
  .swatch {
    flex: 0 0 32px;
    width: 32px;
    height: 24px;
    margin-top: 1px;
    object-fit: contain;
  }
  li div {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 600 13px/1.3 var(--mc-font);
  }
  li span {
    font: 400 12px/1.35 var(--mc-font);
    color: var(--mc-text-2);
  }
  .glyph {
    font: bold 11px sans-serif;
    stroke: #fff;
    stroke-width: 2;
    paint-order: stroke;
  }
  .tag {
    fill: var(--mc-glass-fill-strong);
    stroke: var(--mc-separator);
  }
  .tag-text {
    font: 700 9.5px -apple-system, system-ui, sans-serif;
    fill: var(--mc-text);
  }
  .bands {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  .band {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px 2px 5px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 500 12px/1.35 var(--mc-font);
  }
  .band[aria-pressed="false"] {
    background: none;
    color: var(--mc-text-3);
    text-decoration: line-through;
  }
  .band[aria-pressed="false"] i { opacity: 0.35; }
  .band:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }

  /* Off: the row stays, faded, with its switch to turn it back on. */
  li.off .swatch,
  li.off div { opacity: 0.45; }

  /* The settings' switch, a size down to sit in a row of the key. */
  .switch {
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    flex: none;
    align-self: center;
    width: 38px;
    height: 23px;
    margin: 0;
    border-radius: 12px;
    background: var(--mc-hairline);
    cursor: pointer;
    transition: background-color var(--mc-motion-fast);
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform var(--mc-motion-fast) var(--mc-ease);
  }
  .switch:checked { background: var(--mc-accent); }
  .switch:checked::after { transform: translateX(15px); }
  .switch:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  /* Something is switched off: a dot on the pill. */
  .pill.filtered::after {
    content: "";
    width: 6px;
    height: 6px;
    margin-left: -1px;
    border-radius: 50%;
    background: var(--mc-accent);
  }
  .bands i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
</style>
