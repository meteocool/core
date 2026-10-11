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

- Before pushing develop: `npx svelte-check --threshold error`, `npx eslint .`, `npm test` and `npm run test:ui`. Do not push on a failure.
- `npm run test:ui` is Playwright (`tests/ui`), offline on recorded backend answers and a recorded clock. Read [tests/ui/README.md](tests/ui/README.md) before adding a spec or re-recording.
- A UI change that fixes a bug, or that could break another part of the screen, gets a spec in `tests/ui` that fails without the change.
- A test failing on "requests have no recording" means the app asks for something new: add its path to `tests/ui/offline.ts` if it is the backend's, then `npm run test:ui:record` and commit the reviewed fixtures.
