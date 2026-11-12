<script lang="ts">
/**
 * What the status pill says, in sentences: opened by the pill.
 *
 * In order: our notices for this view; the connection, when it is not fine
 * (offline, slow, degraded with its reasons, the socket gone); one row per
 * thing late on screen, as the backend judges it (lib/status.ts), worst
 * first; and when nothing is, one line saying everything is arriving. The
 * diagnostics panel (ConnectionInfo) is behind the last row, unchanged.
 *
 * A card hanging from the pill rather than a sheet from the bottom edge: it
 * stops above the tray, so the timeline it explains stays in view and in
 * reach on a phone. Escape or a tap elsewhere closes it.
 */
import { createEventDispatcher, onMount } from "svelte";
import { _, locale } from "svelte-i18n";
import { format } from "date-fns";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons/faChevronRight";
import Icon from "./Icon.svelte";
import CloseDisc from "./CloseDisc.svelte";
import { connectionStatus, degradedStatus, networkStatus, radarStale, socketDown } from "../stores";
import { shouldShowNetworkBanner } from "../lib/networkBanner";
import { statusVerdict } from "../lib/statusFeed";
import type { StatusComponent } from "../lib/status";

/** The pill that opened it: a tap on it is the pill's to toggle, not an outside tap. */
export let opener: HTMLElement | null = null;

const dispatch = createEventDispatcher<{ close: void; details: void }>();
const close = () => dispatch("close");
const titleId = `status-${Math.random().toString(36).slice(2)}`;

let panel: HTMLDivElement;

/** The clock, for the ages; ticked while open so "3 min old" does not stand still. */
let now = Date.now();

/** A domain's name in the reader's language: the browser's name for the country, or Europe for the merged composite. */
function place(domain: string, language: string | null | undefined): string {
  if (domain === "eu") return $_("status.europe");
  try {
    return new Intl.DisplayNames([language ?? "en"], { type: "region" }).of(domain.toUpperCase()) ?? domain.toUpperCase();
  } catch {
    return domain.toUpperCase();
  }
}

const clock = (unix: number) => format(new Date(unix * 1000), "HH:mm");

/** What a component is and where: "Radar, Poland", or "Lightning". */
function what(component: StatusComponent, language: string | null | undefined): string {
  const kind = $_(`status.kind.${component.kind}`);
  return component.domain ? $_("status.where", { values: { what: kind, place: place(component.domain, language) } }) : kind;
}

/** Its state in words, from its newest, in the reader's clock. */
function state(component: StatusComponent): string {
  if (component.newest == null) return $_("status.state_none");
  const time = clock(component.newest);
  return $_(component.state === "down" ? "status.state_down" : "status.state_delayed", { values: { time } });
}

/** The degraded criteria in sentences, by id; one without a sentence of its own says the panel's words. */
const DEGRADED_SENTENCES: Record<string, string> = {
  "api-errors": "status.degraded.api_errors",
  "slow-responses": "status.degraded.slow_responses",
  "stale-publish": "status.degraded.stale_publish",
  "tile-errors": "status.degraded.tile_errors",
};

$: connection = $connectionStatus.state;
$: connectionLines = [
  ...(connection === "offline" ? [$_("status.connection.offline")] : []),
  ...(connection === "catching-up" ? [$_("status.connection.catching_up")] : []),
  ...(connection === "degraded"
    ? $degradedStatus.reasons.map((reason) => (DEGRADED_SENTENCES[reason.id] ? $_(DEGRADED_SENTENCES[reason.id]) : reason.detail))
    : []),
  ...(connection === "online" && shouldShowNetworkBanner($networkStatus) ? [$_("status.connection.slow")] : []),
  // Offline says it already: the socket is one of the things that went.
  ...($socketDown && connection !== "offline" ? [$_("status.connection.socket")] : []),
];

$: verdict = $statusVerdict;
$: notices = verdict?.notices ?? [];
$: late = verdict?.affected ?? [];
/** How old the newest radar on screen is, in minutes, by the server's clock carried forward from the answer. */
$: radarAge = verdict && verdict.newestRadar !== null
  ? Math.max(0, Math.round((verdict.serverTime - verdict.newestRadar + (now - verdict.receivedAt) / 1000) / 60))
  : null;

/*
 * Capture phase, as GlassPanel does, so this runs before the map's own
 * Escape handlers and marks the key as taken.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  close();
}

/* A tap anywhere but the card or its pill closes it, and still does what it
   does there: there is no scrim, so the map and the tray stay live. */
function onPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target || panel?.contains(target) || opener?.contains(target)) return;
  close();
}

onMount(() => {
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  const ticker = window.setInterval(() => { now = Date.now(); }, 15_000);
  panel?.focus({ preventScroll: true });
  return () => {
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.clearInterval(ticker);
  };
});
</script>

<style>
  /* Hung from the top line, under the pill, and stopped a gap above the
     tray and whatever floats on it (an open radar's pills, the stations'),
     so the timeline is never under it. */
  .status-sheet {
    position: absolute;
    z-index: var(--mc-z-dialog);
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + 4px);
    left: 50%;
    transform: translateX(-50%);
    width: min(24rem, calc(100% - 2 * var(--mc-gutter)));
    max-height: calc(
      100% - var(--mc-top-stack) - var(--mc-control-lg) - 4px
      - var(--mc-tray-bottom) - var(--mc-player-h) - var(--mc-float-stack) - 2 * var(--mc-tray-gap)
    );
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    color: var(--mc-text);
    font: var(--mc-type-body);
    outline: none;
  }

  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 4px 16px;
  }
  h2 {
    flex: 1 1 auto;
    margin: 0;
    font: 700 17px/1.2 var(--mc-font);
    letter-spacing: -0.01em;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px 10px;
  }

  section + section {
    border-top: 1px solid var(--mc-separator);
  }
  section {
    padding: 8px 0;
  }
  h3 {
    margin: 0 0 2px;
    font: 600 13px/1.3 var(--mc-font);
  }
  p {
    margin: 0;
  }
  .warning h3 {
    color: var(--mc-orange);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    margin-top: 6px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .row .what {
    font-weight: 600;
  }
  .row .state {
    color: var(--mc-text-2);
    text-align: right;
  }
  .down .state {
    color: var(--mc-orange);
  }

  .details {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin: 0;
    padding: 8px 0 0;
    border: 0;
    background: none;
    color: var(--mc-accent);
    font: 600 14px/1.3 var(--mc-font);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .details:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  .details :global(svg) {
    width: 10px;
    height: 10px;
  }
</style>

<div
  bind:this={panel}
  class="status-sheet glass glass-tray glass-reading"
  role="dialog"
  aria-labelledby={titleId}
  tabindex="-1">
  <header>
    <h2 id={titleId}>{$_("status.title")}</h2>
    <CloseDisc material="chrome" on:click={close} />
  </header>
  <div class="body">
    {#each notices as notice (notice.id)}
      <section class:warning={notice.level === "warning"}>
        <h3>{$_(notice.level === "warning" ? "notice_warning" : "notice_info")}</h3>
        <p>{notice.text}</p>
      </section>
    {/each}

    {#if connectionLines.length}
      <section class="connection">
        <h3>{$_("status.connection.title")}</h3>
        {#each connectionLines as line (line)}
          <p>{line}</p>
        {/each}
      </section>
    {/if}

    {#if late.length}
      <section>
        <ul aria-label={$_("status.late")}>
          {#each late as { component } (`${component.kind}:${component.domain ?? ""}`)}
            <li class="row" class:down={component.state === "down"}>
              <span class="what">{what(component, $locale)}</span>
              <span class="state">{state(component)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {:else if verdict}
      <section>
        <p>{radarAge !== null
          ? $_("status.all_arriving_radar", { values: { minutes: radarAge } })
          : $_("status.all_arriving")}</p>
      </section>
    {:else if $radarStale}
      <!-- No verdict from the backend: the map's own rule found the radar behind. -->
      <section>
        <p>{$_("status.radar_behind")}</p>
      </section>
    {/if}

    <section>
      <button type="button" class="details" on:click={() => dispatch("details")}>
        <span>{$_("connection_details")}</span>
        <Icon icon={faChevronRight} />
      </button>
    </section>
  </div>
</div>
