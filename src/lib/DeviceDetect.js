let device = "web";

export default class DeviceDetect {
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
}
