<script>
  export let steps;

  import cssVars from 'svelte-css-vars';

  export let valueFormat;

  $ : ncol = Object.values(steps).length;
  $ : palette = Object.values(steps).map((color, index) => `#${color} ${Math.round(index * (100/ncol))}% ${Math.round((index+1)*(100/ncol))}%`).join(",");
  $ : vs = Object.keys(steps).map((c) => (valueFormat ? valueFormat(c) : c)).filter((e) => e !== "");

  $: scaleStyle = {
    backgroundImage: `linear-gradient(to right, ${palette})`,
  };
</script>

<style>
  .scale-divider {
    float: left;
    padding-top: 1.05em;
    font-size: 76%;
    color: var(--sl-color-black);
    line-height: 80%;
  }

  /* XXX share styles with scaleline */
  .scale-line {
    width: 100%;
    border-radius: var(--sl-border-radius-pill);
    border: 0.5px solid var(--sl-color-info-200);
    background-image: var(--backgroundImage);
    height: 16%;
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  .scale {
    width: 100%;
    height: calc(var(--sl-input-height-medium) * 0.8);
    float: left;
    margin-right: 2em;
    padding-bottom: 0;
  }

  @media only screen and (max-width: 990px) {
      .scale-divider {
          font-size: 74%;
      }
      .scale {
          height: calc(var(--sl-input-height-medium) * 1.2);
          padding-bottom: 0.25em;
      }
  }
</style>

<div class="scale">
    <div class="scale-line" use:cssVars="{scaleStyle}">
        <div class="scale-dividers">
            {#each vs as value}
                <div class="scale-divider" style="width: {100/ncol}%;">
                    {@html value }
                </div>
            {/each}
        </div>
    </div>
</div>

