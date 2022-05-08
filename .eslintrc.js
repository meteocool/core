module.exports = {
  env: {
    es6: true,
    browser: true,
  },
  extends: [
    "airbnb-base",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: [
    "@typescript-eslint",
    "svelte3",
  ],
  overrides: [
    {
      files: ["**/*.svelte"],
      processor: "svelte3/svelte3",
    },
  ],
  globals: {
    GIT_COMMIT_HASH: "readonly",
    BACKEND: "readonly",
    Android: "readonly",
  },
  rules: {
    "class-methods-use-this": "off",
    "import/first": "off",
    "max-len": ["error", 170, 2, {
      ignoreUrls: true,
      ignoreComments: false,
      ignoreRegExpLiterals: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
    }],
    "no-console": "off",
    "no-param-reassign": ["error", { props: false }],
    "object-curly-newline": "off",
    "operator-linebreak": ["error", "after"],
    quotes: ["error", "double", { allowTemplateLiterals: true }],
  },
  settings: {
    "import/resolver": {
      node: {
        extensions: [".js", ".jsx", ".ts", ".tsx"],
      },
      webpack: {
        extensions: [".js", ".jsx", ".ts", ".tsx"],
        config: "webpack.config.js",
      },
    },
  },
};
