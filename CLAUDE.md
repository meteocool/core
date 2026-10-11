# meteocool core

## Commits

Terse Conventional Commits, in the voice of a changelog:

```
feat(worker): serve the apps' API on app.meteocool.com

- New custom domain on the staging Worker
- Forwards /post_location, /unregister and /v3/mobile/ to API_ORIGIN
- Production has no API_ORIGIN yet, so nothing is forwarded there
```

- Subject: `type(scope): summary`, imperative, plain words, at most 72 chars.
- Body: optional, at most six one-line `- ` bullets of plain facts. A small change gets a subject alone.
- The message ends on its last bullet: no `Co-Authored-By` or other attribution trailer, overriding Claude Code's default. PR descriptions follow the same style, without attribution.

`scripts/commit-msg`, installed as the shared `.git/hooks/commit-msg`, rejects anything else. On a rejection, rewrite the message and commit again.

## Tests

Every change comes with tests of both kinds below, written the way the existing ones are. Before pushing develop, run `npm run check`, `npm test` and `npm run test:ui`; none of them may fail.

**Unit tests**: `scripts/tests/*.test.ts`, Node's own `node:test` and `node:assert/strict`, run by `npm test`.
- For decisions: what a control allows, which frame comes next, whether a notice applies. Take the rule out of the component into a pure function in `src/lib/` (no stores, no DOM, no OpenLayers objects; pass predicates or plain values in) and test that function. `src/lib/playbackLoop.ts` and `src/lib/forecastCoverage.ts` are examples.
- One `test()` per rule, named as a sentence about behaviour. Edge cases get their own test.

**UI tests**: `tests/ui/*.spec.ts`, Playwright, run by `npm run test:ui` in an iPhone's WebKit and a desktop Chromium.
- For what a reader sees and does: a button enabled or not, a notice shown, playback staying within bounds, one part of the screen covering another.
- Offline: the backend's answers are recorded (`tests/ui/fixtures`) and replayed on the recording's clock, tiles are blank, and anything unrecorded is refused. Import `test` and `expect` from `./test`, never from `@playwright/test`, or the spec goes online. Read [tests/ui/README.md](tests/ui/README.md) before adding a spec or re-recording.
- A test failing on "requests have no recording" means the app asks for something new: add its path to `tests/ui/offline.ts` if it is the backend's, then `npm run test:ui:record` and commit the reviewed fixtures.
- Central Germany at zoom 8 (`GERMANY_VIEW` in `forecast-coverage.spec.ts`, which keeps a desktop screen inside DWD's reach) has radar and a forecast. Aquitaine (`44.8, -0.6`) has French radar but no forecast.
- Find elements by role and accessible name, or through the helpers in `tests/ui/app.ts`; add a helper there instead of repeating a selector. Drive the timeline with the arrow keys and read its position from `aria-valuenow`.
- Both projects must pass. A test that only fails with all workers running is flaky, not done.
