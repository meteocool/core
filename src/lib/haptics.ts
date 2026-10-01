/**
 * One place for a tick of haptics, wherever the device can give one.
 *
 * Safari has no `navigator.vibrate`, so on iOS the only way to the Taptic
 * Engine is the native host: the apps listen for `impactLight` and
 * `impactMedium` on the script handler. The web gets the Vibration API where
 * it exists, which is Android browsers. Three strengths, named for what they
 * mark rather than for a motor:
 *
 *   tick    one step among many: a picker's notch, a strip's five minutes
 *   detent  a step that means something: now, a named direction, an option
 *   bump    an action that took: a long press registering
 */
import { DeviceDetect as dd } from "./DeviceDetect";
import { postToNative } from "./nativeBridge";

export type Haptic = "tick" | "detent" | "bump";

const WEB_MS: Record<Haptic, number> = { tick: 3, detent: 6, bump: 12 };

export function haptic(kind: Haptic): void {
  if (dd.isApp()) {
    postToNative(kind === "tick" ? "impactLight" : "impactMedium");
    return;
  }
  navigator.vibrate?.(WEB_MS[kind]);
}
