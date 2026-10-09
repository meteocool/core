<script lang="ts">
  import mapBg from "../../assets/map-bg.webp";

  export let palette: string;
  export let valueFormat: ((value: string, index: number) => string) | null = null;
  export let title = "";
  /** Keep the title on a phone, where it is otherwise dropped for the strip's room. */
  export let titleOnPhone = false;
  /**
   * Labels placed where they fall on the strip, 0 to 1, in place of
   * `valueFormat`'s, which are spread evenly across it.
   */
  export let ticks: { at: number; html: string }[] | null = null;
  /** What hovering the strip says. */
  export let hint = "";
  /** What clicking the strip does, if anything: it is a button then, named by `toggleLabel`. */
  export let onToggle: (() => void) | null = null;
  export let toggleLabel = "";

  let className = "";
  export { className as class };

  /**
   * The palette as [value, hexColour] pairs.
   *
   * Takes the palette as an argument instead of closing over the prop, so the
   * reactive statements below depend on it. Otherwise a palette change leaves
   * the scale line showing the previous colours.
   */
  function colorMap(source: string): string[][] {
    if (!source) return [];
    return source.split(";").map((c) => c.split(":"));
  }

  $: vs = colorMap(palette)
    .map((c, index) => (valueFormat ? valueFormat(c[0], index) : c[0]))
    .filter((e) => e !== "");
  // if (dd.isApp()) {
  //   $ : vs = vs.filter((element, index) => index % 2 === 0);
  // }

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

  /* As tall as the ink, not a form control.
     .scale-dividers is shifted out of flow inside the 10px .scale-line, so this
     box has to state the height the two of them actually occupy: 2px of margin
     above the strip, the strip, and the dividers' 12px offset plus their line.
     At the Shoelace input height of 40px, with the ink in the top 26,
     align-items:center in .wrapper would centre the title on 14px of empty
     space below the strip, and the row would overflow the tray it sits in. */
  .scale {
    width: 100%;
    flex: 1;
    float: none;
    margin-bottom: 0;
    height: 28px;
  }

  /* The strip as a button: no chrome of its own, a pointer, and a ring for
     the keyboard. A flex column, because a button centres its content in its
     height, which would put the strip and its labels lower than the div's. */
  .scale.toggle {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .scale.toggle:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; border-radius: 4px; }

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

  /* dBZ, each value under its own colour: centred on it, but kept inside
     the strip at either end. */
  .scale-ticks {
    position: relative;
    top: 12px;
    height: 11px;
    color: var(--mc-text);
    font: 600 11px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  .scale-tick {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .scale-tick.first { transform: translateX(-25%); }
  .scale-tick.last { transform: translateX(-100%); }

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
    .scale-dividers, .scale-ticks {
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
    .legend-label:not(.keep) {
      display: none;
    }
  }
</style>

<div class="wrapper">
    {#if title || $$slots.title}
        <div class="legend-label" class:keep={titleOnPhone}><slot name="title">{@html title}</slot></div>
    {/if}
    <svelte:element
        this={onToggle ? "button" : "div"}
        type={onToggle ? "button" : undefined}
        class="scale"
        class:toggle={Boolean(onToggle)}
        title={hint || undefined}
        aria-label={onToggle ? toggleLabel : undefined}
        role={onToggle ? undefined : "presentation"}
        on:click={() => onToggle?.()}>
        <div class="scale-line" style:--backgroundImage={backgroundImage} style:--backgroundUrl={backgroundUrl}>
            {#if ticks}
                <div class="scale-ticks">
                    {#each ticks as tick, i (i)}
                        <span class="scale-tick" class:first={i === 0} class:last={i === ticks.length - 1}
                            style:left={`${tick.at * 100}%`}>{@html tick.html}</span>
                    {/each}
                </div>
            {:else}
                <div class="scale-dividers">
                    {#each vs as value, i (i)}
                        <div class="scale-divider">
                            {@html value}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </svelte:element>
</div>

