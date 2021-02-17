export const uiConstantsDefault = {
  "toast-stack-offset": "49px",
};

export function resetUIConstant(name) {
  document.documentElement.style.setProperty(`--${name}`, uiConstantsDefault[name]);
}

export function initUIConstants() {
  Object.keys(uiConstantsDefault).forEach((key) => resetUIConstant(key));
}

export function setUIConstant(name, value) {
  document.documentElement.style.setProperty(`--${name}`, value);
}
