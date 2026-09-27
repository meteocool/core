/**
 * The message catalogues, and which one is in use.
 *
 * English is bundled: it is the fallback for any key a translation lacks, so
 * it has to be there before anything renders. Every other language is its own
 * chunk, fetched only when it is the one chosen (choose.ts) -- a reader in
 * English downloads none of them, and a reader in Czech only Czech. The
 * service worker precaches the chunks with the rest of the build, so an
 * installed app does not wait on the network for them.
 *
 * Imported for its side effect, before anything renders: App.svelte imports
 * it, and the entrypoints hold the first mount on `i18nReady`.
 */
import { addMessages, init, locale, register, waitLocale } from "svelte-i18n";
import en from "./en.json";
import { chooseLocale } from "./choose";

addMessages("en", en);
register("de", () => import("./de.json"));
register("fr", () => import("./fr.json"));
register("pl", () => import("./pl.json"));
register("nl", () => import("./nl.json"));
register("cs", () => import("./cs.json"));
register("sk", () => import("./sk.json"));

/* The app's language when it says, else the browser's: choose.ts. An app
   that says so after load -- injectSettings({ lang }) -- moves it through the
   `lang` setting in App.svelte. */
init({
  fallbackLocale: "en",
  initialLocale: chooseLocale(),
});

locale.subscribe((tag) => {
  if (tag && typeof document !== "undefined") document.documentElement.lang = tag;
});

/** How long the first paint waits for a catalogue before going ahead in English. */
const READY_WAIT_MS = 1500;

/**
 * Settles when the chosen language's strings are in, or after READY_WAIT_MS:
 * a slow or failed chunk must never hold the map back. The page then renders
 * in English and switches over when the strings land -- svelte-i18n re-renders
 * everything reading `$_` once they do.
 */
export const i18nReady: Promise<void> = Promise.race([
  waitLocale().then(() => undefined, () => undefined),
  new Promise<void>((resolve) => { setTimeout(resolve, READY_WAIT_MS); }),
]);
