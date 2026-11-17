# Stylus quick dial

The viewer subscribes to the local `StylusShortcut` Expo module only while focused. Android S Pen barrel-button events (hover/contact), supported Apple Pencil double taps, and Apple Pencil Pro squeeze-end events open a non-modal quick palette. Where the hardware button cannot fire (unsupported pencils, web, a finger-only iPhone), the viewer's **pen tool button** in the top bar summons the same palette; the palette is not an item of the top bar itself and, apart from the pen button and the hardware shortcut, nothing renders it. Pressing the pen button again closes it, and a long press on the pen button opens the full pen card that the palette would otherwise cover. OS-disabled Pencil gestures/system shortcuts remain respected; a native bridge does not imply every pen supports the shortcut.

The palette reuses the toolbar's `ToolArt`. The latest requested design is a compact translucent semicircle rotated as ONE whole 0 degrees (rounded face up, flat edge below), with enlarged thick tool artwork retaining its original radial fan, NO logo/footer, a continuous width slider WITHOUT a visible number, and the user's representative colors (`viewer.favoriteColors`, unchanged order). Artwork proportions never change stroke width. Tool/color/width changes use the existing `onCfg` path and its per-tool persistence.

## Input invariants

- Pen/Pencil writes and erases; fingers and palms remain navigation only.
- The palette is not registered in the top bar. It opens from the pen tool button (or the hardware pen button) and is absent otherwise: no top-bar icon, no always-visible shape next to the logo.
- A normal pen contact outside tool options dismisses options and begins that SAME stroke. It is not a sacrificial close-only contact.
- S Pen button-held contact rejects ink on the UI thread, using per-contact Android `buttonState` from the RNGH patch. A button change without movement is included.
- A shortcut cancels an unfinished stroke across mounted canvases. Cancelling an eraser restores the pre-gesture ink. Committed ink is not deleted.
- Dial controls do not sit under a full-screen touch-blocking backdrop. Position is converted from native screen points into viewer-local points and clamped inside the overlay.
- Blur/unmount/background remove the observer or close the palette. No global Window callback replacement remains active after native cleanup.

## Evidence boundary

Local callback/geometry/module-wrapper tests and browser interactions cover selection, slider changes, dismissal + first stroke, and bounds. Native CI compiles both integrations. Neither browser input nor a simulator without a physical stylus verifies S Pen or Apple Pencil hardware gestures.

Before claiming hardware validation, test on Galaxy Tab with S Pen and an iPad with the corresponding Pencil:
1. Button while hovering, button held while touching, button pressed during writing, and release/repress: one opening per press, no accidental dots/strokes, next normal stroke works.
2. Pencil double tap / Pro squeeze with enabled system preference: opens once; disabled preference does not trigger it.
3. Tool, slider and representative color selection; first outside pen down both closes and writes, fingers still never ink.
4. Rotation, split view, app background/foreground, viewer exit, simultaneous palm contact, undo after cancelled erasing.

## Glass implementation

Expo BlurView uses a sibling BlurTargetView on Android, so the target never includes the palette itself. Android API31+ uses native Dimezis blur; older Android uses the supported translucent fallback to avoid expensive software blur. iOS uses ultra-thin material and web uses backdrop-filter. Shared directional gradients, a hairline reflection and a soft shadow retain the visual direction across platforms. Physical-device appearance/performance remains unverified.

The palette position is clamped using its rotated bounding box. The slider projects absolute pointer coordinates back onto its rotated local axis; simply subtracting the screen-space left edge is not sufficient. The full-range diagonal drag was verified in the browser.

## Pen-button delivery (1.6.20)

Hardware could not be held, so the bridge now observes every form a barrel-button press is known to take and reports
what a device really sent:

- Android `MotionEvent` on a stylus pointer: `BUTTON_STYLUS_PRIMARY/SECONDARY`, and the generic
  `BUTTON_SECONDARY/TERTIARY` bits (a stylus has no mouse buttons); `ACTION_BUTTON_PRESS/RELEASE`; Samsung's legacy
  button-contact actions 211/212/213. Stylus-button **key** events 308–310 are forwarded too (311, the tail button,
  belongs to the system). Everything stays pass-through.
- A contact with any of those bits set never deposits ink (`PEN_BUTTON_BITS` in `InkCanvas`).
- `takeStylusDiagnostics()` returns counts and button/key codes only. The viewer sends one line per app session to the
  diagnostics channel when a pen-button-like signal was seen ("stylus shortcut android emitted=… buttonStates=[…]"),
  or, on iOS, when a Pencil tap/squeeze arrived ("… tap=… tapPreferenceOff=…"). A device whose presses arrive but do not
  open the palette is visible there as `emitted=0` with non-empty codes.
- On Galaxy devices the system's own Air command can be bound to the same button; when it opens, this app's window
  loses focus and the press is counted under `unfocused`.

The viewer lab drives this path on an emulator with a `uinput` virtual stylus (evdev `BTN_TOOL_PEN`, `BTN_TOUCH`,
`BTN_STYLUS`): hover + barrel button, button held during contact, and plain strokes against the open pen card and
palette. That is the AOSP input path, not a Samsung S Pen.
