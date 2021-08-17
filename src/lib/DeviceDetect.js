let device = "web";

// eslint-disable-next-line import/prefer-default-export
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
