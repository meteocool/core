<script>
  import cssVars from "svelte-css-vars";
  import mapBg from "../../../public/assets/map-bg.png";

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
    color: var(--sl-color-black);
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
    margin-top: 1px;
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
    margin-bottom: 2px;
    height: var(--sl-input-height-medium);
  }


  :global(.legendLabel) {
    font-size: 80%;
    padding-left: 0.15em;
    color: var(--sl-color-black);
    /*text-shadow: 0 0 1px rgba(0,0,0,0.6),
            -1px -1px 1px rgba(0,0,0,0.6),
            -1px 1px 1px  rgba(0,0,0,0.6),
            1px 1px 1px   rgba(0,0,0,0.6),
            1px -1px 1px  rgba(0,0,0,0.6);*/
  }
  @media only screen and (max-width: 990px) {
    :global(.legendLabel) {
      display: none;
    }
    :global(.legend-icon) {
      height: 1.4em !important;
    }
  }

  :global(.legend-icon) {
    filter: var(--svg-dark-to-light);
    height: 1em;
    vertical-align: bottom;
    /*filter: drop-shadow(0px 0px 1px #000000) drop-shadow(0px 0px 1px #000000);*/
  }

  :root {
    --svg-dark-to-light: "";
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
