<script lang="ts">
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import Icon from "./Icon.svelte";
import { _ } from "svelte-i18n";
import { onDestroy } from "svelte";
import { format } from "date-fns";
import {
  bottomToolbarMode, capTimeIndicator, connectionStatus, lastFocus, live, networkStatus,
  radarStale, replay,
} from "../stores";
import { shouldShowNetworkBanner } from "../lib/networkBanner";
// The diagnostics panel is loaded when it is opened; it is a reader of everything and needed by nothing.
const loadConnectionInfo = () => import("./ConnectionInfo.svelte");
import Lazy from "./Lazy.svelte";
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
 * worse than one saying the more important of them. The dot carries the
 * state: blinking red for live, orange for a slow connection, solid red
 * offline, a pulsing accent while catching up.
 *
 * The frame clock sits here too, and outranks "Latest": with the player open,
 * which frame you are looking at is the thing worth a pill, and "Latest" stops
 * being true the moment the scrubber moves. A capsule of its own down in the
 * tray would cost that row a column to say something the top line can say
 * for free.
 */
$: state = (() => {
  // Offline, catching up and degraded are one state machine's, and only one of
  // them holds at a time; see lib/connectionState.ts. Each outranks a
  // connection that merely measures as slow: those are facts, that is an
  // estimate, and only they mean the data on screen may be wrong.
  const connection = $connectionStatus.state;
  if (connection === "offline") return "offline";
  if (connection === "catching-up") return "catching_up";
  if (connection === "degraded") return "degraded";
  // Knowing the frames are out of date beats showing their clock or calling
  // them the latest, and beats a connection that only measures as slow: this
  // one is not an estimate either, and it is about the picture on the map.
  // Normally it lasts as long as one refetch: coming back to a phone should
  // say "catching up" instead of lying for a second.
  if ($radarStale) return "stale";
  if (shouldShowNetworkBanner($networkStatus)) return "slow";
  if ($bottomToolbarMode === "player" && frameTime) return "time";
  // A replay is as current as live data (every timestamp is rewritten to
  // now) but it is not the weather, so it takes the live pill's place and
  // not a warning's: the connectivity states above still outrank it.
  if ($live && $replay) return "demo";
  return $live ? "live" : "none";
})();

$: label = {
  offline: $_("offline"),
  catching_up: $_("catching_up"),
  degraded: $_("degraded"),
  stale: $_("outdated"),
  slow: $_("slow_connection"),
  live: $_("latest"),
  demo: $_("demo"),
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
 * the tab is refocused: coming back is the moment the freshness claim is
 * worth reading again. The opacity goes through a class and a CSS
 * transition.
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

  /* The line's full 44px as the hit area, around a 28px pill: the pill is a
     status line rather than a disc, and a 44px capsule saying "Latest" is
     heavier than its news. It is centred on the line the discs stand on, not
     hung from its top edge, and a thumb gets the line's full height.
     The button is the target; the pill inside it is the control everyone
     sees, in the same glass as the discs (.glass/.glass-pill), with their
     hover, press and focus. */
  .live {
    pointer-events: auto;
    display: grid;
    place-items: center;
    height: var(--mc-control-lg);
    margin: 0;
    padding: 0 4px;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: opacity 500ms linear;
  }
  .live.dim {
    opacity: 0.5;
  }
  .live:focus-visible {
    outline: none;
  }

  /* Neutral glass capsule with a coloured dot: a red-50 tag fill stays pink
     in dark mode. */
  .pill {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-pill-h);
    padding: 0 12px 0 10px;
    font: 600 12px/1 var(--mc-font);
    letter-spacing: 0.01em;
    transition:
      background-color var(--mc-motion-fast),
      color var(--mc-motion-fast),
      transform var(--mc-motion-fast) var(--mc-ease);
  }
  .live:hover .pill {
    background: var(--mc-glass-fill-strong);
    color: var(--mc-accent);
  }
  .live:active .pill {
    transform: scale(var(--mc-press));
  }
  .live:focus-visible .pill {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
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

  /* toggled every second by use:blink; name and !important must survive */
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
  .circle-container.demo {
    color: var(--mc-accent);
  }
  /* Something is arriving, as with live, but not yet the news: the accent,
     breathing rather than blinking. */
  .circle-container.catching_up {
    color: var(--mc-accent);
    animation: catching-up 1.2s ease-in-out infinite alternate;
  }
  @keyframes catching-up {
    to { opacity: 0.3; }
  }

  .label {
    font-size: 12px;
    letter-spacing: 0;
  }

  /* No dot on this side, so the tighter leading inset it paid for goes back. */
  .clock .pill {
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
    .circle-container.catching_up {
      animation: none;
    }
  }
</style>

{#if state !== "none"}
  <div class="live-wrapper" role="status" aria-live="polite">
    <button
      type="button"
      class="live"
      class:clock={state === "time"}
      class:dim
      title={$_("connection_details")}
      on:click={() => { showInfo = true; }}>
      <span class="pill glass glass-pill">
        <!-- Demo holds a steady dot in the accent rather than the live pulse:
             the pulse says "arriving now", and a recording is not. -->
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
      </span>
    </button>
  </div>
{/if}

{#if showInfo}
  <Lazy load={loadConnectionInfo} floating let:module>
    <svelte:component this={module.default} {cap} on:close={() => { showInfo = false; }} />
  </Lazy>
{/if}
