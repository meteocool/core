<script lang="ts">
  /**
   * The legend for a radar's radial velocity: toward the radar green, away
   * red, across the sweep's own Nyquist velocity, which is as fast a wind as
   * that tilt measures at all. Ticks every 5 m/s, or every 10 or 20 where the
   * strip has no room for that (a phone's); a sweep folding at 8 m/s gets a
   * short scale, which is the point: it says how little that tilt can tell
   * apart before it folds.
   */
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import { velocityTable } from "../../colormaps";
  import { velocityByte } from "../../lib/sweep";
  import { velocityTicks } from "../../lib/siteSweeps";

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
  let stripWidth = 0;
  /** Room the last tick needs with its unit, from the one before it. */
  const UNIT_ROOM_PX = 60;
  /* The unit on the last tick: a phone has no room for the title, which
     carries it on a wider screen, and a bare +30 says nothing. Longer for
     it, so the tick before it gives way where the two would touch. */
  $: ticks = velocityTicks(span, stripWidth)
    .filter((_tick, i, all) => !(i === all.length - 2 && all.length > 2
      && (all[i + 1].at - all[i].at) * stripWidth < UNIT_ROOM_PX))
    .map(({ value, at }, i, all) => ({
      at,
      html: `${value > 0 ? "+" : ""}${value}${i === all.length - 1 ? " m/s" : ""}`,
    }));
</script>

<ScaleLine class="scale" {palette} {ticks} bind:stripWidth
  title={relative ? $_("site.legend.srv") : $_("site.legend.velocity")}
  hint={$_("site.legend.hint")} />
