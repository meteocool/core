<script lang="ts">
/**
 * The day's board, on a card under the deck's readouts: the pilot's
 * callsign, this flight's score on the board (the one that counts) beside
 * the cockpit's, where it stands, which of the cockpit's feats the board
 * granted, and the top twenty, the pilot's own entry marked.
 *
 * The board works the score out again from where the aircraft was, reading
 * the same radar, but it cannot see everything the cockpit does; where the
 * two differ, the card says why.
 */
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faPlane } from "@fortawesome/free-solid-svg-icons/faPlane";
import { _ } from "svelte-i18n";
import Icon from "../../../Icon.svelte";
import { featStanding, isOwn, scoresDiffer, stoppedBy } from "../../../../lib/studio/flight/board/view";
import type { BoardDeck } from "./meteoairBoard";

export let board: BoardDeck;

const { view, cockpit, open } = board;
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

$: stopped = stoppedBy($view);
$: differ = $view.cockpitThen !== null && scoresDiffer($view.cockpitThen, $view.points);

function close(event: MouseEvent): void {
  open.set(false);
  (event.currentTarget as HTMLElement).blur();
}
</script>

{#if $open}
  <section class="board-card glass glass-tray" aria-label={$_("studio.flight.board.heading")}>
    <h2>{$_("studio.flight.board.heading")}</h2>
    <button type="button" class="close" tabindex="-1" aria-label={$_("studio.flight.board.close")} title={$_("studio.flight.board.close")}
      on:click={close}>
      <Icon icon={faXmark} />
    </button>
    {#if $view.callsign}
      <p class="callsign">{$_("studio.flight.board.callsign")} <b>{$view.callsign}</b></p>
    {/if}
    <dl class="scores">
      <div class="counts">
        <dt>{$_("studio.flight.board.counts")}</dt>
        <dd aria-label={$_("studio.flight.board.counts")}>
          {$view.points === null ? "–" : points.format(Math.floor($view.points))}
          {#if $view.rank !== null}<span class="rank">#{$view.rank}</span>{/if}
        </dd>
      </div>
      <div>
        <dt>{$_("studio.flight.board.cockpit")}</dt>
        <dd aria-label={$_("studio.flight.board.cockpit")}>{points.format(Math.floor($cockpit.points))}</dd>
      </div>
    </dl>
    {#if $view.phase === "unavailable"}
      <p class="say caution">{$_("studio.flight.board.unavailable")}</p>
    {:else if stopped}
      <p class="say caution">{$_("studio.flight.board.stopped", { values: { reason: $_(`studio.flight.board.reason.${stopped}`) } })}</p>
    {:else if !$view.reachable}
      <p class="say">{$_("studio.flight.board.unreachable")}</p>
    {:else if $view.phase === "joining"}
      <p class="say">{$_("studio.flight.board.joining")}</p>
    {:else if $view.points !== null && $view.rank === null}
      <p class="say">{$_("studio.flight.board.unranked")}</p>
    {/if}
    {#if differ}
      <p class="say why">{$_("studio.flight.board.differ")}</p>
    {/if}
    {#if $cockpit.feats.length}
      <ul class="feats" aria-label={$_("studio.flight.board.feats")}>
        {#each $cockpit.feats as feat (feat)}
          {@const standing = featStanding(feat, $view)}
          <li>
            <span>{$_(`studio.flight.feat.${feat}`)}</span>
            <span class="standing {standing}">{$_(`studio.flight.board.feat_${standing}`)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if $view.top.length}
      <ol class="top" aria-label={$_("studio.flight.board.top")}>
        {#each $view.top as entry (entry.rank)}
          {@const own = isOwn(entry, $view)}
          <li class:own aria-current={own ? "true" : undefined}>
            <span class="place">{entry.rank}</span>
            <span class="who">{entry.callsign}{#if own}<em>{$_("studio.flight.board.you")}</em>{/if}</span>
            <span class="flying" title={entry.flying ? $_("studio.flight.board.flying") : undefined}>
              {#if entry.flying}<Icon icon={faPlane} />{/if}
            </span>
            <span class="pts">{points.format(entry.points)}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="say">{$_("studio.flight.board.empty")}</p>
    {/if}
  </section>
{/if}

<style>
  /* Where it stands is the deck's to say (FlightDeck.svelte): in the middle under the top's readouts, scrolled where it has to be. */
  .board-card {
    position: relative;
    width: 300px;
    max-width: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    box-sizing: border-box;
    padding: 14px 16px 14px;
    color: var(--mc-text);
    font: 13px/1.3 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  /* The deck lets presses through what is on it to the view (FlightDeck.svelte); not on this card. */
  :global(.flight-deck) .board-card { pointer-events: auto; }
  /* Flown by touch, under the top row of readouts. */
  :global(.flight-deck.touch) .board-card {
    position: absolute;
    width: min(300px, calc(100% - 32px));
    top: calc(var(--deck-top) + 50px);
    left: var(--deck-left);
    max-height: calc(100% - var(--deck-top) - 50px - 140px);
  }
  h2 {
    margin: 0 32px 8px 0;
    font: var(--mc-type-heading);
  }
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
  .callsign { margin: 0 0 8px; color: var(--mc-text-2); }
  .callsign b { color: var(--mc-text); letter-spacing: 0.04em; }
  .scores {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0 0 8px;
  }
  .scores dt { color: var(--mc-text-2); font: 600 11px/1.4 var(--mc-font); text-transform: uppercase; letter-spacing: 0.05em; }
  .scores dd { margin: 0; font: 700 18px/1.2 var(--mc-font); }
  .scores .counts dd { color: #9fe0b8; }
  .rank { margin-left: 6px; color: var(--mc-text); font-size: 13px; }
  .say { margin: 0 0 8px; color: var(--mc-text-2); font-size: 12px; line-height: 1.35; }
  .say.caution { color: #ffb340; font-weight: 600; }
  .feats, .top { margin: 0 0 8px; padding: 0; list-style: none; }
  .feats li { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .standing { color: var(--mc-text-2); font-size: 12px; }
  .standing.board { color: #3ddc84; }
  .standing.cockpit { color: #ffb340; }
  .top { margin-bottom: 0; border-top: 1px solid var(--mc-hairline); padding-top: 6px; }
  .top li { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 6px; align-items: baseline; padding: 2px 4px; border-radius: 6px; }
  .top li.own { background: rgba(159, 224, 184, 0.16); font-weight: 700; }
  .place { color: var(--mc-text-2); text-align: right; }
  .who em { margin-left: 6px; color: #9fe0b8; font-style: normal; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .flying { color: #7fd4ff; font-size: 10px; }
  .flying :global(svg) { width: 10px; height: 10px; }
  .pts { text-align: right; }
</style>
