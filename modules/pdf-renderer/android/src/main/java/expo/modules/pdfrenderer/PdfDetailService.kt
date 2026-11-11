package expo.modules.pdfrenderer

import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.*
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/** Private wire protocol: no paths, URIs, passwords, or plaintext bytes in Binder messages. */
internal object PdfDetailProtocol {
  const val RENDER = 1
  const val CLOSE = 2
  const val RESULT = 3
  const val MAX_FULL_WIDTH = 4096
  const val MAX_PAGE_WIDTH = 16384
  const val MAX_FULL_PIXELS = 16_000_000L
  const val MAX_TILE_PIXELS = 12_000_000L
  const val TIMEOUT_MS = 45_000L
}

/** Runs under an isolated UID in :pdfdetail; only the host-supplied FDs grant document access. */
class PdfDetailService : Service() {
  private val busy = AtomicBoolean(false)
  private lateinit var thread: HandlerThread
  private lateinit var worker: Handler
  private var document: PdfRenderer? = null // accessed only by the single worker
  private var descriptor: ParcelFileDescriptor? = null
  private var documentKey: String? = null
  private var parentPid = 0
  private fun isIsolatedWorker(): Boolean {
    // Android reserves app IDs 90000..98999 for app-zygote isolated processes,
    // and 99000..99999 for other isolated processes (within each 100000-UID user).
    // Never trust the manifest alone: an ordinary app/host UID must fail closed.
    return android.os.Process.myUid() % 100000 in 90000..99999
  }
  private fun terminateWorker(hostPid: Int = parentPid) {
    if (isIsolatedWorker() && (hostPid <= 0 || hostPid != android.os.Process.myPid())) {
      android.os.Process.killProcess(android.os.Process.myPid())
    } else if (::worker.isInitialized) {
      // Misconfigured same-process service: no render was admitted, and never kill the host.
      worker.post { closeDocument(); thread.quitSafely() }
    }
  }
  private val ingress = Messenger(object : Handler(Looper.getMainLooper()) {
    override fun handleMessage(message: Message) {
      if (message.what == PdfDetailProtocol.CLOSE) {
        // Both actual UID class and caller PID/UID must differ before terminating.
        if (message.arg1 > 0 && message.arg2 == message.sendingUid && message.arg2 != android.os.Process.myUid()) {
          terminateWorker(message.arg1)
        }
        return
      }
      if (message.what != PdfDetailProtocol.RENDER) return
      val data = message.data
      data.classLoader = ParcelFileDescriptor::class.java.classLoader
      @Suppress("DEPRECATION")
      val input = data.getParcelable<ParcelFileDescriptor>("input")
      @Suppress("DEPRECATION")
      val output = data.getParcelable<ParcelFileDescriptor>("output")
      val reply = message.replyTo
      val id = message.arg1
      if (!isIsolatedWorker() || message.arg2 <= 0 || message.arg2 == android.os.Process.myPid() ||
        message.sendingUid == android.os.Process.myUid() || input == null || output == null || reply == null || !busy.compareAndSet(false, true)) {
        try { input?.close() } catch (_: Throwable) {}
        try { output?.close() } catch (_: Throwable) {}
        send(reply, id, Bundle().apply { putInt("error", 1) })
        return
      }
      parentPid = message.arg2
      val accepted = worker.post {
        val result = try { render(data, input, output) } catch (_: Throwable) {
          closeDocument()
          Bundle().apply { putInt("error", 2) }
        } finally {
          try { input.close() } catch (_: Throwable) {}
          try { output.close() } catch (_: Throwable) {}
          busy.set(false)
        }
        send(reply, id, result)
      }
      if (!accepted) {
        busy.set(false)
        try { input.close() } catch (_: Throwable) {}
        try { output.close() } catch (_: Throwable) {}
        send(reply, id, Bundle().apply { putInt("error", 3) })
      }
    }
  })

  override fun onCreate() {
    super.onCreate()
    if (!isIsolatedWorker()) return
    thread = HandlerThread("pdf-detail", android.os.Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    worker = Handler(thread.looper)
  }
  override fun onBind(intent: Intent): IBinder? = if (isIsolatedWorker()) ingress.binder else null
  override fun onDestroy() {
    // Kernel teardown closes stuck PDFium/FDs only after verifying actual isolation.
    // A bad manifest can never turn service teardown into host-process termination.
    terminateWorker()
    super.onDestroy()
  }
  private fun send(reply: Messenger?, id: Int, data: Bundle) {
    try { reply?.send(Message.obtain(null, PdfDetailProtocol.RESULT, id, 0).apply { this.data = data }) } catch (_: Exception) {}
  }
  private fun closeDocument() {
    try { document?.close() } catch (_: Throwable) {}
    try { descriptor?.close() } catch (_: Throwable) {}
    document = null; descriptor = null; documentKey = null
  }
  private fun render(args: Bundle, input: ParcelFileDescriptor, output: ParcelFileDescriptor): Bundle {
    val total = System.nanoTime()
    val key = args.getString("key") ?: throw IOException("missing opaque key")
    require(key.length in 1..96)
    val index = args.getInt("page")
    val width = args.getInt("width")
    val tile = args.getBoolean("tile")
    require(index >= 0 && width in 1..if (tile) PdfDetailProtocol.MAX_PAGE_WIDTH else PdfDetailProtocol.MAX_FULL_WIDTH)
    val opened = System.nanoTime()
    if (document == null || documentKey != key) {
      closeDocument()
      val fd = ParcelFileDescriptor.dup(input.fileDescriptor)
      val doc = try { PdfRenderer(fd) } catch (e: Throwable) { try { fd.close() } catch (_: Throwable) {}; throw e }
      descriptor = fd; document = doc; documentKey = key
    }
    val page = checkNotNull(document).openPage(index)
    val openNanos = System.nanoTime() - opened
    return page.use { p ->
      require(p.width > 0 && p.height > 0)
      val heightDouble = p.height.toDouble() * width / p.width
      require(heightDouble.isFinite() && heightDouble <= Int.MAX_VALUE)
      val fullHeight = heightDouble.roundToInt().coerceAtLeast(1)
      val x = if (tile) args.getInt("x").coerceIn(0, width - 1) else 0
      val y = if (tile) args.getInt("y").coerceIn(0, fullHeight - 1) else 0
      val rw = if (tile) args.getInt("w").coerceAtMost(width - x).coerceAtLeast(1) else width
      val rh = if (tile) args.getInt("h").coerceAtMost(fullHeight - y).coerceAtLeast(1) else fullHeight
      require(rw.toLong() * rh <= if (tile) PdfDetailProtocol.MAX_TILE_PIXELS else PdfDetailProtocol.MAX_FULL_PIXELS)
      if (tile) require(rw <= 4096 && rh <= 4096)
      val bitmap = Bitmap.createBitmap(rw, rh, Bitmap.Config.ARGB_8888)
      try {
        val draw = System.nanoTime()
        bitmap.eraseColor(Color.WHITE)
        val matrix = if (tile) Matrix().apply {
          val scale = width.toFloat() / p.width
          setScale(scale, scale); postTranslate(-x.toFloat(), -y.toFloat())
        } else null
        p.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        val drawNanos = System.nanoTime() - draw
        val writing = System.nanoTime()
        var diskNanos = 0L
        var encodeNanos = 0L
        ParcelFileDescriptor.AutoCloseOutputStream(output).use { stream ->
          val measured = object : OutputStream() {
            override fun write(value: Int) { val t = System.nanoTime(); try { stream.write(value) } finally { diskNanos += System.nanoTime() - t } }
            override fun write(bytes: ByteArray, offset: Int, count: Int) { val t = System.nanoTime(); try { stream.write(bytes, offset, count) } finally { diskNanos += System.nanoTime() - t } }
          }
          BufferedOutputStream(measured, 1 shl 16).use { buffer ->
            val encode = System.nanoTime()
            val ok = bitmap.compress(Bitmap.CompressFormat.JPEG, 92, buffer)
            encodeNanos = (System.nanoTime() - encode - diskNanos).coerceAtLeast(0L)
            if (!ok) throw IOException("compression failed")
          }
        }
        Bundle().apply {
          putLong("openNs", openNanos); putLong("drawNs", drawNanos)
          putLong("encodeNs", encodeNanos)
          putLong("writeNs", (System.nanoTime() - writing - encodeNanos).coerceAtLeast(0L))
          putLong("totalNs", System.nanoTime() - total)
        }
      } finally { bitmap.recycle() }
    }
  }
}
