{
  "env": {
    "browser": true,
    "es6": true
  },
  "extends": [
    "airbnb-base",
  ],
  "globals": {
    "Cesium": "readonly",
    "Atomics": "readonly",
    "SharedArrayBuffer": "readonly"
  },
  "parserOptions": {
    "parser": "babel-eslint",
    "sourceType": "module"
  },
  "rules": {
    "class-methods-use-this": "off",
    "no-console": "off",
    "no-param-reassign": ["error", { "props": false }],
    "object-curly-newline": "off",
    "operator-linebreak": ["error", "after"],
    "quotes": ["error", "double", { "allowTemplateLiterals": true }],
    "max-len": ["error", 170, 2, {
      "ignoreUrls": true,
      "ignoreComments": false,
      "ignoreRegExpLiterals": true,
      "ignoreStrings": true,
      "ignoreTemplateLiterals": true
    }],
    }]
  },
  "settings": {
    "import/resolver": {
      "webpack": {
        "config": "webpack.config.js"
      }
    }
  }
}

