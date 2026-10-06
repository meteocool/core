<script lang="ts">
/**
 * Which product the radar map's observed frames are drawn from, picked here,
 * with how old each one's newest scan is (lib/observedProduct.ts).
 *
 * Two faces of one control. In the scale line it is the caption the legend
 * always had -- "Radarkomposit (DWD 1km)", until this -- now the chosen
 * product and its age; on a phone, where that caption has no room, a pill
 * with a radar dish in its place. Where there is no scale line at all, the
 * player below the desktop's width and the apps', it is the pill on its own.
 * Either opens the same menu above the tray.
 *
 * The menu is moved to <body>: the tray clips what overflows it, and a
 * backdrop filter on any ancestor would position a fixed child against that
 * ancestor rather than the window.
 */
import { onDestroy, tick } from "svelte";
import { _ } from "svelte-i18n";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons/faChevronUp";
import { faSatelliteDish } from "@fortawesome/free-solid-svg-icons/faSatelliteDish";
import Icon from "./Icon.svelte";
import { radarProducts, smallScreen } from "../stores";
import { OBSERVED_PRODUCTS, ageMinutes, fallsBehind } from "../lib/observedProduct";
import type { NewestScans, ObservedProduct } from "../lib/observedProduct";

/** `adaptive`: the caption, but the pill on a phone. */
export let variant: "caption" | "pill" | "adaptive" = "caption";

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;

/** The ages are minutes: a tick a quarter of one keeps them honest. */
let nowS = Date.now() / 1000;
const clock = setInterval(() => { nowS = Date.now() / 1000; }, 15_000);
onDestroy(() => clearInterval(clock));

$: face = variant === "adaptive" ? ($smallScreen ? "pill" : "caption") : variant;
$: ({ chosen, drawn, scans } = $radarProducts);
/** The choice has fallen behind, and the default is drawn in its place. */
$: fellBack = chosen !== drawn;
$: fellBackNote = $_("chrome.radar_product.fell_back", {
  values: { product: $_(`chrome.radar_product.${chosen}`), fallback: $_(`chrome.radar_product.${drawn}`) },
});

function age(product: ObservedProduct, newest: NewestScans, now: number): string {
  const minutes = ageMinutes(newest[product], now);
  return minutes === null
    ? $_("chrome.radar_product.unavailable")
    : $_("chrome.radar_product.age", { values: { minutes } });
}

async function show() {
  nowS = Date.now() / 1000;
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  open = true;
  await tick();
  if (!menu) return;
  // Centred on the control, kept on screen.
  const width = menu.offsetWidth;
  const centred = rect.left + rect.width / 2 - width / 2;
  left = Math.max(MARGIN, Math.min(centred, window.innerWidth - width - MARGIN));
  menu.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
}

function close(refocus = false) {
  open = false;
  if (refocus) trigger?.focus();
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
  {:else}
    <span class="name">{$_(`chrome.radar_product.${chosen}`)}<Icon icon={faChevronUp} class="chevron" /></span>
    <span class="age">{fellBack ? $_("chrome.radar_product.fell_back_short") : age(chosen, scans, nowS)}</span>
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
    style:bottom={`${bottom}px`}>
    <div class="heading">{$_("chrome.radar_product.title")}</div>
    {#each OBSERVED_PRODUCTS as product (product)}
      <button
        type="button"
        role="menuitemradio"
        class="option"
        class:behind={fallsBehind(product, scans)}
        aria-checked={product === chosen}
        on:click={() => choose(product)}>
        <span class="check" aria-hidden="true">{product === chosen ? "✓" : ""}</span>
        <span class="text">
          <span class="name">{$_(`chrome.radar_product.${product}`)}</span>
          <span class="hint">{$_(`chrome.radar_product.${product}_hint`)}</span>
          <span class="grid">{$_(`chrome.radar_product.${product}_grid`)}</span>
        </span>
        <span class="age">{age(product, scans, nowS)}</span>
      </button>
    {/each}
    {#if fellBack}
      <p class="note">{fellBackNote}</p>
    {/if}
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
  .pill.fellBack { color: var(--mc-orange-ink); }

  .menu {
    position: fixed;
    z-index: var(--mc-z-dialog);
    width: min(300px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 6px;
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-ring-lg);
    font-family: var(--mc-font);
  }
  .heading {
    padding: 6px 10px 4px;
    color: var(--mc-text-2);
    font: 600 12px/1.3 var(--mc-font);
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
