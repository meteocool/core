<script lang="ts">
  import mapBg from "../../assets/map-bg.png";

  export let palette: string;
  export let valueFormat: ((value: string, index: number) => string) | null = null;
  export let prettyName: string;
  export let title = "";

  let className = "";
  export { className as class };

  /**
   * The palette as [value, hexColour] pairs.
   *
   * Takes the palette as an argument rather than closing over the prop, so the
   * reactive statements below actually depend on it -- otherwise a palette
   * change leaves the scale line showing the previous colours.
   */
  function colorMap(source: string): string[][] {
    if (!source) return [];
    return source.split(";").map((c) => c.split(":"));
  }

  function capitalizeFirst(string: string) {
    return string.charAt(0)
      .toUpperCase() + string.slice(1);
  }

  $: vs = colorMap(palette)
    .map((c, index) => (valueFormat ? valueFormat(c[0], index) : c[0]))
    .filter((e) => e !== "");
  // if (dd.isApp()) {
  //   $ : vs = vs.filter((element, index) => index % 2 === 0);
  // }

  $: [minDbz] = colorMap(palette)[0] ?? [""];
  $: [maxDbz] = colorMap(palette).pop() ?? [""];
  $: colors = colorMap(palette)
    .map((c) => `#${c[1]}`);

  $: backgroundImage = `linear-gradient(to right, ${colors.join(",")})`;
  const backgroundUrl = `url(${mapBg})`;
</script>

<style>
  /* A legend inside the glass tray: the colour strip is the one place
     saturated colour is allowed in the chrome. No material of its own. */
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
    margin-bottom: 0;
    height: var(--sl-input-height-medium);
  }

  .scale-line {
    width: 100%;
    height: 10px;
    margin-top: 2px;
    border-radius: var(--mc-radius-pill);
    border: 1px solid var(--mc-hairline);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
    background-image: var(--backgroundImage), var(--backgroundUrl);
    background-repeat: repeat;
    background-size: contain;
    background-position: left;
  }

  .scale-dividers {
    display: flex;
    justify-content: space-between;
    position: relative;
    top: 12px;
    padding: 0 5%;
    color: var(--mc-text);
    font: 600 11px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }

  :global(.legendLabel) {
    padding-left: 0.15em;
    color: var(--mc-text);
    font-size: 10px;
    font-weight: 600;
  }

  :global(.legend-icon) {
    filter: var(--svg-dark-to-light);
    height: 1em;
    vertical-align: bottom;
  }

  @media only screen and (max-width: 990px) {
    .scale-dividers {
      font-size: 10px;
      top: 11px;
    }
    .scale-line {
      height: 8px;
    }
    :global(.legendLabel) {
      display: none;
    }
    :global(.legend-icon) {
      height: 1.4em !important;
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
    <div class="scale" title="Colormap: {capitalizeFirst(prettyName)} ({minDbz} - {maxDbz} dBZ)">
        <div class="scale-line" style:--backgroundImage={backgroundImage} style:--backgroundUrl={backgroundUrl}>
            <div class="scale-dividers">
                {#each vs as value, i (i)}
                    <div class="scale-divider">
                        {@html value}
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>

