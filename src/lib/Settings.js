// XXX this thing has a problem where the datatypes are lost when stuff is saved to localstroage.

import Router from './Router';

export default class Settings {
  constructor(settingsCbs) {
    // expects a structure like this:
    // {
    //      "settingName": {"type": "boolean", "default": true, "cb": f},
    //      ....
    // }
    this.settings = settingsCbs;
    Object.keys(this.settings).forEach((key) => {
      if (this.settings[key].default !== this.get(key)) {
        this.cb(key);
      }
    });
  }

  get(key) {
    if (typeof key !== "string") {
      return null;
    }

    const url = new URL(document.location);
    const local = localStorage.getItem(key);
    switch (this.getSourceForKey(key)) {
      case "localStorage":
        if (local) {
          if (this.settings[key].type === "boolean") {
            return local === "true";
          }
          return local;
        }
        break;
      case "url":
        if (url.searchParams.has(key)) {
          return url.searchParams.get(key);
        }
        break;
      default:
        return null;
    }
    if (key in this.settings) {
      return this.settings[key].default;
    }
    return null;
  }

  setCb(key, cb, trigger = false) {
    if (typeof key !== "string") {
      return;
    }
    this.settings[key].cb = cb;
    if (trigger) cb(this.get(key));
  }

  cb(key) {
    if (typeof key !== "string") {
      return;
    }
    if (this.settings[key].cb) {
      this.settings[key].cb(this.get(key));
    }
  }

  set(key, value, apply = true) {
    if (typeof key !== "string") {
      return;
    }
    // eslint-disable-line valid-typeof
    if (typeof value !== this.settings[key].type) {
      console.log(`Type missmatch for key ${key}`);
      return;
    }

    const old = this.get(key);
    console.log(`Updating ${key} => ${value} with old ${old}, apply=${apply}`);
    const url = new URL(window.location);
    switch (this.getSourceForKey(key)) {
      case "localStorage":
        if (old !== value && this.settings[key].default !== value) {
          localStorage.setItem(key, value);
        } else if (this.settings[key].default === value && localStorage.getItem(key) !== null) {
          // remove from localstorage if value is reset to default
          localStorage.removeItem(key);
        }
        break;
      case "url":
        if (old !== value && this.settings[key].default !== value) {
          url.searchParams.set(key, value);
          window.history.pushState({ location: window.location.toString() }, `meteocool 2.0 ${window.location.toString()}`, url);
        } else if (this.settings[key].default === value && url.searchParams.has(key)) {
          url.searchParams.delete(key);
          window.history.pushState({ location: window.location.toString() }, "meteocool 2.0", url);
        }
        break;
      default:
        break;
    }

    if (old !== this.get(key)) {
      if (this.settings[key].cb && apply) {
        this.settings[key].cb(value);
      }
    }
  }

  getSourceForKey(key) {
    let source = "localStorage";
    if ("source" in this.settings[key]) {
      source = this.settings[key].source;
    }
    return source;
  }

  injectSettings(newSettings) {
    for (const key in newSettings) {
      this.set(key, newSettings[key]);
    }
  }
}

/* vim: set ts=2 sw=2 expandtab: */
