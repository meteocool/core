/**
 * Turnstile, the check the board asks for before it takes a new pilot or a
 * new flight: its script loaded once, on the first take-off that goes on the
 * board, and one widget rendered explicitly, invisible unless it has to ask
 * the reader something. Each token is single-use and lasts five minutes, so
 * one is asked for just before each request that needs it.
 *
 * The widget is drawn where the deck gives it a place (BoardCheck.svelte),
 * and says when it is asking, so that the deck can put a card round it.
 */
import { writable } from "svelte/store";
import type { Readable } from "svelte/store";

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** How long a token is waited for, ms: a challenge the reader has to answer takes a moment. */
const TOKEN_MOST_MS = 60_000;
/** How long the deck is waited for to give the widget its place, ms. */
const PLACE_MOST_MS = 15_000;

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  execute(widget: string): void;
  reset(widget: string): void;
  remove(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => reject(new Error("turnstile did not load"));
    document.head.append(script);
  }).catch((error: unknown) => {
    // Tried again on the next flight.
    loading = null;
    throw error;
  });
  return loading;
}

/** One widget for the page: `token()` a fresh token, `dispose()` the widget gone. */
export interface TokenSource {
  token(): Promise<string>;
  dispose(): void;
}

/** Turnstile's widget as the deck sees it: where it is drawn, whether it is asking, and a way out of being asked. */
export interface TurnstileSource extends TokenSource {
  /** Whether the widget has something up for the reader to answer. */
  asking: Readable<boolean>;
  /** Where the widget draws itself. Tokens wait for it. */
  place(element: HTMLElement): void;
  /** The reader would rather not answer: the token waited for is given up. */
  skip(): void;
}

export function turnstileTokens(sitekey: string): TurnstileSource {
  let api: TurnstileApi | null = null;
  let widget: string | null = null;
  let host: HTMLElement | null = null;
  let placed: () => void = () => undefined;
  const place = new Promise<void>((resolve) => { placed = resolve; });
  const asking = writable(false);
  let waiting: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;
  let disposed = false;

  const settle = (outcome: { token: string } | { error: string }) => {
    const pending = waiting;
    waiting = null;
    asking.set(false);
    if (!pending) return;
    if ("token" in outcome) pending.resolve(outcome.token);
    else pending.reject(new Error(outcome.error));
  };

  async function ready(): Promise<{ api: TurnstileApi; widget: string }> {
    api ??= await loadScript();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      place,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("no place for the check")), PLACE_MOST_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (disposed || !host) throw new Error("disposed");
    if (widget === null) {
      widget = api.render(host, {
        sitekey,
        appearance: "interaction-only",
        execution: "execute",
        // The deck is dark whatever the reader's system is.
        theme: "dark",
        size: "flexible",
        "before-interactive-callback": () => asking.set(true),
        "after-interactive-callback": () => asking.set(false),
        "refresh-expired": "manual",
        callback: (token: string) => settle({ token }),
        "error-callback": () => { settle({ error: "turnstile error" }); return true; },
        "expired-callback": () => settle({ error: "turnstile expired" }),
        "timeout-callback": () => settle({ error: "turnstile timeout" }),
      }) ?? null;
      if (widget === null) throw new Error("turnstile did not render");
    }
    return { api, widget };
  }

  return {
    asking,
    place(element) {
      // A new place: the widget drawn in the old one is gone with it.
      if (host && host !== element && api && widget !== null) {
        api.remove(widget);
        widget = null;
      }
      host = element;
      placed();
    },
    skip() {
      settle({ error: "skipped" });
      if (api && widget !== null) api.reset(widget);
    },
    async token() {
      const { api: turnstile, widget: id } = await ready();
      settle({ error: "superseded" });
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => settle({ error: "turnstile took too long" }), TOKEN_MOST_MS);
        waiting = {
          resolve: (token) => { clearTimeout(timer); resolve(token); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        };
        // A fresh one each time: the last was spent, or refused.
        turnstile.reset(id);
        turnstile.execute(id);
      });
    },
    dispose() {
      disposed = true;
      settle({ error: "disposed" });
      if (api && widget !== null) api.remove(widget);
      widget = null;
    },
  };
}
