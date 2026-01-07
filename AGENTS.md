# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` — Svelte UI (`App.svelte`, `components/`), map and data layers (`layers/`), capabilities (`caps/`), shared libs (`lib/`), entry points (`entrypoints/`), locale files (`locale/`).
- Static assets: `public/` (served as-is). Build output: `dist/`.
- HTML entry pages: `index.html`, `android.html`, `ios.html`, `imprint.html`, `privacy.html` (configured in `vite.config.mjs`).
- Import alias: `@` resolves to `src` (e.g., `import Map from '@/components/Map.svelte'`).

## Build, Test, and Development Commands
- `npm run dev`: Start Vite dev server on `127.0.0.1:3000`.
- `npm run dev-local`: Dev server with `BACKEND=local` for local APIs.
- `npm run build`: Production build to `dist/` (PWA enabled).
- `npm run preview`: Serve the production build locally.
- `npm run deploy[:staging|:production]`: Build and deploy via Cloudflare `wrangler`.
- Lint/format/type: `npm run lint`, `npm run lint:fix`, `npm run typecheck`, `npm run format`.

## Coding Style & Naming Conventions
- Indentation: 2 spaces; LF line endings (`.editorconfig`).
- Formatting: Prettier with Svelte plugin; single quotes, no semicolons. Run `npm run format`.
- Linting: ESLint (JS/TS + Svelte) with Prettier integration. Run `npm run lint`.
- Names: Svelte components `PascalCase.svelte` (e.g., `MiniMap.svelte`); files/modules `camelCase.js|ts`; constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines
- Frameworks available: `svelte-check`/TypeScript for static checks.
- Current status: no committed test suite; no coverage threshold enforced.
- If you add E2E tests later, prefer Playwright with `tests/e2e/*.spec.ts`.
- Always run `npm run lint` and `npm run typecheck` before pushing.

## Commit & Pull Request Guidelines
- Prefer Conventional Commits (feat|fix|chore|refactor|docs|test) with scope when useful: `feat(layers): add lightning overlay`.
- Keep messages imperative and focused; reference issues: `fix: handle null tiles (closes #123)`.
- PRs: include a clear description, linked issues, and screenshots/GIFs for UI changes. Note any config/env changes and test steps.

## Security & Configuration Tips
- Env: copy `.env.example` to `.env` as needed. Key variables: `BACKEND`, `NODE_ENV`, Cloudflare settings in `wrangler.jsonc`.
- Do not commit secrets or tokens; `public/` is served verbatim.
- Sentry hooks exist (`src/lib/sentry.js`); verify DSN via env before enabling.
