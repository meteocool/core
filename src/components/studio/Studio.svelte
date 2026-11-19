<script lang="ts">
/**
 * meteocool Studio: the 3D map as a place to make pictures of storms.
 *
 * A mode of the 3D map, on a desktop. The map's own chrome for looking
 * (the legend, the peel's tray) steps aside for a tools panel and a
 * timeline: section planes that cut every storm where the reader puts them,
 * the standard views and lenses, the last two hours of scans on a slider,
 * and a scene of keyframes that plays, records to a video and goes into a
 * link. The map underneath is the same map; see lib/studio.
 *
 * Or the reader flies: the panel and the timeline give way to a cockpit's
 * flight deck (flight/FlightDeck.svelte), and the pilot (lib/studio/flight)
 * flies the camera over the same map.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import StudioPanel from "./StudioPanel.svelte";
import StudioTimeline from "./StudioTimeline.svelte";
import FlightDeck from "./flight/FlightDeck.svelte";
import Preflight from "./flight/Preflight.svelte";
import { Director } from "../../lib/studio/director";
import type { Stage } from "../../lib/studio/director";
import { Pilot } from "../../lib/studio/flight/pilot";
import type { FlightPlan } from "../../lib/studio/flight/plan";
import { cropOf } from "../../lib/studio/record";
import { closeStudio } from "../../lib/studio/session";
import { STUDIO_SUPPORT } from "../../lib/studio/support";
import { studioAspect, studioFlying, studioPlaying, studioRecording } from "../../lib/studio/store";

/** The 3D map. */
export let stage: Stage;

// What the map calls of Studio's code comes with Studio, not with the map.
stage.setStudioSupport(STUDIO_SUPPORT);
const director = new Director(stage);

/** The flight under way; null when the reader is not flying. */
let pilot: Pilot | null = null;

/** Whether the reader is planning a flight: the page before it (flight/Preflight.svelte). */
let planning = false;

/** To the flight's plan: a scene playing stops first. Not while one records. */
function plan(): void {
  if (pilot || $studioRecording !== null) return;
  director.pause();
  planning = true;
}

/** Take off, as planned. */
function fly(flightPlan: FlightPlan): void {
  planning = false;
  if (pilot) return;
  pilot = new Pilot(stage, { credits, modelCredit: $_("studio.flight.model_credit"), onLeave: land }, flightPlan);
  pilot.start();
}

/** Back to Studio, the map and its tools as they were. */
function land(): void {
  const flying = pilot;
  pilot = null;
  flying?.stop();
}

// The map can end a flight itself: when the 3D map is put away under it.
$: if (!$studioFlying && pilot) land();
// The page's own chrome goes while flying; see global.css.
$: document.documentElement.classList.toggle("mc-flying", $studioFlying);

onDestroy(() => {
  land();
  document.documentElement.classList.remove("mc-flying");
  director.dispose();
});

/** The credits on the map, for a recording to carry: what its own line of them reads. */
function credits(): string {
  const line = stage.canvas()?.closest(".maplibregl-map")?.querySelector(".maplibregl-ctrl-attrib-inner");
  return (line?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/* What a recording frames, drawn over the map while a shape other than the
   whole window is chosen: the part outside it is dimmed. */
let width = 0;
let height = 0;
$: frame = $studioAspect === "window" ? null : cropOf(width, height, $studioAspect);

function keydown(event: KeyboardEvent) {
  // The flight has keys of its own (lib/studio/flight/controls.ts), and so has its plan.
  if ($studioFlying || planning) return;
  const target = event.target as HTMLElement | null;
  // A control with the focus keeps its own keys: Space presses a button.
  if (target?.closest("input, select, textarea, button, [role='radio'], [contenteditable]")) return;
  if (event.key === " ") {
    event.preventDefault();
    if ($studioPlaying) director.pause();
    else void director.play();
  } else if (event.key === "k" || event.key === "K") {
    director.addKeyframe();
  } else if (event.key === "Escape" && ($studioPlaying || $studioRecording !== null)) {
    event.stopPropagation();
    director.pause();
  }
}
</script>

<svelte:window on:keydown={keydown} />

<div class="studio" class:flying={$studioFlying} bind:clientWidth={width} bind:clientHeight={height}>
  {#if $studioFlying && pilot}
    <FlightDeck {pilot} {credits} />
  {:else if planning}
    <Preflight {stage} ontakeoff={fly} oncancel={() => { planning = false; }} />
  {:else}
  {#if frame && width && height}
    <div
      class="frame"
      class:recording={$studioRecording !== null}
      style:left={`${frame.x}px`}
      style:top={`${frame.y}px`}
      style:width={`${frame.width}px`}
      style:height={`${frame.height}px`}
      aria-hidden="true">
      <span>{$studioAspect}</span>
    </div>
  {/if}
  <StudioPanel {director} onclose={closeStudio} onfly={plan} />
  <StudioTimeline {director} {credits} />
  {#if $studioRecording !== null}
    <p class="rec" role="status">{$_("studio.recording_note")}</p>
  {/if}
  {/if}
</div>

<style>
  .studio {
    --studio-accent: var(--mc-orange);
    position: absolute;
    inset: 0;
    z-index: var(--mc-z-chrome);
    pointer-events: none;
  }
  .studio > :global(*) { pointer-events: auto; }
  /* The flight deck covers the page's own chrome, over which it is drawn. */
  .studio.flying { z-index: var(--mc-z-frame); }
  .studio.flying > :global(*) { pointer-events: none; }

  /* The frame: a hairline with everything outside it dimmed by one large shadow. */
  .studio > .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--studio-accent) 70%, transparent);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.28);
    pointer-events: none;
  }
  .frame.recording { border-color: #ff453a; }
  .frame span {
    position: absolute;
    top: 6px;
    right: 8px;
    color: color-mix(in srgb, var(--studio-accent) 85%, transparent);
    font: 600 11px/1 var(--mc-font);
  }
  .studio > .rec {
    position: absolute;
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
    left: 50%;
    margin: 0;
    padding: 6px 12px;
    border-radius: var(--mc-radius-pill);
    background: #ff453a;
    color: #fff;
    font: 600 12px/1 var(--mc-font);
    transform: translateX(-50%);
    pointer-events: none;
  }
</style>
