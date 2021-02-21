module.exports = {
  env: {
    es6: true,
    browser: true,
  },
  extends: [
    'airbnb-base',
    "plugin:import/errors",
    "plugin:import/warnings",
  ],
  parserOptions: {
    ecmaVersion: 2019,
    sourceType: 'module'
  },
  plugins: [
    'svelte3'
  ],
  overrides: [
    {
      files: ['**/*.svelte'],
      processor: 'svelte3/svelte3'
    }
  ],
  globals: {
    GIT_COMMIT_HASH: "readonly",
    Android: "readonly",
  },
  rules: {
    "class-methods-use-this": "off",
    "max-len": ["error", 170, 2, {
              "ignoreUrls": true,
              "ignoreComments": false,
              "ignoreRegExpLiterals": true,
              "ignoreStrings": true,
              "ignoreTemplateLiterals": true
             }],
    "no-console": "off",
    "no-param-reassign": ["error", { "props": false }],
    "object-curly-newline": "off",
    "operator-linebreak": ["error", "after"],
    quotes: ["error", "double", { "allowTemplateLiterals": true }],
  },
  settings: {
    "import/resolver": {
      webpack: {
        config: "webpack.config.js"
      },
    },
  },
};
