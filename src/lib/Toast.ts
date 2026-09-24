import { isDismissed, withDismissal } from "./noticeLedger";

/**
 * Where the notices a reader has closed for good are kept.
 *
 * Declared in App.svelte alongside the rest; `Settings` drops a key whose
 * value is the default, so an empty ledger stores nothing. The keying rule and
 * the string handling live in lib/noticeLedger.ts, which is where they are
 * tested.
 */
const LEDGER = "dismissedNotices";

/*
 * Both of these are wrapped: Toast.ts is imported by the API client, which can
 * report a failure before App.svelte has built `window.settings` at all, and
 * Settings' own localStorage access can throw in a private window. A notice
 * that cannot read the ledger is simply shown.
 */
function dismissedBefore(message: string): boolean {
  try {
    return isDismissed(window.settings.getString<string>(LEDGER, ""), message);
  } catch {
    return false;
  }
}

function rememberDismissal(message: string): void {
  try {
    const stored = window.settings.getString<string>(LEDGER, "");
    const next = withDismissal(stored, message);
    if (next !== stored) window.settings.set(LEDGER, next);
  } catch {
    // Nothing to do: the notice comes back next session, which is the safe way
    // round for something the reader was told once.
  }
}

/**
 * `remember` outlives the session: the reader closing this notice means they
 * do not want to see it again, not that they do not want to see it now.
 *
 * Offered only to notices with no duration. `sl-after-hide` cannot say why an
 * alert closed, so on one that dismisses itself a timeout would be recorded as
 * a decision -- and a reader who simply looked away would never be told again.
 */
function toast(
  message: string,
  variant: string,
  icon: string,
  { duration, remember = false }: { duration?: number; remember?: boolean } = {},
) {
  const durable = remember && duration === undefined;
  if (durable && dismissedBefore(message)) return undefined;

  const alert = Object.assign(document.createElement("sl-alert"), {
    variant,
    closable: true,
    duration,
    innerHTML: `<sl-icon name="${icon}" slot="icon"></sl-icon>${message}`,
  });
  if (durable) {
    alert.addEventListener("sl-after-hide", () => rememberDismissal(message), { once: true });
  }
  document.body.append(alert);
  return alert.toast();
}

/**
 * Record a failure, without putting anything over the map.
 *
 * This used to raise a "Something went wrong" toast, once a session. The status
 * pill says the same thing better: it is always on screen, it says which kind
 * of trouble it is, the diagnostics behind it name the failing endpoint, and it
 * clears itself when the backend recovers -- where the toast said nothing the
 * pill did not, sat over the map until it was closed, and told the reader to
 * reload a page that would recover without it. The model comparison, which
 * reports open-meteo failing through here, shows its own error in its panel.
 *
 * console.error, not log: the Sentry CaptureConsole integration is configured
 * for the error level, and this is the one path errors are reported through.
 */
export function reportError(message: unknown) {
  console.error(message);
}

export function reportToast(message: string, variant = "primary", icon = "info-circle") {
  return toast(message, variant, icon, { duration: 15000 });
}

/**
 * Whether the replay notice has been shown this session.
 *
 * The flag arrives on every radar refresh, which is every five minutes and
 * again on every poke, pan and foreground. The reader needs telling once.
 */
let replayAnnounced = false;

/** For tests and for a deliberate re-arm. */
export function resetReplayNotice() {
  replayAnnounced = false;
}

/**
 * Say that the map is showing a recording.
 *
 * Replay rewrites every timestamp in a recorded storm to the present, so the
 * radar, the cells, the lightning and the "last updated" pill are all
 * indistinguishable from live -- deliberately, because that is what makes it a
 * useful test of the real thing. Nobody can tell by looking, so they have to be
 * told. No duration: this is a standing condition, not an event, and it stays
 * until it is dismissed.
 *
 * Remembered once dismissed, because the condition outlives the page: staging
 * replays for days at a time, and a reader who has been told is told again on
 * every reload otherwise.
 */
export function reportReplay(announced = replayAnnounced) {
  if (announced) return undefined;
  replayAnnounced = true;
  return toast(
    "<b>This is not live weather.</b> The stack is replaying a recorded storm, with every "
      + "timestamp rewritten to now.",
    "warning",
    "clock-history",
    { remember: true },
  );
}
