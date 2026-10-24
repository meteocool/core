# meteocool Frontend

This is the frontend component [for meteocool, the free & open-source
storm and lightning tracker](https://github.com/meteocool/).


The meteocool frontend is Svelte 5 and TypeScript, built with Vite. The
`main` branch is deployed to [meteocool.com](https://meteocool.com) and the
apps. The `develop` branch is deployed to
[next.meteocool.com](https://next.meteocool.com), which the apps show with
the "Experimental Features" setting.

## Architecture

Non-existent, but here's a few pointers:

* Backend calls go through a typed client generated from the
  backend's OpenAPI schemas. The schemas
  are vendored in `spec/`; `npm run generate:api` regenerates
  `src/api/generated/`, and `src/api/index.ts` wraps each endpoint so the
  progress bar and error reporting cannot be forgotten. Socket.IO cannot be
  described by OpenAPI, so `src/api/events.ts` maps event names to payload
  types that the same generator produces.
* The globals the native apps call (`window.lm`, `window.settings`,
  `window.enterForeground` and the rest) are declared in
  `src/lib/nativeBridge.ts`. They are a public API: shipped app versions
  depend on these names.
* Most interactions between the native applications and the web
  application happen through the Settings interface, which is
  [documented in the Wiki](https://github.com/meteocool/core/wiki/Settings-API).
* If you are planning to use meteocool for a dashboard/status display,
  [check out possible HTTP request parameters](https://github.com/meteocool/core/wiki/URL-Parameters)
  for further customization.

## Local Development
- `npm install`
- `npm run dev` to connect to the production backend
- `npm run dev-local` to connect to a local stack (`make up` in the backend
  repo). Everything is proxied through the dev server's own origin, so there
  is no CORS to configure.
- `npm run check` runs svelte-check and eslint; `npm run build` builds.
- `npm test` runs the unit tests (`scripts/tests`).
- `npm run test:ui` runs the UI tests (`tests/ui`, Playwright): the app in
  an iPhone's WebKit and a desktop Chromium, offline on recorded answers.
  Run it before pushing develop; it is not in CI yet. See
  [tests/ui/README.md](tests/ui/README.md).

## Deployment

Three Worker environments in `wrangler.jsonc`, each with its own Vite mode:

| Environment | Hostnames | Deployed from | Build |
|---|---|---|---|
| `production` | meteocool.com, app.meteocool.com | `main` | `vite build` |
| `next` | next.meteocool.com | `develop` | `vite build --mode next` |
| `demo` | demo.meteocool.com | `develop` | `vite build --mode demo` |

CI deploys on every push to those branches. `npm run deploy:production`,
`deploy:next` and `deploy:demo` do the same by hand.
The Pages build guard must stay enabled while legacy apps use that project.

## Warning: Recreational Programming

I do not consider myself to be a web (nor frontend) developer, and
since I'm basically the only person working on this particular
component, nothing is clean, good practice or mature.  Some
code smells are documented in the issue tracker, most of
them are not.

Here be dragons, you have been warned. 🐲
