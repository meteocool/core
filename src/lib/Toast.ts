function toast(message: string, variant: string, icon: string, { duration }: { duration?: number } = {}) {
  const alert = Object.assign(document.createElement("sl-alert"), {
    variant,
    closable: true,
    duration,
    innerHTML: `<sl-icon name="${icon}" slot="icon"></sl-icon>${message}`,
  });
  document.body.append(alert);
  return alert.toast();
}

/**
 * Whether the generic failure toast has already been shown this session.
 *
 * One backend outage is one piece of news, but it arrives once per call, and
 * the calls repeat: a poke, a pan, a refresh timer. Stacking five identical
 * "something went wrong" alerts over the map tells the reader nothing the first
 * one did not, and buries the map while it does it. After the first, the status
 * pill carries the state instead -- it is always visible, it says which kind of
 * trouble it is, and it goes away on its own when the backend recovers.
 */
let announced = false;

/** For tests and for a deliberate re-arm; nothing in the app calls this yet. */
export function resetErrorReporting() {
  announced = false;
}

export function reportError(message: unknown, variant = "warning", icon = "exclamation-triangle") {
  // console.error, not log: the Sentry CaptureConsole integration is configured
  // for the error level, and this is the one path errors are reported through.
  // Every failure goes here, toast or no toast, so nothing is lost to the
  // deduplication -- only the second alert on screen is.
  console.error(message);
  if (announced) return undefined;
  announced = true;
  return toast(
    "<b>Something went wrong.</b> Please reload the page, or contact support@meteocool.com if it keeps happening.",
    variant,
    icon,
  );
}

export function reportToast(message: string, variant = "primary", icon = "info-circle") {
  return toast(message, variant, icon, { duration: 15000 });
}
