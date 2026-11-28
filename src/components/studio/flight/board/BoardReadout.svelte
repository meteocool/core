<script lang="ts">
/**
 * Where this flight stands on today's board, beside the cockpit's score
 * among the deck's readouts (FlightDeck.svelte): its rank, the score itself
 * being the cockpit's, which takes the board's in now and then. Pressed, it
 * brings up the day's board (BoardCard.svelte).
 */
import { _ } from "svelte-i18n";
import type { BoardDeck } from "./meteoairBoard";

export let board: BoardDeck;

const { view, open } = board;

$: text = $view.phase === "unavailable"
  ? $_("studio.flight.board.off")
  : $view.rank !== null ? `#${$view.rank}` : $_("studio.flight.board.label");

function toggle(event: MouseEvent): void {
  open.update((up) => !up);
  // The flight's keys stay the flight's (controls.ts), not this button's.
  (event.currentTarget as HTMLElement).blur();
}
</script>

<button type="button" class="board-points" class:off={$view.phase === "unavailable"} tabindex="-1"
  title={$_("studio.flight.board.title")} aria-expanded={$open}
  aria-label={`${$_("studio.flight.board.title")}: ${text}`} on:click={toggle}>{text}</button>

<style>
  .board-points {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: #9fe0b8;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-decoration: underline dotted rgba(159, 224, 184, 0.6);
    text-underline-offset: 3px;
    cursor: pointer;
    pointer-events: auto;
  }
  .board-points.off { color: #9aa3ad; }
  .board-points:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
</style>
