# Memory lab

Plays the iOS page through a scenario in an iOS simulator's Safari and
records what its web content process holds, so memory work on the app's web
view can be measured and repeated without a phone or its logs.

```
node scripts/memlab/run.mjs                         # mixed, 2 cycles, staging
node scripts/memlab/run.mjs --scenario threed --cycles 3 --backend demo
node scripts/memlab/run.mjs --compare scripts/memlab/out/a.json scripts/memlab/out/b.json
```

- `run.mjs` starts the dev server with two scripts added to `ios.html`, boots
  a simulator named "memlab iPhone …" (made on first use from the newest iOS
  runtime), opens the page in a fresh Safari and samples once a second until
  the scenario ends. `--device <udid>` and `--port` run a second one beside it,
  for comparing two checkouts at once.
- `driver.js` runs the scenario in the page, through what the apps use from
  outside (`window.lm`, `window.settings`, the player's button):
  - `mixed`: playback running while the map flies and pinches between zoom 4
    and 12 and the radar product changes, then scrubbing, then the 3D map and
    back.
  - `playzoom`: the first part alone.
  - `threed`: play, then 3D and back.
- `probe.js` counts what the simulator's footprint leaves out and a phone
  counts: WebGL textures, buffers and drawing buffers, 2D canvases and
  ImageBitmaps, with a census of what holds them.

Results are in `out/<label>.json` (gitignored): each second's footprint per
WebKit process, the page's count and the phase it was in, plus a table of
peaks per phase. `content` is the web content process's footprint;
`gpuEst` is the page's count; their sum, `total`, is the number to keep under
a phone's limit. In the simulator a 2D canvas's pixels can sit in both, so
the sum is an upper bound. A page reloaded, or its process replaced, during a
run is reported as a crash.

Safari needs nothing set up. The page drives itself because `safaridriver`
would not start a session on an iOS 27 simulator (October 2026).
