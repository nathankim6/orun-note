package expo.modules.pdfrenderer

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.roundToInt
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition

/**
 * Encrypted PDF storage + rasterization. Files live in app-private storage (filesDir) as AES-GCM ciphertext;
 * the key is a non-exportable Android Keystore key. A decrypted working copy exists only in the private cache.
 *
 * Storage format v2 (streamed, so 200 MB+ files never sit in memory):
 *   header: "OPDF2" | u32 BE chunk size | u8 key mode (0 = Keystore key, 1 = per-file data key wrapped by the Keystore key)
 *           [mode 1: 60-byte wrapped data key = iv 12 + ciphertext 32 + tag 16, AAD = the 10 header bytes before it]
 *   chunks: iv 12 | AES-256-GCM ciphertext (chunk size; last one may be shorter) | tag 16
 *           AAD = full header + u64 BE chunk index + u8 isLast
 * Android writes mode 1: bulk AES runs in-process (hardware-accelerated) instead of through the Keystore, which is
 * slow for hundreds of MB. v1 files (no magic: iv 12 + one GCM blob) still open as before.
 */
class PdfRendererModule : Module() {
  companion object {
    /** PdfRenderer, PdfBox and the decrypt cache are not thread-safe; every access holds this lock. */
    val LOCK = Any()
    private val MAGIC = byteArrayOf(0x4F, 0x50, 0x44, 0x46, 0x32) // "OPDF2"
    private const val CHUNK = 4 * 1024 * 1024
    private const val IV = 12
    private const val TAG = 16
    private const val KEEP_PLAIN = 3
    // One open renderer / text document, reused until another document is needed (opening re-parses the whole file).
    private var rUri: String? = null
    private var rPfd: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private var pbUri: String? = null
    private var pbDoc: PDDocument? = null
  }
  private val alias = "com.paperly.study.pdfkey"
  private val ctx get() = appContext.reactContext ?: throw IllegalStateException("No context")

  // ---- keys ----
  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
    return gen.generateKey()
  }
  /** v1 files: iv(12) + one GCM blob of the whole document. */
  private fun decrypt(data: ByteArray): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, IV)); return c.doFinal(data, IV, data.size - IV) }
  /** Seals small data with the Keystore key: iv(12) + ciphertext + tag. */
  private fun sealWithKeystore(plain: ByteArray, aad: ByteArray): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key()); c.updateAAD(aad); val iv = c.iv; return iv + c.doFinal(plain) }
  private fun openWithKeystore(data: ByteArray, aad: ByteArray): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, IV)); c.updateAAD(aad); return c.doFinal(data, IV, data.size - IV) }

  // ---- paths ----
  private fun fileFor(uri: String): File { val u = Uri.parse(uri); return if (u.scheme == "file") File(u.path!!) else File(uri) }
  private fun storeDir() = File(ctx.filesDir, "paperly-pdfs").apply { mkdirs() }
  private fun decDir() = File(ctx.cacheDir, "pdf-dec").apply { mkdirs() }
  private fun pagesDir() = File(ctx.cacheDir, "pdf-pages").apply { mkdirs() }
  /** Stable cache key: SHA-256 of the stored file name (or of the URI for other files), 24 hex chars. */
  private fun keyOf(uri: String): String {
    val f = fileFor(uri); val basis = if (f.name.endsWith(".pdfenc")) f.name else uri
    return MessageDigest.getInstance("SHA-256").digest(basis.toByteArray(Charsets.UTF_8)).take(12).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
  private fun legacyKey(uri: String) = "${uri.hashCode().toUInt()}"

  // ---- v2 streaming crypto ----
  private fun readFully(ins: InputStream, buf: ByteArray, len: Int = buf.size): Int {
    var n = 0
    while (n < len) { val r = ins.read(buf, n, len - n); if (r < 0) break; n += r }
    return n
  }
  private fun baseHeader(chunk: Int, mode: Int): ByteArray = MAGIC + byteArrayOf((chunk ushr 24).toByte(), (chunk ushr 16).toByte(), (chunk ushr 8).toByte(), chunk.toByte(), mode.toByte())
  private fun chunkAad(header: ByteArray, index: Long, last: Boolean): ByteArray {
    val a = header.copyOf(header.size + 9)
    for (i in 0 until 8) a[header.size + i] = (index ushr (56 - 8 * i)).toByte()
    a[header.size + 8] = (if (last) 1 else 0).toByte()
    return a
  }
  private fun isV2(f: File): Boolean = try { FileInputStream(f).use { s -> val b = ByteArray(5); readFully(s, b) == 5 && b.contentEquals(MAGIC) } } catch (e: Throwable) { false }

  /** Streams [ins] into the v2 format (4 MiB chunks), also writing the plaintext to [plainOut] when given. Returns the plaintext size. */
  private fun encryptV2(ins: InputStream, out: OutputStream, plainOut: OutputStream?): Long {
    val dek = ByteArray(32); val rnd = SecureRandom(); rnd.nextBytes(dek)
    try {
      val base = baseHeader(CHUNK, 1)
      val header = base + sealWithKeystore(dek, base)
      out.write(header)
      val k = SecretKeySpec(dek, "AES")
      var cur = ByteArray(CHUNK); var nxt = ByteArray(CHUNK); val ct = ByteArray(CHUNK + 64); val iv = ByteArray(IV)
      var curLen = readFully(ins, cur)
      if (curLen <= 0) throw IOException("빈 파일입니다")
      var index = 0L; var total = 0L
      while (true) {
        val nxtLen = readFully(ins, nxt)
        val last = nxtLen <= 0
        rnd.nextBytes(iv)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, k, GCMParameterSpec(TAG * 8, iv))
        c.updateAAD(chunkAad(header, index, last))
        val n = c.doFinal(cur, 0, curLen, ct, 0)
        out.write(iv); out.write(ct, 0, n)
        plainOut?.write(cur, 0, curLen)
        total += curLen
        if (last) break
        val t = cur; cur = nxt; nxt = t; curLen = nxtLen; index++
      }
      return total
    } finally { dek.fill(0) }
  }

  /** Decrypts a v2 file chunk by chunk into [dst] (via a .part file renamed only when complete). */
  private fun decryptV2(src: File, dst: File) {
    val part = File(dst.parentFile, dst.name + ".part"); part.delete()
    try {
      BufferedInputStream(FileInputStream(src), 1 shl 16).use { ins ->
        val base = ByteArray(10)
        if (readFully(ins, base) != 10 || !base.copyOfRange(0, 5).contentEquals(MAGIC)) throw IOException("bad header")
        val chunk = ((base[5].toInt() and 0xff) shl 24) or ((base[6].toInt() and 0xff) shl 16) or ((base[7].toInt() and 0xff) shl 8) or (base[8].toInt() and 0xff)
        if (chunk <= 0 || chunk > (64 shl 20)) throw IOException("bad chunk size")
        val keyed: Pair<ByteArray, SecretKey> = when (base[9].toInt()) {
          1 -> { val w = ByteArray(IV + 32 + TAG); if (readFully(ins, w) != w.size) throw IOException("truncated"); Pair(base + w, SecretKeySpec(openWithKeystore(w, base), "AES")) }
          0 -> Pair(base, key())
          else -> throw IOException("unknown key mode")
        }
        val header = keyed.first; val k = keyed.second
        val record = chunk.toLong() + IV + TAG
        val body = src.length() - header.size
        if (body <= IV + TAG) throw IOException("truncated")
        val count = (body + record - 1) / record
        val buf = ByteArray(record.toInt()); val pt = ByteArray(record.toInt())
        BufferedOutputStream(FileOutputStream(part), 1 shl 16).use { os ->
          for (i in 0L until count) {
            val last = i == count - 1
            val want = (if (last) body - record * (count - 1) else record).toInt()
            if (want <= IV + TAG || readFully(ins, buf, want) != want) throw IOException("truncated")
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(TAG * 8, buf, 0, IV))
            c.updateAAD(chunkAad(header, i, last))
            val n = c.doFinal(buf, IV, want - IV, pt, 0)
            os.write(pt, 0, n)
          }
        }
      }
      if (!part.renameTo(dst)) { dst.delete(); if (!part.renameTo(dst)) throw IOException("rename failed") }
    } catch (e: Throwable) { part.delete(); throw e }
  }

  /** Readable plain PDF for a stored URI: the decrypted working copy in the private cache (created on demand). */
  private fun plainFile(uri: String): File {
    val f = fileFor(uri)
    if (!f.name.endsWith(".pdfenc")) return f
    val out = File(decDir(), "${keyOf(uri)}.pdf")
    if (out.exists() && out.length() > 0L) { out.setLastModified(System.currentTimeMillis()); return out }
    File(decDir(), "${legacyKey(uri)}.pdf").delete() // copy written by older builds
    if (isV2(f)) decryptV2(f, out)
    else {
      val part = File(decDir(), out.name + ".part")
      try { FileOutputStream(part).use { it.write(decrypt(f.readBytes())) } } catch (e: Throwable) { part.delete(); throw e }
      if (!part.renameTo(out)) { out.delete(); if (!part.renameTo(out)) throw IOException("rename failed") }
    }
    trimPlain(out.name)
    return out
  }
  /** Keeps the most recently used decrypted copies (and the ones in use). Call with LOCK held. */
  private fun trimPlain(keep: String) {
    val inUse = listOfNotNull(rUri, pbUri).map { "${keyOf(it)}.pdf" }.toMutableSet().apply { add(keep) }
    val files = decDir().listFiles()?.filter { it.name.endsWith(".pdf") }?.sortedByDescending { it.lastModified() } ?: return
    files.drop(KEEP_PLAIN).filter { it.name !in inUse }.forEach { it.delete() }
  }

  // ---- cached renderer / text document (call with LOCK held) ----
  private fun closeRendererLocked() {
    try { renderer?.close() } catch (e: Throwable) {}
    try { rPfd?.close() } catch (e: Throwable) {}
    renderer = null; rPfd = null; rUri = null
  }
  private fun closePdfBoxLocked() { try { pbDoc?.close() } catch (e: Throwable) {}; pbDoc = null; pbUri = null }
  private fun rendererFor(uri: String): PdfRenderer {
    val cur = renderer
    if (cur != null && rUri == uri) return cur
    closeRendererLocked()
    val pfd = ParcelFileDescriptor.open(plainFile(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    val r = try { PdfRenderer(pfd) } catch (e: Throwable) { try { pfd.close() } catch (e2: Throwable) {}; throw e }
    renderer = r; rPfd = pfd; rUri = uri
    return r
  }
  private fun <T> withRenderer(uri: String, block: (PdfRenderer) -> T): T = synchronized(LOCK) {
    val r = rendererFor(uri)
    try { block(r) } catch (e: Throwable) { closeRendererLocked(); throw e }
  }
  private fun <T> withPdfBox(uri: String, block: (PDDocument) -> T): T = synchronized(LOCK) {
    val cur = pbDoc
    val d = if (cur != null && pbUri == uri) cur else {
      closePdfBoxLocked()
      PDFBoxResourceLoader.init(ctx)
      // mixed memory: big documents spill parser scratch data to a temp file instead of the Java heap
      val doc = PDDocument.load(plainFile(uri), MemoryUsageSetting.setupMixed(16L * 1024 * 1024).setTempDir(ctx.cacheDir))
      pbDoc = doc; pbUri = uri
      doc
    }
    block(d)
  }

  private fun writeImage(bmp: Bitmap, out: File, jpeg: Boolean, quality: Int) {
    val part = File(out.parentFile, out.name + ".part")
    try { FileOutputStream(part).use { fos -> bmp.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, quality, fos) } } catch (e: Throwable) { part.delete(); throw e }
    if (!part.renameTo(out)) { out.delete(); part.renameTo(out) }
  }

  override fun definition() = ModuleDefinition {
    Name("PdfRenderer")

    OnCreate {
      try { val cur = Thread.getDefaultUncaughtExceptionHandler(); if (cur !is CrashSaver) Thread.setDefaultUncaughtExceptionHandler(CrashSaver(File(ctx.filesDir, "crash"), cur)) } catch (e: Throwable) {}
      // Page images / decrypted copies written by older builds used a different key scheme and are never reused.
      Thread {
        try {
          synchronized(LOCK) {
            pagesDir().listFiles()?.forEach { f -> val dash = f.name.indexOf('-'); if ((dash >= 0 && dash != 24) || f.name.endsWith(".png")) f.delete() }
            decDir().listFiles()?.forEach { f -> val dot = f.name.indexOf('.'); if (dot >= 0 && dot != 24) f.delete() }
          }
        } catch (e: Throwable) {}
      }.start()
    }
    OnDestroy { synchronized(LOCK) { closeRendererLocked(); closePdfBoxLocked() } }

    /** Encrypts a picked/downloaded PDF into app storage (v2, streamed) and keeps a decrypted working copy so the first open is instant. */
    AsyncFunction("importFile") Coroutine { srcUri: String, id: String ->
      withContext(Dispatchers.IO) {
        val out = File(storeDir(), "$id.pdfenc"); val outUri = "file://${out.absolutePath}"
        val encPart = File(storeDir(), "$id.pdfenc.part")
        val plain = File(decDir(), "${keyOf(outUri)}.pdf"); val plainPart = File(decDir(), plain.name + ".part")
        encPart.delete(); plainPart.delete()
        try {
          val src = Uri.parse(srcUri)
          val input: InputStream = if (src.scheme == "content") (ctx.contentResolver.openInputStream(src) ?: throw IOException("cannot open $srcUri")) else FileInputStream(fileFor(srcUri))
          val total = BufferedInputStream(input, 1 shl 16).use { ins ->
            BufferedOutputStream(FileOutputStream(encPart), 1 shl 16).use { eo ->
              BufferedOutputStream(FileOutputStream(plainPart), 1 shl 16).use { po -> encryptV2(ins, eo, po) }
            }
          }
          if (!plainPart.renameTo(plain)) throw IOException("rename failed")
          // validate: the working copy must open as a PDF (it also becomes the open renderer for the first getInfo/render)
          synchronized(LOCK) { rendererFor(outUri); trimPlain(plain.name) }
          if (!encPart.renameTo(out)) throw IOException("rename failed")
          mapOf("uri" to outUri, "size" to total.toDouble())
        } catch (e: Throwable) {
          synchronized(LOCK) { if (rUri == outUri) closeRendererLocked() }
          encPart.delete(); plainPart.delete(); plain.delete()
          throw e
        }
      }
    }
    AsyncFunction("deleteFile") { uri: String ->
      synchronized(LOCK) {
        if (rUri == uri) closeRendererLocked()
        if (pbUri == uri) closePdfBoxLocked()
        fileFor(uri).delete()
        val k = keyOf(uri); val legacy = legacyKey(uri)
        File(decDir(), "$k.pdf").delete(); File(decDir(), "$legacy.pdf").delete()
        pagesDir().listFiles()?.filter { it.name.startsWith("$k-") || it.name.startsWith("$legacy-") }?.forEach { it.delete() }
      }
      null
    }
    AsyncFunction("fileExists") { uri: String -> fileFor(uri).exists() }
    AsyncFunction("clearCaches") {
      synchronized(LOCK) {
        closeRendererLocked(); closePdfBoxLocked()
        decDir().deleteRecursively(); pagesDir().deleteRecursively()
        storeDir().listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() } // interrupted imports
      }
      null
    }

    AsyncFunction("getInfo") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        withRenderer(uri) { r ->
          val pages = (0 until r.pageCount).map { i -> r.openPage(i).use { p -> mapOf("width" to p.width.toDouble(), "height" to p.height.toDouble()) } }
          mapOf("pageCount" to r.pageCount, "pages" to pages, "title" to "")
        }
      }
    }

    /** An already-rendered page (no rendering, no lock): lets the viewer show it at once instead of queueing. */
    AsyncFunction("cachedPage") { uri: String, index: Int, width: Int ->
      val out = File(pagesDir(), "${keyOf(uri)}-$index-$width.jpg")
      if (out.exists() && out.length() > 0L) "file://${out.absolutePath}" else null
    }

    /** Whole page at [width] px, cached on disk (a cached page returns without touching the PDF). Always JPEG 92:
     *  several times faster to encode and decode than PNG, and text stays crisp at this quality. */
    AsyncFunction("renderPage") Coroutine { uri: String, index: Int, width: Int ->
      withContext(Dispatchers.IO) {
        val jpeg = true
        val out = File(pagesDir(), "${keyOf(uri)}-$index-$width.jpg")
        if (!out.exists()) {
          withRenderer(uri) { r ->
            if (!out.exists()) {
              r.openPage(index).use { p ->
                val h = (p.height.toDouble() * width / p.width).roundToInt().coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
                try {
                  bmp.eraseColor(Color.WHITE)
                  p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                  writeImage(bmp, out, jpeg, if (jpeg) 92 else 100)
                } finally { bmp.recycle() }
              }
            }
          }
        }
        "file://${out.absolutePath}"
      }
    }

    /** A [w]×[h] px window (top-left [x],[y]) of the page scaled to [pageWidthPx] wide, clamped to the page. JPEG 90, cached on disk. */
    AsyncFunction("renderRegion") Coroutine { uri: String, index: Int, pageWidthPx: Int, x: Int, y: Int, w: Int, h: Int ->
      withContext(Dispatchers.IO) {
        val out = File(pagesDir(), "${keyOf(uri)}-$index-$pageWidthPx-r${x}_${y}_${w}_$h.jpg")
        if (!out.exists()) {
          withRenderer(uri) { r ->
            if (!out.exists()) {
              r.openPage(index).use { p ->
                if (pageWidthPx <= 0 || p.width <= 0) throw IllegalArgumentException("bad page width")
                val scale = pageWidthPx.toFloat() / p.width
                val fullH = (p.height.toDouble() * pageWidthPx / p.width).roundToInt().coerceAtLeast(1)
                val x0 = x.coerceIn(0, pageWidthPx - 1); val y0 = y.coerceIn(0, fullH - 1)
                val rw = w.coerceAtMost(pageWidthPx - x0).coerceAtLeast(1); val rh = h.coerceAtMost(fullH - y0).coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(rw, rh, Bitmap.Config.ARGB_8888)
                try {
                  bmp.eraseColor(Color.WHITE)
                  val m = Matrix(); m.setScale(scale, scale); m.postTranslate(-x0.toFloat(), -y0.toFloat())
                  p.render(bmp, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                  writeImage(bmp, out, true, 90)
                } finally { bmp.recycle() }
              }
            }
          }
        }
        "file://${out.absolutePath}"
      }
    }

    AsyncFunction("getPageText") Coroutine { uri: String, index: Int ->
      withContext(Dispatchers.IO) {
        try { withPdfBox(uri) { d -> PDFTextStripper().apply { startPage = index + 1; endPage = index + 1 }.getText(d) } } catch (e: Throwable) { "" }
      }
    }
    /** Words with rectangles normalized to the displayed page (0..1, top-left origin), via PdfBox text positions. */
    AsyncFunction("getWords") Coroutine { uri: String, index: Int ->
      withContext(Dispatchers.IO) {
        try {
          withPdfBox(uri) { d ->
            val page = d.getPage(index); val box = page.cropBox; val rot = ((page.rotation % 360) + 360) % 360
            val pw = if (rot == 90 || rot == 270) box.height else box.width; val ph = if (rot == 90 || rot == 270) box.width else box.height
            val words = ArrayList<Map<String, Any>>()
            val stripper = object : PDFTextStripper() {
              override fun writeString(text: String?, positions: MutableList<TextPosition>?) {
                if (positions == null) return
                var cur = ArrayList<TextPosition>()
                fun flush() {
                  if (cur.isEmpty()) return
                  val t = cur.joinToString("") { it.unicode ?: "" }
                  if (t.any { it.isLetter() }) {
                    val x0 = cur.minOf { it.xDirAdj }; val x1 = cur.maxOf { it.xDirAdj + it.widthDirAdj }
                    val yb = cur.maxOf { it.yDirAdj }; val hh = cur.maxOf { it.heightDir }.coerceAtLeast(4f) * 1.15f
                    words.add(mapOf("t" to t, "x" to (x0 / pw).toDouble(), "y" to ((yb - hh) / ph).toDouble(), "w" to ((x1 - x0) / pw).toDouble(), "h" to (hh / ph).toDouble()))
                  }
                  cur = ArrayList()
                }
                for (tp in positions) { val u = tp.unicode ?: ""; if (u.isBlank() || (u.length == 1 && !u[0].isLetterOrDigit() && u[0] != '\'' && u[0] != '-')) flush() else cur.add(tp) }
                flush()
              }
            }
            stripper.sortByPosition = true; stripper.startPage = index + 1; stripper.endPage = index + 1
            stripper.getText(d)
            words
          }
        } catch (e: Throwable) { emptyList<Map<String, Any>>() }
      }
    }
    /** Crash diagnostics gathered since the last call: saved stack traces + Android's own exit records (API 30+:
     *  crashes, native crashes, ANRs, low-memory kills) newer than the last report. Each is returned once. */
    AsyncFunction("takeCrashReports") Coroutine { ->
      withContext(Dispatchers.IO) {
        val out = ArrayList<Map<String, Any>>()
        try {
          File(ctx.filesDir, "crash").listFiles()?.sortedBy { it.name }?.forEach { f ->
            out.add(mapOf("kind" to "java", "at" to (f.name.removePrefix("crash-").removeSuffix(".txt").toLongOrNull() ?: f.lastModified()).toDouble(), "detail" to f.readText().take(24000)))
            f.delete()
          }
        } catch (e: Throwable) {}
        try {
          if (Build.VERSION.SDK_INT >= 30) {
            val prefs = ctx.getSharedPreferences("orun_diag", Context.MODE_PRIVATE); val last = prefs.getLong("exitTs", 0L); var newest = last
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            for (x in am.getHistoricalProcessExitReasons(ctx.packageName, 0, 12)) {
              if (x.timestamp <= last) continue; if (x.timestamp > newest) newest = x.timestamp
              val r = x.reason
              val bad = r == ApplicationExitInfo.REASON_CRASH || r == ApplicationExitInfo.REASON_CRASH_NATIVE || r == ApplicationExitInfo.REASON_ANR ||
                r == ApplicationExitInfo.REASON_LOW_MEMORY || r == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE || r == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE || r == ApplicationExitInfo.REASON_SIGNALED
              if (!bad) continue
              var trace = ""
              if (r == ApplicationExitInfo.REASON_ANR) try { x.traceInputStream?.use { trace = String(it.readBytes().take(16000).toByteArray()) } } catch (e: Throwable) {}
              out.add(mapOf("kind" to "exit", "at" to x.timestamp.toDouble(),
                "detail" to "reason=$r status=${x.status} importance=${x.importance} pss=${x.pss / 1024}MB rss=${x.rss / 1024}MB desc=${x.description ?: ""}" + (if (trace.isNotEmpty()) "\n$trace" else "")))
            }
            if (newest > last) prefs.edit().putLong("exitTs", newest).apply()
          }
        } catch (e: Throwable) {}
        out
      }
    }
    AsyncFunction("getOutline") { _: String -> emptyList<Map<String, Any>>() }
  }
}

/** Writes the stack trace of an uncaught exception (Java crash, or a fatal JS error re-thrown natively) to the app's
 *  private crash folder, then hands it to the previous handler (the normal crash). Read back on the next launch. */
private class CrashSaver(private val dir: File, private val prev: Thread.UncaughtExceptionHandler?) : Thread.UncaughtExceptionHandler {
  override fun uncaughtException(t: Thread, e: Throwable) {
    try {
      dir.mkdirs()
      val rt = Runtime.getRuntime()
      val mem = "heap ${(rt.totalMemory() - rt.freeMemory()) / 1048576}/${rt.maxMemory() / 1048576} MB"
      File(dir, "crash-${System.currentTimeMillis()}.txt").writeText("thread=${t.name} $mem\n" + Log.getStackTraceString(e).take(24000))
    } catch (x: Throwable) {}
    prev?.uncaughtException(t, e)
  }
}
