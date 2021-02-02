module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'airbnb-base',
    "plugin:import/errors",
    "plugin:import/warnings",
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
    parser: "@babel/eslint-parser",
    requireConfigFile: false,
    babelOptions: {
      plugins: [
        "@babel/plugin-proposal-class-properties",
        "@babel/plugin-proposal-optional-chaining"
      ]
    },
  },
  globals: {
    GIT_COMMIT_HASH: "readonly",
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
