<script lang="ts">
/**
 * Which scan the 3D map's storms are from: "Latest", kept up as runs land,
 * or one of the last two hours' -- picked here, at the end of the peel's
 * tray along the bottom edge (PeelSlider).
 *
 * No playback. There is no list of an earlier scan's storms, so they are
 * found in the bucket, a few dozen requests a scan (lib/cloudHistory.ts):
 * a short wait for one, far too long a wait for an hour of them. So one is
 * picked, the pill shows how the looking goes, and the map stays on it --
 * the pill filled, with its time, so it is plainly not live -- until
 * "Latest" is picked again. A scan with nothing here leaves the map as it
 * was, and a note over the pill says so.
 *
 * The menu is moved to <body>, as the radar product picker's is: the tray's
 * backdrop filter would otherwise position it against the tray.
 */
import { onDestroy, tick } from "svelte";
import { _ } from "svelte-i18n";
import { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
import Icon from "./Icon.svelte";
import { cloudsTime } from "../stores";
import { currentLocale } from "../locale/t";
import { earlierScans } from "../lib/cloudHistory";

/** Put this scan's storms on the map, or the newest for null; see Cells3DCapability.showScan. */
export let pick: (scan: number | null) => void;

/** Space kept between the menu and the window's edges, and above the control. */
const MARGIN = 8;

/** How long the note that a scan had nothing stays up. */
const NOTE_MS = 6000;

let open = false;
let trigger: HTMLButtonElement;
let menu: HTMLDivElement | undefined;
let left = 0;
let bottom = 0;

$: ({ shown, loading, progress, newest, missed } = $cloudsTime);
/** Newest first; one picked so long ago the newest has moved two hours on stays in the list. */
$: offered = newest === null ? [] : withShown(earlierScans(newest), shown);
/** The time on the pill: the one being looked for, else the one on the map. */
$: face = loading ?? shown;

function withShown(scans: number[], scan: number | null): number[] {
  return scan === null || scans.includes(scan) ? scans : [...scans, scan];
}

/** 24-hour, as every other time in the panels; see `CloudDetails`. */
function clock(scan: number): string {
  return new Date(scan * 1000).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "-35m", "-1h", "-1h5m" behind the newest, as the flat map's timeline marks its steps. */
function behind(scan: number, from: number): string {
  const minutes = Math.round((from - scan) / 60);
  if (minutes % 60 === 0) return $_("chrome.playback.offset_hours", { values: { sign: "-", hours: minutes / 60 } });
  if (minutes < 60) return $_("chrome.playback.offset_minutes", { values: { sign: "-", minutes } });
  return $_("chrome.playback.offset_hours_minutes", {
    values: { sign: "-", hours: Math.floor(minutes / 60), minutes: minutes % 60 },
  });
}

async function show() {
  dismissNote();
  const rect = trigger.getBoundingClientRect();
  bottom = window.innerHeight - rect.top + MARGIN;
  left = rect.left;
  open = true;
  await tick();
  if (!menu) return;
  // Over the control, kept on screen.
  const width = menu.offsetWidth;
  const centred = rect.left + rect.width / 2 - width / 2;
  left = Math.max(MARGIN, Math.min(centred, window.innerWidth - width - MARGIN));
  // The one on the map, scrolled to: two hours of them run past the menu's height.
  menu.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
}

function close(refocus = false) {
  open = false;
  if (refocus) trigger?.focus();
}

function choose(scan: number | null) {
  close(true);
  pick(scan);
}

/** Anything outside the menu and its control closes it, as a menu does. */
function outside(event: PointerEvent) {
  if (!open) return;
  const target = event.target as Node;
  if (menu?.contains(target) || trigger?.contains(target)) return;
  close();
}

function keydown(event: KeyboardEvent) {
  if (!open) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    close(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...(menu?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? [])];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
  next?.focus();
  event.preventDefault();
}

function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

/* The note that a scan had nothing, until it times out or the menu opens.
   Cleared in the store, so the tray coming back after a storm is closed
   does not say it again. */
let noteTimer: ReturnType<typeof setTimeout> | null = null;
let noted: typeof missed = null;
$: if (missed !== noted) {
  noted = missed;
  if (noteTimer !== null) clearTimeout(noteTimer);
  noteTimer = missed ? setTimeout(dismissNote, NOTE_MS) : null;
}
function dismissNote() {
  if (noteTimer !== null) clearTimeout(noteTimer);
  noteTimer = null;
  if ($cloudsTime.missed) cloudsTime.update((time) => ({ ...time, missed: null }));
}
onDestroy(() => {
  if (noteTimer !== null) clearTimeout(noteTimer);
});
</script>

<svelte:window on:pointerdown={outside} on:keydown={keydown} on:resize={() => close()} />

<div class="picker">
  {#if missed}
    <p class="note" role="status">
      {$_(missed.failed ? "time_3d.failed" : "time_3d.nothing", { values: { time: clock(missed.scan) } })}
    </p>
  {/if}
  <button
    bind:this={trigger}
    type="button"
    class="pill"
    class:past={shown !== null}
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={newest === null && shown === null}
    title={loading !== null
      ? $_("time_3d.loading", { values: { time: clock(loading) } })
      : $_("time_3d.choose")}
    aria-label={shown !== null
      ? $_("time_3d.past_aria", { values: { time: clock(shown) } })
      : $_("time_3d.latest_aria")}
    on:click={() => (open ? close() : show())}>
    {#if loading !== null}
      <span class="ring" style:--progress={progress} aria-hidden="true"></span>
    {:else}
      <Icon icon={faHistory} />
    {/if}
    <span class="label">{face !== null ? clock(face) : $_("time_3d.latest")}</span>
  </button>
</div>

{#if open}
  <div
    bind:this={menu}
    use:portal
    class="menu glass glass-strong"
    role="menu"
    aria-label={$_("time_3d.title")}
    style:left={`${left}px`}
    style:bottom={`${bottom}px`}>
    <div class="heading">{$_("time_3d.title")}</div>
    <div class="options">
      <button type="button" role="menuitemradio" class="option" aria-checked={shown === null} on:click={() => choose(null)}>
        <span class="check" aria-hidden="true">{shown === null ? "✓" : ""}</span>
        <span class="name">{$_("time_3d.latest")}</span>
        <span class="when">{newest !== null ? clock(newest) : ""}</span>
      </button>
      {#each offered as scan (scan)}
        <button type="button" role="menuitemradio" class="option" aria-checked={shown === scan} on:click={() => choose(scan)}>
          <span class="check" aria-hidden="true">
            {#if loading === scan}
              <span class="ring" style:--progress={progress}></span>
            {:else}
              {shown === scan ? "✓" : ""}
            {/if}
          </span>
          <span class="name">{clock(scan)}</span>
          <span class="when">{newest !== null ? behind(scan, newest) : ""}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .picker {
    position: relative;
    flex: none;
    display: flex;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .pill:disabled { cursor: default; opacity: 0.5; }
  .pill :global(svg) { width: 12px; height: 12px; }
  /* Not live: filled, as the flat map's chip for a step back is when on. */
  .pill.past { background: var(--mc-accent); color: #fff; }
  .pill.past:hover { background: var(--mc-accent-strong); }

  /* How far the looking has got, as a ring that fills. */
  .ring {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background:
      conic-gradient(currentColor calc(var(--progress, 0) * 1turn), color-mix(in srgb, currentColor 22%, transparent) 0);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  }

  /* Over the pill, at the tray's end: clear of the guide's pill at the
     other. Solid, since nothing under the tray's glass shows through. */
  .note {
    position: absolute;
    /* The tray's edge: its padding at this end, and its border. */
    right: calc((var(--mc-pill-h) - var(--mc-control)) / 2 - 1px);
    bottom: calc(100% + (var(--mc-control) - var(--mc-pill-h)) / 2 + var(--mc-gutter));
    width: max-content;
    /* Short of the guide's pill or card at the other end (Guide3D). */
    max-width: min(280px, max(160px, calc(100vw - var(--mc-guide-3d-inset, 0px) - 2 * var(--mc-gutter))));
    box-sizing: border-box;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-glass-fill-solid);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
    font: 500 12px/1.35 var(--mc-font);
    text-align: left;
    white-space: normal;
  }

  .menu {
    position: fixed;
    z-index: var(--mc-z-dialog);
    display: flex;
    flex-direction: column;
    width: min(220px, calc(100vw - 16px));
    max-height: min(60vh, 420px);
    box-sizing: border-box;
    padding: 6px;
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-ring-lg);
    font-family: var(--mc-font);
  }
  .heading {
    flex: none;
    padding: 6px 10px 4px;
    color: var(--mc-text-2);
    font: 600 12px/1.3 var(--mc-font);
  }
  .options {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .option {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: none;
    color: var(--mc-text);
    font-family: var(--mc-font);
    text-align: left;
    cursor: pointer;
  }
  .option:hover { background: var(--mc-tint-hover); }
  .option:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
  .check {
    display: inline-flex;
    color: var(--mc-accent);
    font: 700 13px/1 var(--mc-font);
  }
  .option .name {
    font: 600 14px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  .option .when {
    color: var(--mc-text-2);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
