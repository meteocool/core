<script lang="ts">
/**
 * The panels' way out, as a glass disc: the cell's panel and sheet, the storm
 * core's, and the reading panels (About, Settings, Connection Details), so
 * everything that opens over the map closes with the same control in the
 * same corner.
 */
import { _ } from "svelte-i18n";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import Icon from "./Icon.svelte";

/**
 * Whose tints the disc takes. The drawer's by default: a flat tint under the
 * drawer's own rim, for the storm panels. "chrome" for the reading panels
 * (GlassPanel), whose glass has ink that follows the basemap rather than the
 * scheme: there the disc takes the chrome's edge and the lens bevel instead,
 * which is the rule for anything sitting on that glass.
 */
export let material: "drawer" | "chrome" = "drawer";
</script>

<button
  type="button"
  class:chrome={material === "chrome"}
  aria-label={$_("close")}
  title={$_("close")}
  on:click><Icon icon={faXmark} /></button>

<style>
/**
 * The close button, as a disc of the drawer's own glass.
 *
 * It was a bare glyph at half opacity, which is the weakest thing the panel
 * could have made of the one control that gets you out of it -- and on the
 * sheet, where the panel is most of the screen, the way out is the control a
 * reader looks for first. A disc gives it an edge to aim at and says, in the
 * app's own visual language, that it is a button.
 *
 * A flat tint with a specular rim rather than a second blur: it sits on the
 * drawer, which is glass already, and glass on glass is the one thing the
 * material rules out. The tint and the ink are the drawer's, so the disc
 * follows it between schemes. The glyph is the icon GlassPanel's close uses,
 * not a multiplication sign, whose weight and centring change with the font.
 */
button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  margin-left: auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--mc-tint);
  box-shadow: inset 0 1px 0 var(--mc-drawer-edge), inset 0 0 0 0.5px var(--mc-separator);
  color: var(--mc-text);
  font-size: 14px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--mc-motion-fast, 120ms), transform var(--mc-motion-fast, 120ms) var(--mc-ease, ease);
}
button:hover { background: var(--mc-tint-hover); }
button:active {
  background: var(--mc-tint-active);
  transform: scale(var(--mc-press, 0.94));
}
button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

/* On the reading panels' glass: the chrome's edge and bevel, no inset rim. */
button.chrome {
  border: 1px solid var(--mc-glass-edge);
  box-shadow: var(--mc-glass-highlight);
}

/* A thumb needs 44px; a mouse does not, and at desktop size a target that
   big beside the title is the loudest thing in the panel. */
@media only screen and (max-width: 620px) {
  button {
    width: 44px;
    height: 44px;
    /* Pulled up and right, into the sheet's own corner. The sheet reserves
       matching padding on .body for this overhang (see CellSheet.svelte) --
       without it the overhang gave the sheet a horizontal scrollbar, on a
       panel with nothing to scroll sideways. */
    margin: -10px -8px -10px auto;
    font-size: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
  button:active { transform: none; }
}
</style>
