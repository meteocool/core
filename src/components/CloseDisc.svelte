<script lang="ts">
/**
 * The panels' way out, as a glass disc: the cell's panel and sheet, the storm
 * core's, and the reading panels (About, Settings, Connection Details), so
 * everything that opens over the map closes with the same control in the
 * same corner.
 */
import { _ } from "svelte-i18n";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import Disc from "./Disc.svelte";

/** Whose tints the disc takes; see Disc.svelte. */
export let material: "drawer" | "chrome" = "drawer";
</script>

<Disc icon={faXmark} label={$_("close")} {material} edge on:click />
