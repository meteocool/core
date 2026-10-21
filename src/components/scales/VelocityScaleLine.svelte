<script lang="ts">
  /**
   * The legend for a radar's radial velocity: toward the radar green, away
   * red, across the sweep's own Nyquist velocity, which is as fast a wind as
   * that tilt measures at all. Ticks every 5 m/s; a sweep folding at 8 m/s
   * gets a short scale, which is the point: it says how little that tilt can
   * tell apart before it folds.
   */
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import { velocityTable } from "../../colormaps";
  import { velocityByte } from "../../lib/sweep";

  /** The sweep's Nyquist velocity in m/s, or null when unknown. */
  export let nyquist: number | null = null;
  /** Storm-relative: the same colours, the storm's motion taken out. */
  export let relative = false;

  const FALLBACK_M_S = 30;
  const STEPS = 40;

  $: span = Math.min(60, Math.max(5, nyquist ?? FALLBACK_M_S));
  $: palette = Array.from({ length: STEPS + 1 }, (_value, i) => {
    const v = -span + (2 * span * i) / STEPS;
    const [r, g, b] = velocityTable()[velocityByte(v)];
    return `${v.toFixed(1)}:${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }).join(";");
  $: ticks = Array.from({ length: Math.floor(span / 5) * 2 + 1 }, (_value, i) => (i - Math.floor(span / 5)) * 5)
    .map((v) => ({ at: (v + span) / (2 * span), html: `${v > 0 ? "+" : ""}${v}` }));
</script>

<ScaleLine class="scale" {palette} {ticks}
  title={relative ? $_("site.legend.srv") : $_("site.legend.velocity")}
  hint={$_("site.legend.hint")} />
