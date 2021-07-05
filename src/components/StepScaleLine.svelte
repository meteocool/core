<script>
  export let steps;

  import cssVars from 'svelte-css-vars';

  export let valueFormat;

  $ : ncol = Object.values(steps).length;
  $ : palette = Object.values(steps).map((color, index) => `#${color} ${Math.round(index * (100/ncol))}% ${Math.round((index+1)*(100/ncol))}%`).join(",");
  $ : vs = Object.keys(steps).map((c) => (valueFormat ? valueFormat(c) : c)).filter((e) => e !== "");
  $ : console.log(palette);

  $: scaleStyle = {
    backgroundImage: `linear-gradient(to right, ${palette})`,
  };
</script>

<style>
  .scale-divider {
      float: left;
  }

  .scale-divider {
    padding-top: 1.2em;
    text-shadow:
            0 0 6px #636363B0,
                -1px -1px 6px #636363B0,
            -1px 1px 6px #636363B0,
            1px 1px 6px #636363B0,
                1px -1px 6px #636363B0;
    font-size: 74%;
    color: var(--sl-color-primary-100);
  }

  .scale-line {
    width: 100%;
    border-radius: var(--sl-border-radius-pill);
    border: 1px solid grey;
    background-image: var(--backgroundImage);
    height: calc(var(--sl-input-height-medium) * 0.25);
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  .scale {
    width: 100%;
    height: var(--sl-input-height-medium);
    float: left;
    margin-right: 2em;
    padding-bottom: 0;
    margin-top: 0.1em;
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

