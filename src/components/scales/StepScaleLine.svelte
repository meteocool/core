<script lang="ts">
  /** Label to hex-colour, in the order they are drawn. */
  export let steps: Record<string, string>;
  export let title = "";
  export let valueFormat: ((value: string) => string) | null = null;

  $: ncol = Object.values(steps).length;
  $: palette = Object.values(steps).map((color, index) => `#${color} ${Math.round(index * (100 / ncol))}% ${Math.round((index + 1) * (100 / ncol))}%`).join(",");
  $: vs = Object.keys(steps).map((c) => (valueFormat ? valueFormat(c) : c)).filter((e) => e !== "");

  $: backgroundImage = `linear-gradient(to right, ${palette})`;
</script>

<style>
  /* Same strip and label recipe as ScaleLine, so the two legends match in weight. */
  .wrapper {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-around;
  }

  .legend-label {
    height: auto;
    color: var(--mc-text-2);
    font: 600 10px/1.2 var(--mc-font);
    text-align: right;
    word-break: break-word;
  }

  .scale {
    width: 100%;
    flex: 1;
    float: none;
    margin-right: 0;
    padding-bottom: 0;
    height: calc(var(--sl-input-height-medium) * 0.8);
  }

  .scale-line {
    width: 100%;
    height: 10px;
    margin-top: 2px;
    border-radius: var(--mc-radius-pill);
    border: 1px solid var(--mc-hairline);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
    background-image: var(--backgroundImage);
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  .scale-divider {
    float: left;
    padding-top: 14px;
    color: var(--mc-text);
    font: 600 10px/1 var(--mc-font);
    text-align: center;
  }

  @media only screen and (max-width: 990px) {
    .scale-divider {
      font-size: 10px;
    }
    .scale {
      height: calc(var(--sl-input-height-medium) * 1.2);
      padding-bottom: 0.25em;
    }
  }

  @media only screen and (max-width: 620px) {
    .legend-label {
      display: none;
    }
  }
</style>

<div class="wrapper">
    <div class="legend-label">{@html title}</div>
    <div class="scale">
        <div class="scale-line" style:--backgroundImage={backgroundImage}>
            <div class="scale-dividers">
                {#each vs as value, i (i)}
                    <div class="scale-divider" style="width: {100/ncol}%;">
                        {@html value }
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>
