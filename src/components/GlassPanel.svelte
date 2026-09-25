<script lang="ts">
import { _ } from "svelte-i18n";
import { createEventDispatcher, onMount } from "svelte";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import Icon from "./Icon.svelte";

/**
 * A panel of text floating over the map: About, Settings, Connection Details.
 *
 * Glass rather than a solid sheet, so the map stays in view behind whatever is
 * being read -- but in the reading material (`.glass-reading` in
 * src/glass.css), not the chrome's. The chrome's glass boosts saturation and
 * lifts the backdrop, which is what makes a pill look like a lens and is
 * exactly wrong under a paragraph over a squall line: the radar comes through
 * brighter than it is on the map. See the material for how it holds up.
 *
 * No backdrop dim: the map stays at full strength around the panel, and a tap
 * on it -- anywhere outside the panel -- closes it, as does Escape.
 *
 * Close is a glass disc in the top-right corner, as on the storm popup.
 */

export let title: string;

/** Fill what the map leaves, for a wall of readings; otherwise a reading column. */
export let wide = false;

const dispatch = createEventDispatcher();
const titleId = `panel-${Math.random().toString(36).slice(2)}`;

let panel: HTMLElement;

function close() {
  dispatch("close");
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
  // Where the keyboard goes next, and what a screen reader announces.
  panel.focus({ preventScroll: true });
  window.addEventListener("keydown", onKeydown, true);
  return () => window.removeEventListener("keydown", onKeydown, true);
});
</script>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--mc-z-status);
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
    width: min(31rem, 100%);
    max-height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    color: var(--mc-text);
    font-family: var(--mc-font);
    outline: none;
  }
  /* A wall of readings: paging through a narrow column of them is worse than
     reading a wide one. */
  .panel.wide {
    width: min(72rem, 100%);
    height: 100%;
  }

  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    /* Top and right match, so the disc sits square in the corner with the
       same air on both sides of it. */
    padding: 14px 14px 8px 16px;
  }
  h2 {
    flex: 1 1 auto;
    margin: 0;
    font: 700 15px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
  }

  /*
   * Close, as a glass disc: the storm popup's (CellDetails.svelte), in this
   * panel's own material. That one is built from Shoelace's neutrals because
   * its panel is a light sheet in either scheme; this one sits on glass whose
   * ink follows the basemap, so it takes the chrome tints -- a flat tint and
   * the lens bevel, no second blur, which is the rule for anything on glass.
   */
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    margin-left: auto;
    padding: 0;
    border: 1px solid var(--mc-glass-edge);
    border-radius: 50%;
    background: var(--mc-tint);
    box-shadow: var(--mc-glass-highlight);
    color: var(--mc-text);
    font-size: 14px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast), transform var(--mc-motion-fast) var(--mc-ease);
  }
  .close:hover { background: var(--mc-tint-hover); }
  .close:active { transform: scale(var(--mc-press)); }
  .close:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  /* A thumb needs 44px; a mouse does not, and at desktop size a target that
     big beside the title is the loudest thing in the panel. Not pulled into
     the corner the way the storm popup's is: against a 26px corner radius
     that left it 4px from the edge, crowding the rim it sits inside. */
  @media only screen and (max-width: 620px) {
    .close {
      width: 44px;
      height: 44px;
      font-size: 18px;
    }
  }

  /* The only scroller: the panel stops at the bottom of the screen, so a long
     body scrolls inside it rather than running off the map. */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0 16px 14px;
  }

  /* A phone on its side has about 375px of height for all of this, and half of
     it should not go to a gap above the panel. The top line goes behind it
     here; the panel is modal anyway, and the reading beats the affordance. */
  @media (max-height: 480px) {
    .scrim {
      padding-top: calc(var(--mc-safe-top) + var(--mc-gutter));
      padding-bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter) / 2);
    }
    header {
      padding: 10px 10px 4px 14px;
    }
  }
</style>

<div class="scrim" on:click|self={close} role="presentation">
  <div
    bind:this={panel}
    class="panel glass glass-tray glass-reading"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1">
    <header>
      <h2 id={titleId}>{title}</h2>
      <button type="button" class="close" aria-label={$_("close")} title={$_("close")} on:click={close}>
        <Icon icon={faXmark} />
      </button>
    </header>
    <div class="body">
      <slot />
    </div>
  </div>
</div>
