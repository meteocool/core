<script lang="ts">
/**
 * The detail panels' way out, as a glass disc: the cell's panel and sheet, and
 * the storm core's sheet on the 3D map, so every "storm you tapped" closes
 * with the same control in the same corner.
 */
</script>

<button type="button" aria-label="Close" on:click>&times;</button>

<style>
/**
 * The close button, as a glass disc.
 *
 * It was a bare glyph at half opacity, which is the weakest thing the panel
 * could have made of the one control that gets you out of it -- and on the
 * sheet, where the panel is most of the screen, the way out is the control a
 * reader looks for first. A disc in the same material the map's own controls
 * are made of gives it an edge to aim at and says, in the app's own visual
 * language, that it is a button.
 *
 * Built from the panel's own palette rather than from the map's glass
 * tokens, although those were tried first and looked right. They flip with
 * the app's light and dark scheme, and this disc does not sit on the app --
 * it sits on the panel, which is light whichever scheme is on. Over a light
 * sheet the dark-scheme tokens come out as a white fill and a white edge and
 * the whole disc is carried by its drop shadow, which is luck rather than
 * design. Shoelace's neutrals flip with the surface the button is actually
 * on, so the disc keeps its edge either way.
 *
 * The blur stays: it is what makes it a glass drop rather than a grey circle,
 * and there is something behind it -- the 3D model and the charts scroll
 * under the header.
 */
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-left: auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--sl-color-neutral-300, #d6d3d1);
  border-radius: 50%;
  background: var(--sl-color-neutral-100, #f5f5f4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  color: var(--sl-color-neutral-700, #57534e);
  font-size: 19px;
  line-height: 0;
  cursor: pointer;
  transition: transform var(--mc-motion-fast, 120ms) var(--mc-ease, ease);
}

/* Translucent where the browser can blur what is behind it, opaque where it
   cannot -- a clear pane over a scrolling chart is worse than a grey one. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  button {
    background: color-mix(in srgb, var(--sl-color-neutral-100, #f5f5f4) 72%, transparent);
  }
}

button:active {
  transform: scale(var(--mc-press, 0.94));
}

/* A thumb needs 44px; a mouse does not, and at desktop size a target that
   big beside a 13px heading is the loudest thing in the panel. */
@media only screen and (max-width: 620px) {
  button {
    width: 44px;
    height: 44px;
    /* Pulled up and right, into the sheet's own corner. The sheet now
       reserves matching padding on .body for this overhang (see
       CellSheet.svelte) -- previously any right overhang here gave the
       sheet a horizontal scrollbar, on a panel with nothing to scroll
       sideways. */
    margin: -10px -8px -10px auto;
    font-size: 26px;
  }
}

@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
  button:active { transform: none; }
}
</style>
