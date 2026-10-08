<script lang="ts">
/**
 * Which product the radar map's observed frames are drawn from, picked here,
 * with how old each one's newest scan is (lib/observedProduct.ts).
 *
 * Two faces of one control. In the scale line it is the caption the legend
 * always had -- "Radarkomposit (DWD 1km)", until this -- now the chosen
 * product and its age; on a phone, where that caption has no room, a pill
 * with a radar dish, the product's short name and its age in its place. The
 * age is the radar's "last updated": there is no other. Where there is no scale line at all, the
 * player below the desktop's width and the apps', it is the pill on its own.
 * Either opens the same menu above the tray.
 *
 * The menu is moved to <body>: the tray clips what overflows it, and a
 * backdrop filter on any ancestor would position a fixed child against that
 * ancestor rather than the window. So is the explainer its "?" opens
 * (RadarExplainer.svelte), a panel of the same fixed kind.
 */
import { onDestroy, tick } from "svelte";
import { _ } from "svelte-i18n";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons/faChevronUp";
import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons/faCircleQuestion";
import { faSatelliteDish } from "@fortawesome/free-solid-svg-icons/faSatelliteDish";
import Icon from "./Icon.svelte";
import Lazy from "./Lazy.svelte";
import { radarProducts, smallScreen } from "../stores";
import { PRODUCT_GROUPS, ageSpan, fallsBehind } from "../lib/observedProduct";
import type { ObservedProduct, ScanRange } from "../lib/observedProduct";

/** `adaptive`: the caption, but the pill on a phone. */
export let variant: "caption" | "pill" | "adaptive" = "caption";

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
/* How the radar works: a chunk of its own, loaded only when asked for. */
const loadExplainer = () => import("./RadarExplainer.svelte");
let explaining = false;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;
/** Set on a phone (`show`); else the stylesheet's. */
let width: number | null = null;
let maxHeight: number | null = null;

/** Narrower than this, the menu takes the width beside the map's buttons rather than its own. */
const PHONE_WIDTH = 520;

/** Where the map's own buttons are -- zoom, locate, rotate, layers: what the menu must not run under. */
function mapButtons(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".ol-control:not(.ol-attribution):not(.ol-hidden), .lsToggle")]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

/** The ages are minutes: a tick a quarter of one keeps them honest. */
let nowS = Date.now() / 1000;
const clock = setInterval(() => { nowS = Date.now() / 1000; }, 15_000);
onDestroy(() => clearInterval(clock));

$: face = variant === "adaptive" ? ($smallScreen ? "pill" : "caption") : variant;
$: ({ chosen, drawn, scans, ranges } = $radarProducts);
/** The choice has fallen behind, and the default is drawn in its place. */
$: fellBack = chosen !== drawn;
$: fellBackNote = $_("chrome.radar_product.fell_back", {
  values: { product: $_(`chrome.radar_product.${chosen}`), fallback: $_(`chrome.radar_product.${drawn}`) },
});

/** How long ago its scans were: one age, or a span where its countries differ. */
function age(product: ObservedProduct, scanRanges: Record<ObservedProduct, ScanRange | null>, now: number): string {
  const span = ageSpan(scanRanges[product], now);
  if (span === null) return $_("chrome.radar_product.unavailable");
  const [from, to] = span;
  return from === to
    ? $_("chrome.radar_product.age", { values: { minutes: from } })
    : $_("chrome.radar_product.age_span", { values: { from, to } });
}

async function show() {
  nowS = Date.now() / 1000;
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  const buttons = mapButtons();
  // On a phone, all the width left of the buttons down the right edge: wider
  // than its own, so shorter, and beside them rather than under them.
  const rightColumn = Math.min(window.innerWidth, ...buttons.filter((b) => b.left > window.innerWidth / 2).map((b) => b.left));
  const phone = window.innerWidth < PHONE_WIDTH;
  width = phone ? rightColumn - 2 * MARGIN : null;
  maxHeight = null;
  open = true;
  await tick();
  if (!menu) return;
  // Centred on the control, kept on screen -- and on a phone, left of the buttons.
  const menuWidth = menu.offsetWidth;
  const centred = rect.left + rect.width / 2 - menuWidth / 2;
  const rightEdge = phone ? rightColumn : window.innerWidth;
  left = Math.max(MARGIN, Math.min(centred, rightEdge - menuWidth - MARGIN));
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
  if (menu?.contains(target) || trigger?.contains(target)) return;
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
  aria-haspopup="menu"
  aria-expanded={open}
  title={fellBack ? fellBackNote : $_("chrome.radar_product.choose")}
  aria-label={face === "pill" ? `${$_("chrome.radar_product.choose")}: ${fellBack ? fellBackNote : $_(`chrome.radar_product.${chosen}`)}` : undefined}
  on:click={() => (open ? close() : show())}>
  {#if face === "pill"}
    <Icon icon={faSatelliteDish} />
    <span>{$_(`chrome.radar_product.${chosen}_short`)}</span>
    <span class="age">{fellBack ? $_("chrome.radar_product.fell_back_short") : age(chosen, ranges, nowS)}</span>
  {:else}
    <span class="name">{$_(`chrome.radar_product.${chosen}`)}<Icon icon={faChevronUp} class="chevron" /></span>
    <span class="age">{fellBack ? $_("chrome.radar_product.fell_back_short") : age(chosen, ranges, nowS)}</span>
  {/if}
</button>

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
      <span>{$_("chrome.radar_product.title")}</span>
      <button
        type="button"
        class="help"
        title={$_("radar_help.open")}
        aria-label={$_("radar_help.open")}
        on:click={explain}>
        <Icon icon={faCircleQuestion} />
      </button>
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
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 4px 4px 10px;
    color: var(--mc-text);
    font: 700 15px/1.3 var(--mc-font);
  }
  /* "How the radar works", in the corner: a tap target of its own size. */
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
  .option .age {
    color: var(--mc-text-2);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .option.behind .age { color: var(--mc-orange-ink); }
  .note {
    margin: 4px 10px 6px;
    color: var(--mc-orange-ink);
    font: 500 12px/1.35 var(--mc-font);
  }
</style>
