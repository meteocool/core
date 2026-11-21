/**
 * The curtain: the whole screen faded to black and back, as a simulator
 * goes from one of its scenes to the next (the flight's page, its plan, its
 * loading, the flight, and back). Whoever changes the scene lowers it; the
 * scene that comes up lifts it once it has drawn, or the change made
 * through it (`throughBlack`) does. A curtain nobody lifts goes up by itself
 * after a while, so a scene that never came leaves the page usable.
 *
 * Tiny and with nothing of the flight in it: the 3D map's Fly lowers it
 * before the flight's code has loaded.
 */

/** How long the screen takes to go black, and to come back, ms. */
const DOWN_MS = 320;
const UP_MS = 480;
/** A curtain still down after this long goes up by itself, ms. */
const LONGEST_MS = 8000;

let element: HTMLDivElement | null = null;
let down = false;
let lowering: Promise<void> | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
let liftTimer: ReturnType<typeof setTimeout> | null = null;
/** Counts the lowerings: a lift asked for before the latest one is not for it. */
let generation = 0;

function curtain(): HTMLDivElement {
  if (element?.isConnected) return element;
  element = document.createElement("div");
  element.className = "mc-curtain";
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "fixed", inset: "0", zIndex: "2147483000", background: "#000",
    opacity: "0", pointerEvents: "none", transition: "opacity 0ms linear",
  });
  // Beside the body, not in it: the body is turned on its side in the apps (lib/sideways.ts).
  document.documentElement.appendChild(element);
  return element;
}

/** Whether the screen is black, or going there. */
export function curtainDown(): boolean {
  return down;
}

/** To black; resolves once the screen is. Lowered already, at once. */
export function lower(ms = DOWN_MS): Promise<void> {
  if (liftTimer !== null) {
    clearTimeout(liftTimer);
    liftTimer = null;
  }
  if (safety !== null) clearTimeout(safety);
  safety = setTimeout(() => lift(), LONGEST_MS);
  generation += 1;
  if (down && lowering) return lowering;
  down = true;
  const black = curtain();
  // Input stops here while the scene changes under it.
  black.style.pointerEvents = "auto";
  black.style.transition = `opacity ${ms}ms ease-in`;
  // Read back so the change from where it is now is a transition, not a jump.
  void black.offsetWidth;
  black.style.opacity = "1";
  lowering = new Promise((resolve) => setTimeout(resolve, ms + 20));
  return lowering;
}

/** Back from black, once the scene under it has had a frame or two to draw; nothing if it is up. */
export function lift(ms = UP_MS): void {
  if (!down) return;
  if (safety !== null) clearTimeout(safety);
  safety = null;
  const asked = generation;
  const up = () => {
    if (!down || asked !== generation) return;
    // The curtain still on its way down finishes first.
    void (lowering ?? Promise.resolve()).then(() => {
      if (!down || liftTimer !== null || asked !== generation) return;
      down = false;
      lowering = null;
      const black = curtain();
      black.style.transition = `opacity ${ms}ms ease-out`;
      black.style.opacity = "0";
      black.style.pointerEvents = "none";
    });
  };
  // Two frames, so what is under it has drawn; a timer too, for a page whose frames are held back.
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    up();
  };
  requestAnimationFrame(() => requestAnimationFrame(once));
  setTimeout(once, 250);
}

/**
 * A change of scene through black: down, the change made, held for `hold`
 * ms more while the new scene settles, and up again, whatever the change did.
 */
export async function throughBlack(change: () => unknown, hold = 0): Promise<void> {
  await lower();
  try {
    await change();
  } finally {
    if (hold > 0) {
      liftTimer = setTimeout(() => {
        liftTimer = null;
        lift();
      }, hold);
    } else {
      lift();
    }
  }
}
