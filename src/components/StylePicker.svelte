<script lang="ts">
/**
 * How the 3D map draws its storms (a lit cloud, a white cloud plain or
 * tinted, or see-through light; lib/cloudStyle.ts), picked here in the
 * peel's tray along the bottom edge (PeelSlider). Only the styles the map
 * offers: the shells are Studio's.
 *
 * The pill is the picture of the style on the map (StyleGlyph), in the
 * palette the storms are painted in, and no word: the tray is a slider and
 * two pills on a phone's width. The menu names each and says what it is for.
 *
 * It writes the `layer3dStyle` setting, as the settings dialog does, so the
 * choice is kept across visits.
 *
 * The menu is moved to <body>, as the scan picker's is: the tray's backdrop
 * filter would otherwise position it against the tray.
 */
import { tick } from "svelte";
import { _ } from "svelte-i18n";
import { cloudStyle } from "../stores";
import { MAP_STYLES, type CloudStyle } from "../lib/cloudStyle";
import StyleGlyph from "./StyleGlyph.svelte";

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;

async function show() {
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  open = true;
  await tick();
  if (!menu) return;
  // Over the control, kept on screen.
  const width = menu.offsetWidth;
  const centred = rect.left + rect.width / 2 - width / 2;
  left = Math.max(MARGIN, Math.min(centred, window.innerWidth - width - MARGIN));
  menu.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
}

function close(refocus = false) {
  open = false;
  if (refocus) trigger?.focus();
}

function choose(style: CloudStyle) {
  close(true);
  window.settings.set("layer3dStyle", style);
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
  class="pill"
  aria-haspopup="menu"
  aria-expanded={open}
  title={$_("style_3d.choose")}
  aria-label={$_("style_3d.aria", { values: { style: $_(`style_3d.${$cloudStyle}`) } })}
  on:click={() => (open ? close() : show())}>
  <StyleGlyph style={$cloudStyle} small />
</button>

{#if open}
  <div
    bind:this={menu}
    use:portal
    class="menu glass glass-strong"
    role="menu"
    aria-label={$_("style_3d.title")}
    style:left={`${left}px`}
    style:bottom={`${bottom}px`}>
    <div class="heading">{$_("style_3d.title")}</div>
    {#each MAP_STYLES as style (style)}
      <button
        type="button"
        role="menuitemradio"
        class="option"
        aria-checked={$cloudStyle === style}
        on:click={() => choose(style)}>
        <StyleGlyph {style} />
        <span class="text">
          <span class="name">{$_(`style_3d.${style}`)}</span>
          <span class="what">{$_(`style_3d.${style}_body`)}</span>
        </span>
        <span class="check" aria-hidden="true">{$cloudStyle === style ? "✓" : ""}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 8px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .menu {
    position: fixed;
    z-index: var(--mc-z-dialog);
    display: flex;
    flex-direction: column;
    width: min(280px, calc(100vw - 16px));
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
    grid-template-columns: 32px 1fr 16px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: none;
    color: var(--mc-text);
    font-family: var(--mc-font);
    text-align: left;
    cursor: pointer;
  }
  .option:hover { background: var(--mc-tint-hover); }
  .option:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font: 600 14px/1.25 var(--mc-font);
  }
  .what {
    color: var(--mc-text-2);
    font: 400 12px/1.3 var(--mc-font);
  }
  .check {
    color: var(--mc-accent);
    font: 700 13px/1 var(--mc-font);
  }

  @media (prefers-reduced-motion: reduce) {
    .pill { transition: none; }
    .pill:active { transform: none; }
  }
</style>
