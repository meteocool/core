import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import svelteConfig from "./svelte.config.js";

// Replaces the airbnb-base setup, which has no flat-config support and is
// unmaintained, and eslint-plugin-svelte3, which does not understand Svelte 5.
// Only the rules that were actually customised before are carried over.
export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "max-len": ["error", 170, 2, {
        ignoreUrls: true,
        ignoreComments: false,
        ignoreRegExpLiterals: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      }],
      "no-console": "off",
      quotes: ["error", "double", { allowTemplateLiterals: true }],
      "@typescript-eslint/no-explicit-any": "off",
      // The only {@html} sources are this repo's own locale files and the
      // legend markup built in the scale components; none of it is user input.
      "svelte/no-at-html-tags": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_|^Sl",
      }],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: [".svelte"],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Generated from the backend's OpenAPI schemas; not ours to lint.
    ignores: ["dist/", "src/api/generated/", "functions/", "public/"],
  },
);
