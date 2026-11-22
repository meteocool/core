<script lang="ts">
/**
 * The music's switch in the menus: the soundtrack on or off, the menus' and
 * the flight's (lib/studio/flight/soundtrack.ts); the flight's own sounds
 * stay. The flight's M key is the same switch. Shown off until the page may play, which a press
 * of this lets it do: a reader who has not clicked anywhere yet hears
 * nothing, and is not told the sound is on.
 */
import { _ } from "svelte-i18n";
import MusicIcon from "./MusicIcon.svelte";
import { flightMuted, setFlightMuted, soundAvailable, soundLocked, unlockSound } from "../../../lib/studio/flight/soundtrack";

/** How it looks: the meteoair page's pill on the dark wash, or a chip of the plan's. */
export let look: "pill" | "chip" = "pill";

const available = soundAvailable();
$: on = !$flightMuted && !$soundLocked;

function press(): void {
  if ($flightMuted) setFlightMuted(false);
  else if (!$soundLocked) setFlightMuted(true);
  // Turning it on is a click: what lets the page play.
  unlockSound();
}
</script>

{#if available}
  <button type="button" class="switch {look}" data-sound-switch aria-pressed={on} on:click={press}
    title={$_(on ? "studio.flight.sound.on_title" : "studio.flight.sound.off_title")}>
    <MusicIcon off={!on} />
    <span>{$_(on ? "studio.flight.sound.on" : "studio.flight.sound.off")}</span>
  </button>
{/if}

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .switch :global(svg) { width: 14px; height: 14px; }
  .pill {
    height: 38px;
    padding: 0 16px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: var(--mc-radius-pill);
    background: rgba(7, 11, 17, 0.62);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    color: #f4f6f8;
    font: 600 13px/1 var(--mc-font);
    transition: background-color 0.12s ease;
  }
  .pill:hover { background: rgba(30, 38, 50, 0.8); }
  .pill:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .chip {
    height: var(--mc-pill-h);
    padding: 0 12px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip :global(svg) { width: 12px; height: 12px; }
  /* Narrow: the icon alone, the words for a screen reader still. The page's width, not the screen's (lib/sideways.ts). */
  @container mc-frame (max-width: 760px) {
    .pill { width: 38px; padding: 0; justify-content: center; }
    .pill span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  }
  @media (pointer: coarse) {
    .chip { height: 40px; padding: 0 16px; }
  }
</style>
