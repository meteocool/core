# UI tests

The whole app in real browsers, driven the way a reader does: an iPhone in
WebKit (the closest a desktop gets to the iOS app's web view) and a desktop
Chromium. They exist to catch one part of the screen breaking another, which
the unit tests in `scripts/tests` cannot see.

```
npx playwright install webkit chromium   # once per machine
npm run test:ui                          # all specs, both browsers
npx playwright test radar-menu --project=iphone   # one file, one browser
npx playwright show-report               # the last run, with traces of failures
```

Run them before pushing develop. They are not in CI yet.

## Offline, on a recorded clock

A run never reaches a backend. `test.ts` gives every spec a page that:

- answers the backend's requests (`/v3`, `/cells`, `/mesocyclones`,
  `/lightning_cache`, `/geocoding`, see `offline.ts`) from
  `fixtures/api/*.json`, keyed by method and path (the query is ignored);
- draws every map tile blank: radar, value tiles and the basemap;
- connects the lightning socket to a stand-in that stays quiet;
- starts its clock at `fixtures/recording.json`'s `recordedAt` and lets it
  run on, so "now", the live frame and "3–8 min ago" are the recording's;
- refuses anything else that would leave the machine, and fails the test
  naming the request.

So the same commit always gives the same result, whatever the weather or the
state of staging and demo.

## Re-recording

When the app starts asking for something new, or an answer's shape changes,
the failing test names the request. Then:

```
npm run test:ui:record                     # from staging
UI_RECORD_FROM=demo npm run test:ui:record # from demo
```

`record.ts` opens the app on a phone and a desktop, lets each settle, and
replaces `fixtures/api` and `recording.json`. It visits the views in its
`VIEWS`: a spec that opens a new one adds it there. A new endpoint also needs
its path in `offline.ts`'s `API_PATHS`. Record when there is rain on the map, and
review the diff before committing it: it is test data from then on.

## Writing a spec

- Import `test` and `expect` from `./test`, not from `@playwright/test`:
  that is what makes the page offline.
- Start from `openRadar(page)` (`app.ts`), which also waits for the tray to
  finish flying in. A drag measured mid-flight lands on whatever slid under it.
- Find things the way a reader does: by role and name
  (`getByRole("button", { name: "Back to now" })`), and add to `app.ts` what
  more than one spec needs.
- Assert what broke, not how it looks: that a dialog stays open, that two
  boxes do not overlap (`overlaps`), that a line and a needle share an x.
  Screenshots are a last resort; the map under the chrome is blank anyway.
- Phone-only behaviour: `test.skip(({ isMobile }) => !isMobile, "…")`.
- What the page tells the iOS app: `native-bridge.spec.ts` stands in a
  recording `window.webkit.messageHandlers` and loads `/ios.html`.
- A spec for a fixed bug should fail on the code before the fix. Check that
  once, by putting the old code back for a run.
