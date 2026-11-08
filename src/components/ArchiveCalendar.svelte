<script lang="ts">
/**
 * The archive's days as a month, in the iOS manner: the month and its
 * arrows on top, the weekdays, and a grid of days where only those the
 * archive keeps can be chosen. Today's number is in the accent, the chosen
 * day sits in an accent disc.
 *
 * As many rows as the month has weeks. The arrows and the Page keys move
 * the month; the arrow keys on the grid move the day, across a month's edge
 * too.
 */
import { createEventDispatcher, tick } from "svelte";
import { _, locale } from "svelte-i18n";
import {
  addDays, addMonths, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import { faChevronLeft } from "@fortawesome/free-solid-svg-icons/faChevronLeft";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons/faChevronRight";
import Icon from "./Icon.svelte";
import getDfnLocale from "../locale/locale";

/** The days that can be chosen, each its local midnight in epoch ms, oldest first. */
export let days: number[] = [];
/** The chosen day, its local midnight in epoch ms. */
export let value: number;
/** What it picks, for assistive tech. */
export let label: string;

const dispatch = createEventDispatcher<{ change: number }>();

let grid: HTMLDivElement;
/** The month on show: its first day. */
let month = startOfMonth(value).getTime();

$: kept = new Set(days);
$: first = days.length ? startOfMonth(days[0]).getTime() : month;
$: last = days.length ? startOfMonth(days[days.length - 1]).getTime() : month;
/* The reader's language for dates, again once it changes. */
$: dfn = { locale: getDfnLocale(), language: $locale };
$: cells = (() => {
  const from = startOfWeek(month, dfn).getTime();
  const out: number[] = [];
  for (let day = from; out.length % 7 !== 0 || isSameMonth(day, month) || day < month; day = addDays(day, 1).getTime()) {
    out.push(day);
  }
  return out;
})();
$: weekdays = cells.slice(0, 7).map((day) => format(day, "EEEEEE", dfn));
const today = startOfDay(Date.now()).getTime();
/* The one day the Tab key lands on: the chosen one, or this month's first kept. */
$: focusDay = isSameMonth(value, month) ? value : days.find((day) => isSameMonth(day, month));

function showMonth(by: number) {
  month = addMonths(month, by).getTime();
}

function pick(day: number) {
  if (!kept.has(day)) return;
  if (!isSameMonth(day, month)) month = startOfMonth(day).getTime();
  if (day !== value) dispatch("change", day);
}

/** Arrows step the day to the nearest one kept that way; the focus follows it. */
async function onKeydown(event: KeyboardEvent) {
  const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (by === undefined) {
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      showMonth(event.key === "PageUp" ? -1 : 1);
    }
    return;
  }
  event.preventDefault();
  let day = value;
  for (let i = 0; i < days.length; i += 1) {
    day = startOfDay(addDays(day, by)).getTime();
    if (kept.has(day)) break;
    if (day < days[0] || day > days[days.length - 1]) return;
  }
  pick(day);
  await tick();
  grid?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
}
</script>

<div class="calendar">
  <div class="head">
    <span class="month" aria-live="polite">{format(month, "LLLL yyyy", dfn)}</span>
    <button
      type="button"
      class="step"
      aria-label={$_("chrome.archive.prev_month")}
      disabled={month <= first}
      on:click={() => showMonth(-1)}>
      <Icon icon={faChevronLeft} />
    </button>
    <button
      type="button"
      class="step"
      aria-label={$_("chrome.archive.next_month")}
      disabled={month >= last}
      on:click={() => showMonth(1)}>
      <Icon icon={faChevronRight} />
    </button>
  </div>
  <div class="weekdays" aria-hidden="true">
    {#each weekdays as weekday, i (i)}<span>{weekday}</span>{/each}
  </div>
  <!-- The arrows step the day from any of its buttons, so the group listens. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="days" role="group" aria-label={label} bind:this={grid} on:keydown={onKeydown}>
    {#each cells as day (day)}
      {#if isSameMonth(day, month)}
        <button
          type="button"
          class="day"
          class:today={isSameDay(day, today)}
          aria-pressed={day === value}
          aria-label={format(day, "EEEE d MMMM yyyy", dfn)}
          tabindex={day === focusDay ? 0 : -1}
          disabled={!kept.has(day)}
          on:click={() => pick(day)}>
          {format(day, "d", dfn)}
        </button>
      {:else}
        <span class="day blank" aria-hidden="true"></span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px 4px 6px;
  }
  .month {
    flex: 1;
    font: 600 17px/1.2 var(--mc-font);
    color: var(--mc-text);
    text-transform: capitalize;
  }
  .step {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--mc-accent);
    font-size: 17px;
    cursor: pointer;
    transition: background-color var(--mc-motion-fast);
  }
  .step:hover:not(:disabled) { background: var(--mc-tint); }
  .step:disabled {
    color: var(--mc-text-3);
    cursor: default;
  }
  .step:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }

  .weekdays,
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    justify-items: center;
  }
  .weekdays span {
    font: 600 12px/1 var(--mc-font);
    color: var(--mc-text-3);
    text-transform: uppercase;
    padding: 4px 0 6px;
  }
  .days { row-gap: 2px; }
  .day {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    max-width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--mc-text);
    font: 400 19px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--mc-motion-fast),
      color var(--mc-motion-fast),
      transform var(--mc-motion-fast) var(--mc-ease);
  }
  .day.blank { cursor: default; }
  .day:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--mc-tint); }
  .day:active:not(:disabled) { transform: scale(var(--mc-press)); }
  .day:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  .day.today { color: var(--mc-accent); font-weight: 600; }
  .day[aria-pressed="true"] {
    background: var(--mc-accent);
    color: #fff;
    font-weight: 600;
  }
  .day:disabled {
    color: var(--mc-text-3);
    cursor: default;
  }

  @media (max-width: 380px) {
    .day { width: 36px; height: 36px; font-size: 17px; }
  }
</style>
