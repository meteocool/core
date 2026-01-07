<script>
  // CSS vars are now handled natively by Svelte
  const mapBgWebp = '/assets/map-bg.webp'
  const mapBgPng = '/assets/map-bg.png'
  // Function to get optimized background image with WebP fallback
  function getBackgroundUrl() {
    // Check if WebP is supported
    if (typeof window !== 'undefined') {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx && canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0) {
        return `url(${mapBgWebp})`
      }
    }
    return `url(${mapBgPng})`
  }

  let { palette, valueFormat, prettyName, title = '' } = $props()

  function colorMap() {
    if (!palette) {
      return '#ffffff'
    }
    return palette.split(';').map((c) => c.split(':'))
  }

  function capitalizeFirst(string) {
    return string.charAt(0).toUpperCase() + string.slice(1)
  }

  let vs = $derived(
    colorMap()
      .map((c, index) => (valueFormat ? valueFormat(c[0], index) : c[0]))
      .filter((e) => e !== '' && e !== undefined && e !== null),
  )
  // if (dd.isApp()) {
  //   $ : vs = vs.filter((element, index) => index % 2 === 0);
  // }

  let minDbz = $derived(colorMap(palette)[0][0])
  let maxDbz = $derived(colorMap(palette).pop()[0])
  let colors = $derived(colorMap().map((c) => `#${c[1]}`))

  let scaleStyle = $derived({
    backgroundImage: `linear-gradient(to right, ${colors.join(',')})`,
    backgroundUrl: getBackgroundUrl(),
  })
</script>

<div class="wrapper">
  <div class="legend-label">{@html title}</div>
  <div class="scale" title="Colormap: {capitalizeFirst(prettyName)} ({minDbz || 'N/A'} - {maxDbz || 'N/A'} dBZ)">
    <div class="scale-line" style="--backgroundImage: {scaleStyle.backgroundImage}; --backgroundUrl: {scaleStyle.backgroundUrl}">
      <div class="scale-dividers">
        {#each vs as value}
          <div class="scale-divider">
            {@html value}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
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
    border: none;
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
    /*margin-right: 2em;*/
    margin-bottom: 2px;
    height: var(--sl-input-height-medium);
    flex: 1;
  }

  .legend-label {
    height: 100%;
    color: var(--sl-color-gray-600);
    line-height: 1.21;
    font-size: 80%;
    text-align: right;
    word-break: break-word;
  }
  .scale {
    flex: 1;
  }
  .wrapper {
    display: flex;
    gap: 0.75em;
    justify-content: space-around;
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

  @media only screen and (max-width: 620px) {
    .legend-label {
      display: none;
    }
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
    --svg-dark-to-light: '';
  }
</style>
