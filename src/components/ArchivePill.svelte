<script lang="ts">
/**
 * The way into the archive (lib/archive.ts): a pill in the player's row,
 * in StationToggle's shape, that opens the picker (ArchivePicker). Pressed,
 * in the accent, while a past window is open. Once the archive has said it
 * keeps nothing yet, the pill says so too.
 */
import { createEventDispatcher } from "svelte";
import { _ } from "svelte-i18n";
import { faCalendarDays } from "@fortawesome/free-solid-svg-icons/faCalendarDays";
import Icon from "./Icon.svelte";
import { archiveWindow } from "../stores";
import { archiveCoverage } from "../lib/archiveCoverage";

const dispatch = createEventDispatcher<{ open: void }>();

$: empty = $archiveCoverage.state === "empty";
</script>

<button
  type="button"
  class="pill"
  aria-haspopup="dialog"
  aria-pressed={$archiveWindow !== null}
  title={$_(empty ? "chrome.archive.empty" : "chrome.archive.choose")}
  on:click={() => dispatch("open")}>
  <Icon icon={faCalendarDays} />
  <span>{$_(empty ? "chrome.archive.pill_empty" : "chrome.archive.pill")}</span>
</button>

<style>
  /* StationToggle's pill, so the row reads as one kind of thing. */
  .pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--mc-chip-h);
    box-sizing: border-box;
    padding: 0 var(--mc-chip-pad);
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    box-shadow: var(--mc-chip-edge);
    color: var(--mc-text);
    font: var(--mc-chip-font);
    white-space: nowrap;
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .pill :global(svg) { width: var(--mc-chip-icon); height: var(--mc-chip-icon); }
  .pill[aria-pressed="true"] {
    background: color-mix(in srgb, var(--mc-accent) 18%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-accent) 40%, transparent);
    color: var(--mc-accent);
  }
</style>
