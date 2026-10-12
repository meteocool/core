<script lang="ts">
/**
 * Which storms this one merged into, or took in.
 *
 * A storm keeps its identity through what would end a track (a border, a
 * product losing it, a split), so its own lineage is short: the storms that
 * merged into it, and the one it merged into once it has. KONRAD3D's cells
 * have the longer story, splits and all, in the family chart below this one
 * (CellLineage), where the storm has a KONRAD3D track.
 *
 * The storms that merged into it are the ones the flat map holds: the
 * record names only what a storm merged into, not what merged into it.
 */
import { _ } from "svelte-i18n";
import { selectedStorm, stormDetails } from "../stores";
import { heldStorms } from "../lib/stormResolver";
import { byId, mergedInto } from "../lib/stormSelection";
import type { StormSelection } from "../lib/stormSelection";
import { currentLocale } from "../locale/t";

export let selection: StormSelection;

$: storm = selection.summary?.properties ?? null;
$: into = storm?.status === "merged" ? storm.merged_into ?? null : null;
$: from = storm ? mergedInto(heldStorms(), storm.id) : [];

/** 24-hour, as every other time in the panels. */
const clock = (iso: string): string => new Date(iso)
  .toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });

function go(id: string) {
  selectedStorm.set(byId(id, heldStorms()));
  stormDetails.set(true);
}
</script>

{#if into || from.length}
  <h3 class="section">{$_("storm.section.merges")}</h3>
  <ul class="merges">
    {#if into}
      <li><button type="button" on:click={() => go(into)}>{$_("storm.merges.into")}</button></li>
    {/if}
    {#each from as other (other.properties.id)}
      <li>
        <button type="button" on:click={() => go(other.properties.id)}>
          {$_("storm.merges.from", { values: { time: clock(other.properties.last_seen) } })}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .merges {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  button {
    font: 500 13px/1.3 var(--mc-font);
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--mc-accent);
    cursor: pointer;
    text-align: left;
  }
  button::after { content: " ›"; }
  button:hover { text-decoration: underline; }
</style>
