<script lang="ts">
import { _ } from "svelte-i18n";
import { createEventDispatcher, onMount } from "svelte";
import CloseDisc from "./CloseDisc.svelte";
import { smallScreen } from "../stores";
import { holdNativeChrome } from "../lib/nativeBridge";

/**
 * A panel of text over the map: About, Settings, Connection Details.
 *
 * One component, two frames, chosen by the screen -- the same split the storm
 * panels make in App.svelte, so everything that opens over the map takes the
 * same two shapes. On a desktop it is a panel floating over the map; on a
 * phone it is the sheet (CellSheet) a storm's details come up in, at full
 * height, pulled down to dismiss. The reading panels used to float on a
 * phone too, as a card the size of the screen with no grip and no slide,
 * beside storm sheets that had both.
 *
 * Glass rather than a solid sheet, so the map stays in view behind whatever is
 * being read -- but in the reading material (`.glass-reading` in
 * src/glass.css), not the chrome's. The chrome's glass boosts saturation and
 * lifts the backdrop, which is what makes a pill look like a lens and is
 * exactly wrong under a paragraph over a squall line: the radar comes through
 * brighter than it is on the map. See the material for how it holds up. The
 * sheet takes the same material, so the panel reads the same on both.
 *
 * No backdrop dim: the map stays at full strength around the panel, and a tap
 * on it -- anywhere outside the floating panel -- closes it, as does Escape.
 *
 * Close is the panels' glass disc in the top-right corner, in the chrome's
 * tints; see CloseDisc. On a phone the sheet draws it, out of the scroll.
 */

export let title: string;

/** Fill what the map leaves, for a wall of readings; otherwise a reading column. */
export let wide = false;

/* The sheet is the storm panels' chunk, not this one's: it brings the cell's
   details, charts and model with it, which About has no use for on a desktop. */
const loadSheet = () => import("./CellSheet.svelte");

const dispatch = createEventDispatcher();
const titleId = `panel-${Math.random().toString(36).slice(2)}`;

function close() {
  dispatch("close");
}

/** Where the keyboard goes next, and what a screen reader announces. */
function autofocus(node: HTMLElement) {
  node.focus({ preventScroll: true });
}

/*
 * Capture phase, so this runs before anything else listening on the window --
 * the storm popup behind it closes on Escape too -- and marks the key as
 * taken, which that handler checks for.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  close();
}

onMount(() => {
  window.addEventListener("keydown", onKeydown, true);
  // The sheet holds the chrome too; the bridge counts, so both can.
  const releaseChrome = holdNativeChrome();
  return () => {
    window.removeEventListener("keydown", onKeydown, true);
    releaseChrome();
  };
});
</script>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--mc-z-panel);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    /* Clears the top line of chrome -- its tallest members, the 44px discs,
       not just the Live pill -- so the control it was opened from stays in
       view. The side insets are the notch's, which in landscape is on a side
       rather than the top. */
    padding:
      calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter))
      calc(var(--mc-gutter) + env(safe-area-inset-right, 0px))
      calc(var(--mc-safe-bottom) + var(--mc-gutter))
      calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    box-sizing: border-box;
  }

  .panel {
    color: var(--mc-text);
    font-family: var(--mc-font);
    outline: none;
  }

  .floating {
    width: min(31rem, 100%);
    max-height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  /* A wall of readings: paging through a narrow column of them is worse than
     reading a wide one. */
  .floating.wide {
    width: min(72rem, 100%);
    height: 100%;
  }

  .floating header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    /* Top and right match, so the disc sits square in the corner with the
       same air on both sides of it. */
    padding: 14px 14px 6px var(--mc-drawer-pad);
  }
  /* The drawer's title, as the storm panel sets it: bold and a clear step
     above everything in the panel, so the panel says what it is at a glance. */
  h2 {
    flex: 1 1 auto;
    margin: 0;
    font: var(--mc-type-title);
    letter-spacing: -0.02em;
  }

  /* The only scroller: the panel stops at the bottom of the screen, so a long
     body scrolls inside it rather than running off the map -- and fades out
     at both ends into the glass, rather than being cut off under the header
     and at the rim. The padding is the fade's length, so the first and last
     lines rest clear of it. */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: var(--mc-fade-top) var(--mc-drawer-pad) var(--mc-fade-bottom);
    -webkit-mask-image: linear-gradient(to bottom,
      transparent, #000 var(--mc-fade-top),
      #000 calc(100% - var(--mc-fade-bottom)), transparent);
    mask-image: linear-gradient(to bottom,
      transparent, #000 var(--mc-fade-top),
      #000 calc(100% - var(--mc-fade-bottom)), transparent);
  }

  /* In the sheet, which scrolls and insets the body itself: the header is
     the storm panel's (StormPanel.svelte), the disc pulled into the corner
     the sheet keeps clear for it, and the body is the reading. */
  .in-sheet {
    font: var(--mc-type-body);
  }
  .in-sheet header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 14px;
    padding-right: var(--mc-sheet-corner, 0px);
  }
  .in-sheet h2 {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* A phone on its side has about 375px of height for all of this, and half of
     it should not go to a gap above the panel. The top line goes behind it
     here; the panel is modal anyway, and the reading beats the affordance. */
  @media (max-height: 480px) {
    .scrim {
      padding-top: calc(var(--mc-safe-top) + var(--mc-gutter));
      padding-bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter) / 2);
    }
    .floating header {
      padding: 10px 10px 4px 14px;
    }
  }
</style>

{#if $smallScreen}
  {#await loadSheet() then { default: CellSheet }}
    <!-- The sheet is the dialog, and draws the close disc in its corner, where
         it stays while the reading scrolls; see lib/sheetContext.ts. -->
    <svelte:component this={CellSheet} full halfway={false} material="reading" onClose={close} dialogLabelledBy={titleId}>
      <div class="panel in-sheet" tabindex="-1" use:autofocus>
        <header>
          <h2 id={titleId}>{title}</h2>
        </header>
        <slot />
      </div>
    </svelte:component>
  {/await}
{:else}
  <div class="scrim" on:click|self={close} role="presentation">
    <div
      class="panel floating glass glass-tray glass-reading"
      class:wide
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      use:autofocus>
      <header>
        <h2 id={titleId}>{title}</h2>
        <CloseDisc material="chrome" on:click={close} />
      </header>
      <div class="body">
        <slot />
      </div>
    </div>
  </div>
{/if}
