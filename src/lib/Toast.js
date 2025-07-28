
import { logger } from './logger.js';

export function reportError(
  message,
  type = "warning",
  icon = "exclamation-triangle",
) {
  // const alert = Object.assign(document.createElement("sl-alert"), {
  //   type,
  //   closable: true,
  //   innerHTML: `
  //       <sl-icon name="${icon}" slot="icon"></sl-icon>
  //       <b>Connection Lost.</b> Please reload the page or contact support@meteocool.com if the problem persists.
  //     `,
  // });
  // document.body.append(alert);
  logger.log(message);
  // return alert.toast();
}

export function reportToast(message, type = "primary", icon = "info-circle") {
  const alert = Object.assign(document.createElement("sl-alert"), {
    type,
    closable: true,
    duration: 15000,
  });
  
  // Safely create icon element
  const iconElement = document.createElement("sl-icon");
  iconElement.setAttribute("name", icon);
  iconElement.setAttribute("slot", "icon");
  
  // Safely set text content to prevent XSS
  const textNode = document.createTextNode(message);
  
  alert.appendChild(iconElement);
  alert.appendChild(textNode);
  document.body.append(alert);
  return alert.toast();
}
