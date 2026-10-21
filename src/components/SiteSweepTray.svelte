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
import { siteMode, siteSweepView } from "../stores";
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

function clock(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString($locale ?? undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

$: chosenTilt = view && mode
  ? view.tilts.reduce((best, tilt) => (Math.abs(tilt.elevation - mode.elevation) < Math.abs(best.elevation - mode.elevation) ? tilt : best), view.tilts[0])
  : null;
</script>

<style>
  .tray {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 0 4px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .name {
    font: 600 13px/1.2 var(--mc-font);
    color: var(--mc-text-1);
  }

  .time, .note {
    font: 500 11px/1.3 var(--mc-font);
    color: var(--mc-text-2);
  }

  .note.warn {
    color: var(--mc-warn, #b45309);
  }

  select {
    font: 500 12px/1.2 var(--mc-font);
    color: var(--mc-text-1);
    background: transparent;
    border: 1px solid var(--mc-hairline, rgba(127, 127, 127, 0.35));
    border-radius: 999px;
    padding: 4px 10px;
  }

  .close {
    margin-left: auto;
  }
</style>

{#if mode && view}
  <div class="tray" role="group" aria-label={$_("site.title", { values: { name } })}>
    <div class="line">
      <span class="name">{$_("site.title", { values: { name } })}</span>
      <button type="button" class="controlButton close" on:click={close}
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
    </div>
    <div class="line">
      {#if view.status === "none"}
        <span class="time">{$_("site.none")}</span>
      {:else if view.status === "failed"}
        <span class="time">{$_("site.failed")}</span>
      {:else if view.startedAt || view.scannedAt}
        <span class="time">{$_("site.scanned", { values: { time: clock(view.startedAt ?? view.scannedAt) } })}</span>
      {/if}
      {#if mode.quantity !== "reflectivity" && view.dealiased === true}
        <span class="note" title={view.dealiaser ?? ""}>{$_("site.dealiased")}</span>
      {:else if mode.quantity !== "reflectivity" && view.dealiased === false}
        <span class="note warn">{$_("site.not_dealiased")}</span>
      {/if}
    </div>
    {#if mode.quantity === "srv" && !view.hasMotion}
      <p class="note">{$_("site.srv_hint")}</p>
    {/if}
  </div>
{/if}
