import { registerHooks } from "node:module";

/**
 * Let the Node test runner resolve the app's own imports.
 *
 * Vite resolves `./cellGeometry` to `cellGeometry.ts`; Node's ESM resolver
 * does not, and it is Node that runs these tests. Without this hook the suite
 * can only ever import leaf modules -- anything that imports a sibling throws
 * ERR_MODULE_NOT_FOUND before a single assertion runs, which quietly limits
 * what is testable to whatever happens to have no dependencies.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript sibling; fall through to Node's own answer, whose
        // error message is the more useful one.
      }
    }
    return nextResolve(specifier, context);
  },
});
