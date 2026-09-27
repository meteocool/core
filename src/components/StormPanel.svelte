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
 * So are the two row shapes the panels share: `.stats`, a line of three
 * facts under the title, and `dl.facts`, label-and-value rows at the end.
 *
 * The type and the spacing follow the system's own place cards: a bold title
 * with the place under it in the secondary ink, bold section headings a step
 * above the body, labels carried by colour rather than by being small, and
 * air between the groups rather than rules.
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
  <header>
    <!-- The storm's own colour, as the map draws it, so the panel says which
         of the shapes behind it it is about. -->
    <span class="rule" style:background={rule} aria-hidden="true"></span>
    <div class="titles">
      <h2 class="title"><slot name="header" /></h2>
      {#if place}<p class="place">{place}</p>{/if}
    </div>
    <CloseDisc on:click={onClose} />
  </header>
  <slot />
</section>

<style>
  .storm-panel {
    font: var(--mc-type-body);
    color: var(--mc-text);
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
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 14px;
  }
  /* A bar rather than a border, so it can be rounded and stop short of the
     line box's leading, top and bottom. */
  .rule {
    flex: 0 0 4px;
    align-self: stretch;
    margin: 3px 0;
    border-radius: 2px;
  }
  .titles {
    flex: 1 1 auto;
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 8px;
    margin: 0;
    font: var(--mc-type-title);
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  /* What the storm is called, whichever panel names it. */
  .title :global(.headline) {
    min-width: 0;
  }
  .place {
    margin: 3px 0 0;
    font: var(--mc-type-subtitle);
    color: var(--mc-text-2);
  }

  /**
   * Three facts in a row under the title, as the system's place cards set
   * "Hours / Open": a small label in the secondary ink over a value in the
   * primary, centred in equal columns. The value carries the colour when
   * there is one to carry.
   */
  .storm-panel :global(.stats) {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: 8px;
    margin: 0 0 14px;
    padding: 0;
    text-align: center;
  }
  .storm-panel :global(.stats dt) {
    font: var(--mc-type-label);
    color: var(--mc-text-2);
  }
  .storm-panel :global(.stats dd) {
    margin: 4px 0 0;
    font: var(--mc-type-value);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /**
   * A section heading, on the footing the place cards give one: bold, in the
   * primary ink, a clear step above the body -- it names the group, and the
   * air above it is what separates the groups, so there are no rules.
   *
   * `h3` because these are real headings -- the panel is a section of the page
   * and each block is a section of the panel, so a screen reader can jump
   * between them.
   */
  .storm-panel :global(.section) {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 26px 0 10px;
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
    color: var(--mc-text);
  }
  /* The first heading follows the stats or the dial, which carry a gap. Only
     the panel's own: `:first-of-type` counts per parent, so unqualified it
     also caught the first heading inside VolumeProvenance and CellLineage,
     which come after whole sections and need the full gap. */
  .storm-panel > :global(h3.section:first-of-type) {
    margin-top: 18px;
  }
  /**
   * The aside is the hint that used to live in the caption ("drag to turn",
   * "tap to follow"), set at the far end of the heading's line where the
   * place cards put their "Edit": a different kind of thing from the heading,
   * so it is somewhere else rather than just quieter.
   */
  .storm-panel :global(.section .aside) {
    margin-left: auto;
    font: 400 13px/1.25 var(--mc-font);
    letter-spacing: 0;
    color: var(--mc-text-3);
    text-align: right;
  }

  /**
   * Label-and-value rows at the end, as the place cards' "Details": the label
   * in the secondary ink, the value in the primary, a hairline between rows
   * that stops short of the edge the text starts from.
   */
  .storm-panel :global(.facts) {
    margin: 0;
  }
  .storm-panel :global(.facts > div) {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
  }
  .storm-panel :global(.facts > div:first-child) {
    padding-top: 0;
  }
  .storm-panel :global(.facts > div + div) {
    border-top: 0.5px solid var(--mc-separator);
  }
  .storm-panel :global(.facts dt) {
    color: var(--mc-text-2);
  }
  .storm-panel :global(.facts dd) {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .storm-panel :global(footer) {
    margin-top: 12px;
    font: 400 12px/1.4 var(--mc-font);
    color: var(--mc-text-3);
  }
</style>
