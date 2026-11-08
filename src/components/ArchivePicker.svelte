<script lang="ts">
/**
 * Choosing a past window (lib/archive.ts): a day the archive keeps, on a
 * month's calendar, then its start on the five-minute grid and its length on
 * wheels, as the system's own date picker does; "Open" puts the map in it. A
 * panel over the map on a desktop and a sheet on a phone (GlassPanel),
 * opened from the Archive pill in the player's tray or the frame's tab.
 *
 * The days are what `/v3/archive` says it covers, asked for as the picker
 * opens. While nothing is kept yet it says the archive is empty.
 */
import { createEventDispatcher, onMount } from "svelte";
import { _, locale } from "svelte-i18n";
import { addDays, format, getHours, getMinutes, set, startOfDay } from "date-fns";
import GlassPanel from "./GlassPanel.svelte";
import ArchiveCalendar from "./ArchiveCalendar.svelte";
import Wheel from "./Wheel.svelte";
import { archiveWindow } from "../stores";
import { archiveCoverage, loadCoverage } from "../lib/archiveCoverage";
import {
  DEFAULT_WINDOW_HOURS, STEP_S, WINDOW_HOURS, coverageDays, onGrid, pickWindow, startMinutes,
  type ArchiveCoverage, type WindowHours,
} from "../lib/archive";
import getDfnLocale from "../locale/locale";

const dispatch = createEventDispatcher<{ close: void }>();

const dayOf = (ms: number) => startOfDay(ms).getTime();
const nextDay = (ms: number) => addDays(ms, 1).getTime();
const minuteOf = (ms: number) => getHours(ms) * 60 + getMinutes(ms);

let day = 0;
let minute = 0;
let hours: WindowHours = DEFAULT_WINDOW_HOURS;
let ready = false;

/** Where the picker starts: the window open now, or the last few hours the archive has. */
function seed(coverage: ArchiveCoverage) {
  const open = $archiveWindow;
  const start = open ? open.start : onGrid(coverage.until - DEFAULT_WINDOW_HOURS * 3600);
  const from = Math.max(start, coverage.since) * 1000;
  day = dayOf(from);
  minute = minuteOf(from);
  if (open) {
    const length = Math.round((open.end - open.start) / 3600);
    hours = WINDOW_HOURS.find((h) => h >= length) ?? DEFAULT_WINDOW_HOURS;
  }
  ready = true;
}

onMount(() => {
  void loadCoverage().then((coverage) => { if (coverage) seed(coverage); });
});

$: coverage = $archiveCoverage.state === "kept" ? $archiveCoverage.coverage : null;
$: days = coverage ? coverageDays(coverage, dayOf, nextDay) : [];
$: [firstMinute, lastMinute] = coverage && day ? startMinutes(day, coverage, minuteOf, dayOf) : [0, 1435];
$: minutes = Array.from({ length: (lastMinute - firstMinute) / 5 + 1 }, (_, i) => firstMinute + i * 5);
/* Another day keeps the time of day, inside what that day has. */
$: if (ready) minute = Math.min(Math.max(minute, firstMinute), lastMinute);

/* The reader's language for dates, again once it changes. */
$: dfn = { locale: getDfnLocale(), language: $locale };
const two = (n: number) => String(n).padStart(2, "0");
$: lengths = WINDOW_HOURS.map((value) => ({ value, label: $_("chrome.archive.hours", { values: { hours: value } }) }));

/* The start on two wheels: the hours the day has, then that hour's minutes.
   An hour without the minute that was on the wheel takes its nearest one. */
$: hourItems = Array.from(
  { length: Math.floor(lastMinute / 60) - Math.floor(firstMinute / 60) + 1 },
  (_, i) => { const h = Math.floor(firstMinute / 60) + i; return { value: h, label: two(h) }; },
);
$: hour = Math.floor(minute / 60);
$: minuteItems = minutes.filter((m) => Math.floor(m / 60) === hour).map((m) => ({ value: m % 60, label: two(m % 60) }));
const clampMinute = (m: number) => Math.min(Math.max(m, firstMinute), lastMinute);
function setHour(h: number) { minute = clampMinute(h * 60 + (minute % 60)); }
function setMinute(m: number) { minute = clampMinute(hour * 60 + m); }

/** The window the choices make, kept inside the archive; null where none can be. */
$: chosen = coverage && day
  ? pickWindow(set(day, { hours: Math.floor(minute / 60), minutes: minute % 60 }).getTime() / 1000, hours, coverage)
  : null;
$: summary = chosen
  ? $_("chrome.archive.summary", {
    values: {
      from: format(chosen.start * 1000, "EEE d MMM, HH:mm", dfn),
      to: format(chosen.end * 1000, "HH:mm", dfn),
      steps: (chosen.end - chosen.start) / STEP_S + 1,
    },
  })
  : "";

function openWindow() {
  if (!chosen) return;
  archiveWindow.set(chosen);
  dispatch("close");
}

function backToLive() {
  archiveWindow.set(null);
  dispatch("close");
}

function retry() {
  void loadCoverage().then((answer) => { if (answer) seed(answer); });
}
</script>

<GlassPanel title={$_("chrome.archive.title")} on:close>
  <div class="archive">
    <p class="lede">{$_("chrome.archive.lede")}</p>
    {#if $archiveCoverage.state === "empty"}
      <p class="status" role="status">{$_("chrome.archive.empty")}</p>
    {:else if $archiveCoverage.state === "failed"}
      <p class="status" role="status">{$_("chrome.archive.failed")}</p>
      <button type="button" class="action" on:click={retry}>{$_("chrome.archive.retry")}</button>
    {:else if !coverage || !ready}
      <p class="status" role="status">{$_("chrome.archive.loading")}</p>
    {:else}
      <form class="fields" on:submit|preventDefault={openWindow}>
        <ArchiveCalendar {days} value={day} label={$_("chrome.archive.day")} on:change={(event) => { day = event.detail; }} />
        <div class="wheels">
          <span class="caption start" aria-hidden="true">{$_("chrome.archive.start")}</span>
          <span class="caption length" aria-hidden="true">{$_("chrome.archive.length")}</span>
          <div class="band" aria-hidden="true"></div>
          <div class="wheel hour">
            <Wheel items={hourItems} value={hour} label="{$_("chrome.archive.start")}, {$_("chrome.archive.hour")}"
              on:change={(event) => setHour(event.detail)} />
          </div>
          <span class="colon" aria-hidden="true">:</span>
          <div class="wheel minute">
            <Wheel items={minuteItems} value={minute % 60} label="{$_("chrome.archive.start")}, {$_("chrome.archive.minute")}"
              on:change={(event) => setMinute(event.detail)} />
          </div>
          <div class="wheel hours">
            <Wheel items={lengths} value={hours} label={$_("chrome.archive.length")}
              on:change={(event) => { hours = event.detail; }} />
          </div>
        </div>
        <p class="summary" aria-live="polite">{summary}</p>
        <div class="actions">
          {#if $archiveWindow}
            <button type="button" class="action" on:click={backToLive}>{$_("chrome.archive.back_to_live")}</button>
          {/if}
          <button type="submit" class="action primary" disabled={!chosen}>{$_("chrome.archive.open")}</button>
        </div>
      </form>
    {/if}
  </div>
</GlassPanel>

<style>
  .archive {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 8px;
  }
  .lede, .status, .summary {
    margin: 0;
    font: var(--mc-type-body);
    color: var(--mc-text-2);
  }
  .status { color: var(--mc-text); }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* One band across the wheels marks the row that is chosen, as the
     system's picker draws it; the captions name the columns above it. */
  .wheels {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 56px 14px 56px 28px 80px 1fr;
    grid-template-rows: auto auto;
    align-items: center;
    row-gap: 2px;
    padding-top: 4px;
    border-top: 0.5px solid var(--mc-separator);
  }
  .caption {
    grid-row: 1;
    padding-top: 6px;
    font: var(--mc-type-label);
    color: var(--mc-text-2);
    text-align: center;
  }
  .caption.start { grid-column: 2 / 5; }
  .caption.length { grid-column: 6; }
  .band {
    grid-row: 2;
    grid-column: 2 / 7;
    height: 34px;
    margin: 0 -8px;
    border-radius: 9px;
    background: var(--mc-tint);
    pointer-events: none;
  }
  .wheel { grid-row: 2; }
  .wheel.hour { grid-column: 2; }
  .colon {
    grid-row: 2;
    grid-column: 3;
    text-align: center;
    font: 500 21px/1 var(--mc-font);
    color: var(--mc-text);
    transform: translateY(-1px);
  }
  .wheel.minute { grid-column: 4; }
  .wheel.hours { grid-column: 6; }
  .summary {
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .action {
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 14px/1 var(--mc-font);
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .action:hover { background: var(--mc-tint-hover); }
  .action:active { transform: scale(var(--mc-press)); }
  .action:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .action.primary {
    background: var(--mc-accent);
    color: #fff;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
