<script lang="ts">
/**
 * What the deck says of the board among its notes (FlightDeck.svelte), and
 * only when it matters, for a few seconds: the board has stopped counting
 * this flight, and why, in a word; or there is no board for this flight,
 * and the cockpit's score is all there is. The card (BoardCard.svelte) and
 * the readout keep saying it after.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { stoppedBy } from "../../../../lib/studio/flight/board/view";
import type { BoardDeck } from "./meteoairBoard";

export let board: BoardDeck;

const { view } = board;
const SHOWN_MS = 8_000;

$: stopped = $view.phase === "over" ? stoppedBy($view) : null;
$: said = stopped
  ? $_("studio.flight.board.stopped", { values: { reason: $_(`studio.flight.board.reason.${stopped}`) } })
  : $view.phase === "unavailable" ? $_("studio.flight.board.unavailable") : null;

let shown: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Say `what` for a while; nothing, at once. */
function say(what: string | null): void {
  if (timer) clearTimeout(timer);
  shown = what;
  timer = what ? setTimeout(() => { shown = null; }, SHOWN_MS) : null;
}
$: say(said);
onDestroy(() => { if (timer) clearTimeout(timer); });
</script>

{#if shown}
  <!-- Among the deck's alerts, which are a live region already. -->
  <p class="board-note">{shown}</p>
{/if}

<style>
  /* As the deck's own notes. */
  .board-note {
    margin: 0;
    padding: 6px 14px;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.6);
    color: #ffb340;
    font: 600 13px/1.2 var(--mc-font);
  }
</style>
