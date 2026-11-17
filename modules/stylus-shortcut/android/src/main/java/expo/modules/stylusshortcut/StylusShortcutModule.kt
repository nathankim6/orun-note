package expo.modules.stylusshortcut

import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/** Observe, never consume, mutate, cancel or redispatch an input event. */
class StylusShortcutModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var observing = false
  private var window: Window? = null
  private var observer: ShortcutCallback? = null
  private val diagnostics = StylusDiagnostics()

  override fun definition() = ModuleDefinition {
    Name("StylusShortcut")
    Events("onStylusShortcut")
    OnStartObserving { main.post { observing = true; attach() } }
    OnStopObserving { main.post { observing = false; detach() } }
    OnActivityEntersForeground { main.post { if (observing) attach() } }
    OnActivityEntersBackground { main.post { detach() } }
    OnActivityDestroys { main.post { detach() } }
    OnDestroy { main.post { observing = false; detach() } }
    /** What the pen actually sent since the last call (counts and codes only, never positions or content). */
    Function("takeDiagnostics") { diagnostics.take() }
  }

  private fun attach() {
    val next = appContext.currentActivity?.window ?: return
    if (window === next && observer != null) return
    detach()
    val original = next.callback ?: return
    val weak = WeakReference(this)
    val density = next.decorView.resources.displayMetrics.density
    val wrapper = ShortcutCallback(original, diagnostics) { event, index ->
      val module = weak.get() ?: return@ShortcutCallback
      if (event == null) { module.sendEvent("onStylusShortcut", mapOf("kind" to "stylus-button")); return@ShortcutCallback }
      // Android 10+ supports per-pointer raw coordinates. Translation fallback handles older APIs.
      val x = if (android.os.Build.VERSION.SDK_INT >= 29) event.getRawX(index) else event.rawX + event.getX(index) - event.x
      val y = if (android.os.Build.VERSION.SDK_INT >= 29) event.getRawY(index) else event.rawY + event.getY(index) - event.y
      module.sendEvent("onStylusShortcut", mapOf("kind" to "stylus-button", "x" to x / density, "y" to y / density))
    }
    window = next
    observer = wrapper
    next.callback = wrapper
  }

  private fun detach() {
    val wrapper = observer ?: return
    wrapper.active = false
    // Another library may have wrapped us. Never overwrite its newer callback.
    if (window?.callback === wrapper) window?.callback = wrapper.original
    observer = null
    window = null
  }
}

/** Counters for field diagnosis: which form a pen button press takes on a given device. Main thread only for writes. */
internal class StylusDiagnostics {
  private val lock = Any()
  private var stylusEvents = 0
  private var hoverEvents = 0
  private var emitted = 0
  private var unfocused = 0
  private val buttonStates = sortedSetOf<Int>()
  private val actionButtons = sortedSetOf<Int>()
  private val vendorActions = sortedSetOf<Int>()
  private val keyCodes = sortedSetOf<Int>()
  fun motion(event: MotionEvent, focused: Boolean) = synchronized(lock) {
    stylusEvents++
    val action = event.actionMasked
    if (action == MotionEvent.ACTION_HOVER_ENTER || action == MotionEvent.ACTION_HOVER_MOVE || action == MotionEvent.ACTION_HOVER_EXIT) hoverEvents++
    if (event.buttonState != 0 && buttonStates.size < 12) buttonStates.add(event.buttonState)
    if ((action == MotionEvent.ACTION_BUTTON_PRESS || action == MotionEvent.ACTION_BUTTON_RELEASE) && actionButtons.size < 12) actionButtons.add(event.actionButton)
    if (action > MotionEvent.ACTION_BUTTON_RELEASE && vendorActions.size < 12) vendorActions.add(action)
    if (!focused && event.buttonState != 0) unfocused++
  }
  fun key(code: Int) = synchronized(lock) { if (keyCodes.size < 12) keyCodes.add(code) }
  fun emit() = synchronized(lock) { emitted++ }
  fun take(): Map<String, Any> = synchronized(lock) {
    val out = mapOf<String, Any>(
      "stylusEvents" to stylusEvents, "hoverEvents" to hoverEvents, "emitted" to emitted, "unfocused" to unfocused,
      "buttonStates" to buttonStates.toList(), "actionButtons" to actionButtons.toList(), "vendorActions" to vendorActions.toList(), "keyCodes" to keyCodes.toList()
    )
    stylusEvents = 0; hoverEvents = 0; emitted = 0; unfocused = 0
    buttonStates.clear(); actionButtons.clear(); vendorActions.clear(); keyCodes.clear()
    out
  }
}

internal class ShortcutCallback(
  val original: Window.Callback,
  private val diagnostics: StylusDiagnostics,
  private val emit: (MotionEvent?, Int) -> Unit
) : Window.Callback by original {
  var active = true
  private var held = false
  private var focused = true

  companion object {
    // A stylus has no mouse buttons: on a stylus pointer the generic secondary/tertiary bits can only be its barrel
    // button(s). Some firmware reports the barrel button that way instead of BUTTON_STYLUS_*.
    const val BUTTON_MASK = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY or MotionEvent.BUTTON_TERTIARY
    // Samsung's legacy action codes for a contact made while the S Pen side button is held (down / up / move).
    const val SAMSUNG_PEN_DOWN = 211
    const val SAMSUNG_PEN_UP = 212
    const val SAMSUNG_PEN_MOVE = 213
    // KeyEvent.KEYCODE_STYLUS_BUTTON_PRIMARY / SECONDARY / TERTIARY (API 34). The tail button (311) belongs to the system.
    val STYLUS_KEYS = setOf(308, 309, 310)
  }

  private fun observe(event: MotionEvent) {
    if (!active) return
    var stylus = -1
    for (i in 0 until event.pointerCount) {
      val type = event.getToolType(i)
      if (type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER) { stylus = i; break }
    }
    if (stylus < 0) return // finger/mouse events cannot release or trigger a pen button
    diagnostics.motion(event, focused)
    if (!focused) return
    val action = event.actionMasked
    val state = when {
      action == SAMSUNG_PEN_DOWN || action == SAMSUNG_PEN_MOVE -> true
      action == SAMSUNG_PEN_UP -> false
      action == MotionEvent.ACTION_BUTTON_PRESS && event.actionButton and BUTTON_MASK != 0 -> true
      action == MotionEvent.ACTION_BUTTON_RELEASE && event.actionButton and BUTTON_MASK != 0 -> event.buttonState and BUTTON_MASK != 0
      else -> event.buttonState and BUTTON_MASK != 0
    }
    if (state && !held) { diagnostics.emit(); emit(event, stylus) }
    held = state // do NOT clear on tip-up / hover-exit: the side button may still be held
  }
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    observe(event)
    return original.dispatchTouchEvent(event)
  }
  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    observe(event)
    return original.dispatchGenericMotionEvent(event)
  }
  /** Styluses that report their button as a key (USI / Bluetooth pens) instead of a motion-event button bit. */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (active && event.keyCode in STYLUS_KEYS) {
      diagnostics.key(event.keyCode)
      if (focused && KeyEvent.ACTION_DOWN == event.action && event.repeatCount == 0) { diagnostics.emit(); emit(null, -1) }
    }
    return original.dispatchKeyEvent(event)
  }
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    focused = hasFocus
    // Keep the latch across temporary focus loss; a still-held button is not a new press.
    original.onWindowFocusChanged(hasFocus)
  }
}
