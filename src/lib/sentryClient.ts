/**
 * The parts of the Sentry SDK the page uses, and nothing else.
 *
 * src/lib/sentry.ts loads this module on demand. Importing `@sentry/browser`
 * there as a whole namespace kept every export alive, so the chunk carried
 * Session Replay (rrweb) and the feedback widget (Preact), which nothing
 * here turns on: named imports let the bundler drop them. `init` adds only
 * the SDK's default integrations, none of which is replay or feedback.
 */
export { browserTracingIntegration, captureConsoleIntegration, captureException, init } from "@sentry/browser";
