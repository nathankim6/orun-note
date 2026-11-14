# Stylus shortcut bridge

Local Expo module, discovered from `modules/`; requires a new native binary. No app-level dependency or plugin entry is needed. Older binaries and web safely return a no-op subscription.

```ts
import { addStylusShortcutListener } from '../../modules/stylus-shortcut';
// In a focused-viewer effect, not a global singleton:
const subscription = addStylusShortcutListener(({ kind, x, y }) => {
  // Cancel/discard any in-progress ink stroke BEFORE displaying the palette.
  // x/y are optional SCREEN logical points/dp. Convert to viewer-local coordinates,
  // clamp to its visible bounds, or use a centered fallback if coordinates are absent.
});
// on blur/unmount:
subscription.remove();
```

Events: `stylus-button`, `pencil-double-tap`, `pencil-squeeze`. `hasStylusShortcutBridge()` tests binary inclusion only, NOT hardware capabilities.

## Android

Observes current Activity `Window.Callback.dispatchTouchEvent` and `dispatchGenericMotionEvent`. Selects a stylus/eraser pointer, detects the rising edge of `BUTTON_STYLUS_PRIMARY | BUTTON_STYLUS_SECONDARY` including explicit button actions, and converts raw screen px to dp. Repeated held-button motion, tip-up, and hover-exit do not independently trigger. Mouse/finger events cannot trigger or reset the latch. Both event streams and their return values pass through unchanged. No interception, mutation, synthetic cancellation or event redispatch. Background/destroy/last-listener cleanup disables the wrapper and restores the original callback **only if still owned**. If another library has wrapped this callback, the retained wrapper becomes inert and retains the module only weakly.

Integration MUST reject button-held pen contacts and cancel any active ink preview when receiving a shortcut. This bridge alone does not stop an incidental button-held dot: that is deliberately the ink engine's job, to preserve proper UP/CANCEL delivery and finger navigation. No Bluetooth Air Actions, remote buttons out of hover range, or Samsung system Air Command override are implemented; system/firmware may consume the button first. OEM behavior needs device QA.

## iOS

Adds `UIPencilInteraction` to the current controller view only while observed. Uses legacy double-tap on iOS 12.1–17.4 (app minimum 15.1), modern double-tap/hover pose and squeeze APIs on iOS17.5+. Only `.ended` squeeze emits; began/changed/cancelled do not. UIKit specifies only modern tap delegate fires when both delegates are present. Disabled Pencil interactions and the system-shortcut preference are respected; otherwise this app's shortcut intentionally opens its palette, as requested. No touch recognizer or drawing gesture is installed. Background/destroy/last-listener cleanup removes interaction and delegate. Key-window/active-app checks prevent inactive-window events. Optional hover location is converted from interaction-view coordinates to screen points.

Double-tap requires supported Pencil hardware (e.g. Pencil2/Pro); squeeze requires Pencil Pro. Pencil1/USB-C do not acquire unsupported gestures. No physical-device verification is claimed.

## Verification

- `node --test modules/stylus-shortcut/tests/bridge.test.cjs`: actual TS wrapper execution tests plus explicitly **source-only** native contract checks.
- `npx tsc --noEmit -p .`: app/bridge TypeScript check.
- `xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -target arm64-apple-ios15.1-simulator modules/stylus-shortcut/ios/PencilShortcutObserver.swift`: UIKit helper API/availability check, NOT an Expo native build.
- Native Android build, full Expo iOS build and real S Pen/Pencil tests are still required. Test hover press, contact press, held movement/landing, release/repress, palm-rest, finger pan/pinch, app blur/resume, viewer unmount, split-screen coordinates, repeated mount, disabled Pencil actions, double tap and cancelled/completed squeeze. Confirm no accidental ink or stuck gesture.

## Official SDK references inspected

- https://developer.android.com/reference/android/view/MotionEvent : button press/release use generic motion, stylus button masks.
- https://developer.android.com/reference/android/view/Window.Callback : both dispatch paths must preserve normal processing.
- https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features
- https://developer.apple.com/documentation/uikit/uipencilinteraction
- https://developer.apple.com/documentation/uikit/uipencilinteractiondelegate/pencilinteraction(_:didreceivesqueeze:)
- https://developer.apple.com/videos/play/wwdc2024/10214 : `.ended` squeeze and optional hover pose sample.
- Local Xcode27.1 SDK `UIKit.framework/Headers/UIPencilInteraction.h`: signatures, availability, mutually exclusive tap callbacks, hover location coordinate space.
