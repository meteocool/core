<script lang="ts">
/**
 * The veil over the map while the 3D map is brought up for the first time.
 *
 * The first switch to 3D fetches MapLibre, compiles its shaders, parses the
 * style and pulls tiles and storm volumes -- seconds, with the main thread
 * pegged for much of it, during which the map element shows the half-built
 * result: an empty box, then a basemap with no storms, then a storm easing
 * into view in stutters. The veil blurs whatever is underneath and says what
 * is happening; the capability takes it down on the map's first settled
 * frame (see Cells3DCapability.settled), with the camera ease starting under
 * the fade so the map comes into view already moving.
 *
 * Glass rather than a sheet, against the material rules in glass.css, because
 * it is on screen for seconds and over a map that is not yet drawing frames
 * of its own: the backdrop blur is what turns the bring-up's flicker into a
 * soft wash of colour. The capsule in the middle is the ordinary glass pill,
 * with the spinner and a line of text.
 *
 * The line is one word of what a radar does -- "Scanning…", "Backscattering…"
 * -- a different one from the last time, rather than the same "Preparing the
 * 3D map…" on every visit; the sentence is still what a screen reader hears.
 * Each language has its own list (`loading_3d_words`), not a translation of
 * the English one: a word that is fun in one language is a mouthful in another.
 */
import { fade } from "svelte/transition";
import { _, json } from "svelte-i18n";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";

/**
 * The last word shown, kept across reloads: the veil comes up once per page,
 * so a word remembered in memory alone would repeat on the next visit as often
 * as chance allows.
 */
const LAST_WORD_KEY = "mc-3d-loading-word";

function pick(words: string[]): string | null {
  if (!words.length) return null;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_WORD_KEY); } catch { /* storage blocked: any word will do */ }
  const fresh = words.length > 1 ? words.filter((word) => word !== last) : words;
  const word = fresh[Math.floor(Math.random() * fresh.length)];
  try { localStorage.setItem(LAST_WORD_KEY, word); } catch { /* as above */ }
  return word;
}

/* Picked again only if the language changes under the veil. */
$: words = (($json("loading_3d_words") as unknown) ?? []) as string[];
$: word = pick(Array.isArray(words) ? words.filter((w) => typeof w === "string" && w) : []);
</script>

<style>
  .veil {
    position: absolute;
    inset: 0;
    /* Over the map and the 3D map's own controls, under the top line's
       chrome: the layer switcher stays reachable to a reader who changes
       their mind. */
    z-index: calc(var(--mc-z-chrome) - 1);
    display: grid;
    place-items: center;
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    /* A pan or a pinch on a map still compiling its shaders is a pan the
       map answers a second later, somewhere else. */
    pointer-events: auto;
    touch-action: none;
  }

  .capsule {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px 12px 16px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill-strong);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring-lg);
    color: var(--mc-text);
    font: var(--mc-type-subtitle);
    white-space: nowrap;
    /* The capsule settles in a touch late and a touch large, so the veil
       is already a surface by the time it lands on it. */
    animation: settle var(--mc-motion-spring) var(--mc-ease-spring) both;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* sl-spinner props: --track-width --track-color --indicator-color --speed */
  .spinner {
    --track-width: 2.5px;
    --track-color: var(--mc-separator);
    --indicator-color: var(--mc-accent);
    --speed: 1.4s;
    font-size: 22px;
    flex: none;
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: scale(1.06);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .capsule {
      animation: none;
    }
  }
</style>

<div class="veil" out:fade={{ duration: 420 }} role="status" aria-live="polite">
  <div class="capsule">
    <sl-spinner class="spinner"></sl-spinner>
    {#if word}
      <span aria-hidden="true">{word}…</span>
      <span class="sr-only">{$_("preparing_3d")}</span>
    {:else}
      <span>{$_("preparing_3d")}</span>
    {/if}
  </div>
</div>
