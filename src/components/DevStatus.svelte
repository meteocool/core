<script>
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
      usage = estimate.usage;
    });
    setTimeout(updateStorageEstimate, 1000);
  }

  updateStorageEstimate();
</script>

<style>
  .wrapper {
      position: absolute;
      z-index: 9999;
      top: calc(env(safe-area-inset-top) + 0.4em);
      right: 1em;
  }
  .dev {
      line-height: 1;
      border: 0;
      font-size: 8px;
  }
  tr, td, th {
      padding: 0;
      margin: 0;
  }
  th {
      text-align: right;
  }
</style>

<div class="wrapper">
    <sl-tag type="danger" size="medium" pill>
        <table class="dev">
            <tr><th>Tiles<br />(Pending/Loaded/Cached)</th><td>{pending} / {downloaded} / {hit}</td></tr>
            <tr><th>Cache Size</th><td>{(usage / 1024 / 1024).toFixed(1)} MiB</td></tr>
        </table>
    </sl-tag>
</div>
