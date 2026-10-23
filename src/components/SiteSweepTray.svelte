<script lang="ts">
/**
 * Site mode's controls, in the player's tray while a radar is open: what to
 * draw of it (reflectivity, radial velocity, or velocity relative to the
 * selected storm), at which tilt, the sweep's own scan time, and the way out.
 *
 * Each tilt is offered with how high its beam is 100 km out, which is what a
 * reader choosing one wants to know. A velocity sweep says whether the
 * server could dealias it, because a fold looks exactly like a couplet.
 */
import { _, locale } from "svelte-i18n";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import Icon from "./Icon.svelte";
import Segmented from "./Segmented.svelte";
import { onDestroy } from "svelte";
import { pointMenuAt, selectedStorm, siteMode, siteSweepView, stormDetails } from "../stores";
import { radarSite } from "../lib/radarSites";
import { tiltLabel } from "../lib/siteSweeps";
import type { Quantity } from "../lib/siteSweeps";

$: mode = $siteMode;
$: view = $siteSweepView;
$: name = mode ? (radarSite(mode.site)?.name ?? mode.site.toUpperCase()) : "";
$: options = [
  { value: "reflectivity" as Quantity, label: $_("site.quantity.reflectivity") },
  ...(view?.hasVelocity ? [
    { value: "velocity" as Quantity, label: $_("site.quantity.velocity") },
    { value: "srv" as Quantity, label: $_("site.quantity.srv") },
  ] : []),
];

function setQuantity(quantity: Quantity) {
  siteMode.update((current) => (current ? { ...current, quantity } : current));
}

function setTilt(event: Event) {
  const elevation = Number((event.target as HTMLSelectElement).value);
  siteMode.update((current) => (current ? { ...current, elevation } : current));
}

function close() {
  siteMode.set(null);
}

/*
 * Escape closes the radar, unless something over it is what the key is for:
 * a dialog, the point menu, the open storm's panel (whose motion a
 * storm-relative sweep is read against, so it goes first), or a field
 * other than the tray's own tilt.
 * Capture phase, so the storm is still open when this looks.
 */
let tray: HTMLElement | undefined;
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !$siteMode) return;
  if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
  if ($pointMenuAt || ($selectedStorm && $stormDetails)) return;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target && !tray?.contains(target) && /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  event.preventDefault();
  close();
}
window.addEventListener("keydown", onKeydown, true);
onDestroy(() => window.removeEventListener("keydown", onKeydown, true));

function clock(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString($locale ?? undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

$: chosenTilt = view && mode
  ? view.tilts.reduce((best, tilt) => (Math.abs(tilt.elevation - mode.elevation) < Math.abs(best.elevation - mode.elevation) ? tilt : best), view.tilts[0])
  : null;
</script>

<style>
  /* Two lines where the timeline was: whose sweep and when, then what to
     draw of it and at which tilt, with what the server says of the fold. */
  .tray {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 0 0;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .line.top { flex-wrap: nowrap; }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    font: 700 13px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .time, .note {
    font: 500 11px/1.3 var(--mc-font);
    color: var(--mc-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .time { flex: 0 1 auto; min-width: 0; }
  /* Takes what is left of its line, onto the next when that is too little. */
  .note { flex: 1 1 8em; min-width: 0; }

  .note.warn {
    color: var(--mc-warn, #b45309);
  }

  select {
    font: 500 12px/1.2 var(--mc-font);
    color: var(--mc-text);
    background: transparent;
    border: 1px solid var(--mc-hairline);
    border-radius: var(--mc-radius-pill, 999px);
    padding: 5px 10px;
  }

  /* The way out, small like the player's other close. */
  .close {
    flex: 0 0 auto;
    margin-left: auto;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--mc-tint);
    color: var(--mc-text-3);
    font-size: 13px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .close:hover { background: var(--mc-tint-hover); color: var(--mc-text); }
  .close:active { background: var(--mc-tint-active); transform: scale(var(--mc-press)); }
  .close:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
</style>

{#if mode && view}
  <div class="tray" bind:this={tray} role="group" aria-label={$_("site.title", { values: { name } })}>
    <div class="line top">
      <span class="name">{$_("site.title", { values: { name } })}</span>
      {#if view.status === "none"}
        <span class="time">{$_("site.none")}</span>
      {:else if view.status === "failed"}
        <span class="time">{$_("site.failed")}</span>
      {:else if view.startedAt || view.scannedAt}
        <span class="time">{$_("site.scanned", { values: { time: clock(view.startedAt ?? view.scannedAt) } })}</span>
      {/if}
      <button type="button" class="close" on:click={close}
        title={$_("site.close")} aria-label={$_("site.close")}>
        <Icon icon={faXmark} />
      </button>
    </div>
    <div class="line">
      <Segmented options={options} value={mode.quantity} label={$_("site.quantity.group")}
        on:change={(event) => setQuantity(event.detail)} />
      {#if view.tilts.length}
        <select aria-label={$_("site.tilt")} value={chosenTilt?.elevation} on:change={setTilt}>
          {#each view.tilts as tilt (tilt.elevation)}
            <option value={tilt.elevation}>{tiltLabel(tilt.elevation, tilt.beamKmAt100)}</option>
          {/each}
        </select>
      {/if}
      {#if mode.quantity === "srv" && !view.hasMotion}
        <span class="note" title={$_("site.srv_hint")}>{$_("site.srv_hint")}</span>
      {:else if mode.quantity !== "reflectivity" && view.dealiased === true}
        <span class="note" title={view.dealiaser ?? ""}>{$_("site.dealiased")}</span>
      {:else if mode.quantity !== "reflectivity" && view.dealiased === false}
        <span class="note warn" title={$_("site.not_dealiased")}>{$_("site.not_dealiased")}</span>
      {/if}
    </div>
  </div>
{/if}
