<script lang="ts">
  import { tileCacheDownloaded, tileCachePending, tileCacheHit } from "../stores";

  let hit = 0;
  let downloaded = 0;
  let pending = 0;

  tileCachePending.subscribe(() => {
    pending += 1;
  });

  tileCacheHit.subscribe(() => {
    pending -= 1;
    hit += 1;
  });

  tileCacheDownloaded.subscribe(() => {
    pending -= 1;
    downloaded += 1;
  });

  let usage = 0;
  function updateStorageEstimate() {
    navigator.storage.estimate().then((estimate) => {
      usage = estimate.usage ?? 0;
    });
    setTimeout(updateStorageEstimate, 1000);
  }

  updateStorageEstimate();
</script>

<style>
  /* Dev only. Bottom-right, just above the tray: the top-right belongs to the
     control cluster now. */
  .wrapper {
    position: absolute;
    z-index: var(--mc-z-pill);
    top: auto;
    right: var(--mc-gutter);
    bottom: calc(var(--bottom-toolbar-height, 0px) + var(--mc-gutter) + 26px);
    pointer-events: none;
  }

  /* sl-tag parts: base content remove-button */
  .wrapper sl-tag::part(base) {
    height: auto;
    padding: 6px 10px;
    border-radius: 14px;
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
  }

  .dev {
    line-height: 1.2;
    border: 0;
    font: 500 9px/1.2 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  tr, td, th {
    padding: 0;
    margin: 0;
  }
  th {
    text-align: right;
    padding-right: 6px;
    color: var(--mc-text-2);
    font-weight: 500;
  }
</style>

<div class="wrapper">
    <sl-tag variant="danger" size="medium" pill>
        <table class="dev">
            <tbody>
                <tr><th>Tiles<br />(Pending/Loaded/Cached)</th><td>{pending} / {downloaded} / {hit}</td></tr>
                <tr><th>Cache Size</th><td>{(usage / 1024 / 1024).toFixed(1)} MiB</td></tr>
            </tbody>
        </table>
    </sl-tag>
</div>
