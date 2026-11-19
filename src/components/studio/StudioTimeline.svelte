<script lang="ts">
/**
 * Studio's timeline: which scan the storms are from, and the scene.
 *
 * Two rows along the bottom edge. The upper is the time slider: the last two
 * hours of scans, the map's storms being those of the one it stands on. The
 * lower is the scene (lib/studio/scene.ts): its playhead, a mark at each
 * keyframe, and what makes, plays, records and shares one.
 *
 * A keyframe keeps the map as it stands (camera, planes, peel and the scan
 * the upper slider is on) at the second the playhead is on, so a scene is
 * made by going to a second, arranging the map, and keeping it.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faStop } from "@fortawesome/free-solid-svg-icons/faStop";
import { faPlus } from "@fortawesome/free-solid-svg-icons/faPlus";
import { faMinus } from "@fortawesome/free-solid-svg-icons/faMinus";
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import { faRotate } from "@fortawesome/free-solid-svg-icons/faRotate";
import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons/faClockRotateLeft";
import Icon from "../Icon.svelte";
import { cloudsTime } from "../../stores";
import { currentLocale } from "../../locale/t";
import { earlierScans } from "../../lib/cloudHistory";
import { share, shareIcon } from "../../lib/share";
import type { Director } from "../../lib/studio/director";
import { canRecord } from "../../lib/studio/record";
import { DURATION_RANGE, keyframeAt, withDuration } from "../../lib/studio/scene";
import {
  studioAspect, studioLoading, studioPlayhead, studioPlaying, studioRecording, studioScene,
} from "../../lib/studio/store";
import type { Aspect } from "../../lib/studio/store";

export let director: Director;
/** The credits a recording carries, as the map shows them. */
export let credits: () => string;

const ASPECTS: Aspect[] = ["16:9", "1:1", "9:16", "window"];
const recordable = canRecord();
const shareGlyph = shareIcon();

$: ({ shown, loading, progress, newest, missed } = $cloudsTime);
/** Oldest first, the newest last: left to right is forward in time. */
$: scans = newest === null ? [] : [...earlierScans(newest)].reverse().concat(newest);
/** Where the slider stands: on the scan being looked for, else the one on the map. */
$: at = scans.length ? Math.max(0, scans.indexOf(loading ?? shown ?? newest ?? 0)) : 0;
/** While it is being dragged, where the hand has it; the map follows a moment later. */
let dragging: number | null = null;
let settle: ReturnType<typeof setTimeout> | null = null;
$: face = scans[dragging ?? at] ?? null;

$: scene = $studioScene;
$: onKeyframe = keyframeAt(scene, $studioPlayhead) !== null;
$: busy = $studioLoading !== null || $studioRecording !== null;

function clock(scan: number): string {
  return new Date(scan * 1000).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* The scan under the hand is asked for once the hand has rested on it: each
   is a few dozen requests the first time, and a drag crosses many. */
function scrub(event: Event) {
  dragging = Number((event.currentTarget as HTMLInputElement).value);
  if (settle !== null) clearTimeout(settle);
  settle = setTimeout(showDragged, 180);
}
function showDragged() {
  if (settle !== null) clearTimeout(settle);
  settle = null;
  if (dragging === null) return;
  const scan = scans[dragging];
  dragging = null;
  if (scan === undefined) return;
  director.pause();
  void director.showScan(scan === newest ? null : scan);
}
onDestroy(() => {
  if (settle !== null) clearTimeout(settle);
});

function seek(event: Event) {
  director.pause();
  director.seek(Number((event.currentTarget as HTMLInputElement).value));
}

function toggle() {
  if ($studioPlaying || $studioLoading) director.pause();
  else void director.play();
}

function setDuration(event: Event) {
  const seconds = Number((event.currentTarget as HTMLInputElement).value);
  if (!Number.isFinite(seconds)) return;
  const stretch = seconds / scene.duration;
  studioScene.update((current) => withDuration(current, seconds));
  studioPlayhead.update((playhead) => playhead * stretch);
}

function record() {
  if ($studioRecording !== null) director.pause();
  else void director.record(credits());
}

let height = 0;
$: document.documentElement.style.setProperty("--studio-dock-h", `calc(${height}px + var(--mc-gutter))`);
onDestroy(() => document.documentElement.style.removeProperty("--studio-dock-h"));
</script>

<section class="dock glass glass-tray" aria-label={$_("studio.timeline.aria")} bind:offsetHeight={height}>
  <div class="line">
    <span class="name">{$_("studio.timeline.time")}</span>
    <input
      type="range"
      class="scans"
      min="0"
      max={Math.max(0, scans.length - 1)}
      step="1"
      value={dragging ?? at}
      disabled={!scans.length}
      aria-label={$_("time_3d.choose")}
      aria-valuetext={face === null ? "" : clock(face)}
      on:input={scrub}
      on:change={showDragged} />
    <output class="clock" class:past={face !== null && face !== newest}>
      {#if loading !== null}<span class="ring" style:--progress={progress} aria-hidden="true"></span>{/if}
      {face === null ? "–" : face === newest ? `${clock(face)} · ${$_("time_3d.latest")}` : clock(face)}
    </output>
  </div>
  {#if missed}
    <p class="note" role="status">
      {$_(missed.failed ? "time_3d.failed" : "time_3d.nothing", { values: { time: clock(missed.scan) } })}
    </p>
  {/if}

  <div class="line">
    <button type="button" class="disc" on:click={toggle} disabled={!scene.keyframes.length || $studioRecording !== null}
      aria-label={$_($studioPlaying || $studioLoading ? "studio.timeline.pause" : "studio.timeline.play")}
      title={$_($studioPlaying || $studioLoading ? "studio.timeline.pause" : "studio.timeline.play")}>
      <Icon icon={$studioPlaying || $studioLoading ? faPause : faPlay} />
    </button>
    <div class="track">
      <input
        type="range"
        min="0"
        max={scene.duration}
        step="0.01"
        value={$studioPlayhead}
        disabled={busy}
        aria-label={$_("studio.timeline.playhead")}
        aria-valuetext={`${$studioPlayhead.toFixed(1)} s`}
        on:input={seek} />
      <div class="marks" aria-hidden="true">
        {#each scene.keyframes as keyframe (keyframe.at)}
          <i style:left={`${(keyframe.at / scene.duration) * 100}%`}></i>
        {/each}
      </div>
    </div>
    <output class="clock">
      {#if $studioLoading}
        {$_("studio.timeline.loading", { values: { done: $studioLoading.done + 1, of: $studioLoading.of } })}
      {:else}
        {$studioPlayhead.toFixed(1)} / {scene.duration.toFixed(0)} s
      {/if}
    </output>
  </div>

  <div class="line tools">
    <button type="button" class="chip" class:on={onKeyframe} on:click={() => director.addKeyframe()} disabled={busy}
      title={$_("studio.timeline.keyframe_title")}>
      <Icon icon={faPlus} /> {$_(onKeyframe ? "studio.timeline.keyframe_update" : "studio.timeline.keyframe")}
    </button>
    <button type="button" class="chip icon" on:click={() => director.removeKeyframe()} disabled={busy || !onKeyframe}
      aria-label={$_("studio.timeline.keyframe_remove")} title={$_("studio.timeline.keyframe_remove")}>
      <Icon icon={faMinus} />
    </button>
    <span class="gap"></span>
    <button type="button" class="chip" on:click={() => director.makeOrbit()} disabled={busy}
      title={$_("studio.timeline.orbit_title")}>
      <Icon icon={faRotate} /> {$_("studio.timeline.orbit")}
    </button>
    <button type="button" class="chip" on:click={() => director.makeTimelapse()} disabled={busy || newest === null}
      title={$_("studio.timeline.timelapse_title")}>
      <Icon icon={faClockRotateLeft} /> {$_("studio.timeline.timelapse")}
    </button>
    <label class="field" title={$_("studio.timeline.duration_title")}>
      <input type="number" min={DURATION_RANGE[0]} max={DURATION_RANGE[1]} step="1" value={Math.round(scene.duration)}
        disabled={busy} aria-label={$_("studio.timeline.duration")} on:change={setDuration} />
      s
    </label>
    <span class="spacer"></span>
    {#if recordable}
      <label class="field">
        <select bind:value={$studioAspect} disabled={busy} aria-label={$_("studio.timeline.aspect")}>
          {#each ASPECTS as aspect (aspect)}
            <option value={aspect}>{aspect === "window" ? $_("studio.timeline.aspect_window") : aspect}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="chip record" class:on={$studioRecording !== null} on:click={record}
        disabled={!scene.keyframes.length || $studioLoading !== null && $studioRecording === null}
        title={$_("studio.timeline.record_title")}>
        <Icon icon={$studioRecording !== null ? faStop : faCircle} />
        {$studioRecording !== null
          ? $_("studio.timeline.recording", { values: { percent: Math.round($studioRecording * 100) } })
          : $_("studio.timeline.record")}
      </button>
    {/if}
    <button type="button" class="chip" on:click={() => void share()} disabled={busy} title={$_("studio.timeline.share_title")}>
      <Icon icon={shareGlyph} /> {$_("share.share")}
    </button>
  </div>
</section>

<style>
  .dock {
    position: absolute;
    left: calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    right: calc(var(--mc-gutter) + env(safe-area-inset-right, 0px));
    bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter));
    z-index: var(--mc-z-chrome);
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 980px;
    margin: 0 auto;
    padding: 10px 14px;
    box-sizing: border-box;
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--mc-pill-h);
  }
  .tools { flex-wrap: wrap; gap: 6px; }
  .name {
    flex: none;
    width: 28px;
    color: var(--mc-text-2);
  }
  .spacer { flex: 1 1 auto; }
  .gap { width: 8px; }
  .clock {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 108px;
    font-variant-numeric: tabular-nums;
  }
  .clock.past { color: var(--studio-accent); }
  .note {
    margin: 0 0 0 38px;
    font-weight: 400;
    color: var(--mc-text-2);
  }
  .ring {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background:
      conic-gradient(currentColor calc(var(--progress, 0) * 1turn), color-mix(in srgb, currentColor 22%, transparent) 0);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  }

  input[type="range"] {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    height: 20px;
    margin: 0;
    accent-color: var(--studio-accent);
    cursor: pointer;
  }
  input[type="range"]:disabled { cursor: default; }
  .track {
    position: relative;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  /* A mark over the track at each keyframe; the slider under them takes the pointer. */
  .marks {
    position: absolute;
    inset: 0 8px;
    pointer-events: none;
  }
  .marks i {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -11px 0 0 -4px;
    background: var(--studio-accent);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    transform: rotate(45deg);
  }

  .disc {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: var(--mc-pill-h);
    height: var(--mc-pill-h);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--studio-accent);
    color: #1c1c1e;
    cursor: pointer;
  }
  .disc:disabled { cursor: default; opacity: 0.45; }
  .disc :global(svg) { width: 11px; height: 11px; }
  .disc:focus-visible, .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:active { transform: scale(var(--mc-press)); }
  .chip:disabled { cursor: default; opacity: 0.45; }
  .chip.icon { width: var(--mc-pill-h); justify-content: center; padding: 0; }
  .chip.on { background: color-mix(in srgb, var(--studio-accent) 28%, transparent); }
  .chip :global(svg) { width: 11px; height: 11px; }
  .chip.record :global(svg) { color: #ff453a; }
  .chip.record.on { background: #ff453a; color: #fff; }
  .chip.record.on :global(svg) { color: #fff; }

  .field {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--mc-text-2);
  }
  .field input, .field select {
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 8px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  .field input { width: 54px; }
</style>
