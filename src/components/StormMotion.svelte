<script lang="ts">
/**
 * The motion storm-relative velocity takes out, as site mode's tray shows it:
 * one row saying whose it is and how it moves, which opens the controls to
 * set it by hand.
 *
 * One row, because the tray is rows of a fixed height and the map keeps the
 * rest (SiteSweepTray). The controls open over the map, above the row, where
 * the sweep they change stays in view: a compass dial a thumb turns, a speed
 * stepper, and with a storm selected, whether to take its motion or one's
 * own. Turning the dial or stepping the speed while the storm's motion is
 * taken starts from it and takes it over (lib/srvMotion.ts, `editBase`).
 */
import { tick } from "svelte";
import { _ } from "svelte-i18n";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons/faChevronUp";
import Icon from "./Icon.svelte";
import MotionDial from "./MotionDial.svelte";
import Segmented from "./Segmented.svelte";
import { selectedStorm, srvManualMotion, srvPrefersManual } from "../stores";
import { BAND_NAMES } from "../lib/cellMetrics";
import { placementLabel } from "../lib/cellPlacement";
import type { Translate } from "../lib/cellPlacement";
import { knowsSeverity, severityOf } from "../lib/stormSelection";
import type { StormSelection } from "../lib/stormSelection";
import { clampSpeed, compassPoint, editBase, MAX_SPEED_KMH, SPEED_STEP_KMH, stepSpeed } from "../lib/srvMotion";
import type { ManualMotion, MotionSource, SrvMotion } from "../lib/srvMotion";

/** What SRV is taking out, and whose (SiteSweepView.srv). */
export let srv: SrvMotion;
/** Whether a storm is selected that says how it moves. */
export let stormMoves: boolean;

/** Kept clear of the window's edges and the row. */
const MARGIN = 8;

/** Whether the controls are open: the tray leaves Escape to them while they are. */
export let open = false;
let trigger: HTMLButtonElement;
let panel: HTMLDivElement | undefined;
let left = MARGIN;
let bottom = 0;

/** What the dial and the stepper show: the motion in use, in whole degrees and km/h. */
$: shown = editBase(srv, $srvManualMotion);
$: line = $_("site.motion.line", {
  values: {
    source: srv.source === "manual" ? $_("site.motion.manual") : stormName($selectedStorm),
    speed: shown.speedKmh,
    direction: direction(shown.headingDeg, $_),
  },
});
$: sources = [
  { value: "storm" as MotionSource, label: $_("site.motion.storm") },
  { value: "manual" as MotionSource, label: $_("site.motion.by_hand") },
];

/** A heading as the storm panel words it: the nearest of sixteen points. */
const direction = (deg: number, t: Translate) => t(`storm.compass.${compassPoint(deg)}`);

/** What to call the storm whose motion is taken: where it is, else what it is. */
function stormName(selection: StormSelection | null): string {
  if (!selection) return $_("storm.storm_label.unclassed");
  const placement = selection.cell?.placement ?? selection.summary?.properties.placement ?? null;
  const place = placementLabel(placement, $_, "short");
  if (place) return place;
  if (!knowsSeverity(selection)) return $_("storm.storm_label.unclassed");
  return $_(`storm.storm_label.${BAND_NAMES[severityOf(selection) ?? 0]}`);
}

/** Set by hand: from the motion in use, which takes a storm's over. */
function edit(change: Partial<ManualMotion>) {
  const base = editBase(srv, $srvManualMotion);
  srvManualMotion.set({
    headingDeg: change.headingDeg ?? base.headingDeg,
    speedKmh: clampSpeed(change.speedKmh ?? base.speedKmh),
  });
  if (srv.source === "storm") srvPrefersManual.set(true);
}

/** A typed speed, once it is typed: brought into range, or put back if it is not a number. */
function typeSpeed(event: Event) {
  const input = event.target as HTMLInputElement;
  const typed = input.valueAsNumber;
  if (Number.isFinite(typed)) edit({ speedKmh: typed });
  input.value = String(Number.isFinite(typed) ? clampSpeed(typed) : shown.speedKmh);
}

/** Open the controls; from the keyboard, with the focus on the dial. */
async function show(keyboard: boolean) {
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  open = true;
  await tick();
  if (!panel) return;
  left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - panel.offsetWidth - MARGIN));
  if (keyboard) panel.querySelector<HTMLElement>("[role='slider']")?.focus({ preventScroll: true });
}

function close(refocus = false) {
  open = false;
  if (refocus) tick().then(() => trigger?.focus());
}

/** Anything outside the controls and the row closes them, as a menu does. */
function outside(event: PointerEvent) {
  if (!open) return;
  const target = event.target as Node;
  if (panel?.contains(target) || trigger?.contains(target)) return;
  close();
}

function keydown(event: KeyboardEvent) {
  if (!open || event.key !== "Escape") return;
  event.stopPropagation();
  close(true);
}

function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
</script>

<svelte:window on:pointerdown={outside} on:keydown={keydown} on:resize={() => close()} />

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: var(--mc-site-row-h);
    min-width: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 0 10px 0 4px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text-2);
    font: 500 11px/1.3 var(--mc-font);
    font-variant-numeric: tabular-nums;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .row:hover { background: var(--mc-tint-hover); }
  .row:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 1px;
  }
  .row .text {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row :global(svg.chevron) {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    margin-left: auto;
    transition: transform var(--mc-motion-fast) var(--mc-ease);
  }
  .row[aria-expanded="true"] :global(svg.chevron) { transform: rotate(180deg); }
  /* A wide screen has the room for the line whole, and no thumb to reach across it. */
  @media (min-width: 1024px) {
    .row { width: auto; max-width: 100%; }
    .row :global(svg.chevron) { margin-left: 4px; }
  }

  /* The arrow the dial has, small: which way the motion goes, at a glance. */
  .compass {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    color: var(--mc-accent);
  }
  .compass circle {
    fill: none;
    stroke: var(--mc-hairline);
    stroke-width: 6;
  }
  .compass .still { opacity: 0.4; }

  .panel {
    position: fixed;
    z-index: var(--mc-z-dialog);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    max-width: calc(100vw - 16px);
    box-sizing: border-box;
    padding: 12px;
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-ring-lg);
    font-family: var(--mc-font);
  }
  .settings {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .stepper button {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 19px/1 var(--mc-font);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .stepper button:hover:not(:disabled) { background: var(--mc-tint-hover); }
  .stepper button:active:not(:disabled) {
    transform: scale(var(--mc-press));
    background: var(--mc-tint-active);
  }
  .stepper button:disabled {
    color: var(--mc-text-3);
    cursor: default;
  }
  .stepper input {
    width: 3.2em;
    box-sizing: border-box;
    padding: 6px 2px;
    border: 1px solid var(--mc-hairline);
    border-radius: 10px;
    background: transparent;
    color: var(--mc-text);
    font: 600 15px/1.2 var(--mc-font);
    font-variant-numeric: tabular-nums;
    text-align: center;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .stepper input::-webkit-outer-spin-button,
  .stepper input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .unit {
    margin-left: 2px;
    color: var(--mc-text-2);
    font: 500 12px/1.2 var(--mc-font);
  }
</style>

<button
  bind:this={trigger}
  type="button"
  class="row"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={$_("site.motion.edit")}
  on:click={(event) => (open ? close() : show(event.detail === 0))}>
  <svg class="compass" viewBox="-50 -50 100 100" aria-hidden="true">
    <circle r="44" />
    <g class:still={shown.speedKmh === 0} transform="rotate({shown.headingDeg})">
      <path d="M0,-40 L-20,-6 L-7,-6 L-7,36 L7,36 L7,-6 L20,-6 Z" fill="currentColor" />
    </g>
  </svg>
  <span class="text">{line}</span>
  <Icon icon={faChevronUp} class="chevron" />
</button>

{#if open}
  <div bind:this={panel} use:portal class="panel glass glass-strong" role="dialog" aria-label={$_("site.motion.title")}
    style:left={`${left}px`} style:bottom={`${bottom}px`}>
    <MotionDial size={120} heading={shown.headingDeg} moving={shown.speedKmh > 0}
      label={$_("site.motion.heading")} valuetext={`${Math.round(shown.headingDeg)}° ${direction(shown.headingDeg, $_)}`}
      north={$_("storm.compass.N")} on:change={(event) => edit({ headingDeg: event.detail })} />
    <div class="settings">
      {#if stormMoves}
        <Segmented compact options={sources} value={srv.source} label={$_("site.motion.source")}
          on:change={(event) => srvPrefersManual.set(event.detail === "manual")} />
      {/if}
      <div class="stepper">
        <button type="button" aria-label={$_("site.motion.slower")} title={$_("site.motion.slower")}
          disabled={shown.speedKmh <= 0} on:click={() => edit({ speedKmh: stepSpeed(shown.speedKmh, -1) })}>−</button>
        <input type="number" inputmode="numeric" min="0" max={MAX_SPEED_KMH} step={SPEED_STEP_KMH}
          aria-label={$_("site.motion.speed")} value={shown.speedKmh} on:change={typeSpeed} />
        <button type="button" aria-label={$_("site.motion.faster")} title={$_("site.motion.faster")}
          disabled={shown.speedKmh >= MAX_SPEED_KMH} on:click={() => edit({ speedKmh: stepSpeed(shown.speedKmh, 1) })}>+</button>
        <span class="unit">km/h</span>
      </div>
    </div>
  </div>
{/if}
