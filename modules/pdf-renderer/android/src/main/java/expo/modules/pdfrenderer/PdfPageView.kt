package expo.modules.pdfrenderer

import android.content.ComponentCallbacks2
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.LruCache
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * In-memory page bitmaps for [PdfPageView]. Pages are drawn by PdfRenderer straight into a Bitmap that the view paints:
 * no JPEG encode, no disk write, no bridge hop, no image decode. Visible pages are served newest-first (during a fling
 * the page that just scrolled in matters more than one already scrolled away); prefetch ("warm") jobs only run when no
 * visible page is waiting.
 */
internal object PageBitmaps {
  private val maxBytes: Int = (Runtime.getRuntime().maxMemory() / 2).coerceIn(48L shl 20, 256L shl 20).toInt()
  private val cache = object : LruCache<String, Bitmap>(maxBytes) { override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount }
  private class Job(val key: String, val stillWanted: () -> Boolean, val run: () -> Unit)
  private val lock = Object()
  private val visible = ArrayDeque<Job>()
  private val warm = ArrayDeque<Job>()
  @Volatile private var worker: Thread? = null

  fun key(uri: String, index: Int, width: Int) = "$uri|$index|$width"
  fun get(key: String): Bitmap? = cache.get(key)
  fun put(key: String, bmp: Bitmap) { cache.put(key, bmp) }
  fun clear() { cache.evictAll(); synchronized(lock) { warm.clear() } }
  fun trim(level: Int) {
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) cache.trimToSize(maxBytes / 4)
    if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) cache.evictAll()
  }

  fun visible(key: String, stillWanted: () -> Boolean, run: () -> Unit) = enqueue { visible.addFirst(Job(key, stillWanted, run)) }
  /** Replaces the previous prefetch list (the scroll direction may have changed). */
  fun warm(keys: List<Pair<String, () -> Unit>>) = enqueue { warm.clear(); keys.forEach { (k, r) -> if (cache.get(k) == null) warm.addLast(Job(k, { true }, r)) } }

  private fun enqueue(change: () -> Unit) {
    synchronized(lock) { change(); lock.notifyAll() }
    if (worker == null) synchronized(this) {
      if (worker == null) worker = Thread({ loop() }, "pdf-page-view").apply { isDaemon = true; priority = Thread.NORM_PRIORITY + 1; start() }
    }
  }
  private fun loop() {
    while (true) {
      val job = synchronized(lock) {
        while (visible.isEmpty() && warm.isEmpty()) lock.wait()
        visible.removeFirstOrNull() ?: warm.removeFirst()
      }
      if (!job.stillWanted()) continue
      try { job.run() } catch (_: Throwable) {}
    }
  }
}

/** Draws one PDF page from an in-memory bitmap. The JS layer keeps ink, zoom tiles and fallbacks on top of it. */
class PdfPageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPageReady by EventDispatcher()
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private val dst = Rect()
  private var bitmap: Bitmap? = null
  private var shownKey: String? = null
  @Volatile private var wantedKey: String? = null
  var source: String? = null
  var index: Int = 0
  var pixelWidth: Int = 0

  init { setWillNotDraw(false); setBackgroundColor(Color.WHITE) }

  fun update() {
    val uri = source ?: return
    val w = (if (pixelWidth > 0) pixelWidth else width).coerceAtMost(PdfRendererModule.PAGE_VIEW_WIDTH)
    if (w <= 0) return
    val key = PageBitmaps.key(uri, index, w)
    if (key == shownKey || key == wantedKey) return
    val hit = PageBitmaps.get(key)
    if (hit != null) { wantedKey = null; show(key, hit, 0.0, true); return }
    wantedKey = key
    val page = index; val started = System.nanoTime()
    PageBitmaps.visible(key, { wantedKey == key }) {
      val bmp = PageBitmaps.get(key) ?: try { PdfRendererModule.shared?.pageBitmap(uri, page, w)?.also { PageBitmaps.put(key, it) } } catch (_: Throwable) { null }
      post {
        if (wantedKey != key) return@post
        wantedKey = null
        if (bmp != null) show(key, bmp, (System.nanoTime() - started) / 1_000_000.0, false)
        else onPageReady(mapOf("ok" to false, "page" to page))
      }
    }
  }

  private fun show(key: String, bmp: Bitmap, ms: Double, cached: Boolean) {
    shownKey = key; bitmap = bmp; invalidate()
    onPageReady(mapOf("ok" to true, "page" to index, "width" to bmp.width, "ms" to ms, "cached" to cached))
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val b = bitmap ?: return
    if (b.isRecycled) return
    dst.set(0, 0, width, height)
    canvas.drawBitmap(b, null, dst, paint)
  }

  override fun onDetachedFromWindow() { super.onDetachedFromWindow(); wantedKey = null }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); if (shownKey == null) update() }
}
