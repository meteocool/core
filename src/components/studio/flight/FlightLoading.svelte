<script lang="ts">
/**
 * Between taking off and the flight: what of it is still loading
 * (lib/studio/flight/preload.ts), and how far along. Up only while
 * something is still to come; the flight starts the moment it is all there.
 * The menus' music fades out across it, the flight's own comes up as the
 * flight begins. A failure says so, with another try and the way back.
 */
import { _ } from "svelte-i18n";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import Icon from "../../Icon.svelte";
import { flightLoad, shareOf } from "../../../lib/studio/flight/preload";

export let onretry: () => void;
export let onback: () => void;

const MB = 1024 * 1024;
$: percent = Math.floor(shareOf($flightLoad) * 100);
$: failed = $flightLoad.state === "failed";

function keydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  onback();
}
</script>

<svelte:window on:keydown|capture={keydown} />

<div class="loading" role="dialog" aria-modal="true" aria-labelledby="flight-loading-title">
  <section class="card glass glass-tray glass-reading">
    <h2 id="flight-loading-title"><Icon icon={faPlaneDeparture} /> {$_("studio.flight.loading.title")}</h2>
    {#if failed}
      <p class="failed" role="alert">{$_("studio.flight.loading.failed")}</p>
      <div class="actions">
        <button type="button" class="chip" on:click={onback}>{$_("studio.flight.loading.back")}</button>
        <button type="button" class="chip go" on:click={onretry}>{$_("studio.flight.loading.retry")}</button>
      </div>
    {:else}
      <p class="what">{$_("studio.flight.loading.what")}</p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}
        aria-label={$_("studio.flight.loading.title")}>
        <span style:width={`${percent}%`}></span>
      </div>
      <p class="numbers">
        <span>{percent}%</span>
        <span>{$_("studio.flight.loading.progress", { values: {
          loaded: ($flightLoad.loaded / MB).toFixed(1), total: ($flightLoad.total / MB).toFixed(1),
        } })}</span>
      </p>
      <div class="actions">
        <button type="button" class="chip" on:click={onback}>{$_("studio.flight.loading.back")}</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: auto;
  }
  .card {
    width: min(420px, 100%);
    box-sizing: border-box;
    padding: 18px 20px 16px;
    color: var(--mc-text);
    font: 13px/1.4 var(--mc-font);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font: 700 17px/1.2 var(--mc-font);
  }
  h2 :global(svg) { width: 16px; height: 16px; color: var(--mc-orange); }
  .what { margin: 8px 0 14px; opacity: 0.8; }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--mc-tint);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--mc-orange);
    transition: width 0.2s ease;
  }
  .numbers {
    display: flex;
    justify-content: space-between;
    margin: 8px 0 0;
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .failed { margin: 10px 0 0; color: #ff6961; font-weight: 600; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: var(--mc-pill-h);
    padding: 0 14px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip.go { background: var(--mc-orange); color: #1a1205; }
  @media (prefers-reduced-motion: reduce) {
    .bar span { transition: none; }
  }
  @media (pointer: coarse) {
    .chip { height: 40px; padding: 0 18px; }
  }
</style>
