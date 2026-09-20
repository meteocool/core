<script lang="ts">
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import Icon from "./Icon.svelte";
import { _ } from "svelte-i18n";
import { onDestroy } from "svelte";
import { format } from "date-fns";
import {
  bottomToolbarMode, capTimeIndicator, degradedStatus, lastFocus, live, networkStatus,
  radarStale,
} from "../stores";
import { shouldShowNetworkBanner } from "../lib/networkBanner";
import ConnectionInfo from "./ConnectionInfo.svelte";
import type RadarCapability from "../caps/RadarCapability";

export let cap: RadarCapability;

/** The pill is the affordance: tapping it opens what it is summarising. */
let showInfo = false;

/** The clock of the frame on screen, while the player has one. */
$: frameTime = $capTimeIndicator
  ? format(new Date($capTimeIndicator * 1000), "HH:mm")
  : "";

/**
 * The one pill on the top-centre line, in whichever state matters most.
 *
 * Connectivity outranks freshness: "Latest" over a dead connection is a lie,
 * and two stacked bubbles saying different things about the same data read
 * worse than one saying the more important of them. The dot carries the state
 * -- blinking red for live, orange for a slow connection, solid red offline.
 *
 * The frame clock sits here too, and outranks "Latest": with the player open,
 * which frame you are looking at is the thing worth a pill, and "Latest" stops
 * being true the moment the scrubber moves. It used to have a capsule of its
 * own down in the tray, which cost that row a column to say something the top
 * line could say for free.
 */
$: state = (() => {
  if (!$networkStatus.online) return "offline";
  // A backend that is misbehaving outranks a connection that merely measures as
  // slow: one is a fact, the other is an estimate, and only one of them means
  // the data on screen may be wrong. What counts as misbehaving, and how it
  // stops counting again, is lib/degraded.ts -- the pill only reads the verdict,
  // which is re-taken on a timer so it clears itself without a tick of its own.
  if ($degradedStatus.degraded) return "degraded";
  // Knowing the frames are out of date beats showing their clock or calling
  // them the latest, and beats a connection that only measures as slow: this
  // one is not an estimate either, and it is about the picture on the map.
  // Normally it lasts as long as one refetch, which is the point -- coming back
  // to a phone should say "catching up" rather than quietly lie for a second.
  if ($radarStale) return "stale";
  if (shouldShowNetworkBanner($networkStatus)) return "slow";
  if ($bottomToolbarMode === "player" && frameTime) return "time";
  return $live ? "live" : "none";
})();

$: label = {
  offline: $_("offline"),
  degraded: $_("degraded"),
  stale: $_("outdated"),
  slow: $_("slow_connection"),
  live: $_("latest"),
  time: frameTime,
  none: "",
}[state];

/* A clock is not a status: no dot beside it. The connectivity states outrank
   this one anyway, so nothing is lost by dropping it here. */
$: showDot = state !== "time";

/**
 * Only the live pill fades back.
 *
 * It says "you are looking at the newest frame", which stops being worth full
 * attention after a moment. A connection warning is not in that category, so it
 * holds full strength until the connection is no longer the story.
 */
$: fades = state === "live";

let lightRed = true;

/* The action returns its teardown: without it the chain reschedules itself
   forever, toggling a class on a detached node for the rest of the session. */
function blink(elem) {
  let timer = 0;
  const tick = () => {
    timer = window.setTimeout(() => {
      if (lightRed) {
        elem.classList.add("circle-container-light-red");
        lightRed = false;
      } else {
        elem.classList.remove("circle-container-light-red");
        lightRed = true;
      }
      tick();
    }, 1000);
  };
  tick();
  return { destroy() { window.clearTimeout(timer); } };
}

/**
 * The live pill dims itself a few seconds after it appears, and again whenever
 * the tab is refocused -- coming back is the moment the freshness claim is
 * worth reading again. Opacity through a class rather than an inline style
 * stepped 20 times by a timer, which is what this used to be.
 */
let dim = false;
let dimTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDim(shouldFade: boolean) {
  if (dimTimer) clearTimeout(dimTimer);
  dimTimer = null;
  dim = false;
  if (!shouldFade) return;
  dimTimer = setTimeout(() => { dim = true; }, 3000);
}

$: scheduleDim(fades);

const unsubscribeFocus = lastFocus.subscribe(() => scheduleDim(fades));
onDestroy(() => {
  unsubscribeFocus();
  if (dimTimer) clearTimeout(dimTimer);
});
</script>

<style>
  .live-wrapper {
    position: absolute;
    z-index: var(--mc-z-pill);
    /* A drag that starts beside the pill should pan the map; only the pill
       itself takes the pointer, and it takes it to open the details. */
    pointer-events: none;
    top: var(--mc-top-stack);
    left: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    touch-action: none;
  }

  .live {
    padding-top: 0;
    pointer-events: auto;
    cursor: pointer;
    transition: opacity 500ms linear, transform var(--mc-motion-fast) var(--mc-ease);
  }
  .live:active {
    transform: scale(var(--mc-press));
  }
  .live.dim {
    opacity: 0.5;
  }

  /* Neutral glass capsule with a coloured dot: the red-50 tag fill stayed pink
     in dark mode. sl-tag parts: base content remove-button */
  :global(.live::part(base)) {
    height: var(--mc-pill-h);
    padding: 0 12px 0 10px;
    gap: 6px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    letter-spacing: 0.01em;
  }

  .circle-container {
    padding: 0;
    margin: 0;
    float: none;
    display: inline-flex;
    font-size: 8px;
    color: var(--mc-red);
    transition: color 300ms ease;   /* colour only: no layout, no backdrop re-read */
  }

  /* toggled every second by use:blink -- name and !important must survive */
  .circle-container-light-red {
    color: var(--mc-red-dim) !important;
  }

  /* A warning holds its colour: only the live dot blinks. */
  .circle-container.slow,
  .circle-container.stale,
  .circle-container.degraded {
    color: var(--mc-orange);
  }
  .circle-container.offline {
    color: var(--mc-red);
  }

  .label {
    font-size: 12px;
    letter-spacing: 0;
  }

  /* No dot on this side, so the tighter leading inset it paid for goes back. */
  :global(.live.clock::part(base)) {
    padding: 0 12px;
  }

  /* Lining figures, so the pill does not twitch between 09:55 and 10:00. */
  .label.clock {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  @media only screen and (max-width: 620px) {
    .circle-container {
      font-size: 7px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .circle-container {
      transition: none;
    }
    .circle-container-light-red {
      color: var(--mc-red) !important;
    }
  }
</style>

{#if state !== "none"}
  <div class="live-wrapper" role="status" aria-live="polite">
    <sl-tag
      variant="danger"
      class="live"
      class:clock={state === "time"}
      class:dim
      size="small"
      pill
      role="button"
      tabindex="0"
      title={$_("connection_details")}
      on:click={() => { showInfo = true; }}
      on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") showInfo = true; }}>
      {#if state === "live"}
        <div class="circle-container circle-container-light-red" use:blink>
          <Icon icon={faCircle} />
        </div>
      {:else if showDot}
        <div class="circle-container {state}">
          <Icon icon={faCircle} />
        </div>
      {/if}
      <span class="label" class:clock={state === "time"}>{label}</span>
    </sl-tag>
  </div>
{/if}

{#if showInfo}
  <ConnectionInfo {cap} on:close={() => { showInfo = false; }} />
{/if}
