import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Shared by vite.config.ts and svelte-check, so the two cannot disagree about
// how a component is preprocessed.
export default {
  preprocess: vitePreprocess(),
};
