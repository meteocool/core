// XXX this thing has a problem where the datatypes are lost when stuff is saved to localstroage.

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

    const local = localStorage.getItem(key);
    if (local) {
      if (this.settings[key].type === "boolean") {
        return local === "true";
      }
      return local;
    }
    return this.settings[key].default;
  }

  setCb(key, cb) {
    if (typeof key !== "string") {
      return;
    }
    this.settings[key].cb = cb;
  }

  set(key, value) {
    if (typeof key !== "string") {
      return;
    }
    if (typeof value !== this.settings[key].type) {
      // eslint-disable-line valid-typeof
      return;
    }

    const old = this.get(key);

    if (old !== value && this.settings[key].default !== value) {
      localStorage.setItem(key, value);
    } else if (
      this.settings[key].default === value &&
      localStorage.getItem(key) !== null
    ) {
      // remove from localstorage if value is reset to default
      localStorage.removeItem(key);
    }

    if (old !== this.get(key)) {
      if (this.settings[key].cb) {
        this.settings[key].cb(value);
      }
    }
  }

  cb(key) {
    if (typeof key !== "string") {
      return;
    }
    if (this.settings[key].cb) {
      this.settings[key].cb(this.get(key));
    }
  }

  injectSettings(newSettings) {
    for (const key in newSettings) {
      this.set(key, newSettings[key]);
    }
  }
}

/* vim: set ts=2 sw=2 expandtab: */
