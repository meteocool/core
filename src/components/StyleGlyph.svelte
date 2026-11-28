<script lang="ts">
/**
 * One storm drawn in a style (lib/cloudStyle.ts), in a 32x24 box: the
 * picture that names the style wherever one is picked, the map's pill
 * (StylePicker) and Studio's panel. In the palette the storms are painted
 * in, so it is the style as the map shows it.
 */
import { radarColormap } from "../stores";
import { dbzColour } from "../lib/cellVolume";
import type { CloudStyle } from "../lib/cloudStyle";

export let style: CloudStyle;
/** Drawn smaller, as on the map's pill. */
export let small = false;

/* A storm as three nested levels, envelope to core, as the guide draws one. */
/* The dots of `points`: where each is, and which of the three levels it is in. */
const DOTS: Array<[number, number, 0 | 1 | 2]> = [
  [4, 13, 0], [7.5, 8, 0], [8, 17.5, 0], [12.5, 4.5, 0], [14, 20.5, 0], [19, 4, 0], [20.5, 20, 0],
  [24.5, 7, 0], [25.5, 16.5, 0], [28.5, 11.5, 0],
  [9.5, 12.5, 1], [12.5, 16.5, 1], [13, 8.5, 1], [18.5, 16.5, 1], [19.5, 8.5, 1], [22.5, 12.5, 1],
  [14, 12.5, 2], [17.8, 12.2, 2],
];

$: levels = [30, 45, 58].map((dbz) => `rgb(${dbzColour(dbz, $radarColormap).join(", ")})`);
</script>

<!-- Soft and shaded, blurred light, hard-edged shells, a scatter of dots, or a white cumulus, plain or tinted on top. -->
<svg class="picture" class:small viewBox="0 0 32 24" aria-hidden="true">
  {#if style === "cloud"}
    <ellipse cx="16" cy="13" rx="13" ry="9" fill={levels[0]} opacity="0.55" />
    <ellipse cx="15" cy="12" rx="8" ry="6" fill={levels[1]} opacity="0.8" />
    <ellipse cx="14.5" cy="11" rx="3.8" ry="3.2" fill={levels[2]} />
  {:else if style === "glow"}
    <g class="lit">
      <ellipse cx="16" cy="12.5" rx="11" ry="7.5" fill={levels[0]} />
      <ellipse cx="15.5" cy="12" rx="6.5" ry="4.8" fill={levels[1]} />
      <ellipse cx="15" cy="11.5" rx="3" ry="2.6" fill="#fff" />
    </g>
  {:else if style === "shells"}
    <g class="hard">
      <ellipse cx="16" cy="12.5" rx="13" ry="9" fill={levels[0]} />
      <ellipse cx="15.5" cy="12.5" rx="8.5" ry="6" fill={levels[1]} />
      <ellipse cx="15" cy="12.5" rx="4" ry="3" fill={levels[2]} />
    </g>
  {:else if style === "points"}
    <!-- A scatter of dots, small and faint outside, large and close at the core. -->
    {#each DOTS as [x, y, level] (`${x} ${y}`)}
      <circle cx={x} cy={y} r={[1, 1.5, 2.1][level]} fill={levels[level]} opacity={[0.7, 0.9, 1][level]} />
    {/each}
  {:else}
    <!-- A cumulus: grey where it is in its own shadow, white where the sun is. -->
    <g class="sky">
      <ellipse cx="16" cy="17" rx="13" ry="4.6" fill="#9aa4b0" />
      <circle cx="9.5" cy="14" r="5.2" fill="#e9edf2" />
      <circle cx="22.5" cy="14.5" r="5" fill="#dfe4ea" />
      <circle cx="15.5" cy="10.5" r="7" fill="#fff" />
      {#if style === "tinted"}
        <circle cx="15.5" cy="10.5" r="7" fill={levels[2]} opacity="0.45" />
        <circle cx="22.5" cy="14.5" r="5" fill={levels[1]} opacity="0.35" />
      {/if}
    </g>
  {/if}
</svg>

<style>
  .picture {
    flex: none;
    width: 32px;
    height: 24px;
    overflow: visible;
  }
  .picture.small {
    width: 24px;
    height: 18px;
  }
  .lit {
    filter: blur(1.6px) saturate(1.3);
  }
  .hard ellipse {
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 0.9;
  }
  .sky {
    filter: drop-shadow(0 0.5px 0.6px rgba(0, 0, 0, 0.35));
  }
</style>
