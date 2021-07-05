<script>
  import cssVars from 'svelte-css-vars';
  import mapBg from "../../public/assets/map-bg.png";

  export let palette;
  export let valueFormat;

  function colorMap() {
    if (!palette) {
      return "#ffffff";
    }
    return palette.split(";").map((c) => c.split(":"));
  }

  $ : vs = colorMap().map((c) => (valueFormat ? valueFormat(c[0]) : c[0])).filter((e) => e !== "");
  $ : colors = colorMap().map((c) => `#${c[1]}`);

  $: scaleStyle = {
    backgroundImage: `linear-gradient(to right, ${colors.join(",")})`,
    backgroundUrl: `url(${mapBg})`,
  };
</script>

<style lang="less">
  .scale-dividers {
    display: flex;
    justify-content: space-between;
    padding-top: 0.3em;
    padding-left: 5%;
    padding-right: 5%;
    font-size: 92%;
    position: relative;
    top: 0.5em;
    color: var(--sl-color-primary-100);
  }

  .scale-line {
    width: 100%;
    border-radius: var(--sl-border-radius-pill);
    border: 0.5px solid var(--sl-color-info-200);
    background-image: var(--backgroundImage), var(--backgroundUrl);
    height: 25%;
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  @media only screen and (max-width: 990px) {
    .scale-dividers {
      font-size: 60%;
      top: 1.1em;
    }
    .scale-line {
      height: 20%;
    }
  }

  .scale {
    width: 100%;
    float: left;
    margin-right: 2em;
    height: var(--sl-input-height-medium);
  }
</style>

<div class="scale">
    <div class="scale-line" use:cssVars="{scaleStyle}">
        <div class="scale-dividers">
            {#each vs as value}
                <div class="scale-divider">
                    {@html value }
                </div>
            {/each}
        </div>
    </div>
</div>
