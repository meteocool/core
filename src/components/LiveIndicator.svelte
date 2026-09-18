<script lang="ts">
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import Icon from "./Icon.svelte";
import { _ } from "svelte-i18n";
import { lastFocus, live } from "../stores";

let lightRed = true;
let livePill: HTMLElement | null = null;

function blink(elem) {
  setTimeout(() => {
    if (lightRed) {
      elem.classList.add("circle-container-light-red");
      lightRed = false;
    } else {
      elem.classList.remove("circle-container-light-red");
      lightRed = true;
    }
    blink(elem);
  }, 1000);
}

let future: ReturnType<typeof setTimeout> | null = null;
function deferredFadeOut() {
  if (future) clearTimeout(future);
  future = setTimeout(() => {
    const steps = 20;
    const fade = (n) => {
      const index = (n / steps) * 0.5;
      if (livePill) livePill.style.opacity = String(0.5 + index);
      if (n > 0) {
        future = setTimeout(() => {
          fade(n - 1);
        }, 500 / steps);
      }
    };
    fade(steps);
  }, 3000);
}

function init(elem) {
  livePill = elem;
}

function hide() {
  if (livePill) livePill.style.display = "none";
  if (future) clearTimeout(future);
  future = null;
}

function show() {
  if (livePill) livePill.style.display = "flex";
  deferredFadeOut();
}

lastFocus.subscribe(() => {
  hide();
});

live.subscribe((value) => {
  if (value) { show(); } else { hide(); }
});
</script>

<style>
  .live-wrapper {
    position: absolute;
    z-index: var(--mc-z-pill);
    /* Purely informational, and it sits over the map: a drag that starts on
       the pill should pan the map, not do nothing. */
    pointer-events: none;
    top: var(--mc-top-stack);
    left: 0;
    width: 100%;
    display: flex;          /* show() writes display:flex; keep it a flex container */
    justify-content: center;
    touch-action: none;
  }

  .live {
    padding-top: 0;
  }

  /* Neutral glass capsule with a red dot: the red-50 tag fill stayed pink in
     dark mode. sl-tag parts: base content remove-button */
  :global(.live::part(base)) {
    height: var(--mc-pill-h);
    padding: 0 12px 0 10px;
    gap: 6px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    letter-spacing: 0.01em;
  }

  .circle-container {
    padding: 0;
    margin: 0;
    float: none;
    display: inline-flex;
    font-size: 8px;
    color: var(--mc-red);
    transition: color 300ms ease;   /* colour only: no layout, no backdrop re-read */
  }

  /* toggled every second by use:blink -- name and !important must survive */
  .circle-container-light-red {
    color: var(--mc-red-dim) !important;
  }

  .label {
    font-size: 12px;
    letter-spacing: 0;
  }

  @media only screen and (max-width: 620px) {
    .circle-container {
      font-size: 7px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .circle-container {
      transition: none;
    }
    .circle-container-light-red {
      color: var(--mc-red) !important;
    }
  }
</style>

<div class="live-wrapper" use:init>
<sl-tag variant="danger" class="live" size="small" pill>
    <div class="circle-container circle-container-light-red" use:blink>
        <Icon icon={faCircle} />
    </div>
    <span class="label">{$_("latest")}</span>
</sl-tag>
</div>
