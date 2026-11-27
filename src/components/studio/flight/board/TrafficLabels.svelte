<script lang="ts">
/**
 * The callsigns over the other aircraft within a few kilometres: a handful
 * of labels, made once and moved each frame to where the traffic's drawing
 * last put its aircraft (layers/trafficPass.ts). None in the clean view;
 * the deck leaves this out there.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import type { Pilot } from "../../../../lib/studio/flight/pilot";
import type { BoardDeck } from "./meteoairBoard";

export let board: BoardDeck;
export let pilot: Pilot;

let box: HTMLDivElement | null = null;
const slots: Array<HTMLSpanElement | null> = board.traffic.labels.map(() => null);
const written: string[] = board.traffic.labels.map(() => "");
let stop: (() => void) | null = null;

function place(): void {
  if (!box) return;
  const width = box.clientWidth;
  const height = box.clientHeight;
  board.traffic.labels.forEach((label, i) => {
    const slot = slots[i];
    if (!slot) return;
    if (!label.shown) {
      if (slot.style.display !== "none") slot.style.display = "none";
      return;
    }
    const text = `${label.callsign} · ${(label.distance / 1000).toFixed(1)}`;
    if (written[i] !== text) {
      slot.textContent = $_("studio.flight.traffic.label", { values: { callsign: label.callsign, km: (label.distance / 1000).toFixed(1) } });
      written[i] = text;
    }
    slot.style.display = "";
    slot.style.transform = `translate(${(label.x * width).toFixed(1)}px, ${(label.y * height).toFixed(1)}px) translate(-50%, -100%)`;
  });
}

onMount(() => {
  stop = pilot.onFrame(place);
});
onDestroy(() => stop?.());
</script>

<div class="traffic-labels" bind:this={box} aria-hidden="true">
  {#each board.traffic.labels as _label, i (i)}
    <span class="label" style="display: none" bind:this={slots[i]}></span>
  {/each}
</div>

<style>
  .traffic-labels {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .label {
    position: absolute;
    left: 0;
    top: 0;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(5, 7, 10, 0.45);
    color: #f2f4f7;
    font: 600 11px/1.3 var(--mc-font);
    letter-spacing: 0.03em;
    white-space: nowrap;
    will-change: transform;
  }
</style>
