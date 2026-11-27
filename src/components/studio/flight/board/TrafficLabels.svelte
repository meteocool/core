<script lang="ts">
/**
 * The pins over the other aircraft near enough to matter: a handful, as the
 * storms have theirs (FlightDeck.svelte's marks), in the traffic's cyan. Each
 * says whose aircraft it is and how far off; picked, it opens a card with the
 * pilot's place on today's board. Made once and moved each frame to where
 * the traffic's drawing last put its aircraft (layers/trafficPass.ts). None
 * in the clean view; the deck leaves this out there.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import type { Pilot } from "../../../../lib/studio/flight/pilot";
import type { BoardEntry } from "../../../../lib/studio/flight/board/wire";
import type { BoardDeck } from "./meteoairBoard";
import logo from "../../../../assets/logo.svg";

export let board: BoardDeck;
export let pilot: Pilot;

const NM = 1852;
const FEET = 3.28084;
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

let box: HTMLDivElement | null = null;
const pins: Array<HTMLButtonElement | null> = board.traffic.labels.map(() => null);
/** What each pin last said, so that a frame writes only what changed. */
const written: string[] = board.traffic.labels.map(() => "");
const cards: string[] = board.traffic.labels.map(() => "");
/** The aircraft whose pin is picked, by its number in the airspace. */
let picked: number | null = null;
let top: BoardEntry[] = [];
const stopView = board.view.subscribe((view) => { top = view.top; });
let stop: (() => void) | null = null;

/** Miles as a chart gives them: a decimal under twenty. */
const miles = (metres: number) => `${(metres / NM).toFixed(metres < 20 * NM ? 1 : 0)} NM`;

function write(element: Element | null | undefined, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

function place(): void {
  if (!box) return;
  const width = box.clientWidth;
  const height = box.clientHeight;
  let pickedShown = false;
  board.traffic.labels.forEach((label, i) => {
    const pin = pins[i];
    if (!pin) return;
    if (!label.shown) {
      if (pin.style.display !== "none") pin.style.display = "none";
      return;
    }
    const said = `${label.callsign}|${miles(label.distance)}`;
    if (written[i] !== said) {
      write(pin.children[1], label.callsign);
      write(pin.children[2], miles(label.distance));
      written[i] = said;
    }
    const isPicked = label.id === picked;
    pickedShown ||= isPicked;
    pin.classList.toggle("picked", isPicked);
    if (isPicked) {
      // The card turns to the left near the right edge, and above the pin near the foot.
      pin.classList.toggle("flip", label.x > 0.62);
      pin.classList.toggle("above", label.y > 0.58);
      const entry = top.find((row) => row.callsign === label.callsign);
      const place = entry
        ? $_("studio.flight.traffic.rank", { values: { rank: entry.rank, points: points.format(entry.points) } })
        : $_("studio.flight.traffic.unranked");
      const level = `FL${String(Math.max(0, Math.round((label.altitude * FEET) / 1000) * 10)).padStart(3, "0")}`;
      const card = `${label.callsign}|${place}|${miles(label.distance)}|${level}`;
      if (cards[i] !== card) {
        const pop = pin.querySelector(".pop");
        write(pop?.querySelector("b"), label.callsign);
        write(pop?.querySelector(".rows"), `${place}\nDIST ${miles(label.distance)} · ${level}`);
        cards[i] = card;
      }
    }
    pin.style.display = "";
    pin.style.transform = `translate(${(label.x * width).toFixed(1)}px, ${(label.y * height).toFixed(1)}px)`;
  });
  // Out of reach or out of sight, its card is put away with its pin; picked again where it is next seen.
  if (picked !== null && !pickedShown && !board.traffic.traffic.list.some((aircraft) => aircraft.id === picked)) picked = null;
}

function pick(index: number, event: MouseEvent): void {
  const label = board.traffic.labels[index];
  picked = label.shown && picked !== label.id ? label.id : null;
  (event.currentTarget as HTMLElement).blur();
  // At once, and while the flight is paused too: no frame comes then to show it.
  place();
}

onMount(() => {
  stop = pilot.onFrame(place);
});
onDestroy(() => {
  stop?.();
  stopView();
});
</script>

<div class="traffic-pins" bind:this={box}>
  {#each board.traffic.labels as _label, i (i)}
    <button type="button" class="pin" tabindex="-1" style="display: none" title={$_("studio.flight.traffic.pin_title")}
      bind:this={pins[i]} on:click={(event) => pick(i, event)}><i></i><span></span><span></span><span class="pop" aria-live="polite"
      ><b></b><span class="rows"></span><span class="brand"><img src={logo} alt="" />meteocool.com</span></span></button>
  {/each}
</div>

<style>
  .traffic-pins {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  /* As a storm's mark (FlightDeck.svelte): a diamond on a stem down to the aircraft, two lines beside it. */
  .pin {
    --pin: #4fd8ff;
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 7px;
    align-items: center;
    width: max-content;
    /* The stem's foot on the aircraft: the diamond stands its length above. */
    margin: -53px 0 0 -5px;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font: 600 11px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-align: left;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.85), 0 1px 1px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    pointer-events: auto;
    will-change: transform;
  }
  .pin i {
    grid-row: 1 / span 2;
    position: relative;
    width: 8px;
    height: 8px;
    border: 1.5px solid var(--pin);
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    transform: rotate(45deg);
  }
  .pin i::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 100%;
    width: 1px;
    height: 44px;
    background: linear-gradient(color-mix(in srgb, var(--pin) 80%, transparent), transparent);
    transform: rotate(-45deg);
    transform-origin: top left;
    pointer-events: none;
  }
  .pin > span:not(.pop) {
    justify-self: start;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(8, 12, 18, 0.34);
  }
  .pin > span:nth-of-type(1) { color: #d6f5ff; }
  .pin > span:nth-of-type(2) { font-weight: 500; opacity: 0.85; }
  .pin:hover i, .pin:global(.picked) i { background: color-mix(in srgb, var(--pin) 55%, transparent); }
  .pin:global(.picked) i { box-shadow: 0 0 0 3px rgba(79, 216, 255, 0.35), 0 0 3px rgba(0, 0, 0, 0.7); }
  /* The pilot picked: a card under the pin's two lines, there only while it is. */
  .pin .pop {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    left: 15px;
    min-width: 196px;
    padding: 9px 11px 8px;
    border-radius: 10px;
    background: rgba(10, 14, 20, 0.78);
    border: 1px solid color-mix(in srgb, var(--pin) 60%, transparent);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    text-shadow: none;
    pointer-events: none;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .pin:global(.picked) .pop { display: grid; gap: 6px; }
  /* Leftwards from the diamond, not from the end of the pin's lines, which may be past the edge. */
  .pin:global(.flip) .pop { left: auto; right: calc(100% - 12px); }
  .pin:global(.above) .pop { top: auto; bottom: calc(100% + 8px); }
  .pin .pop b { font: 800 13px/1.3 var(--mc-font); letter-spacing: 0.06em; color: #fff; }
  .pin .pop .rows { font: 600 12px/1.55 var(--mc-font); font-variant-numeric: tabular-nums; white-space: pre-line; }
  .pin .pop .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
    font: 800 11px/1 var(--mc-font);
    letter-spacing: 0.02em;
    opacity: 0.9;
  }
  .pin .pop .brand img { width: 14px; height: 14px; }
</style>
