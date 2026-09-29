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
