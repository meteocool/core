<script lang="ts">
/**
 * Site mode's controls, in the player's tray while a radar is open: what to
 * draw of it (reflectivity, radial velocity, or velocity relative to the
 * selected storm), at which tilt, the sweep's own scan time, and the way out.
 *
 * Each tilt is offered with how high its beam is 100 km out, which is what a
 * reader choosing one wants to know. A velocity sweep says whether the
 * server could dealias it, because a fold looks exactly like a couplet.
 *
 * Two rows of a fixed height up to a wide screen and one row there, so the
 * map keeps the rest. The player grows by exactly that: --mc-site-tray-h in
 * glass.css, switched on by the root's `site-open` while this is drawn.
 * Whatever does not fit gives way with an ellipsis rather than adding a row,
 * and the status is a short badge with its whole sentence in the title. On a
 * phone the chosen tilt shows its elevation alone; the list it opens has the
 * beam heights.
 */
import { onDestroy } from "svelte";
import { _, locale } from "svelte-i18n";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import Icon from "./Icon.svelte";
import Segmented from "./Segmented.svelte";
import { pointMenuAt, selectedStorm, siteMode, siteSweepView, stormDetails } from "../stores";
import { radarSite } from "../lib/radarSites";
import { tiltAngle, tiltBeam, tiltLabel } from "../lib/siteSweeps";
import type { Quantity, SiteSweepView } from "../lib/siteSweeps";

$: mode = $siteMode;
$: view = $siteSweepView;
$: name = mode ? (radarSite(mode.site)?.name ?? mode.site.toUpperCase()) : "";
$: title = $_("site.title", { values: { name } });
$: options = [
  { value: "reflectivity" as Quantity, label: $_("site.quantity.reflectivity") },
  ...(view?.hasVelocity ? [
    { value: "velocity" as Quantity, label: $_("site.quantity.velocity") },
    { value: "srv" as Quantity, label: $_("site.quantity.srv") },
  ] : []),
];

$: document.documentElement.classList.toggle("site-open", Boolean(mode && view));
onDestroy(() => document.documentElement.classList.remove("site-open"));

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

/** The scan time, unless there is no sweep to have one. */
$: scanned = view && view.status !== "none" && view.status !== "failed" && (view.startedAt || view.scannedAt)
  ? $_("site.scanned", { values: { time: clock(view.startedAt ?? view.scannedAt) } })
  : null;

interface Badge {
  text: string;
  /** The whole sentence, where the badge says it short. */
  title: string;
  warn: boolean;
}

function badgesOf(view: SiteSweepView, quantity: Quantity): Badge[] {
  const badges: Badge[] = [];
  const add = (text: string, title = text, warn = false) => badges.push({ text, title, warn });
  if (view.status === "none") add($_("site.none"));
  else if (view.status === "failed") add($_("site.failed"), undefined, true);
  // Storm-relative with no storm to be relative to: the way to one says more
  // than that the sweep was dealiased, and takes that badge's place.
  const wantsStorm = quantity === "srv" && !view.hasMotion;
  if (quantity !== "reflectivity" && view.dealiased === true && !wantsStorm) add($_("site.dealiased"), view.dealiaser ?? undefined);
  else if (quantity !== "reflectivity" && view.dealiased === false) add($_("site.not_dealiased_badge"), $_("site.not_dealiased"), true);
  if (wantsStorm) add($_("site.srv_hint_badge"), $_("site.srv_hint"));
  return badges;
}

$: badges = view && mode ? badgesOf(view, mode.quantity) : [];
</script>

<style>
  /* Two rows under the head, each --mc-site-row-h tall:

         Borkum  Scanned 20:22:31  [Dealiased]                (x)
         [Reflectivity|Velocity|Storm-relative]  [0.5° v]

     and on a wide screen the three side by side, one row over the strip. */
  .tray {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: var(--mc-site-row-h) var(--mc-site-row-h);
    grid-template-areas:
      "about close"
      "controls controls";
    row-gap: 4px;
    column-gap: 8px;
    align-items: center;
  }
  @media (min-width: 1024px) {
    .tray {
      grid-template-columns: minmax(0, 1fr) auto auto;
      grid-template-rows: var(--mc-site-row-h);
      grid-template-areas: "about controls close";
      column-gap: 12px;
    }
  }

  .about {
    grid-area: about;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    /* In line with the head's title; the controls under it are capsules and
       go to the strip's own edge. */
    padding-left: 8px;
    overflow: hidden;
    white-space: nowrap;
  }
  .name {
    flex: 0 1 auto;
    min-width: 4em;
    overflow: hidden;
    text-overflow: ellipsis;
    font: 700 13px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
  }
  .time {
    flex: 0 0 auto;
    font: 500 11px/1.3 var(--mc-font);
    font-variant-numeric: tabular-nums;
    color: var(--mc-text-2);
  }
  /* The badges give way first, then the name; the scan time stays whole. */
  .badge {
    flex: 0 4 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 3px 7px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text-2);
    font: 600 10.5px/1.2 var(--mc-font);
  }
  .badge.warn {
    background: var(--mc-orange-tint);
    color: var(--mc-orange-ink);
  }

  .controls {
    grid-area: controls;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* The tilt: a capsule in the segmented control's groove, the system's own
     list when tapped. What it shows is drawn under a transparent select, so
     a phone can show less of the chosen tilt than the list says of each. */
  .tilt {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--mc-site-row-h);
    box-sizing: border-box;
    padding: 0 9px 0 10px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.06);
    color: var(--mc-text);
    /* As the segments beside it (Segmented's compact). */
    font: 600 11.5px/1.2 var(--mc-font);
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .tilt:hover { background: var(--mc-tint-hover); }
  .tilt:has(select:focus-visible) {
    outline: 2px solid var(--mc-accent);
    outline-offset: 1px;
  }
  select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    font: inherit;
    cursor: pointer;
  }
  .tilt :global(svg) {
    width: 9px;
    height: 9px;
    color: var(--mc-text-2);
  }
  @media only screen and (max-width: 620px) {
    .beam { display: none; }
  }

  /* The way out: a close disc, like the one that lets a tapped point go. */
  .close {
    grid-area: close;
    width: var(--mc-site-row-h);
    height: var(--mc-site-row-h);
    display: grid;
    place-items: center;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 50%;
    background: var(--mc-tint);
    color: var(--mc-text-3);
    font-size: 13px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .close:hover {
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .close:active {
    transform: scale(var(--mc-press));
    background: var(--mc-tint-active);
  }
  .close:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
</style>

{#if mode && view}
  <div class="tray" bind:this={tray} role="group" aria-label={title}>
    <div class="about">
      <span class="name" title={title}>{name}</span>
      {#if scanned}
        <span class="time">{scanned}</span>
      {/if}
      {#each badges as badge (badge.text)}
        <span class="badge" class:warn={badge.warn} title={badge.title}>{badge.text}</span>
      {/each}
    </div>
    <div class="controls">
      <Segmented compact options={options} value={mode.quantity} label={$_("site.quantity.group")}
        on:change={(event) => setQuantity(event.detail)} />
      {#if view.tilts.length}
        <span class="tilt">
          {#if chosenTilt}
            <span class="chosen" aria-hidden="true">
              {tiltAngle(chosenTilt.elevation)}<span class="beam">{tiltBeam(chosenTilt.beamKmAt100)}</span>
            </span>
          {/if}
          <Icon icon={faChevronDown} />
          <select aria-label={$_("site.tilt")} value={chosenTilt?.elevation} on:change={setTilt}>
            {#each view.tilts as tilt (tilt.elevation)}
              <option value={tilt.elevation}>{tiltLabel(tilt.elevation, tilt.beamKmAt100)}</option>
            {/each}
          </select>
        </span>
      {/if}
    </div>
    <button type="button" class="close" on:click={close}
      title={$_("site.close")} aria-label={$_("site.close")}>
      <Icon icon={faXmark} />
    </button>
  </div>
{/if}
