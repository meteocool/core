<script>
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import Icon from "fa-svelte";

let lightRed = true;

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
      font-size: 115%;
      letter-spacing: 1px;
  }
</style>

<div class="live-wrapper">
<sl-tag type="danger" class="live" size="small" pill>
    <div class="circle-container circle-container-light-red" use:blink>
        <Icon icon={faCircle} />
    </div>
    <span class="label">LIVE</span>
</sl-tag>
</div>
