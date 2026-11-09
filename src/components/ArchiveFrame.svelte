<script lang="ts">
/**
 * A past window (lib/archive.ts), said by the screen's own edge: a graphite
 * frame round the whole map, its corners rounded, so nobody takes the
 * archive for now, not even in a screenshot passed on. Its top edge grows a
 * tab: the window and the step on screen, which opens the picker to choose
 * another, and a cross back to live. The top line of controls moves below
 * it (glass.css, archive-open).
 *
 * Always in the page and only faded in: leaving the archive should be seen
 * too, and an empty frame costs nothing.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { format, isSameDay } from "date-fns";
import { faCalendarDays } from "@fortawesome/free-solid-svg-icons/faCalendarDays";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import Icon from "./Icon.svelte";
import { archivePickerOpen, archiveWindow, capTimeIndicator } from "../stores";
import getDfnLocale from "../locale/locale";

$: open = $archiveWindow !== null;

/**
 * What the tab says, in the reader's language, kept while the frame fades
 * out rather than blanked under it.
 *
 * `step` is the date and time on screen: the window is days away, so the
 * clock alone says little. Where there is room the tab names the window too,
 * its day and span, and the step by its clock, with its day only once it has
 * crossed midnight from the window's start.
 */
let step = "";
/** The step for the iPhone app's tab, between its buttons: without its weekday. */
let stepShort = "";
let span = "";
let stepClock = "";
$: if ($archiveWindow) {
  const dfn = { locale: getDfnLocale() };
  const start = $archiveWindow.start * 1000;
  const end = $archiveWindow.end * 1000;
  span = isSameDay(start, end)
    ? `${format(start, "EEE d MMM, HH:mm", dfn)}–${format(end, "HH:mm", dfn)}`
    : `${format(start, "EEE d MMM, HH:mm", dfn)} – ${format(end, "EEE d MMM, HH:mm", dfn)}`;
  if ($capTimeIndicator) {
    const shown = $capTimeIndicator * 1000;
    step = format(shown, "EEE d MMM, HH:mm", dfn);
    stepShort = format(shown, "d MMM, HH:mm", dfn);
    stepClock = format(shown, isSameDay(start, shown) ? "HH:mm" : "EEE HH:mm", dfn);
  }
}

$: document.documentElement.classList.toggle("archive-open", open);
onDestroy(() => document.documentElement.classList.remove("archive-open"));
</script>

<div class="archive-frame" class:on={open}>
  <div class="window" aria-hidden="true"></div>
  <div class="tab">
    <button
      type="button"
      class="choose"
      aria-haspopup="dialog"
      title={$_("chrome.archive.choose")}
      aria-label={step ? `${$_("chrome.archive.title")}, ${step}` : $_("chrome.archive.title")}
      on:click={() => archivePickerOpen.set(true)}>
      <span class="icon"><Icon icon={faCalendarDays} /></span>
      <span class="word">{$_("chrome.archive.title")}</span>
      <!-- A phone: the step's date and time. A desktop: the window, then the step. -->
      {#if step}
        <span class="sep narrow" aria-hidden="true">·</span>
        <span class="time narrow full">{step}</span>
        <span class="time narrow short">{stepShort}</span>
      {/if}
      <span class="sep wide" aria-hidden="true">·</span>
      <span class="time wide">{span}</span>
      {#if stepClock}
        <span class="sep wide" aria-hidden="true">·</span>
        <span class="time wide step">{stepClock}</span>
      {/if}
    </button>
    <button
      type="button"
      class="close"
      title={$_("chrome.archive.back_to_live")}
      aria-label={$_("chrome.archive.pill_live", { values: { time: step } })}
      on:click={() => archiveWindow.set(null)}>
      <Icon icon={faXmark} />
    </button>
  </div>
</div>

<style>
  /* --mc-motion is 0 under reduced motion (glass.css), so no media query. */
  /* Below the iOS app's status bar blur, where it has one: the blur stays as
     it is live, and the frame is all below it. */
  .archive-frame {
    position: fixed;
    inset: var(--mc-archive-top) 0 0;
    z-index: var(--mc-z-frame);
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--mc-motion) var(--mc-ease),
      visibility 0s linear var(--mc-motion);
  }
  .archive-frame.on {
    opacity: 1;
    visibility: visible;
    transition: opacity var(--mc-motion) var(--mc-ease);
  }

  /* The map shows through a rounded hole; the ink is the hole's shadow,
     spread over everything outside it, so the corners fill in on any
     screen, square or not. */
  .window {
    position: absolute;
    inset: var(--mc-archive-frame-w);
    border-radius: var(--mc-archive-radius-top) var(--mc-archive-radius-top) var(--mc-archive-radius) var(--mc-archive-radius);
    box-shadow: 0 0 0 100vmax var(--mc-archive-ink);
  }

  /* The tab: hung from the top edge, one piece with it, its inner corners
     filleted into the band. Tall enough to clear the status bar and the
     island, its line of its own beneath them; in the iOS app, hung below
     the app's status bar blur, its line alone. */
  .tab {
    --fillet: 10px;
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 2 * var(--mc-archive-radius-top) - 2 * var(--fillet));
    height: calc(var(--mc-archive-tab-h) - var(--mc-archive-top));
    padding: calc(var(--mc-safe-top) - var(--mc-archive-top)) 4px 0;
    border-radius: 0 0 14px 14px;
    background: var(--mc-archive-ink);
    color: var(--mc-archive-on);
    pointer-events: auto;
  }
  .tab::before,
  .tab::after {
    content: "";
    position: absolute;
    top: var(--mc-archive-frame-w);
    width: var(--fillet);
    height: var(--fillet);
    pointer-events: none;
  }
  .tab::before {
    right: 100%;
    background: radial-gradient(circle at 0 100%, transparent calc(var(--fillet) - 0.5px), var(--mc-archive-ink) var(--fillet));
  }
  .tab::after {
    left: 100%;
    background: radial-gradient(circle at 100% 100%, transparent calc(var(--fillet) - 0.5px), var(--mc-archive-ink) var(--fillet));
  }

  /* Two targets on the one tab, each lit on its own. */
  .choose,
  .close {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 22px;
    margin: 0;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: inherit;
    font: 600 12px/1 var(--mc-font);
    letter-spacing: 0.01em;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  .choose:hover,
  .close:hover {
    background: color-mix(in srgb, var(--mc-archive-on) 16%, transparent);
  }
  .choose:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--mc-chrome-accent);
    outline-offset: 1px;
  }
  .choose {
    min-width: 0;
    gap: 6px;
    padding: 0 8px;
  }
  .close {
    flex: 0 0 auto;
    justify-content: center;
    width: 22px;
    padding: 0;
    font-size: 11px;
  }
  /* A thumb's worth of target below the cross, where the tab is short. */
  .close::after {
    content: "";
    position: absolute;
    inset: -6px -6px -12px;
  }

  .icon {
    display: inline-flex;
    font-size: 11px;
  }
  .word,
  .time {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep { opacity: 0.6; }
  /* Lining figures, so the tab does not twitch from 09:55 to 10:00. */
  .time { font-variant-numeric: tabular-nums; }
  .step { opacity: 0.8; }

  /* Room for the window as well as the step: the desktop's breakpoint. */
  .wide { display: none; }
  .short { display: none; }
  @media (min-width: 621px) {
    .narrow { display: none; }
    .wide { display: inline; }
  }
  /* The iPhone app's tab runs between its own buttons, the logo's and the
     column's, which stay where they are: the calendar says "archive", and
     the date and time alone are left beside it, without the weekday. */
  @media (max-width: 620px) {
    :global(html.is-ios) .word,
    :global(html.is-ios) .sep.narrow,
    :global(html.is-ios) .full {
      display: none;
    }
    :global(html.is-ios) .short { display: inline; }
  }

  /* The headless renderer's picture carries nothing over the map but its
     credits (lib/screenshot.ts). */
  :global(html.screenshot) .archive-frame {
    display: none;
  }
</style>
