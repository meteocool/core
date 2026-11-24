<script lang="ts">
/**
 * The flight's settings, as a card under the deck's buttons: what the
 * reader chooses to see while flying, kept for every flight after
 * (lib/studio/flight/settings.ts). Each a switch, with a line saying what
 * it shows.
 *
 * A switch gives its focus back as soon as it is flipped: while an input
 * has it, the flight's keys are the input's (controls.ts), and Space would
 * go on flipping it instead of braking.
 */
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { _ } from "svelte-i18n";
import { flightSettings, setFlightSetting } from "../../../lib/studio/flight/settings";
import type { FlightSettings } from "../../../lib/studio/flight/settings";
import Icon from "../../Icon.svelte";

/** Put the card away, as its button on the deck does. */
export let close: () => void;

/** The settings in the order the card lists them. */
const SETTINGS: Array<keyof FlightSettings> = ["radarBeams"];

function flip(name: keyof FlightSettings, event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  setFlightSetting(name, input.checked);
  input.blur();
}
</script>

<section class="settings glass glass-tray" aria-label={$_("studio.flight.settings.title")}>
  <h2>{$_("studio.flight.settings.title")}</h2>
  <button type="button" class="close" tabindex="-1" aria-label={$_("studio.flight.settings.close")} title={$_("studio.flight.settings.close")}
    on:click={close}>
    <Icon icon={faXmark} />
  </button>
  <ul>
    {#each SETTINGS as name (name)}
      <li>
        <label>
          <span class="name">{$_(`studio.flight.settings.${name}`)}</span>
          <input type="checkbox" role="switch" class="switch" tabindex="-1" checked={$flightSettings[name]}
            on:change={(event) => flip(name, event)} />
          <span class="hint">{$_(`studio.flight.settings.${name}_hint`)}</span>
        </label>
      </li>
    {/each}
  </ul>
</section>

<style>
  .settings {
    position: absolute;
    top: calc(var(--mc-safe-top) + 14px + var(--mc-pill-h) + 10px);
    right: 14px;
    width: min(300px, calc(100% - 28px));
    box-sizing: border-box;
    padding: 14px 16px 14px;
    color: var(--mc-text);
    font: 13px/1.3 var(--mc-font);
  }
  /* The deck lets presses through what is on it to the view (FlightDeck.svelte); not on this card, which is all switches. */
  :global(.flight-deck) > .settings { pointer-events: auto; }
  h2 {
    margin: 0 32px 10px 0;
    font: var(--mc-type-heading);
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: transparent;
    color: var(--mc-text-2);
    font-size: 14px;
    cursor: pointer;
  }
  .close:hover,
  .close:focus-visible {
    color: var(--mc-text);
    background: var(--mc-tint-hover);
  }
  ul {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Its name with the switch beside it, as the map's settings have them, and what it shows under both. */
  label {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 12px;
    row-gap: 3px;
    align-items: center;
    cursor: pointer;
  }
  .name { font-weight: 600; }
  .hint {
    grid-column: 1 / -1;
    color: var(--mc-text-2);
    font-size: 12px;
    line-height: 1.35;
  }
  /* The map's own switch (SettingsDialog.svelte). */
  .switch {
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    width: 46px;
    height: 28px;
    margin: 0;
    border-radius: 14px;
    background: var(--mc-hairline);
    cursor: pointer;
    transition: background-color var(--mc-motion-fast);
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform var(--mc-motion-fast) var(--mc-ease);
  }
  .switch:checked { background: var(--mc-accent); }
  .switch:checked::after { transform: translateX(18px); }
</style>
