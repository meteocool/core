<script lang="ts">
/**
 * The check the board may ask of a reader before it takes a flight
 * (lib/studio/flight/board/turnstile.ts), on a card of the deck's. The
 * widget draws itself only when it has something to ask; the card round it
 * is there only then, saying what it is for and how to fly on without it.
 *
 * The widget's place is in the page from the start and never hidden: it is
 * where the check runs, asked or not.
 */
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { _ } from "svelte-i18n";
import Icon from "../../../Icon.svelte";
import type { BoardDeck } from "./meteoairBoard";

export let board: BoardDeck;

const { asking, place, skip } = board.check;
/** The widget's place, given to it once it is in the page. */
const hold = (element: HTMLElement) => place(element);
</script>

<section class="board-check" class:asking={$asking} class:glass={$asking} class:glass-tray={$asking}
  aria-label={$asking ? $_("studio.flight.board.check.title") : undefined}>
  {#if $asking}
    <h2>{$_("studio.flight.board.check.title")}</h2>
    <p>{$_("studio.flight.board.check.hint")}</p>
    <button type="button" class="close" tabindex="-1" on:click={skip}
      title={$_("studio.flight.board.check.skip")} aria-label={$_("studio.flight.board.check.skip")}>
      <Icon icon={faXmark} />
    </button>
  {/if}
  <div class="widget" use:hold></div>
</section>

<style>
  /* Bottom centre, over the panel: clear of the keys' card, the deck's notes and its corners. */
  .board-check {
    position: absolute;
    bottom: calc(var(--mc-safe-bottom, 0px) + 28px);
    left: 50%;
    z-index: 3;
    width: min(332px, calc(100% - 32px));
    box-sizing: border-box;
    padding: 14px 16px 16px;
    transform: translateX(-50%);
    color: var(--mc-text);
    font: 13px/1.35 var(--mc-font);
    pointer-events: none;
  }
  /* Flown by touch, the sticks have the bottom: under the top rows of readouts instead. */
  :global(.flight-deck.touch) > .board-check {
    top: calc(var(--deck-top) + 96px);
    bottom: auto;
  }
  /* The deck lets presses through what is on it to the view (FlightDeck.svelte); not on this card while it asks. */
  .board-check.asking { pointer-events: auto; }
  h2 {
    margin: 0 32px 4px 0;
    font: var(--mc-type-heading);
  }
  p {
    margin: 0 0 12px;
    color: var(--mc-text-2);
  }
  /* The widget is 65px tall when it asks; nothing when it does not. */
  .board-check.asking .widget { min-height: 65px; }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: transparent;
    color: var(--mc-text-2);
    font-size: 14px;
    cursor: pointer;
  }
  .close:hover,
  .close:focus-visible {
    color: var(--mc-text);
    background: var(--mc-tint-hover);
  }
</style>
