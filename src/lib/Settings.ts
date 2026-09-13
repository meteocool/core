// XXX this thing has a problem where the datatypes are lost when stuff is saved to localstroage.

import Router from './Router';

/** One setting's declaration, as App.svelte writes it. */
export interface SettingDefinition {
  type: "boolean" | "string" | "number";
  default: boolean | string | number;
  cb?: (value: SettingValue) => void;
  /** Where the value lives. URL-sourced settings are not persisted. */
  source?: "localStorage" | "url";
}

export type SettingValue = boolean | string | number | null;

/**
 * Settings, persisted to localStorage or the URL, and the inbound half of the
 * native bridge: the apps call injectSettings() on the window.settings
 * instance. See src/lib/nativeBridge.ts.
 */
export default class Settings {
  private settings: Record<string, SettingDefinition>;

  constructor(settingsCbs: Record<string, SettingDefinition>) {
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

  get(key: string): SettingValue {
    if (typeof key !== "string") {
      return null;
    }

    const url = new URL(document.location.href);
    let local: string | null = null;
    try {
      if (localStorage) local = localStorage.getItem(key);
    } catch (error) {
      console.error(error);
    }
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

  /**
   * The value as a boolean.
   *
   * localStorage is string-keyed, so a stored value always comes back as a
   * string and the declared type is the only way to recover what it was.
   */
  getBoolean(key: string): boolean {
    const value = this.get(key);
    return typeof value === "string" ? value === "true" : Boolean(value);
  }

  /** The value as a string, falling back to `fallback` when unset. */
  getString<T extends string>(key: string, fallback: T): T {
    const value = this.get(key);
    return value === null || value === undefined ? fallback : (String(value) as T);
  }

  setCb(key: string, cb: (value: SettingValue) => void, trigger = false) {
    if (typeof key !== "string") {
      return;
    }
    this.settings[key].cb = cb;
    if (trigger) cb(this.get(key));
  }

  cb(key: string) {
    if (typeof key !== "string") {
      return;
    }
    if (this.settings[key].cb) {
      this.settings[key].cb(this.get(key));
    }
  }

  set(key: string, value: SettingValue, apply = true) {
    if (typeof key !== "string") {
      return;
    }
    if (!(key in this.settings)) {
      console.error(`Key ${key} not found in settings`);
      return;
    }

    // eslint-disable-line valid-typeof
    if (typeof value !== this.settings[key].type) {
      console.log(`Type missmatch for key ${key}`);
      return;
    }

    const old = this.get(key);
    console.log(`Updating ${key} => ${value} with old ${old}, apply=${apply}`);
    const url = new URL(window.location.href);
    switch (this.getSourceForKey(key)) {
      case "localStorage":
        if (old !== value && this.settings[key].default !== value) {
          // Both stores are string-keyed, which is why get() has to read the
          // declared type back to recover a boolean.
          localStorage.setItem(key, String(value));
        } else if (this.settings[key].default === value && localStorage.getItem(key) !== null) {
          // remove from localstorage if value is reset to default
          localStorage.removeItem(key);
        }
        break;
      case "url":
        if (old !== value && this.settings[key].default !== value) {
          url.searchParams.set(key, String(value));
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

  getSourceForKey(key: string): NonNullable<SettingDefinition["source"]> {
    return this.settings[key]?.source ?? "localStorage";
  }

  injectSettings(newSettings: Record<string, SettingValue>) {
    console.log(newSettings);
    for (const key in newSettings) {
      this.set(key, newSettings[key]);
    }
  }
}

/* vim: set ts=2 sw=2 expandtab: */
