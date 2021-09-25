<script>
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import Icon from "fa-svelte";
import { _ } from "svelte-i18n";
import { lastFocus, live } from "../stores";

let lightRed = true;
let livePill = null;

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

let future = 0;
function deferredFadeOut() {
  if (future > 0) clearTimeout(future);
  future = setTimeout(() => {
    const steps = 20;
    const fade = (n) => {
      const index = (n / steps) * 0.5;
      if (livePill) livePill.style.opacity = 0.5 + index;
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
  if (future > 0) clearTimeout(future);
  future = 0;
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
      z-index: 9999;
      top: calc(env(safe-area-inset-top) + 0.4em);
      left: 0;
      width: 100%;
      display: flex;
      justify-content: center;
      touch-action: none;
  }

  .live {
      padding-top: 2px;
  }

  .circle-container {
      padding-top: 1px;
      padding-right: 5px;
      float: left;
      font-size: 8px;
      color: var(--sl-color-danger-800);
  }

  .circle-container-light-red {
      color: var(--sl-color-danger-600) !important;
  }

  .label {
      font-size: 110%;
      letter-spacing: 0px;
  }
</style>

<div class="live-wrapper" use:init>
<sl-tag type="danger" class="live" size="small" pill>
    <div class="circle-container circle-container-light-red" use:blink>
        <Icon icon={faCircle} />
    </div>
    <span class="label">{$_("latest")}</span>
</sl-tag>
</div>
