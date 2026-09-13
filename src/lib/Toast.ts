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

export function reportError(message: unknown, variant = "warning", icon = "exclamation-triangle") {
  // console.error, not log: the Sentry CaptureConsole integration is configured
  // for the error level, and this is the one path errors are reported through.
  console.error(message);
  return toast(
    "<b>Something went wrong.</b> Please reload the page, or contact support@meteocool.com if it keeps happening.",
    variant,
    icon,
  );
}

export function reportToast(message: string, variant = "primary", icon = "info-circle") {
  return toast(message, variant, icon, { duration: 15000 });
}
