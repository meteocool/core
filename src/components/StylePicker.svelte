<script lang="ts">
/**
 * How the 3D map draws its storms (a lit cloud, see-through light or nested
 * shells; lib/cloudStyle.ts), picked here in the peel's tray along the
 * bottom edge (PeelSlider).
 *
 * The pill is the picture of the style on the map, in the palette the storms
 * are painted in, and no word: the tray is a slider and two pills on a
 * phone's width. The menu names each and says what it is for.
 *
 * It writes the `layer3dStyle` setting, as the settings dialog does, so the
 * choice is kept across visits.
 *
 * The menu is moved to <body>, as the scan picker's is: the tray's backdrop
 * filter would otherwise position it against the tray.
 */
import { tick } from "svelte";
import { _ } from "svelte-i18n";
import { cloudStyle, radarColormap } from "../stores";
import { CLOUD_STYLES, type CloudStyle } from "../lib/cloudStyle";
import { dbzColour } from "../lib/cellVolume";

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

let open = false;
let trigger: HTMLButtonElement;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;

/* A storm as three nested levels, envelope to core, as the guide draws one. */
$: levels = [30, 45, 58].map((dbz) => `rgb(${dbzColour(dbz, $radarColormap).join(", ")})`);

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

<!-- One storm in a style, in a 32x24 box: soft and shaded, blurred light, or hard-edged shells. -->
{#snippet picture(style: CloudStyle)}
  <svg class="picture" viewBox="0 0 32 24" aria-hidden="true">
    {#if style === "cloud"}
      <ellipse cx="16" cy="13" rx="13" ry="9" fill={levels[0]} opacity="0.55" />
      <ellipse cx="15" cy="12" rx="8" ry="6" fill={levels[1]} opacity="0.8" />
      <ellipse cx="14.5" cy="11" rx="3.8" ry="3.2" fill={levels[2]} />
    {:else if style === "glow"}
      <g class="lit">
        <ellipse cx="16" cy="12.5" rx="11" ry="7.5" fill={levels[0]} />
        <ellipse cx="15.5" cy="12" rx="6.5" ry="4.8" fill={levels[1]} />
        <ellipse cx="15" cy="11.5" rx="3" ry="2.6" fill={levels[2]} />
      </g>
    {:else}
      <g class="hard">
        <ellipse cx="16" cy="12.5" rx="13" ry="9" fill={levels[0]} />
        <ellipse cx="15.5" cy="12.5" rx="8.5" ry="6" fill={levels[1]} />
        <ellipse cx="15" cy="12.5" rx="4" ry="3" fill={levels[2]} />
      </g>
    {/if}
  </svg>
{/snippet}

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
  {@render picture($cloudStyle)}
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
    {#each CLOUD_STYLES as style (style)}
      <button
        type="button"
        role="menuitemradio"
        class="option"
        aria-checked={$cloudStyle === style}
        on:click={() => choose(style)}>
        {@render picture(style)}
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
  .pill .picture {
    width: 24px;
    height: 18px;
  }

  .picture {
    flex: none;
    width: 32px;
    height: 24px;
    overflow: visible;
  }
  .picture .lit {
    filter: blur(1.6px) saturate(1.3);
  }
  .picture .hard ellipse {
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 0.9;
  }

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
