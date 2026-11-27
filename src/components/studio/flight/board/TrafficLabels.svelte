<script lang="ts">
/**
 * The pins over the other aircraft near enough to matter: a handful, as the
 * storms have theirs (FlightDeck.svelte's marks), in the traffic's cyan. Each
 * says whose aircraft it is and how far off. Made once and moved each frame
 * to where the traffic's drawing last put its aircraft (layers/trafficPass.ts).
 * None in the clean view; the deck leaves this out there.
 *
 * A pin picked opens that pilot's card: their place on today's board, how
 * far off and how high they are, what they are doing, and a live close-up
 * of their aircraft, which the flight's picture draws in the room the card
 * leaves for it (`TrafficShared.closeUp`). The card stays docked on the deck
 * (`dockPlace`, clear of what `keepClear` matches) for as long as the
 * aircraft is heard of, wherever it is and whether or not its pin is in
 * view; it goes when the pin is picked again, when it is closed, or a moment
 * after the aircraft is gone.
 */
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { onDestroy, onMount, tick } from "svelte";
import { _ } from "svelte-i18n";
import Icon from "../../../Icon.svelte";
import type { Pilot } from "../../../../lib/studio/flight/pilot";
import type { BoardEntry } from "../../../../lib/studio/flight/board/wire";
import { apart, dockPlace, doingOf } from "../../../../lib/studio/flight/airspace/card";
import type { Box, Doing } from "../../../../lib/studio/flight/airspace/card";
import { overCloseUp } from "../../../../lib/studio/flight/airspace/shared";
import type { BoardDeck } from "./meteoairBoard";
import logo from "../../../../assets/logo.svg";

export let board: BoardDeck;
export let pilot: Pilot;
/** What on the deck the card keeps clear of: a selector, matched within the deck. */
export let keepClear = "";

const NM = 1852;
const FEET = 3.28084;
/** How long a card says its aircraft is gone before it goes, ms; how often a card open looks again for where to dock, ms. */
const GONE_MS = 3000;
const DOCK_EVERY_MS = 1000;
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const { closeUp } = board.traffic;
let box: HTMLDivElement | null = null;
const pins: Array<HTMLButtonElement | null> = board.traffic.labels.map(() => null);
/** What each pin last said, so that a frame writes only what changed. */
const written: string[] = board.traffic.labels.map(() => "");
/** The aircraft picked, by its number in the airspace: kept by the airspace's share, so it outlasts a turn through the clean view. */
let picked: number | null = closeUp.id;
let callsign = "";
let doing: Doing = null;
let gone = false;
let goneAt = 0;
let card: HTMLElement | null = null;
let shot: HTMLDivElement | null = null;
let rows: HTMLElement | null = null;
let cardSaid = "";
let top: BoardEntry[] = [];
const stopView = board.view.subscribe((view) => { top = view.top; });
let stop: (() => void) | null = null;
let docking: ReturnType<typeof setInterval> | null = null;
let resized: ResizeObserver | null = null;

/** Miles as a chart gives them: a decimal under twenty. */
const miles = (metres: number) => `${(metres / NM).toFixed(metres < 20 * NM ? 1 : 0)} NM`;
const level = (metres: number) => `FL${String(Math.max(0, Math.round((metres * FEET) / 1000) * 10)).padStart(3, "0")}`;

function write(element: Element | null | undefined, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

function place(): void {
  if (!box) return;
  const width = box.clientWidth;
  const height = box.clientHeight;
  board.traffic.labels.forEach((label, i) => {
    const pin = pins[i];
    if (!pin) return;
    // None over the close-up: the page's drawing would show over its picture.
    if (!label.shown || overCloseUp(closeUp, label.x - 6 / width, label.y - 58 / height, label.x + 140 / width, label.y)) {
      if (pin.style.display !== "none") pin.style.display = "none";
      return;
    }
    const said = `${label.callsign}|${miles(label.distance)}`;
    if (written[i] !== said) {
      write(pin.children[1], label.callsign);
      write(pin.children[2], miles(label.distance));
      written[i] = said;
    }
    pin.classList.toggle("picked", label.id === picked);
    pin.style.display = "";
    pin.style.transform = `translate(${(label.x * width).toFixed(1)}px, ${(label.y * height).toFixed(1)}px)`;
  });
  if (picked !== null) say();
}

/** The card's lines, as they are now; and the card let go of a moment after its aircraft is. */
function say(): void {
  const aircraft = picked === null ? undefined : board.traffic.traffic.get(picked);
  if (!aircraft) {
    if (!gone) {
      gone = true;
      goneAt = performance.now();
      // Nothing more to draw: the page's own shows where the picture was, so the card says so there instead.
      closeUp.rect.w = 0;
    } else if (performance.now() - goneAt > GONE_MS) {
      close();
    }
    return;
  }
  if (aircraft.callsign && aircraft.callsign !== callsign) callsign = aircraft.callsign;
  const now = doingOf(aircraft);
  if (now !== doing) doing = now;
  const { shown } = aircraft;
  const sight = pilot.sight;
  const distance = sight ? apart(sight, shown) : null;
  const entry = top.find((row) => row.callsign === aircraft.callsign);
  const standing = entry
    ? $_("studio.flight.traffic.rank", { values: { rank: entry.rank, points: points.format(entry.points) } })
    : $_("studio.flight.traffic.unranked");
  const fpm = Math.round((shown.up * 196.85) / 100) * 100;
  const climb = Math.abs(fpm) >= 200 ? ` · ${fpm > 0 ? "↑" : "↓"} ${points.format(Math.abs(fpm))} fpm` : "";
  const lines = `${standing}\nDIST ${distance === null ? "–" : miles(distance)} · ${level(shown.altitude)}${climb}`;
  if (lines !== cardSaid) {
    write(rows, lines);
    cardSaid = lines;
  }
}

/** Where the card goes: clear of the readouts, the other cards, the chart and the controls; and where its picture is drawn. */
function dock(): void {
  if (!box || !card) return;
  const area = box.getBoundingClientRect();
  const clear: Box[] = [];
  const deck = box.parentElement;
  if (deck && keepClear) {
    for (const element of deck.querySelectorAll(keepClear)) {
      const r = element.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      clear.push({ left: r.left - area.left, top: r.top - area.top, width: r.width, height: r.height });
    }
  }
  // Rather not over the middle of the view, where the flight's own aircraft is.
  const middle: Box = { left: area.width * 0.3, top: area.height * 0.28, width: area.width * 0.4, height: area.height * 0.44 };
  const at = dockPlace({ width: area.width, height: area.height }, { width: card.offsetWidth, height: card.offsetHeight }, clear, middle);
  const transform = `translate(${Math.round(at.left)}px, ${Math.round(at.top)}px)`;
  if (card.style.transform !== transform) card.style.transform = transform;
  measure();
}

/** The picture's place on the flight's, from where its frame is on the deck: inside its border. */
function measure(): void {
  if (!box || !shot || gone) {
    closeUp.rect.w = 0;
    return;
  }
  const area = box.getBoundingClientRect();
  const r = shot.getBoundingClientRect();
  if (!area.width || !area.height) return;
  closeUp.rect.x = (r.left + 1 - area.left) / area.width;
  closeUp.rect.y = (r.top + 1 - area.top) / area.height;
  closeUp.rect.w = Math.max(0, r.width - 2) / area.width;
  closeUp.rect.h = Math.max(0, r.height - 2) / area.height;
}

async function open(id: number): Promise<void> {
  picked = id;
  closeUp.id = id;
  gone = false;
  doing = null;
  callsign = board.traffic.traffic.get(id)?.callsign ?? "";
  cardSaid = "";
  await tick();
  dock();
  docking ??= setInterval(dock, DOCK_EVERY_MS);
  // At once, and while the flight is paused too: no frame comes then to show it.
  place();
}

function close(): void {
  picked = null;
  closeUp.id = null;
  closeUp.rect.w = 0;
  gone = false;
  if (docking) clearInterval(docking);
  docking = null;
  place();
}

function pick(index: number, event: MouseEvent): void {
  const label = board.traffic.labels[index];
  (event.currentTarget as HTMLElement).blur();
  if (label.shown && picked !== label.id) void open(label.id);
  else close();
}

function closed(event: MouseEvent): void {
  (event.currentTarget as HTMLElement).blur();
  close();
}

onMount(() => {
  stop = pilot.onFrame(place);
  // Picked before the deck went to the clean view and back: its card again.
  if (picked !== null) void open(picked);
  if (typeof ResizeObserver !== "undefined" && box) {
    resized = new ResizeObserver(() => { if (picked !== null) dock(); });
    resized.observe(box);
  }
});
onDestroy(() => {
  stop?.();
  stopView();
  resized?.disconnect();
  if (docking) clearInterval(docking);
  // Nowhere to draw it while the deck is not here; still picked, for when it is again.
  closeUp.rect.w = 0;
});
</script>

<div class="traffic-pins" bind:this={box}>
  {#each board.traffic.labels as _label, i (i)}
    <button type="button" class="pin" tabindex="-1" style="display: none" title={$_("studio.flight.traffic.pin_title")}
      bind:this={pins[i]} on:click={(event) => pick(i, event)}><i></i><span></span><span></span></button>
  {/each}
  {#if picked !== null}
    <section class="traffic-card" class:gone bind:this={card} aria-label={$_("studio.flight.traffic.card", { values: { callsign } })}>
      <header>
        <i aria-hidden="true"></i><b>{callsign}</b>
        {#if doing}<span class="doing {doing}">{$_(`studio.flight.traffic.doing.${doing}`)}</span>{/if}
        <button type="button" class="close" tabindex="-1" aria-label={$_("studio.flight.traffic.close")} title={$_("studio.flight.traffic.close")}
          on:click={closed}><Icon icon={faXmark} /></button>
      </header>
      <!-- Empty: the flight's picture draws the close-up into the room this leaves (layers/trafficPass.ts). -->
      <div class="shot" bind:this={shot} role="img" aria-label={$_("studio.flight.traffic.shot", { values: { callsign } })}>
        {#if gone}<p aria-live="polite">{$_("studio.flight.traffic.gone")}</p>{/if}
      </div>
      <p class="rows" bind:this={rows} aria-live="polite"></p>
      <span class="brand"><img src={logo} alt="" />meteocool.com</span>
    </section>
  {/if}
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
  .pin i, .traffic-card header i {
    position: relative;
    width: 8px;
    height: 8px;
    border: 1.5px solid #4fd8ff;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    transform: rotate(45deg);
  }
  .pin i { grid-row: 1 / span 2; }
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
  .pin > span {
    justify-self: start;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(8, 12, 18, 0.34);
  }
  .pin > span:nth-of-type(1) { color: #d6f5ff; }
  .pin > span:nth-of-type(2) { font-weight: 500; opacity: 0.85; }
  .pin:hover i, .pin:global(.picked) i, .traffic-card header i { background: color-mix(in srgb, #4fd8ff 55%, transparent); }
  .pin:global(.picked) i { box-shadow: 0 0 0 3px rgba(79, 216, 255, 0.35), 0 0 3px rgba(0, 0, 0, 0.7); }

  /*
   * The pilot picked: a card docked on the deck, where `dock` puts it. Its
   * frames are glass; the picture's frame is not, and is left empty for the
   * flight's picture to show through (a blur behind it would blur that).
   */
  .traffic-card {
    --shot-w: 240px;
    --shot-h: 150px;
    position: absolute;
    /* Over the deck's other cards where there was no place clear of them all: its own frame never covered. */
    z-index: 1;
    top: 0;
    left: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: var(--shot-w);
    color: #fff;
    font: 600 12px/1.4 var(--mc-font);
    pointer-events: auto;
  }
  .traffic-card > :not(.shot) {
    padding: 0 10px;
    background: rgba(10, 14, 20, 0.78);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .traffic-card header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 4px 0 12px;
    border: 1px solid rgba(79, 216, 255, 0.6);
    border-bottom: 0;
    border-radius: 10px 10px 0 0;
  }
  .traffic-card header b { flex: none; font: 800 13px/1.3 var(--mc-font); letter-spacing: 0.06em; white-space: nowrap; }
  .doing {
    padding: 1px 7px;
    border-radius: var(--mc-radius-pill);
    background: rgba(255, 179, 64, 0.22);
    color: #ffc76a;
    font: 700 10px/1.5 var(--mc-font);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .doing:is(.blew, .broke, .slid, .burning) { background: rgba(255, 69, 58, 0.25); color: #ff8a80; }
  .doing:is(.paused, .ground) { background: rgba(255, 255, 255, 0.14); color: #dfe5ea; }
  .close {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #dfe5ea;
    cursor: pointer;
  }
  .close:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
  .close :global(svg) { width: 12px; height: 12px; }
  .shot {
    box-sizing: border-box;
    width: var(--shot-w);
    height: var(--shot-h);
    border: 1px solid rgba(79, 216, 255, 0.6);
    border-block: 1px solid rgba(255, 255, 255, 0.16);
  }
  .traffic-card.gone .shot {
    display: grid;
    place-items: center;
    background: rgba(10, 14, 20, 0.78);
  }
  .shot p { margin: 0; color: #dfe5ea; font: 600 12px/1.3 var(--mc-font); }
  .rows {
    margin: 0;
    padding-block: 7px !important;
    border-inline: 1px solid rgba(79, 216, 255, 0.6);
    font-variant-numeric: tabular-nums;
    white-space: pre-line;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-block: 6px 7px !important;
    border: 1px solid rgba(79, 216, 255, 0.6);
    border-top: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0 0 10px 10px;
    font: 800 11px/1 var(--mc-font);
    letter-spacing: 0.02em;
  }
  .brand img { width: 14px; height: 14px; }
  /* A phone: a smaller picture, and the card without its foot. */
  @container mc-frame (max-height: 520px) or (max-width: 560px) {
    .traffic-card { --shot-w: 184px; --shot-h: 108px; font-size: 11px; }
    .traffic-card header { min-height: 26px; }
    .rows { padding-block: 5px !important; border-bottom: 1px solid rgba(79, 216, 255, 0.6) !important; border-radius: 0 0 10px 10px; }
    .brand { display: none !important; }
  }
</style>
