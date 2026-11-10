import { registerHooks } from "node:module";

/**
 * Let the Node test runner resolve the app's own imports.
 *
 * Vite resolves `./cellGeometry` to `cellGeometry.ts`; Node's ESM resolver
 * does not, and it is Node that runs these tests. Without this hook the suite
 * can only ever import leaf modules: anything that imports a sibling throws
 * ERR_MODULE_NOT_FOUND before a single assertion runs, which limits
 * what is testable to whatever happens to have no dependencies.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      // A sibling module, or a directory's index (`../api`).
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Not this one; fall through to Node's own answer, whose error
          // message is the more useful one.
        }
      }
    }
    // OpenLayers' modules are imported by path the same way (`ol/proj`), and
    // the package has no exports map to resolve them, so they get `.js`.
    if (/^ol\/[^.]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    // Vite imports JSON as a module with no attribute, and serves it as one in
    // development, where an attribute would make the browser refuse it. Node
    // insists on `type: "json"`, so it is supplied here.
    if (specifier.endsWith(".json") && !context.importAttributes?.type) {
      const importAttributes = { ...context.importAttributes, type: "json" };
      return { ...nextResolve(specifier, { ...context, importAttributes }), importAttributes };
    }
    return nextResolve(specifier, context);
  },
  /*
   * Vite fills `import.meta.env`; Node leaves it undefined, so a module that
   * reads `import.meta.env.DEV` at the top (urls.ts, and everything that
   * reaches the API client through it) throws on import. Under test it is an
   * empty production build's: nothing set, not DEV.
   */
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.includes("/src/") || loaded.source == null) return loaded;
    const source = String(loaded.source);
    if (!source.includes("import.meta.env")) return loaded;
    return { ...loaded, source: source.replaceAll("import.meta.env", "(import.meta.env ?? {})") };
  },
});
