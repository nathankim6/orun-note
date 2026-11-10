package expo.modules.pdfrenderer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.*
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

/** One connection and one pending reply. No executor, thread pool, document bytes, or paths. */
internal class PdfDetailClient(context: Context) {
  private val context = context.applicationContext
  private val state = Any()
  private val gate = Mutex()
  private var connection: Connection? = null
  private var pending: Pending? = null
  private var nextId = 0
  private var closed = false
  private data class Pending(val id: Int, val result: CompletableDeferred<Bundle>)
  private inner class Connection : ServiceConnection {
    val ready = CompletableDeferred<Messenger>()
    var remote: Messenger? = null
    var bound = false
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      synchronized(state) {
        if (connection !== this) return
        remote = Messenger(binder)
        ready.complete(checkNotNull(remote))
      }
    }
    override fun onServiceDisconnected(name: ComponentName) { reset(this) }
    override fun onBindingDied(name: ComponentName) { reset(this) }
    override fun onNullBinding(name: ComponentName) { reset(this) }
  }
  private val replies = Messenger(object : Handler(Looper.getMainLooper()) {
    override fun handleMessage(message: Message) {
      if (message.what != PdfDetailProtocol.RESULT) return
      val job = synchronized(state) {
        pending?.takeIf { it.id == message.arg1 }?.also { pending = null }
      } ?: return
      if (message.data.getInt("error") != 0) job.result.completeExceptionally(IOException("Isolated PDF detail failed"))
      else job.result.complete(message.data)
    }
  })
  private suspend fun connect(): Messenger {
    val current = synchronized(state) {
      check(!closed) { "PDF detail client closed" }
      connection ?: Connection().also { candidate ->
        connection = candidate
        try {
          candidate.bound = context.bindService(Intent(context, PdfDetailService::class.java), candidate, Context.BIND_AUTO_CREATE)
          if (!candidate.bound) {
            connection = null
            candidate.ready.completeExceptionally(IOException("Cannot bind PDF detail service"))
          }
        } catch (e: Exception) {
          connection = null
          candidate.ready.completeExceptionally(IOException("Cannot bind PDF detail service", e))
        }
      }
    }
    return withTimeout(10_000L) { current.ready.await() }
  }
  suspend fun render(args: Bundle, input: ParcelFileDescriptor, output: ParcelFileDescriptor): Bundle = gate.withLock {
    try {
      withTimeout(PdfDetailProtocol.TIMEOUT_MS) {
        val remote = connect()
        val job = synchronized(state) {
          check(!closed && pending == null) { "PDF detail client closed or busy" }
          Pending(++nextId, CompletableDeferred()).also { pending = it }
        }
        val payload = Bundle(args).apply { putParcelable("input", input); putParcelable("output", output) }
        remote.send(Message.obtain(null, PdfDetailProtocol.RENDER, job.id, android.os.Process.myPid()).apply { data = payload; replyTo = replies })
        job.result.await()
      }
    } catch (e: Throwable) {
      reset()
      throw e
    }
  }
  /** Nonblocking invalidation. Kernel FD ownership makes unlink/replacement safe even before worker death. */
  fun close() {
    synchronized(state) { closed = true }
    reset()
  }
  private fun reset(expected: Connection? = null) {
    val old: Connection?
    val job: Pending?
    synchronized(state) {
      if (expected != null && connection !== expected) return
      old = connection; connection = null
      job = pending; pending = null
    }
    val error = IOException("PDF detail service disconnected or invalidated")
    old?.ready?.completeExceptionally(error)
    job?.result?.completeExceptionally(error)
    try { old?.remote?.send(Message.obtain(null, PdfDetailProtocol.CLOSE, android.os.Process.myPid(), android.os.Process.myUid())) } catch (_: Exception) {}
    if (old?.bound == true) try { context.unbindService(old) } catch (_: Exception) {}
  }
}
