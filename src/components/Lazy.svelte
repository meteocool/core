<script lang="ts" generics="T">
/**
 * A component fetched on first use, with something on screen while it comes
 * and when it does not.
 *
 * The storm panels, the model comparison and the dialogs are chunks of their
 * own, loaded when they are opened (see App.svelte). Each was an `{#await}`
 * with nothing in the pending branch and no `{:catch}`: on a slow network the
 * tap did nothing for seconds, and on a failed one -- offline before the
 * service worker had the chunk, or a tab outliving the deploy that named it
 * -- it did nothing at all, the desktop's drawer standing open and empty.
 *
 * Now the wait shows a spinner, once it has lasted long enough to notice, and
 * a failure says so with a way to try again; coming back online tries again
 * by itself (lib/wakeup.ts).
 *
 * `floating` is for a chunk with no container of its own on screen yet -- a
 * phone's sheet, a dialog -- where the spinner and the failure stand in a
 * pill at the foot of the screen instead.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import { onWake } from "../lib/wakeup";
import { reportShown } from "../lib/sentry";

export let load: () => Promise<T>;
export let floating = false;

/**
 * How long a load may take before the spinner shows. A precached chunk lands
 * in a frame or two, and a spinner flashed for that long reads as a glitch.
 */
const SPINNER_AFTER_MS = 250;

let attempt = 0;
let failed = false;
let slow = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function start(loader: () => Promise<T>, _attempt: number): Promise<T> {
  failed = false;
  slow = false;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => { slow = true; }, SPINNER_AFTER_MS);
  return loader().then(
    (module) => module,
    (error) => {
      failed = true;
      // Which panel is in the error: the chunk's own URL, for one that would not load.
      reportShown("panel", error);
      throw error;
    },
  ).finally(() => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });
}

/* A new loader is a new load; `attempt` is an argument only so a retry runs it again. */
$: loading = start(load, attempt);

const retry = () => { attempt += 1; };

let unsubscribe: (() => void) | null = null;
onMount(() => { unsubscribe = onWake(() => { if (failed) retry(); }); });
onDestroy(() => {
  unsubscribe?.();
  if (timer !== null) clearTimeout(timer);
});
</script>

<style>
  .state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 120px;
    padding: 16px;
    color: var(--mc-text-2);
    font: var(--mc-type-body);
  }

  .floating {
    position: fixed;
    left: 50%;
    bottom: calc(var(--mc-gutter) + env(safe-area-inset-bottom, 0px) + 72px);
    transform: translateX(-50%);
    z-index: var(--mc-z-chrome);
    min-height: 0;
    padding: 10px 16px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill-strong);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring-lg);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    color: var(--mc-text);
    white-space: nowrap;
  }

  /* sl-spinner props: --track-width --track-color --indicator-color --speed */
  sl-spinner {
    --track-width: 2.5px;
    --track-color: var(--mc-separator);
    --indicator-color: var(--mc-accent);
    font-size: 20px;
  }

</style>

{#await loading}
  {#if slow}
    <!-- sl-spinner announces itself as a progress bar, with its own label. -->
    <div class="state" class:floating>
      <sl-spinner></sl-spinner>
    </div>
  {/if}
{:then module}
  <slot {module} />
{:catch}
  <div class="state" class:floating role="alert">
    <span>{$_("load_failed")}</span>
    <button type="button" class="mc-retry" on:click={retry}>{$_("retry")}</button>
  </div>
{/await}
