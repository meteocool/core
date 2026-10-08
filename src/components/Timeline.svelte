<script lang="ts">
/**
 * The radar's time scrubber, with the precipitation forecast as its track.
 *
 * The strip is two hours back to as far forward as the nowcast reaches, a
 * bar per five-minute step coloured by the reflectivity at the point being
 * asked about (the client's position, or a tapped one), with the forecast
 * half drawn fainter. Where there is nothing to plot the same strip is a
 * plain ruler of ticks, so the thing you drag looks the same whether or not
 * it is raining, and the bars read as the ruler's ticks grown by the rain.
 *
 * It is a timeline rather than a slider: tap anywhere to go there, drag and
 * the needle follows the finger, flick and it carries on and slows, and it
 * settles on a whole step because that is what the map can show. The ends
 * give way a little and spring back. It borrows that feel from the storm
 * cutaway's dial (SliceDial) but keeps the strip still under a moving
 * needle, because for weather the whole window matters: when the rain starts
 * is read off the strip, not off the number under the needle.
 *
 * The component only draws and reports: `seek` says which step the finger
 * has reached and `grab` that a hand is on it. Which frame the map shows,
 * and the play loop, stay with NowcastPlayback.
 */
import { createEventDispatcher, onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { radarColormap } from "../stores";
import { dbz2color } from "../lib/cmap_utils";
import { decideAxis, type SwipeAxis } from "../lib/swipeAway";
import { haptic } from "../lib/haptics";
import {
  AT_REST, axisTicks, barCeiling, glideStep, indexOf, lastPlayableIndex, restingStep, rubberBand,
  type TimelineStep,
} from "../lib/timeline";
import type { Translate } from "../locale/t";

/** The steps, oldest first; see lib/timeline.ts. */
export let steps: TimelineStep[] = [];
/** The grid's own "now": the axis is labelled as offsets from it. */
export let now = 0;
/** The newest observation: the mark between what was seen and what is expected. */
export let latest = 0;
/** The step on screen, unix seconds. The needle sits on it when nothing is moving it. */
export let value = 0;
/** Whether the strip answers a hand at all. Off in the collapsed strip, which opens the player instead. */
export let interactive = true;
/** How often the axis is labelled, in minutes. */
export let labelEvery = 30;

const dispatch = createEventDispatcher<{ seek: number; grab: void }>();

/** The height of the plot, in CSS px; the axis row sits under it. */
const PLOT_H = 56;
/** A ruler tick's height, minor and on the half hour. */
const TICK = 7;
const TICK_MAJOR = 13;

let width = 0;
$: n = steps.length;
/** The last step the needle may reach; the strip itself runs on to +2h. */
$: last = lastPlayableIndex(steps);
$: slot = n > 0 ? width / n : 0;
$: ceiling = barCeiling(steps);
$: nowIndex = indexOf(steps, latest);

/** "-2h", "+45m", "+1h30m", and "now" for the zero mark. */
function formatOffset(minutes: number, t: Translate): string {
  if (minutes === 0) return t("now");
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  if (abs % 60 === 0) return t("chrome.playback.offset_hours", { values: { sign, hours: abs / 60 } });
  if (abs < 60) return t("chrome.playback.offset_minutes", { values: { sign, minutes: abs } });
  return t("chrome.playback.offset_hours_minutes", {
    values: { sign, hours: Math.floor(abs / 60), minutes: abs % 60 },
  });
}

$: ticks = axisTicks(steps, now, labelEvery);

/** The bars, with the colour table applied once per redraw rather than per frame. */
$: bars = steps.map((step, i) => {
  const minutes = Math.round((step.t - now) / 60);
  if (step.dbz === null || step.dbz <= 0) {
    return { i, x: (i + 0.5) * slot, h: 0, fill: "", major: minutes % 30 === 0, pending: !step.playable };
  }
  const [r, g, b] = dbz2color(step.dbz, $radarColormap);
  const alpha = step.forecast ? 0.72 : 1;
  return {
    i,
    x: (i + 0.5) * slot,
    h: Math.max(2, (step.dbz / ceiling) * (PLOT_H - 4)),
    fill: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    major: minutes % 30 === 0,
    pending: !step.playable,
  };
});

/*
 * The first time the player opens in a session, the knob gives one small
 * nudge, so a thumb knows the strip is there to be dragged (a touch screen
 * has no hover and no cursor to say so). Once per session, and never under
 * reduced motion.
 */
const HINTED = "mc-timeline-hinted";
let nudge = false;
onMount(() => {
  if (!interactive) return;
  let seen = true;
  try { seen = sessionStorage.getItem(HINTED) === "1"; } catch { /* private mode: hint every time */ }
  if (seen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try { sessionStorage.setItem(HINTED, "1"); } catch { /* ignore */ }
  const timer = setTimeout(() => { nudge = true; }, 700);
  return () => clearTimeout(timer);
});

/*
 * The needle's position in steps. Fractional while a finger or a glide moves
 * it; parked on `value` the rest of the time, so a playback tick or a link
 * puts it where the map is.
 */
let pos = 0;
let dragging = false;
let frame = 0;
$: active = dragging || frame !== 0;
$: if (!active) pos = indexOf(steps, value);
$: needleX = (Math.min(Math.max(pos, -1.5), last + 1.5) + 0.5) * slot;
$: shownIndex = restingStep(pos, last);
$: readout = n > 0 ? formatOffset(Math.round((steps[shownIndex].t - now) / 60), $_) : "";

let reported = -1;
/**
 * Tell the player when the needle crosses onto another step. A tick of
 * haptics per step, and a firmer one on now and at the ends: the detents.
 */
function report(): void {
  const index = Math.min(Math.max(Math.round(pos), 0), last);
  if (index === reported || n === 0) return;
  const detent = index === nowIndex || index === 0 || index === last;
  reported = index;
  haptic(detent ? "detent" : "tick");
  dispatch("seek", steps[index].t);
}

function stop(): void {
  cancelAnimationFrame(frame);
  frame = 0;
}

/** Ease onto the nearest whole step, or onto now when it is close. */
function settle(): void {
  const target = restingStep(pos, last, nowIndex);
  const from = pos;
  if (Math.abs(target - from) < 0.001) {
    pos = target;
    report();
    return;
  }
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min((t - start) / 180, 1);
    pos = from + (target - from) * (1 - (1 - k) ** 3);
    report();
    frame = k < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}

/** Carry on at the release speed, slowing, then settle. */
let velocity = 0;
function glide(): void {
  if (Math.abs(velocity) < AT_REST || pos < 0 || pos > last) {
    settle();
    return;
  }
  let lastT = performance.now();
  const step = (t: number) => {
    const next = glideStep({ pos, velocity }, t - lastT, last, nowIndex);
    lastT = t;
    pos = next.pos;
    velocity = next.velocity;
    report();
    if (velocity === 0) {
      frame = 0;
      settle();
    } else {
      frame = requestAnimationFrame(step);
    }
  };
  frame = requestAnimationFrame(step);
}

let strip: HTMLDivElement;
let pointerId: number | null = null;
let downX = 0;
let downY = 0;
let lastX = 0;
let lastT = 0;
/**
 * The strip scrubs sideways only. A drag that sets off vertically is let go,
 * uncaptured, for whatever holds the tray to take, and a press that never
 * moves is a tap, which goes straight to the step under it.
 */
let axis: SwipeAxis = "undecided";

function indexAt(clientX: number): number {
  const rect = strip.getBoundingClientRect();
  return (clientX - rect.left) / slot - 0.5;
}

function onPointerDown(event: PointerEvent): void {
  if (!interactive || n === 0) return;
  stop();
  dispatch("grab");
  dragging = true;
  pointerId = event.pointerId;
  downX = lastX = event.clientX;
  downY = event.clientY;
  lastT = event.timeStamp;
  velocity = 0;
  axis = "undecided";
  reported = restingStep(pos, last);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== pointerId) return;
  if (axis === "undecided") {
    axis = decideAxis(event.clientX - downX, event.clientY - downY);
    if (axis === "undecided") return;
    if (axis === "y") {
      dragging = false;
      pointerId = null;
      return;
    }
    try { strip.setPointerCapture(event.pointerId); } catch { /* already gone */ }
  }
  const dt = Math.max(event.timeStamp - lastT, 1);
  const delta = (event.clientX - lastX) / slot;
  velocity = 0.7 * (delta / dt) + 0.3 * velocity;
  lastX = event.clientX;
  lastT = event.timeStamp;
  pos = rubberBand(indexAt(event.clientX), last);
  report();
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  dragging = false;
  pointerId = null;
  if (axis === "undecided") {
    // A tap: straight to the step under the finger.
    pos = restingStep(indexAt(event.clientX), last);
    report();
    return;
  }
  // A finger held still before letting go means "here", not "keep going".
  if (event.timeStamp - lastT > 80) velocity = 0;
  glide();
}

function onKey(event: KeyboardEvent): void {
  if (!interactive || n === 0) return;
  const step = event.shiftKey ? 6 : 1;
  let target: number;
  if (event.key === "ArrowLeft") target = restingStep(pos, last) - step;
  else if (event.key === "ArrowRight") target = restingStep(pos, last) + step;
  else if (event.key === "Home") target = nowIndex;
  else if (event.key === "End") target = last;
  else return;
  event.preventDefault();
  stop();
  dispatch("grab");
  pos = restingStep(target, last);
  reported = -1;
  report();
}

onDestroy(stop);
</script>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: var(--mc-text-2);
  }

  .strip {
    position: relative;
    height: var(--plot-h);
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .strip.interactive {
    touch-action: pan-y;
    cursor: grab;
  }
  .strip.interactive.dragging {
    cursor: grabbing;
  }
  .strip.interactive:focus-visible::after {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: 8px;
    box-shadow: 0 0 0 2px var(--mc-accent);
    pointer-events: none;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  /* The ruler under the bars: every step a tick, the half hours taller. A
     bar covers its tick where it rains, so the strip reads as one thing. */
  .tick {
    fill: currentColor;
    opacity: 0.28;
  }
  .tick.major {
    opacity: 0.5;
  }
  /* The unpublished tail: on the axis, but not yet anything to see. */
  .tick.pending {
    opacity: 0.12;
  }

  /* What has already happened, tinted, so the eye finds now without reading. */
  .past {
    fill: currentColor;
    opacity: 0.06;
  }
  .now {
    stroke: currentColor;
    stroke-width: 1;
    stroke-dasharray: 2 3;
    opacity: 0.6;
  }

  .rain {
    shape-rendering: crispEdges;
  }

  /* The needle: the chrome's accent, haloed so it stands on any bar colour. */
  .needle {
    fill: var(--mc-chrome-accent, var(--mc-accent));
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1;
    transition: opacity var(--mc-motion-fast);
  }
  .strip:not(.interactive) .needle {
    opacity: 0.85;
  }
  .needle-group {
    will-change: transform;
  }
  .knob {
    fill: var(--mc-chrome-accent, var(--mc-accent));
    stroke: rgba(255, 255, 255, 0.7);
    stroke-width: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
    transition: transform var(--mc-motion-fast) var(--mc-ease);
    transform-box: fill-box;
    transform-origin: center;
  }
  .grip {
    fill: rgba(255, 255, 255, 0.85);
  }
  /* Under a finger the knob grows a little, as a picked-up thing does. */
  .strip.dragging .knob {
    transform: scale(1.15);
  }
  /* The first-open hint: a small sway of the knob and needle, twice. */
  .needle-group.nudge {
    animation: mc-timeline-nudge 1100ms var(--mc-ease) 1;
  }
  @keyframes mc-timeline-nudge {
    0%, 100% { translate: 0 0; }
    22% { translate: 9px 0; }
    50% { translate: -7px 0; }
    76% { translate: 4px 0; }
  }

  /* The offset under the needle, while a hand is on it. */
  .readout {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    padding: 1px 7px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-chrome-accent, var(--mc-accent));
    color: #fff;
    font: 600 11px/16px var(--mc-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    white-space: nowrap;
    pointer-events: none;
  }

  /* Spans the strip exactly, so a label sits under the minute the needle
     would be at. The two ends sit flush; the rest centre on their bar. */
  .axis {
    position: relative;
    height: 16px;
    pointer-events: none;
  }
  .label {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
    font: 600 10px/16px var(--mc-font);
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .label.start,
  .label.end {
    transform: none;
  }
  .label.start { left: 0; }
  .label.end { right: 0; }
</style>

<div class="timeline" style:--plot-h="{PLOT_H}px">
  <div
    class="strip"
    class:interactive
    class:dragging
    bind:this={strip}
    bind:clientWidth={width}
    role="slider"
    tabindex={interactive ? 0 : -1}
    aria-readonly={!interactive}
    aria-label={$_("chrome.playback.timeline")}
    aria-valuemin={0}
    aria-valuemax={last}
    aria-valuenow={shownIndex}
    aria-valuetext={readout}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:keydown={onKey}>
    {#if n > 0 && width > 0}
      <svg viewBox="0 0 {width} {PLOT_H}" preserveAspectRatio="none" aria-hidden="true">
        <rect class="past" x="0" y="0" width={(nowIndex + 1) * slot} height={PLOT_H} />
        {#each bars as bar (bar.i)}
          <rect
            class="tick"
            class:major={bar.major}
            class:pending={bar.pending}
            x={bar.x - 0.75}
            y={PLOT_H - (bar.major ? TICK_MAJOR : TICK)}
            width="1.5"
            height={bar.major ? TICK_MAJOR : TICK}
            rx="0.75" />
        {/each}
        {#each bars as bar (bar.i)}
          {#if bar.h > 0}
            <rect
              class="rain"
              x={bar.x - Math.max(0.5, slot / 2 - 0.75)}
              y={PLOT_H - bar.h}
              width={Math.max(1, slot - 1.5)}
              height={bar.h}
              rx={Math.min(1.5, slot / 4)}
              fill={bar.fill} />
          {/if}
        {/each}
        <line class="now" x1={(nowIndex + 1) * slot} x2={(nowIndex + 1) * slot} y1="0" y2={PLOT_H} />
        <g class="needle-group" class:nudge style:transform="translateX({needleX}px)" on:animationend={() => { nudge = false; }}>
          <rect class="needle" x="-1.5" y="0.5" width="3" height={PLOT_H - 1} rx="1.5" />
          {#if interactive}
            <!-- The knob: a thumb's handle on the needle, with a grip. -->
            <rect class="knob" x="-7" y={PLOT_H / 2 - 11} width="14" height="22" rx="7" />
            <rect class="grip" x="-2.5" y={PLOT_H / 2 - 5} width="1.5" height="10" rx="0.75" />
            <rect class="grip" x="1" y={PLOT_H / 2 - 5} width="1.5" height="10" rx="0.75" />
          {/if}
        </g>
      </svg>
      {#if active}
        <span class="readout" style:left="{Math.min(Math.max(needleX, 24), width - 24)}px">{readout}</span>
      {/if}
    {/if}
  </div>
  <div class="axis" aria-hidden="true">
    {#each ticks as tick (tick.at)}
      <span
        class="label"
        class:start={tick.anchor === "start"}
        class:end={tick.anchor === "end"}
        style:left={tick.anchor === "end" ? null : `${tick.at * 100}%`}>
        {formatOffset(tick.minutes, $_)}
      </span>
    {/each}
  </div>
</div>
