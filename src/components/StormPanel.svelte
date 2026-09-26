<script lang="ts">
/**
 * The frame every "storm you tapped" is drawn in: a tracked cell's details
 * and a storm core's alike, in the desktop popup and in the phone's sheet.
 *
 * The two used to be laid out separately, and drifted: the core had a bare
 * close glyph where the cell had the glass disc, its own heading sizes in rem
 * beside the cell's in px, a 12-hour clock beside a 24-hour one, and no
 * Escape. Opened one after the other on the 3D map they read as two different
 * apps. This holds what is the same about both -- the header ruled in the
 * storm's colour with the way out in its corner, the line saying where it is,
 * the section headings, the footer, the key that closes it -- so the panels
 * only differ in what they have to say.
 *
 * Section headings are `h3.section` with an optional `span.aside`, set from
 * here for whatever is inside, `CellLineage` and `VolumeProvenance` included.
 */
import CloseDisc from "./CloseDisc.svelte";

/** The storm's own colour, for the rule down the header. */
export let rule: string;
/** What a screen reader calls the panel. */
export let label: string;
/** Where the storm is, on its own line under the header; none at sea or offline. */
export let place: string | null = null;
export let onClose: () => void;

/**
 * Escape closes the panel, which is what every other dismissable surface on a
 * desktop does.
 *
 * Three things are deliberately left alone. A panel above this one owns the
 * key first -- About, Settings and Connection Details close on Escape
 * themselves, and can be open over this -- so an open one means the key was
 * not aimed here. A handler that already called `preventDefault` means the
 * same; GlassPanel does, from the capture phase, so it always runs first. And
 * Escape in a field means "cancel what I am typing", never "close the panel
 * behind it".
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (document.querySelector("sl-dialog[open], [role='dialog'][aria-modal='true']")) return;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target && /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  onClose();
}
</script>

<svelte:window on:keydown={onKeydown} />

<section class="storm-panel" aria-label={label}>
  <header style="border-color: {rule}">
    <slot name="header" />
    <CloseDisc on:click={onClose} />
  </header>
  {#if place}
    <p class="place">{place}</p>
  {/if}
  <slot />
</section>

<style>
  .storm-panel {
    font-size: 13px;
    line-height: 1.45;
    /* One width for both kinds of storm, so opening one after the other does
       not resize the popup under the pointer; the charts are drawn to it. */
    width: 340px;
    max-width: 100%;
  }
  @media only screen and (max-width: 620px) {
    .storm-panel { width: auto; min-width: 300px; }
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    border-left: 4px solid;
    padding-left: 8px;
    margin-bottom: 6px;
  }
  @media only screen and (max-width: 620px) {
    header { align-items: center; }
  }
  /* What the storm is called, whichever panel names it. */
  header :global(.headline) {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  /* Beside it, quieter: how old it is. */
  header :global(.meta) {
    font-size: 11px;
    opacity: 0.65;
    white-space: nowrap;
  }
  .place {
    margin: -2px 0 6px;
    padding-left: 12px;
    font-size: 0.9em;
    opacity: 0.8;
  }

  /**
   * A section heading, on the footing iOS gives one in a grouped list.
   *
   * Apple sets these at Footnote (13px) semibold in the secondary label
   * colour, not at a size above the body in the primary one -- a section
   * header names the group, it is not the loudest thing in it. Tracking goes
   * slightly positive rather than negative: at this size the default fit is
   * too tight, which is the opposite of the problem a display size has.
   *
   * `h3` because these are real headings -- the panel is a section of the page
   * and each block is a section of the panel, so a screen reader can jump
   * between them.
   */
  .storm-panel :global(.section) {
    margin: 18px 0 7px;
    font: 600 13px/1.25 var(--mc-font, system-ui);
    letter-spacing: 0.006em;
    color: var(--sl-color-neutral-600, #57534e);
  }
  /* The first heading follows the signals row or the dial, which already
     carries the gap. */
  .storm-panel :global(.section:first-of-type) {
    margin-top: 10px;
  }
  /**
   * The aside is the hint that used to live in the caption ("drag to turn",
   * "tap to follow"). Set a step quieter again, and separated by a middot:
   * a margin alone left two phrases touching with nothing to say they were
   * different things.
   */
  .storm-panel :global(.section .aside) {
    font: 400 12px/1 var(--mc-font, system-ui);
    color: var(--sl-color-neutral-500, #78716c);
    letter-spacing: 0;
  }
  .storm-panel :global(.section .aside)::before {
    content: "·";
    margin: 0 5px;
    color: var(--sl-color-neutral-400, #a8a29e);
  }

  .storm-panel :global(footer) {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
