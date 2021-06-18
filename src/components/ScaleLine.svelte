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
    text-shadow:
            0 0 6px #636363B0,
            -1px -1px 6px #636363B0,
            -1px 1px 6px #636363B0,
            1px 1px 6px #636363B0,
            1px -1px 6px #636363B0;
    padding-left: 5%;
    padding-right: 5%;
  }

  .scale-line {
    width: 100%;
    border-radius: var(--sl-border-radius-pill);
    border: 1px solid grey;
    background-image: var(--backgroundImage), var(--backgroundUrl);
    height: calc(var(--sl-input-height-medium) * 0.8);
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  .scale {
    width: 100%;
    height: 31px;
    float: left;
    margin-right: 2em;
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
