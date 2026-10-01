/**
 * The interface the native apps drive the web app through.
 *
 * These globals are a public API: shipped iOS and Android builds call them by
 * name, so a rename here breaks installs already in the wild. Declaring them
 * in one place replaces the `(window as any)` casts that used to hide the
 * contract, and makes it checkable.
 *
 * Callers, for reference:
 *   ios/meteocool/ViewController.swift, lib/WebSettings.swift
 *   android/app/src/main/java/com/meteocool/ui/map/WebFragment.kt
 */
import type { LayerManager } from "./LayerManager";
import type Settings from "./Settings";

/** The message names the web app posts to the native hosts. */
export type NativeMessage =
  | "requestSettings"
  | "layerSwitcherOpened"
  | "layerSwitcherClosed"
  | "detailSheetExpanded"
  | "detailSheetCollapsed"
  | "drawerOpened"
  | "drawerClosed"
  | "impactLight"
  | "impactMedium";

/** The old name, from when only iOS was told. */
export type IosMessage = NativeMessage;

/** The JS interface the Android host injects under the name `Android`. */
export interface AndroidBridge {
  requestSettings(): void;
  /**
   * The same messages iOS gets on `scriptHandler`. Only Android 4.0 and later
   * define it, so callers must check it exists.
   */
  postMessage?(message: NativeMessage): void;
}

declare global {
  interface Window {
    /** The layer manager. The apps call window.lm.updateLocation(...). */
    lm: LayerManager;

    /** Settings. The apps call window.settings.injectSettings({...}). */
    settings: Settings;

    /** Called by both apps when the app returns to the foreground. */
    enterForeground?: () => void;

    /**
     * Called by iOS when the app leaves the foreground. Defined inside
     * NowcastPlayback's onMount, so it does not exist until that component
     * mounts -- an early call from the host is a no-op.
     */
    leaveForeground?: () => void;

    /** Opens the layer switcher. Defined by McLayerSwitcher. */
    openLayerswitcher?: () => void;

    /** Present only inside the iOS webview. */
    webkit?: {
      messageHandlers: {
        scriptHandler: { postMessage(message: NativeMessage): void };
      };
    };

    /** Debugging handles, attached for use from the console. */
    ll?: unknown;
    radar?: unknown;
    slr?: unknown;
    tc?: unknown;
    pu?: unknown;
  }

  /** Injected by the Android host; absent everywhere else. */
  const Android: AndroidBridge | undefined;
}

/**
 * Tell whichever native host the page runs in. A no-op in a browser, and on
 * Android builds older than 4.0, whose bridge only has requestSettings().
 */
export function postToNative(message: NativeMessage): void {
  if (typeof window !== "undefined" && window.webkit?.messageHandlers?.scriptHandler) {
    window.webkit.messageHandlers.scriptHandler.postMessage(message);
    return;
  }
  const android = typeof Android === "undefined" ? undefined : Android;
  if (typeof android?.postMessage === "function") android.postMessage(message);
}

let openDrawers = 0;

/**
 * Marks a drawer or panel as open over the map until the returned function is
 * called: a storm's sheet or corner panel, the model comparison, About,
 * Settings. The host hears `drawerOpened` when the first one opens and
 * `drawerClosed` when the last one goes, so a panel opened over a sheet does
 * not bring the buttons back when it closes.
 *
 * The native buttons float in the map's top corner, where the corner panel
 * sits on a wide screen and where a sheet pulled up reaches on a phone; CSS
 * cannot move them. Android hides them on this; iOS, which keys off
 * `detailSheetExpanded`, ignores it. Releasing twice is harmless.
 */
export function holdNativeChrome(): () => void {
  openDrawers += 1;
  if (openDrawers === 1) postToNative("drawerOpened");
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    openDrawers -= 1;
    if (openDrawers === 0) postToNative("drawerClosed");
  };
}
