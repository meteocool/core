/**
 * Whether the page's inline check (src/browserCheck.js) found this browser
 * unable to run the app. Its message is then the page, and nothing starts
 * behind it: no map under the message, no service worker caching a bundle
 * that cannot run, and no error reports from a browser already known not to
 * work.
 */
export const unsupportedBrowser = typeof window !== "undefined" && window.mcUnsupported === true;

declare global {
  interface Window {
    /** Set by src/browserCheck.js before the bundle loads. */
    mcUnsupported?: boolean;
  }
}
