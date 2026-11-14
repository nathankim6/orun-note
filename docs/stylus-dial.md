# Stylus quick dial

The viewer subscribes to the local `StylusShortcut` Expo module only while focused. Android S Pen barrel-button events (hover/contact), supported Apple Pencil double taps, and Apple Pencil Pro squeeze-end events open a non-modal quick palette. Unsupported pencils and web can use the toolbar's **펜 다이얼** button. OS-disabled Pencil gestures/system shortcuts remain respected; a native bridge does not imply every pen supports the shortcut.

The palette reuses the toolbar's `ToolArt`. The latest requested design is a compact translucent semicircle rotated as ONE whole -38 degrees toward upper-left, with enlarged thick tool artwork retaining its original radial fan, NO logo/footer, a continuous width slider WITHOUT a visible number, and the user's representative colors (`viewer.favoriteColors`, unchanged order). Artwork proportions never change stroke width. Tool/color/width changes use the existing `onCfg` path and its per-tool persistence.

## Input invariants

- Pen/Pencil writes and erases; fingers and palms remain navigation only.
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
