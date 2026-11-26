/**
 * Turnstile, the check the board asks for before it takes a new pilot or a
 * new flight: its script loaded once, on the first take-off that goes on the
 * board, and one widget rendered explicitly, invisible unless it has to ask
 * the reader something. Each token is single-use and lasts five minutes, so
 * one is asked for just before each request that needs it.
 */

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** How long a token is waited for, ms: a challenge the reader has to answer takes a moment. */
const TOKEN_MOST_MS = 60_000;

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

export function turnstileTokens(sitekey: string): TokenSource {
  let api: TurnstileApi | null = null;
  let widget: string | null = null;
  let container: HTMLElement | null = null;
  let waiting: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;
  let disposed = false;

  const settle = (outcome: { token: string } | { error: string }) => {
    const pending = waiting;
    waiting = null;
    if (!pending) return;
    if ("token" in outcome) pending.resolve(outcome.token);
    else pending.reject(new Error(outcome.error));
  };

  async function ready(): Promise<{ api: TurnstileApi; widget: string }> {
    api ??= await loadScript();
    if (disposed) throw new Error("disposed");
    if (widget === null) {
      // Over the flight, where a challenge that must be answered can be.
      container = document.createElement("div");
      container.className = "mc-board-check";
      Object.assign(container.style, {
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: "2147483000",
      });
      document.body.append(container);
      widget = api.render(container, {
        sitekey,
        appearance: "interaction-only",
        execution: "execute",
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
      container?.remove();
      widget = null;
      container = null;
    },
  };
}
