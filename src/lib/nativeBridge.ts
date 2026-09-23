/**
 * The interface the native apps drive the web app through.
 *
 * These globals are a public API: shipped iOS and Android builds call them by
 * name, so a rename here breaks installs already in the wild. Declaring them
 * in one place replaces the `(window as any)` casts that used to hide the
 * contract, and makes it checkable.
 *
 * Callers, for reference:
 *   ios/meteocool/ViewController.swift, SettingsViewController.swift,
 *   CustomeGestureRecognizer.swift
 *   android/app/src/main/java/com/meteocool/ui/map/WebFragment.kt
 *
 * Known gap: ViewController.swift also calls `window.setForecastLayer(slot)`,
 * `window.hidePlayButton()`, `window.showPlayButton()` and
 * `window.resetLayers()`, none of which this app defines -- those calls have
 * been failing silently in the webview. They are deliberately not declared
 * here: declaring them would suggest an implementation exists.
 */
import type { LayerManager } from "./LayerManager";
import type Settings from "./Settings";

/** The message names the web app posts to the iOS host. */
export type IosMessage =
  | "requestSettings"
  | "layerSwitcherOpened"
  | "layerSwitcherClosed"
  | "detailSheetExpanded"
  | "detailSheetCollapsed"
  | "impactLight"
  | "impactMedium";

/** The JS interface the Android host injects under the name `Android`. */
export interface AndroidBridge {
  requestSettings(): void;
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
        scriptHandler: { postMessage(message: IosMessage): void };
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

export {};
