let device = "web";

export class DeviceDetect {
  static set(nDevice) {
    device = nDevice;
  }

  static isIos() {
    return device === "ios";
  }

  static isAndroid() {
    return device === "android";
  }

  static isApp() {
    return this.isIos() || this.isAndroid();
  }

  /** A Mac, whose keyboard says ⌃ where everyone else's says Ctrl. */
  static isMac() {
    if (typeof navigator === "undefined") return false;
    const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    return /mac/i.test(hints?.platform || navigator.platform || "");
  }

  static breakpoint() {
    if (window.innerWidth > 1620) {
      return "wide";
    }
    if (window.innerWidth > 1200) {
      return "reduced";
    }
    return "small";
  }
}
