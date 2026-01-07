<script>
  import { tileCacheDownloaded, tileCachePending, tileCacheHit } from '../stores'

  let hit = $state(0)
  let downloaded = $state(0)
  let pending = $state(0)

  tileCachePending.subscribe((value) => {
    if (value !== undefined) {
      pending += 1
    }
  })

  tileCacheHit.subscribe((value) => {
    if (value !== undefined) {
      pending -= 1
      hit += 1
    }
  })

  tileCacheDownloaded.subscribe((value) => {
    if (value !== undefined) {
      pending -= 1
      downloaded += 1
    }
  })

  let usage = $state(0)
  function updateStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((estimate) => {
        usage = estimate.usage
      })
      setTimeout(updateStorageEstimate, 1000)
    }
  }

  updateStorageEstimate()
</script>

<div class="wrapper">
  <div class="ui-tag">
    <table class="dev">
      <tbody>
        <tr><th>Tiles<br />(Pending/Loaded/Cached)</th><td>{pending || 0} / {downloaded || 0} / {hit || 0}</td></tr>
        <tr><th>Cache Size</th><td>{usage ? (usage / 1024 / 1024).toFixed(1) : '0.0'} MiB</td></tr>
      </tbody>
    </table>
  </div>
</div>

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
  tr,
  td,
  th {
    padding: 0;
    margin: 0;
  }
  th {
    text-align: right;
  }

  .ui-tag {
    display: inline-block;
    padding: 4px 6px;
    border-radius: 9999px;
    background: #fee2e2;
    color: var(--sl-color-danger-800);
    border: 1px solid #fecaca;
  }
</style>
