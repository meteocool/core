<script lang="ts">
/** The flight's keys, as a card: on entry for a few seconds, and on H. */
import { _ } from "svelte-i18n";

const ROWS: Array<[string[], string]> = [
  [["W", "S"], "throttle"],
  [["A", "D"], "rudder"],
  [["↑", "↓"], "pitch"],
  [["←", "→"], "roll"],
  [["⇧"], "warp"],
  [["Space"], "brake"],
  [["G"], "gear"],
  [["L"], "autopilot"],
  [["N", "⌫"], "next"],
  [["V"], "view"],
  [["Drag"], "look"],
  [["C"], "style"],
  [["I"], "inspect"],
  [["R"], "record"],
  [["P"], "pause"],
  [["M"], "mute"],
  [["H"], "help"],
  [["Esc"], "leave"],
];
</script>

<section class="keys glass glass-tray" aria-label={$_("studio.flight.keys.title")}>
  <h2>{$_("studio.flight.keys.title")}</h2>
  <dl>
    {#each ROWS as [keys, name] (name)}
      <dt>{#each keys as key (key)}<kbd>{key}</kbd>{/each}</dt>
      <dd>{$_(`studio.flight.keys.${name}`)}</dd>
    {/each}
  </dl>
</section>

<style>
  .keys {
    position: absolute;
    top: 50%;
    left: max(8%, 24px);
    padding: 14px 18px 16px;
    color: var(--mc-text);
    font: 13px/1.3 var(--mc-font);
    transform: translateY(-60%);
    pointer-events: none;
  }
  h2 {
    margin: 0 0 10px;
    font: var(--mc-type-heading);
  }
  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 5px 14px;
    margin: 0;
  }
  dt {
    display: flex;
    gap: 3px;
  }
  dd {
    margin: 0;
    color: var(--mc-text-2);
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 5px;
    background: var(--mc-tint);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.25);
    font: 600 11px/1 var(--mc-font);
  }
</style>
