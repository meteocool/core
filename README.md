# meteocool Frontend

This is the frontend component [for meteocool, the free & open-source
storm and lightning tracker](https://github.com/meteocool/).


The meteocool frontend ist based on Svelte, Webpack, ES6 (transpiled
via babel). The `develop` branch is automatically deployed to the
[staging environment](https://better.meteocool.com), which can be
viewed after enabling the "Experimental Features" setting in the
iOS app or by joining the Beta program on meteocool Play store page.

## Architecture

Non-existent, but here's a few pointers:

* Most interactions between the native applications and the web
  application happen through the Settings interface, which is
  [documented in the Wiki](https://github.com/meteocool/core/wiki/Settings-API).
* If you are planning to use meteocool for a dashboard/status display,
  [check out possible HTTP request parameters](https://github.com/meteocool/core/wiki/URL-Parameters)
  for further customization.

## Local Development
- `npm install`
- `npm run dev` to connect to the upstream backend
- You might need to disable CORS in your browser during development.

## Warning: Recreational Programming

I do not consider myself to be a web (nor frontend) developer, and
since I'm basically the only person working on this particular
component, nothing is clean, good practice or mature.  Some
code smells are documented in the issue tracker, most of
them are not.

Here be dragons, you have been warned. 🐲
