<script lang="ts" module>
/**
 * A country's flag, drawn flat and small: stripes and crosses only, for the
 * radar networks' countries (lib/radarSites.ts). Emoji flags are pictures of
 * cloth in each system's own style, and on Windows only two letters.
 * Coats of arms are left out: at this size they are a smudge.
 */
type Shape =
  | { stripes: "h" | "v"; colours: string[] }
  | { cross: string; field: string; inner?: string }
  | { swiss: true }
  | { czech: true };

const FLAGS: Record<string, Shape> = {
  be: { stripes: "v", colours: ["#000000", "#fdda24", "#ef3340"] },
  ch: { swiss: true },
  cz: { czech: true },
  de: { stripes: "h", colours: ["#000000", "#dd0000", "#ffce00"] },
  dk: { cross: "#ffffff", field: "#c8102e" },
  ee: { stripes: "h", colours: ["#0072ce", "#000000", "#ffffff"] },
  fi: { cross: "#002f6c", field: "#ffffff" },
  fr: { stripes: "v", colours: ["#0055a4", "#ffffff", "#ef4135"] },
  hr: { stripes: "h", colours: ["#ff0000", "#ffffff", "#171796"] },
  ie: { stripes: "v", colours: ["#169b62", "#ffffff", "#ff883e"] },
  lt: { stripes: "h", colours: ["#fdb913", "#006a44", "#c1272d"] },
  nl: { stripes: "h", colours: ["#ae1c28", "#ffffff", "#21468b"] },
  no: { cross: "#ffffff", field: "#ba0c2f", inner: "#00205b" },
  pl: { stripes: "h", colours: ["#ffffff", "#dc143c"] },
  se: { cross: "#fecc02", field: "#006aa7" },
  sk: { stripes: "h", colours: ["#ffffff", "#0b4ea2", "#ee1c25"] },
};
</script>

<script lang="ts">
/** ISO 3166 alpha-2, lower case. */
export let country: string;
/** What a screen reader calls it; none leaves it to the text beside it. */
export let label: string | null = null;

const W = 24;
const H = 16;

$: shape = FLAGS[country];
</script>

{#if shape}
  <svg class="flag" viewBox="0 0 {W} {H}" role={label ? "img" : undefined} aria-label={label ?? undefined}
    aria-hidden={label ? undefined : "true"}>
    {#if "stripes" in shape}
      {#each shape.colours as colour, i (i)}
        {#if shape.stripes === "h"}
          <rect x="0" y={(i * H) / shape.colours.length} width={W} height={H / shape.colours.length + 0.1} fill={colour} />
        {:else}
          <rect x={(i * W) / shape.colours.length} y="0" width={W / shape.colours.length + 0.1} height={H} fill={colour} />
        {/if}
      {/each}
    {:else if "cross" in shape}
      <!-- The Nordic cross: its upright set towards the hoist. -->
      <rect width={W} height={H} fill={shape.field} />
      <rect x="6.5" y="0" width="4" height={H} fill={shape.cross} />
      <rect x="0" y="6" width={W} height="4" fill={shape.cross} />
      {#if shape.inner}
        <rect x="7.5" y="0" width="2" height={H} fill={shape.inner} />
        <rect x="0" y="7" width={W} height="2" fill={shape.inner} />
      {/if}
    {:else if "swiss" in shape}
      <rect width={W} height={H} fill="#da291c" />
      <rect x="10.5" y="3.5" width="3" height="9" fill="#ffffff" />
      <rect x="7.5" y="6.5" width="9" height="3" fill="#ffffff" />
    {:else}
      <rect width={W} height={H / 2} fill="#ffffff" />
      <rect y={H / 2} width={W} height={H / 2} fill="#d7141a" />
      <path d="M0 0 12 8 0 16Z" fill="#11457e" />
    {/if}
    <!-- An edge, so a white stripe does not run into a white panel. -->
    <rect x="0.25" y="0.25" width={W - 0.5} height={H - 0.5} rx="1.5" fill="none" class="edge" />
  </svg>
{/if}

<style>
  .flag {
    width: 18px;
    height: 12px;
    flex: none;
    border-radius: 2px;
    overflow: hidden;
    vertical-align: -1px;
  }
  .edge {
    stroke: rgba(0, 0, 0, 0.18);
    stroke-width: 0.5;
  }
</style>
