/**
 * Translation outside a component.
 *
 * Components read `$_`, which re-renders them when the language changes. Code
 * in src/lib and src/layers has no `$`, so it reads the store once per call
 * through `t()` -- and a lib function whose output a component renders takes
 * the component's `$_` as an argument instead (see cellPlacement.ts), so the
 * component's reactivity covers it.
 */
import { get } from "svelte/store";
import { _, locale } from "svelte-i18n";
import { chooseLocale } from "./choose";

export type Translate = (key: string, options?: { values?: Record<string, string | number> }) => string;

export const t: Translate = (key, options) => get(_)(key, options);

/** The BCP 47 tag for Intl and toLocale*String, following the chosen language. */
export function currentLocale(): string {
  return get(locale) ?? chooseLocale();
}
