<!--
  The music's switch: a note, struck through while the music is off. Font
  Awesome's free set has the note but no struck-through one; the stroke is
  drawn here, with a gap cut round it so it reads at the size of a button's
  icon.
-->
<script lang="ts">
  import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";

  /** Whether the music is off. */
  export let off = false;

  const [width, height, , , path] = faMusic.icon;
  const d = Array.isArray(path) ? path.join(" ") : path;
  // One mask per icon on the page: ids are the document's.
  const mask = `music-off-${Math.random().toString(36).slice(2)}`;
</script>

<svg aria-hidden="true" class="fa-svelte" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">
  {#if off}
    <defs>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" {width} {height}>
        <rect {width} {height} fill="#fff" />
        <line x1="24" y1="24" x2={width - 24} y2={height - 24} stroke="#000" stroke-width="120" />
      </mask>
    </defs>
    <path fill="currentColor" d={d} mask="url(#{mask})" />
    <line x1="24" y1="24" x2={width - 24} y2={height - 24} stroke="currentColor" stroke-width="48" stroke-linecap="round" />
  {:else}
    <path fill="currentColor" d={d} />
  {/if}
</svg>

<style>
  .fa-svelte {
    width: 1em;
    height: 1em;
    overflow: visible;
    display: inline-block;
  }
</style>
