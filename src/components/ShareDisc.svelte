<script lang="ts">
/**
 * "Send this to someone", as a disc beside a panel's close disc: in a storm
 * panel's header, or in the phone sheet's corner (CellSheet).
 */
import { _ } from "svelte-i18n";
import Disc from "./Disc.svelte";
import { shareIcon } from "../lib/share";
import type { SheetShare } from "../lib/sheetContext";

export let onShare: SheetShare;
/** Whose tints the disc takes; see Disc.svelte. */
export let material: "drawer" | "chrome" = "drawer";

const icon = shareIcon();
</script>

<Disc {icon} label={$_("share.share")} {material}
  on:click={(event) => onShare(event.currentTarget as Element | null)} />
