/// <reference types="svelte" />
/// <reference types="vite/client" />

// Injected by vite.config.ts from COMMIT_REF / GITHUB_SHA.
declare const __GIT_COMMIT_HASH__: string;

// Set in .env and .env.production; see src/features.ts.
interface ImportMetaEnv {
  readonly VITE_FEATURE_STORM_STYLES?: string;
  readonly VITE_FEATURE_STUDIO?: string;
  readonly VITE_FEATURE_METEOAIR?: string;
}
