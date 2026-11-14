package expo.modules.stylusshortcut

import android.os.Handler
import android.os.Looper
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

  override fun definition() = ModuleDefinition {
    Name("StylusShortcut")
    Events("onStylusShortcut")
    OnStartObserving { main.post { observing = true; attach() } }
    OnStopObserving { main.post { observing = false; detach() } }
    OnActivityEntersForeground { main.post { if (observing) attach() } }
    OnActivityEntersBackground { main.post { detach() } }
    OnActivityDestroys { main.post { detach() } }
    OnDestroy { main.post { observing = false; detach() } }
  }

  private fun attach() {
    val next = appContext.currentActivity?.window ?: return
    if (window === next && observer != null) return
    detach()
    val original = next.callback ?: return
    val weak = WeakReference(this)
    val density = next.decorView.resources.displayMetrics.density
    val wrapper = ShortcutCallback(original) { event, index ->
      val module = weak.get() ?: return@ShortcutCallback
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

internal class ShortcutCallback(
  val original: Window.Callback,
  private val emit: (MotionEvent, Int) -> Unit
) : Window.Callback by original {
  var active = true
  private var held = false
  private var focused = true

  private fun observe(event: MotionEvent) {
    if (!active || !focused) return
    var stylus = -1
    for (i in 0 until event.pointerCount) {
      val type = event.getToolType(i)
      if (type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER) { stylus = i; break }
    }
    if (stylus < 0) return // finger/mouse events cannot release or trigger a pen button
    val mask = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY
    val state = when {
      event.actionMasked == MotionEvent.ACTION_BUTTON_PRESS && event.actionButton and mask != 0 -> true
      event.actionMasked == MotionEvent.ACTION_BUTTON_RELEASE && event.actionButton and mask != 0 -> event.buttonState and mask != 0
      else -> event.buttonState and mask != 0
    }
    if (state && !held) emit(event, stylus)
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
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    focused = hasFocus
    // Keep the latch across temporary focus loss; a still-held button is not a new press.
    original.onWindowFocusChanged(hasFocus)
  }
}
