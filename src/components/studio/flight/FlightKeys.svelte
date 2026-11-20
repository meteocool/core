<script lang="ts">
/**
 * The flight's keys, as a card: on entry for a few seconds, and on H. Flown
 * by touch (TouchControls.svelte) there are no keys to list: the card says
 * in a few lines what each thumb has. With a gamepad plugged in, its sticks
 * and buttons are listed under the keys.
 */
import { onMount } from "svelte";
import { _ } from "svelte-i18n";
import { fullscreenSupported } from "../../../lib/fullscreen";
import { touchControls } from "../../../lib/studio/flight/touch";
import { studioFlightOnly } from "../../../lib/studio/store";

/** What the card says of the touch controls, a line each. */
const TOUCH = ["stick", "throttle", "holds", "strip", "look"];

const ROWS: Array<[string[], string]> = [
  [["W", "S"], "throttle"],
  [["A", "D"], "rudder"],
  [["↑", "↓"], "pitch"],
  [["←", "→"], "roll"],
  [["⇧"], "warp"],
  [["Space"], "brake"],
  [["B"], "speedbrake"],
  [["U", "J"], "flaps"],
  [["G"], "gear"],
  [["X"], "autobrake"],
  [["K"], "parking"],
  [["L"], "autopilot"],
  [["N", "⌫"], "next"],
  [["V"], "view"],
  [["Drag"], "look"],
  [["Wheel"], "zoom"],
  [["Click"], "click"],
  [["C"], "style"],
  [["O"], "radar"],
  [["I"], "inspect"],
  [["R"], "record"],
  [["P"], "pause"],
  [["M"], "mute"],
  ...(fullscreenSupported() ? [[["F"], "fullscreen"] as [string[], string]] : []),
  [["H"], "help"],
  // On the flight's own page the way out of a flight is to its plan.
  [["Esc"], $studioFlightOnly ? "leave_plan" : "leave"],
];

/** A gamepad's sticks and buttons in the standard layout, and what each does: as its key, where the words fit both. */
const PAD: Array<[string[], string]> = [
  [["L stick"], "pad.stick"],
  [["LT", "RT"], "pad.throttle"],
  [["LB", "RB"], "rudder"],
  [["A"], "warp"],
  [["B"], "brake"],
  [["X"], "speedbrake"],
  [["D↑", "D↓"], "flaps"],
  [["Y"], "gear"],
  [["D←"], "autobrake"],
  [["D→"], "parking"],
  [["L3"], "autopilot"],
  [["R3"], "view"],
  [["Start"], "pause"],
  [["Back"], "pad.leave"],
];

/** Whether a gamepad is plugged in, as the flight reads one (lib/studio/flight/controls.ts). */
let pad = false;
onMount(() => {
  const look = () => {
    pad = [...(navigator.getGamepads?.() ?? [])].some((one) => one?.connected && one.mapping === "standard");
  };
  look();
  window.addEventListener("gamepadconnected", look);
  window.addEventListener("gamepaddisconnected", look);
  return () => {
    window.removeEventListener("gamepadconnected", look);
    window.removeEventListener("gamepaddisconnected", look);
  };
});
</script>

<section class="keys glass glass-tray" class:touch={$touchControls} aria-label={$_("studio.flight.keys.title")}>
  <h2>{$_("studio.flight.keys.title")}</h2>
  {#if $touchControls}
    <ul>
      {#each TOUCH as line (line)}
        <li>{$_(`studio.flight.touch.hint.${line}`)}</li>
      {/each}
    </ul>
  {:else}
    <dl>
      {#each ROWS as [keys, name] (name)}
        <dt>{#each keys as key (key)}<kbd>{key}</kbd>{/each}</dt>
        <dd>{$_(`studio.flight.keys.${name}`)}</dd>
      {/each}
    </dl>
    {#if pad}
      <h3>{$_("studio.flight.keys.pad.title")}</h3>
      <dl>
        {#each PAD as [buttons, name] (name)}
          <dt>{#each buttons as button (button)}<kbd>{button}</kbd>{/each}</dt>
          <dd>{$_(`studio.flight.keys.${name}`)}</dd>
        {/each}
      </dl>
    {/if}
  {/if}
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
  h3 {
    margin: 12px 0 8px;
    font: 600 12px/1.3 var(--mc-font);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  dl {
    display: grid;
    /* Two keys and what they do, side by side: the card is as long as half its rows. */
    grid-template-columns: auto auto auto auto;
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
  /* For thumbs: a few lines in the middle of the view, clear of what they describe. */
  .keys.touch {
    top: 46%;
    left: 50%;
    width: min(400px, calc(100% - 48px));
    box-sizing: border-box;
    padding: 12px 16px 13px;
    transform: translate(-50%, -50%);
  }
  .keys.touch h2 { margin-bottom: 6px; }
  ul {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0 0 0 16px;
    color: var(--mc-text-2);
    font: 12.5px/1.35 var(--mc-font);
  }
</style>
