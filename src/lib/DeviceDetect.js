export default class DeviceDetect {
  static isIos() {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent);
  }

  static isInStandaloneMode() {
    return ("standalone" in window.navigator) && (window.navigator.standalone);
  }

  /*
   * XXX change the mobile= parameter readout to something more elegant.
   * This would break if the ifs are re-orderd...
   */
  static getAndroidAPILevel() {
    if (window.location.search.indexOf("mobile=android2") !== -1) {
      return 2;
    } if (window.location.search.indexOf("mobile=android") !== -1) {
      return 1;
    }
    return -1;
  }

  static getIosAPILevel() {
    if (DeviceDetect.isIos()) {
      if (window.location.search.indexOf("mobile=ios3") !== -1) {
        return 3;
      }
      if (window.location.search.indexOf("mobile=ios2") !== -1) {
        return 2;
      }
    }
    return -1;
  }

  static isApp() {
    if (DeviceDetect.isIos()) {
      if (window.location.search.indexOf("mobile=ios") !== -1) {
        return true;
      }
    } else {
      // XXX missing double check (like w/ iOS) because of missing isAndroid() method
      if (window.location.search.indexOf("mobile=android") !== -1) {
        return true;
      }
      return false;
    }
    return false;
  }
}
