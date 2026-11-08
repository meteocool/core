<script lang="ts" generics="T">
/**
 * A picker wheel in the iOS manner: a column of values that scrolls and
 * snaps, the one in the middle chosen, the rest turning away on a drum.
 *
 * A finger or a trackpad scrolls it natively; a mouse can drag it too, and a
 * click on a value brings it to the middle. To assistive tech and a keyboard
 * it is an adjustable control: up and down step it, Page keys by five, Home
 * and End to its ends. The band that marks the middle row is the parent's,
 * so it can run across several wheels as one.
 */
import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
import { haptic } from "../lib/haptics";

/** The values, in order. */
export let items: Array<{ value: T; label: string }> = [];
/** The chosen one. */
export let value: T;
/** What it picks, for assistive tech. */
export let label: string;

/** One row's height, in px; the wheel shows five. */
const ROW = 34;

const dispatch = createEventDispatcher<{ change: T }>();

let scroller: HTMLDivElement;
let rows: HTMLDivElement[] = [];
/** The row in the middle as it scrolls, drawn as chosen before it settles. */
let centred = 0;
let settleTimer = 0;
let frame = 0;
let mounted = false;
/** The wheel is moving itself, not under a hand: no notches felt. */
let quiet = true;

$: index = Math.max(0, items.findIndex((item) => item.value === value));

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Turn each row on the drum by how far it is from the middle. */
function draw() {
  frame = 0;
  if (!scroller) return;
  const at = scroller.scrollTop / ROW;
  const middle = Math.round(at);
  if (middle !== centred && !quiet) haptic("tick");
  centred = middle;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const d = Math.max(-3, Math.min(3, i - at));
    row.style.transform = `perspective(260px) rotateX(${-d * 22}deg) translateZ(0)`;
    row.style.opacity = String(Math.max(0.2, 1 - Math.abs(d) * 0.3));
  }
}

function scheduleDraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

/**
 * The row the wheel is bringing to the middle by itself, until it is there or
 * a hand takes over: a scroll it makes is never read back as a choice.
 */
let target: number | null = null;

/** Put row `i` in the middle. */
function scrollTo(i: number, smooth: boolean) {
  if (!scroller) return;
  quiet = true;
  target = i;
  scroller.scrollTo({ top: i * ROW, behavior: smooth && !reduced() ? "smooth" : "auto" });
  scheduleDraw();
}

/**
 * The wheel has stopped. Its own scroll is put exactly on its row, however
 * it was held up on the way; what a hand left in the middle is the choice,
 * then drawn onto its row.
 */
function settle() {
  if (!scroller || dragging) return;
  if (target !== null) {
    if (Math.abs(scroller.scrollTop - target * ROW) > 1) scroller.scrollTo({ top: target * ROW });
    target = null;
    return;
  }
  const i = Math.max(0, Math.min(items.length - 1, Math.round(scroller.scrollTop / ROW)));
  choose(i, false);
  if (Math.abs(scroller.scrollTop - i * ROW) > 1) scrollTo(i, true);
}

function choose(i: number, scroll: boolean) {
  const item = items[Math.max(0, Math.min(items.length - 1, i))];
  if (!item) return;
  if (scroll) scrollTo(items.indexOf(item), true);
  if (item.value !== value) dispatch("change", item.value);
}

function onScroll() {
  scheduleDraw();
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settle, 140);
}

/* A value set from outside, or a list that changed: bring the middle to it,
   unless it is already there or a hand is on the wheel. */
async function follow(i: number) {
  await tick();
  if (!scroller || dragging || target === i) return;
  if (Math.abs(scroller.scrollTop - i * ROW) > 1) {
    scrollTo(i, mounted);
  } else {
    scheduleDraw();
  }
}
$: if (scroller && items) void follow(index);

/* A mouse has no scroll of its own on a column: dragging it scrolls it. A
   press of any pointer that hardly moves is a tap on the row it began on; a
   finger that pans scrolls natively, and the browser cancels the press. */
let dragging = false;
let pressed: HTMLElement | null = null;
let dragStart = 0;
let dragTop = 0;
let moved = false;

function onPointerDown(event: PointerEvent) {
  quiet = false;
  target = null;
  if (event.button !== 0) return;
  pressed = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
  moved = false;
  dragStart = event.clientY;
  dragTop = scroller.scrollTop;
  if (event.pointerType !== "mouse") return;
  dragging = true;
  scroller.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent) {
  if (!pressed && !dragging) return;
  const dy = event.clientY - dragStart;
  if (Math.abs(dy) > 4) moved = true;
  if (dragging && moved) scroller.scrollTop = dragTop - dy;
}

function onPointerUp(event: PointerEvent) {
  const row = moved ? null : pressed;
  pressed = null;
  if (dragging) {
    dragging = false;
    scroller.releasePointerCapture(event.pointerId);
    if (moved) settle();
  }
  if (row && event.type === "pointerup") choose(Number(row.dataset.index), true);
}

function onKeydown(event: KeyboardEvent) {
  const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[event.key];
  let to: number | null = null;
  if (step !== undefined) to = index + step;
  else if (event.key === "Home") to = 0;
  else if (event.key === "End") to = items.length - 1;
  if (to === null) return;
  event.preventDefault();
  choose(to, true);
}

onMount(() => {
  scrollTo(index, false);
  draw();
  mounted = true;
});

onDestroy(() => {
  window.clearTimeout(settleTimer);
  if (frame) cancelAnimationFrame(frame);
});
</script>

<div
  class="wheel"
  role="spinbutton"
  tabindex="0"
  aria-label={label}
  aria-valuenow={index}
  aria-valuemin={0}
  aria-valuemax={Math.max(0, items.length - 1)}
  aria-valuetext={items[index]?.label ?? ""}
  style:--row="{ROW}px"
  on:keydown={onKeydown}>
  <div
    class="scroller"
    class:dragging
    bind:this={scroller}
    on:scroll={onScroll}
    on:wheel={() => { quiet = false; target = null; }}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    aria-hidden="true">
    {#each items as item, i (item.value)}
      <div class="row" class:centred={i === centred} data-index={i} data-value={item.value} bind:this={rows[i]}>
        {item.label}
      </div>
    {/each}
  </div>
</div>

<style>
  .wheel {
    position: relative;
    height: calc(var(--row) * 5);
    border-radius: 10px;
    outline: none;
  }
  .wheel:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  .scroller {
    height: 100%;
    overflow-y: scroll;
    overscroll-behavior: contain;
    scroll-snap-type: y mandatory;
    scrollbar-width: none;
    padding: calc(var(--row) * 2) 0;
    box-sizing: border-box;
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    /* The drum's far side fades out, as the system's does. */
    -webkit-mask-image: linear-gradient(transparent, #000 32%, #000 68%, transparent);
    mask-image: linear-gradient(transparent, #000 32%, #000 68%, transparent);
  }
  .scroller::-webkit-scrollbar { display: none; }
  .scroller.dragging {
    cursor: grabbing;
    scroll-snap-type: none;
  }
  .row {
    height: var(--row);
    display: flex;
    align-items: center;
    justify-content: center;
    scroll-snap-align: center;
    font: 400 21px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    color: var(--mc-text);
    transform-origin: 50% 50%;
    backface-visibility: hidden;
    transition: color var(--mc-motion-fast);
  }
  .row.centred { font-weight: 500; }
</style>
