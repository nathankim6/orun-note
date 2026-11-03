package expo.modules.pdfrenderer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.roundToInt
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition

/**
 * Encrypted PDF storage + rasterization. Files live in app-private storage (filesDir) as AES-GCM ciphertext;
 * the key is a non-exportable Android Keystore key. Decrypted copies exist only in the private cache while rendering.
 */
class PdfRendererModule : Module() {
  companion object { /** PdfRenderer and the decrypt cache are not thread-safe across concurrent calls. */ val LOCK = Any() }
  private val alias = "com.paperly.study.pdfkey"
  private val ctx get() = appContext.reactContext ?: throw IllegalStateException("No context")

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
    return gen.generateKey()
  }
  private fun encrypt(plain: ByteArray): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key()); return c.iv + c.doFinal(plain) }
  private fun decrypt(data: ByteArray): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, 12)); return c.doFinal(data, 12, data.size - 12) }

  private fun fileFor(uri: String): File { val u = Uri.parse(uri); return if (u.scheme == "file") File(u.path!!) else File(uri) }
  private fun storeDir() = File(ctx.filesDir, "paperly-pdfs").apply { mkdirs() }
  private fun decDir() = File(ctx.cacheDir, "pdf-dec").apply { mkdirs() }
  private fun pagesDir() = File(ctx.cacheDir, "pdf-pages").apply { mkdirs() }

  /** Returns a readable plain PDF file for the given stored URI (decrypting into private cache if needed). */
  private fun plainFile(uri: String): File {
    val f = fileFor(uri)
    if (!f.name.endsWith(".pdfenc")) return f
    val out = File(decDir(), "${uri.hashCode().toUInt()}.pdf")
    if (!out.exists() || out.length() == 0L) { val plain = decrypt(f.readBytes()); FileOutputStream(out).use { it.write(plain) } }
    return out
  }
  private fun <T> withRenderer(uri: String, block: (PdfRenderer) -> T): T = synchronized(LOCK) {
    val pfd = ParcelFileDescriptor.open(plainFile(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    val renderer = PdfRenderer(pfd)
    try { block(renderer) } finally { renderer.close(); pfd.close() }
  }

  override fun definition() = ModuleDefinition {
    Name("PdfRenderer")

    AsyncFunction("importFile") { srcUri: String, id: String -> synchronized(LOCK) {
      val src = Uri.parse(srcUri)
      val bytes = if (src.scheme == "content") ctx.contentResolver.openInputStream(src)!!.use { it.readBytes() } else fileFor(srcUri).readBytes()
      // validate it is a PDF before storing
      ParcelFileDescriptor.open(File(ctx.cacheDir, "probe-$id.pdf").apply { writeBytes(bytes) }, ParcelFileDescriptor.MODE_READ_ONLY).use { PdfRenderer(it).close() }
      File(ctx.cacheDir, "probe-$id.pdf").delete()
      val out = File(storeDir(), "$id.pdfenc")
      FileOutputStream(out).use { it.write(encrypt(bytes)) }
      mapOf("uri" to "file://${out.absolutePath}", "size" to bytes.size)
    } }
    AsyncFunction("deleteFile") { uri: String ->
      fileFor(uri).delete()
      File(decDir(), "${uri.hashCode().toUInt()}.pdf").delete()
      pagesDir().listFiles()?.filter { it.name.startsWith("${uri.hashCode().toUInt()}-") }?.forEach { it.delete() }
      null
    }
    AsyncFunction("fileExists") { uri: String -> fileFor(uri).exists() }
    AsyncFunction("clearCaches") { decDir().deleteRecursively(); pagesDir().deleteRecursively(); null }

    AsyncFunction("getInfo") { uri: String ->
      withRenderer(uri) { r ->
        val pages = (0 until r.pageCount).map { i -> r.openPage(i).use { p -> mapOf("width" to p.width.toDouble(), "height" to p.height.toDouble()) } }
        mapOf("pageCount" to r.pageCount, "pages" to pages, "title" to "")
      }
    }

    AsyncFunction("renderPage") { uri: String, index: Int, width: Int ->
      val out = File(pagesDir(), "${uri.hashCode().toUInt()}-$index-$width.png")
      if (!out.exists()) {
        withRenderer(uri) { r ->
          r.openPage(index).use { p ->
            val h = (p.height.toDouble() * width / p.width).roundToInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
            Canvas(bmp).drawColor(Color.WHITE)
            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            FileOutputStream(out).use { fos -> bmp.compress(Bitmap.CompressFormat.PNG, 100, fos) }
            bmp.recycle()
          }
        }
      }
      "file://${out.absolutePath}"
    }

    AsyncFunction("getPageText") { uri: String, index: Int ->
      synchronized(LOCK) { try { PDFBoxResourceLoader.init(ctx); PDDocument.load(plainFile(uri)).use { d -> PDFTextStripper().apply { startPage = index + 1; endPage = index + 1 }.getText(d) } } catch (e: Throwable) { "" } }
    }
    /** Words with rectangles normalized to the displayed page (0..1, top-left origin), via PdfBox text positions. */
    AsyncFunction("getWords") { uri: String, index: Int ->
      synchronized(LOCK) {
        try {
          PDFBoxResourceLoader.init(ctx)
          PDDocument.load(plainFile(uri)).use { d ->
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
    AsyncFunction("getOutline") { _: String -> emptyList<Map<String, Any>>() }
  }
}
