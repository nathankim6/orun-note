// 옳은Note: make react-native-gesture-handler report the RIGHT pointer type per touch, like Samsung Notes / GoodNotes do.
//  Android: touch-down events were dispatched BEFORE the handler updated its pointer type, and only ACTION_DOWN (first finger)
//           updated it — so the first pen stroke after any finger touch, the first stroke on a fresh page, or a pen landing
//           while the palm rests was reported as a finger and rejected. Pressure was read from pointer 0 (the palm).
//  iOS:     the type came from an arbitrary touch ([allTouches anyObject]) — with a resting palm the Pencil was randomly a "finger";
//           pressure also came from an arbitrary touch.
const fs = require('fs');
const base = 'node_modules/react-native-gesture-handler/';
const edits = [
  { f: 'android/src/main/java/com/swmansion/gesturehandler/core/GestureHandler.kt', from: '  private fun setPointerType(event: MotionEvent) {\n    pointerType = event.getPointerType(event.actionIndex)\n  }', to: '  fun setPointerType(event: MotionEvent) {\n    pointerType = event.getPointerType(event.actionIndex)\n  }' },
  { f: 'android/src/main/java/com/swmansion/gesturehandler/core/GestureHandler.kt', from: '    if (sourceEvent.action == MotionEvent.ACTION_DOWN ||\n      sourceEvent.action == MotionEvent.ACTION_HOVER_ENTER ||', to: '    if (sourceEvent.action == MotionEvent.ACTION_DOWN ||\n      sourceEvent.actionMasked == MotionEvent.ACTION_POINTER_DOWN ||\n      sourceEvent.action == MotionEvent.ACTION_HOVER_ENTER ||' },
  { f: 'android/src/main/java/com/swmansion/gesturehandler/core/GestureHandlerOrchestrator.kt', from: '    if (handler.needsPointerData) {\n      handler.updatePointerData(event, sourceEvent)\n    }', to: '    if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {\n      // orun-note patch: tag the touch-down event with the type of the pointer that just went down (pen vs finger/palm)\n      handler.setPointerType(sourceEvent)\n    }\n    if (handler.needsPointerData) {\n      handler.updatePointerData(event, sourceEvent)\n    }' },
  { f: 'android/src/main/java/com/swmansion/gesturehandler/core/StylusData.kt', from: '      val altitudeAngle = (PI / 2) - event.getAxisValue(MotionEvent.AXIS_TILT).toDouble()\n      val pressure = event.getPressure(0).toDouble()\n      val orientation = event.getOrientation(0).toDouble()', to: '      var si = 0\n      for (i in 0 until event.pointerCount) { if (event.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) { si = i; break } }\n      val altitudeAngle = (PI / 2) - event.getAxisValue(MotionEvent.AXIS_TILT, si).toDouble()\n      val pressure = event.getPressure(si).toDouble()\n      val orientation = event.getOrientation(si).toDouble()' },
  { f: 'android/src/main/java/com/swmansion/gesturehandler/core/PanGestureHandler.kt', from: '    if (event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {\n      stylusData = StylusData.fromEvent(event)', to: '    if ((0 until event.pointerCount).any { event.getToolType(it) == MotionEvent.TOOL_TYPE_STYLUS }) {\n      stylusData = StylusData.fromEvent(event)' },
  { f: 'apple/RNGestureHandler.mm', from: '- (void)setCurrentPointerTypeForEvent:(UIEvent *)event\n{\n  UITouch *touch = [[event allTouches] anyObject];\n', to: '- (void)setCurrentPointerTypeForEvent:(UIEvent *)event\n{\n  UITouch *touch = [[event allTouches] anyObject];\n  // orun-note patch: an Apple Pencil touch wins over resting palm / finger touches\n  for (UITouch *t in [event allTouches]) {\n    if (t.type == UITouchTypePencil && t.phase != UITouchPhaseEnded && t.phase != UITouchPhaseCancelled) { touch = t; break; }\n  }\n' },
  { f: 'apple/Handlers/RNPanHandler.m', from: '- (void)tryUpdateStylusData:(UIEvent *)event\n{\n  UITouch *touch = [[event allTouches] anyObject];\n', to: '- (void)tryUpdateStylusData:(UIEvent *)event\n{\n  UITouch *touch = [[event allTouches] anyObject];\n  // orun-note patch: read force / tilt from the Pencil, not from a resting palm\n  for (UITouch *t in [event allTouches]) {\n    if (t.type == UITouchTypePencil) { touch = t; break; }\n  }\n' },
  { f: 'apple/RNGestureHandlerPointerTracker.mm', from: "    @\"absoluteY\" : @(absolutePos.y)\n", to: "    @\"absoluteY\" : @(absolutePos.y),\n#if TARGET_OS_OSX\n    @\"pointerType\" : @2\n#else\n    // orun-note patch: identify EACH contact, never infer a palm type from an active Pencil elsewhere\n    @\"pointerType\" : @(touch.type == UITouchTypePencil ? 1 : (touch.type == UITouchTypeIndirectPointer ? 2 : 0))\n#endif\n" },
];
let applied = 0, already = 0, missing = [];
for (const e of edits) {
  const p = base + e.f; if (!fs.existsSync(p)) { missing.push(e.f + ' (file)'); continue; }
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(e.to)) { already++; continue; }
  if (!s.includes(e.from)) { missing.push(e.f); continue; }
  fs.writeFileSync(p, s.replace(e.from, e.to)); applied++;
}
console.log(`patch-rngh-stylus: applied ${applied}, already ${already}, missing ${missing.length}${missing.length ? ' -> ' + missing.join(', ') : ''}`);
if (missing.length && process.env.CI) { console.error('patch-rngh-stylus: gesture-handler changed; stylus fix NOT applied'); process.exit(1); }
