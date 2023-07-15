import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        navigator: 'readonly',
        Image: 'readonly',
        HTMLElement: 'readonly',
        getComputedStyle: 'readonly',
        getComputedStyle: 'readonly',
        // Node.js globals
        process: 'readonly',
        module: 'readonly',
        // Service Worker globals
        self: 'readonly',
        // Webpack globals
        GIT_COMMIT_HASH: 'readonly',
        BACKEND: 'readonly',
        // Cloudflare globals
        HTMLRewriter: 'readonly',
        // App-specific globals
        Android: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': 'warn',
      'no-inner-declarations': 'off',
      // Disable import rules that don't exist in our config
      'import/no-mutable-exports': 'off',
      'import/prefer-default-export': 'off',
      'import/order': 'off',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: typescriptParser,
        extraFileExtensions: ['.svelte'],
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        navigator: 'readonly',
        Image: 'readonly',
        HTMLElement: 'readonly',
        getComputedStyle: 'readonly',
        // Node.js globals
        process: 'readonly',
      },
    },
    plugins: {
      svelte,
    },
    rules: {
      ...svelte.configs.recommended.rules,
      'svelte/no-unused-svelte-ignore': 'warn',
      'no-console': 'warn',
      'no-unused-vars': 'warn',
      'no-inner-declarations': 'off',
      // Disable import rules that don't exist in our config
      'import/no-mutable-exports': 'off',
      'import/prefer-default-export': 'off',
      'import/order': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.config.js',
      'public/',
      '.eslintrc.js',
    ],
  },
];