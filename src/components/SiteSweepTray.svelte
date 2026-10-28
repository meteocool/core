<script lang="ts">
/**
 * Site mode's controls while a radar is open: what to draw of it
 * (reflectivity, radial velocity, or velocity relative to the selected
 * storm), at which tilt, and the way out. A glass pill of its own, floating
 * a gap over the player, as the stations' picker does (StationPicker); the
 * radar's name and how long ago its sweep was scanned are on the player's
 * product pill (RadarProductPicker).
 *
 * Each tilt is offered with how high its beam is 100 km out, which is what a
 * reader choosing one wants to know. A velocity sweep says whether the
 * server could dealias it, because a fold looks exactly like a couplet: a
 * short badge in the pill, its whole sentence in the title.
 *
 * Storm-relative velocity grows the pill by a row over the controls: whose
 * motion it takes out, which opens the controls to set one by hand
 * (StormMotion). The root's `site-open` and `site-srv` say how much of the
 * stack over the player this is (--mc-site-float-h in glass.css), so the
 * stations' picker, the strips and "Back to now" stand on it. Where the screen is too narrow
 * the pill scrolls sideways, its edges fading out. On a phone the chosen
 * tilt shows its elevation alone; the list it opens has the beam heights.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { fly } from "svelte/transition";
import { fadeEdges } from "../lib/fadeEdges";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import Icon from "./Icon.svelte";
import Segmented from "./Segmented.svelte";
import StormMotion from "./StormMotion.svelte";
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
$: srvShown = Boolean(mode && view && mode.quantity === "srv");
$: document.documentElement.classList.toggle("site-srv", srvShown);
onDestroy(() => document.documentElement.classList.remove("site-open", "site-srv"));

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
 * a dialog, the storm motion's controls, the point menu, the open storm's
 * panel (whose motion a storm-relative sweep is read against, so it goes
 * first), or a field other than the tray's own tilt.
 * Capture phase, so the storm is still open when this looks.
 */
let tray: HTMLElement | undefined;
let motionOpen = false;
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !$siteMode) return;
  if (motionOpen || document.querySelector("[role='dialog'][aria-modal='true']")) return;
  if ($pointMenuAt || ($selectedStorm && $stormDetails)) return;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target && !tray?.contains(target) && /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  event.preventDefault();
  close();
}
window.addEventListener("keydown", onKeydown, true);
onDestroy(() => window.removeEventListener("keydown", onKeydown, true));

$: chosenTilt = view && mode
  ? view.tilts.reduce((best, tilt) => (Math.abs(tilt.elevation - mode.elevation) < Math.abs(best.elevation - mode.elevation) ? tilt : best), view.tilts[0])
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
  // Storm-relative with nothing to take out, no storm selected and no motion
  // set by hand: the way to one says more than that the sweep was dealiased,
  // and takes that badge's place.
  const nothingTaken = quantity === "srv" && view.srv.motion.speedMs === 0;
  if (quantity !== "reflectivity" && view.dealiased === true && !nothingTaken) add($_("site.dealiased"), view.dealiaser ?? undefined);
  else if (quantity !== "reflectivity" && view.dealiased === false) add($_("site.not_dealiased_badge"), $_("site.not_dealiased"), true);
  if (nothingTaken) add($_("site.srv_hint_badge"), $_("site.srv_hint"));
  return badges;
}

$: badges = view && mode ? badgesOf(view, mode.quantity) : [];
</script>

<style>
  /* Over the player, centred: a row the width of the screen that lets
     touches through. */
  .dock {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(var(--mc-tray-bottom) + var(--mc-player-h) + var(--mc-tray-gap));
    z-index: var(--mc-z-pill);
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  /* A pill, or with storm-relative velocity a rounded box of two rows, the
     motion over the controls: the same corners, so it reads as the pill grown. */
  .float {
    pointer-events: auto;
    box-sizing: border-box;
    max-width: 100%;
    min-height: var(--mc-float-pill-h);
    padding: 4px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    border-radius: calc(var(--mc-float-pill-h) / 2);
  }
  .scroller {
    min-width: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    border-radius: var(--mc-radius-pill);
  }
  .scroller::-webkit-scrollbar { display: none; }
  .row {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  /* Touch pans the row sideways from the segments too; a tap still chooses. */
  .row :global(.segmented.compact) {
    touch-action: pan-x;
  }
  .motion {
    display: flex;
    min-width: 0;
    padding: 0 2px;
  }
  .motion > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Whether the sweep was dealiased, short, after the tilt. */
  .badge {
    flex: 0 0 auto;
    white-space: nowrap;
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
    flex: 0 0 auto;
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
  <div class="dock" bind:this={tray} role="group" aria-label={title}>
    <div class="float controls glass" transition:fly|global={{ y: 12, duration: 200 }}>
      {#if srvShown}
        <div class="motion">
          <StormMotion bind:open={motionOpen} srv={view.srv} stormMoves={view.stormMoves} />
        </div>
      {/if}
      <div class="scroller mc-fade-x" use:fadeEdges>
        <span class="row">
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
          {#each badges as badge (badge.text)}
            <span class="badge" class:warn={badge.warn} title={badge.title}>{badge.text}</span>
          {/each}
          <button type="button" class="close" on:click={close}
            title={$_("site.close")} aria-label={$_("site.close")}>
            <Icon icon={faXmark} />
          </button>
        </span>
      </div>
    </div>
  </div>
{/if}
