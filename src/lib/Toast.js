// eslint-disable-next-line import/prefer-default-export
export function reportError(
  message,
  type = "warning",
  icon = "exclamation-triangle",
) {
  const alert = Object.assign(document.createElement("sl-alert"), {
    type,
    closable: true,
    innerHTML: `
        <sl-icon name="${icon}" slot="icon"></sl-icon>
        <b>Connection Lost.</b> Please reload the page or contact support@meteocool.com if the problem persists.
      `,
  });
  document.body.append(alert);
  console.log(message);
  return alert.toast();
}

export function reportToast(message, type = "primary", icon = "info-circle") {
  const alert = Object.assign(document.createElement("sl-alert"), {
    type,
    closable: true,
    duration: 15000,
    innerHTML: `<sl-icon name="${icon}" slot="icon"></sl-icon>${message}`,
  });
  document.body.append(alert);
  return alert.toast();
}
