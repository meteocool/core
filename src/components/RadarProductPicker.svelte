<script lang="ts">
/**
 * Which product the radar map's observed frames are drawn from, picked here,
 * with how old each one's newest scan is (lib/observedProduct.ts).
 *
 * Two faces of one control. In the scale line it is the legend's caption: the
 * chosen product and its age. On a phone, where that caption has no room, it
 * is a pill with a radar dish, the product's short name and its age. The age
 * is the radar's "last updated": there is no other. Where there is no scale
 * line at all (the player below the desktop's width, and the apps'), it is
 * the pill on its own.
 * Either opens the same menu above the tray.
 *
 * On a forecast step it shows the forecast's product and opens nothing: WN
 * is the forecast whatever was picked (FORECAST_PRODUCT). The choice itself
 * is left as it was, so it is back the moment the player is on the present
 * or the past again.
 *
 * On a phone everything but the menu and its control is blurred while it is
 * open: the menu is the one thing to read, and a tap anywhere else closes
 * it, as does its close disc. The control lives in the tray, under the blur
 * whatever its z-index, so a twin of it is drawn over the blur in its place.
 *
 * The menu is moved to <body>: the tray clips what overflows it, and a
 * backdrop filter on any ancestor would position a fixed child against that
 * ancestor rather than the window. So is the explainer its "?" opens
 * (RadarExplainer.svelte), a panel of the same fixed kind.
 */
import { onDestroy, tick } from "svelte";
import { fade } from "svelte/transition";
import { _ } from "svelte-i18n";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons/faChevronUp";
import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons/faCircleQuestion";
import { faSatelliteDish } from "@fortawesome/free-solid-svg-icons/faSatelliteDish";
import CloseDisc from "./CloseDisc.svelte";
import Icon from "./Icon.svelte";
import Lazy from "./Lazy.svelte";
import { onForecastStep, radarProducts, smallScreen } from "../stores";
import { hideNativeControls } from "../lib/nativeBridge";
import { FORECAST_PRODUCT, PRODUCT_GROUPS, ageSpan, fallsBehind } from "../lib/observedProduct";
import type { ObservedProduct, ScanRange } from "../lib/observedProduct";

/** `adaptive`: the caption, but the pill on a phone. */
export let variant: "caption" | "pill" | "adaptive" = "caption";

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
let twinButton: HTMLButtonElement | undefined;
/* How the radar works: a chunk of its own, loaded only when asked for. */
const loadExplainer = () => import("./RadarExplainer.svelte");
let explaining = false;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;
/** Set on a phone (`show`); else the stylesheet's. */
let width: number | null = null;
let maxHeight: number | null = null;
/** Where the control is, and the sizes its placer gave it, for its twin over the blur. */
let twin: { left: number; top: number; width: number; height: number; vars: string } | null = null;
const PILL_VARS = ["--picker-pill-h", "--picker-pill-pad", "--picker-pill-font"];

/** Narrower than this, the menu takes the width beside the map's buttons rather than its own. */
const PHONE_WIDTH = 520;

/** Where the map's own buttons are (zoom, locate, rotate, layers): what the menu must not run under. */
function mapButtons(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".ol-control:not(.ol-attribution):not(.ol-hidden), .lsToggle")]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

/* The apps' buttons float down the right edge, outside the page, so
   `mapButtons` cannot keep the menu clear of them: they go while it is up. */
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

/** The ages are minutes: a tick a quarter of one keeps them honest. */
let nowS = Date.now() / 1000;
const clock = setInterval(() => { nowS = Date.now() / 1000; }, 15_000);
onDestroy(() => clearInterval(clock));

$: face = variant === "adaptive" ? ($smallScreen ? "pill" : "caption") : variant;
$: ({ chosen, drawn, scans, ranges } = $radarProducts);
$: forecast = $onForecastStep;
/** What the control names: the choice, or the forecast's product on its steps. */
$: shown = forecast ? FORECAST_PRODUCT : chosen;
/** The choice has fallen behind, and the default is drawn in its place. */
$: fellBack = !forecast && chosen !== drawn;
$: forecastNote = $_("chrome.radar_product.forecast", { values: { product: $_(`chrome.radar_product.${FORECAST_PRODUCT}`) } });
$: if (forecast && open) close();
$: fellBackNote = $_("chrome.radar_product.fell_back", {
  values: { product: $_(`chrome.radar_product.${chosen}`), fallback: $_(`chrome.radar_product.${drawn}`) },
});

/** How long ago its scans were: one age, or a span where its countries differ. */
function age(product: ObservedProduct, scanRanges: Record<ObservedProduct, ScanRange | null>, now: number): string {
  const span = ageSpan(scanRanges[product], now);
  if (span === null) return $_("chrome.radar_product.unavailable");
  const [from, to] = span;
  const text = from === to
    ? $_("chrome.radar_product.age", { values: { minutes: from } })
    : $_("chrome.radar_product.age_span", { values: { from, to } });
  // The menu wraps an age onto two lines: a number keeps its dash and its
  // unit, so it is "6–11 min" over "ago" rather than "6–" over "11 min".
  return text.replace(/–/g, "–\u2060").replace(/(\d) /g, "$1\u00a0");
}

async function show() {
  nowS = Date.now() / 1000;
  const rect = trigger.getBoundingClientRect();
  const style = getComputedStyle(trigger);
  twin = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    vars: PILL_VARS.map((name) => `${name}: ${style.getPropertyValue(name)}`).filter((v) => !v.endsWith(": ")).join("; "),
  };
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  // On a phone the buttons are blurred behind it, out of its way, and it
  // takes the window's width: wider than its own, so shorter. Elsewhere it
  // keeps left of the ones down the right edge.
  const buttons = $smallScreen ? [] : mapButtons();
  const rightColumn = Math.min(window.innerWidth, ...buttons.filter((b) => b.left > window.innerWidth / 2).map((b) => b.left));
  const phone = window.innerWidth < PHONE_WIDTH;
  width = phone ? rightColumn - 2 * MARGIN : null;
  maxHeight = null;
  open = true;
  await tick();
  if (!menu) return;
  // Centred on the control and kept left of the buttons, at any width: pushed
  // to the screen's edge instead, a short window put it under them, where it
  // stopped short of the lowest and was left a few rows tall.
  const menuWidth = menu.offsetWidth;
  const centred = rect.left + rect.width / 2 - menuWidth / 2;
  left = Math.max(MARGIN, Math.min(centred, rightColumn - menuWidth - MARGIN));
  // Still under a button, and it stops short of it and scrolls.
  const ceiling = Math.max(
    MARGIN,
    ...buttons.filter((b) => b.left < left + menuWidth && b.right > left).map((b) => b.bottom + MARGIN),
  );
  if (window.innerHeight - bottom - menu.offsetHeight < ceiling) maxHeight = window.innerHeight - bottom - ceiling;
  menu.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
}

function close(refocus = false) {
  open = false;
  if (refocus) trigger?.focus();
}

/** The menu gives way to the explainer, which has its own close. */
function explain() {
  close();
  explaining = true;
}

function choose(product: ObservedProduct) {
  window.settings.set("radarProduct", product);
  close(true);
}

/** Anything outside the menu and its control closes it, as a menu does. */
function outside(event: PointerEvent) {
  if (!open) return;
  const target = event.target as Node;
  if (menu?.contains(target) || trigger?.contains(target) || twinButton?.contains(target)) return;
  close();
}

function keydown(event: KeyboardEvent) {
  if (!open) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    close(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...(menu?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? [])];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
  next?.focus();
  event.preventDefault();
}

function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
</script>

<svelte:window on:pointerdown={outside} on:keydown={keydown} on:resize={() => close()} />

<button
  bind:this={trigger}
  type="button"
  class={face}
  class:fellBack
  class:forecast
  aria-haspopup="menu"
  aria-expanded={open}
  aria-disabled={forecast}
  title={forecast ? forecastNote : fellBack ? fellBackNote : $_("chrome.radar_product.choose")}
  aria-label={face === "pill" ? `${$_("chrome.radar_product.choose")}: ${forecast ? forecastNote : fellBack ? fellBackNote : $_(`chrome.radar_product.${chosen}`)}` : undefined}
  on:click={() => (forecast ? undefined : open ? close() : show())}>
  {@render label()}
</button>

{#snippet label()}
  {#if face === "pill"}
    <Icon icon={faSatelliteDish} />
    <span>{$_(`chrome.radar_product.${shown}_short`)}</span>
    <span class="age">{forecast ? $_("chrome.radar_product.forecast_short") : fellBack ? $_("chrome.radar_product.fell_back_short") : age(chosen, ranges, nowS)}</span>
  {:else}
    <span class="name">{$_(`chrome.radar_product.${shown}`)}<Icon icon={faChevronUp} class="chevron" /></span>
    <span class="age">{forecast ? $_("chrome.radar_product.forecast_short") : fellBack ? $_("chrome.radar_product.fell_back_short") : age(chosen, ranges, nowS)}</span>
  {/if}
{/snippet}

{#if open && $smallScreen}
  <div use:portal class="blur" aria-hidden="true" transition:fade={{ duration: 150 }}></div>
  {#if twin}
    <!-- The control, over the blur; the real one, under it, keeps the focus. -->
    <button
      bind:this={twinButton}
      use:portal
      type="button"
      class="{face} twin"
      class:fellBack
      tabindex="-1"
      aria-hidden="true"
      style="{twin.vars}; left: {twin.left}px; top: {twin.top}px; width: {twin.width}px; height: {twin.height}px"
      on:click={() => close(true)}>
      {@render label()}
    </button>
  {/if}
{/if}

{#if open}
  <div
    bind:this={menu}
    use:portal
    class="menu glass glass-strong"
    role="menu"
    aria-label={$_("chrome.radar_product.title")}
    style:left={`${left}px`}
    style:bottom={`${bottom}px`}
    style:width={width === null ? undefined : `${width}px`}
    style:max-height={maxHeight === null ? undefined : `${maxHeight}px`}>
    <div class="heading">
      <span class="title">{$_("chrome.radar_product.title")}</span>
      <button
        type="button"
        class="help"
        title={$_("radar_help.open")}
        aria-label={$_("radar_help.open")}
        on:click={explain}>
        <Icon icon={faCircleQuestion} />
      </button>
      <CloseDisc material="chrome" on:click={() => close(true)} />
    </div>
    {#each PRODUCT_GROUPS as { group, products }, i (group)}
      <div class="group" role="group" aria-labelledby={`radar-product-${group}`}>
        <div class="group-heading">
          <span class="group-text">
            <span class="group-name" id={`radar-product-${group}`}>{$_(`chrome.radar_product.group_${group}`)}</span>
            <span class="group-hint">{$_(`chrome.radar_product.group_${group}_hint`)}</span>
          </span>
          <!-- The ages' column heading, once, over the first group. -->
          {#if i === 0}
            <span class="column" title={$_("chrome.radar_product.age_hint")}>{$_("chrome.radar_product.age_heading")}</span>
          {/if}
        </div>
        {#each products as product (product)}
          <button
            type="button"
            role="menuitemradio"
            class="option"
            class:behind={fallsBehind(product, scans)}
            aria-checked={product === chosen}
            on:click={() => choose(product)}>
            <span class="check" aria-hidden="true">{product === chosen ? "✓" : ""}</span>
            <span class="text">
              <span class="name">{$_(`chrome.radar_product.${product}_option`)}</span>
              <span class="hint">{$_(`chrome.radar_product.${product}_hint`)}</span>
              <span class="grid">{$_(`chrome.radar_product.${product}_grid`)}</span>
            </span>
            <span class="age" title={$_("chrome.radar_product.age_hint")}>{age(product, ranges, nowS)}</span>
          </button>
        {/each}
      </div>
    {/each}
    {#if fellBack}
      <p class="note">{fellBackNote}</p>
    {/if}
  </div>
{/if}

{#if explaining}
  <div use:portal>
    <Lazy load={loadExplainer} floating let:module>
      <svelte:component this={module.default} on:close={() => { explaining = false; }} />
    </Lazy>
  </div>
{/if}

<style>
  button {
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
  }

  /* The scale line's caption, as it was: two short lines, right-aligned. */
  .caption {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    margin: -4px -6px;
    padding: 4px 6px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--mc-text-2);
    font: 600 10px/1.2 var(--mc-font);
    text-align: right;
    white-space: nowrap;
    transition: background-color var(--mc-motion-fast);
  }
  .caption:hover { background: var(--mc-tint-hover); }
  .caption:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 0; }
  .caption .name { color: var(--mc-text); }
  .caption :global(.chevron) {
    width: 7px;
    height: 7px;
    margin-left: 4px;
    vertical-align: 1px;
    color: var(--mc-text-2);
  }
  .caption .age { font-variant-numeric: tabular-nums; }
  .caption.fellBack .age { color: var(--mc-orange-ink); }

  /* Where there is no caption: a pill, sized by whoever places it. */
  .pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--picker-pill-h, 24px);
    box-sizing: border-box;
    padding: 0 var(--picker-pill-pad, 10px);
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 var(--picker-pill-font, 11px)/1 var(--mc-font);
    white-space: nowrap;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .pill :global(svg) { width: 12px; height: 12px; }
  .pill .age {
    color: var(--mc-text-2);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .pill.fellBack .age { color: var(--mc-orange-ink); }

  /* On a forecast step: greyed out, and nothing to open. */
  .forecast {
    opacity: 0.5;
    cursor: default;
  }
  .caption.forecast:hover { background: none; }
  .pill.forecast:hover { background: var(--mc-tint); }
  .pill.forecast:active { transform: none; }

  .menu {
    position: fixed;
    z-index: var(--mc-z-dialog);
    width: min(300px, calc(100vw - 16px));
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-ring-lg);
    font-family: var(--mc-font);
  }
  /* Under the menu and over everything else, the tray and its pills too. */
  .blur {
    position: fixed;
    inset: 0;
    z-index: calc(var(--mc-z-dialog) - 1);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }
  .twin {
    position: fixed;
    z-index: var(--mc-z-dialog);
    box-sizing: border-box;
    margin: 0;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 10px;
    color: var(--mc-text);
    font: 700 15px/1.3 var(--mc-font);
  }
  /* "How the radar works", in the corner: a tap target of its own size. */
  .heading .title { flex: 1 1 auto; min-width: 0; }
  /* Inside the menu's corner: a sheet pulls the disc out to its own edge,
     which on a card this rounded puts it over the curve. */
  .menu .heading :global(button.edge) { margin: 0; }
  .help {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--mc-text-2);
    transition: background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .help:hover { background: var(--mc-tint-hover); color: var(--mc-accent); }
  .help:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
  .help :global(svg) { width: 17px; height: 17px; }
  .group + .group { margin-top: 4px; }
  /* A section of the menu: what its pictures have in common, and over the
     first, what the minutes on the right are. Out at the title's edge rather
     than the options' text, so it reads as a new section. */
  .group-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px 2px;
  }
  .group-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .group-name {
    color: var(--mc-text-2);
    font: 700 11px/1.3 var(--mc-font);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .group-hint { color: var(--mc-text-3); font: 500 11px/1.3 var(--mc-font); }
  .column {
    flex: 0 0 auto;
    max-width: 64px;
    color: var(--mc-text-3);
    font: 600 10px/1.2 var(--mc-font);
    text-align: right;
    cursor: help;
  }
  .option {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: none;
    color: var(--mc-text);
    font-family: var(--mc-font);
    text-align: left;
  }
  .option:hover { background: var(--mc-tint-hover); }
  .option:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
  .check { color: var(--mc-accent); font: 700 13px/1 var(--mc-font); }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .option .name { font: 600 14px/1.25 var(--mc-font); }
  .option .hint { color: var(--mc-text-2); font: 500 12px/1.3 var(--mc-font); }
  .option .grid {
    color: var(--mc-text-3);
    font: 500 11px/1.3 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  /* Wrapped at its words, "1–9 min" over "ago", so the column stays narrow
     and the text beside it gets the width. */
  .option .age {
    max-width: 4.6em;
    color: var(--mc-text-2);
    font: 600 12px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .option.behind .age { color: var(--mc-orange-ink); }
  .note {
    margin: 4px 10px 6px;
    color: var(--mc-orange-ink);
    font: 500 12px/1.35 var(--mc-font);
  }
</style>
