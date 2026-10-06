/**
 * In-stream live-video sample buffers from Capgo InAppBrowser / WebView media.
 * Never a WebView page still, never Capture jpeg, never the phone camera.
 */
package expo.modules.cardflowlivevideo

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Rect
import android.media.ImageReader
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

class CardFlowLiveVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CardFlowLiveVideo")

    OnCreate {
      LiveVideoSamplePump.shared.start { appContext.currentActivity }
    }

    OnDestroy {
      LiveVideoSamplePump.shared.stop()
    }

    AsyncFunction("setScannerSession") { active: Boolean ->
      LiveVideoSamplePump.shared.setScannerSession(active)
    }

    AsyncFunction("setPlaybackUrl") { url: String? ->
      LiveVideoSamplePump.shared.noteHlsUrl(url)
    }

    AsyncFunction("pullSampleBuffer") {
      LiveVideoSamplePump.shared.pullFrame()
    }
  }
}

/// Copies decoded buffers from in-app live-page video. Detect + identity crop.
internal class LiveVideoSamplePump private constructor() {
  companion object {
    val shared = LiveVideoSamplePump()
    private val MAIN = Handler(Looper.getMainLooper())
  }

  private val lock = Any()
  private var activityProvider: (() -> Activity?)? = null
  private var copyThread: HandlerThread? = null
  private var copyHandler: Handler? = null
  private var scannerSession = false
  private var hlsUrl: String? = null
  private var hlsPlayer: MediaPlayer? = null
  private var hlsReader: ImageReader? = null

  fun start(activityProvider: () -> Activity?) {
    synchronized(lock) {
      this.activityProvider = activityProvider
      if (copyThread != null) return
      val thread = HandlerThread("CardFlowLiveVideo")
      thread.start()
      copyThread = thread
      copyHandler = Handler(thread.looper)
    }
  }

  fun stop() {
    stopHlsPlayer()
    synchronized(lock) {
      scannerSession = false
      hlsUrl = null
      copyThread?.quitSafely()
      copyThread = null
      copyHandler = null
      activityProvider = null
    }
  }

  fun setScannerSession(active: Boolean) {
    synchronized(lock) { scannerSession = active }
    if (!active) stopHlsPlayer()
  }

  fun noteHlsUrl(raw: String?) {
    val next = normalizeLiveHlsUrl(raw)
    val changed = synchronized(lock) {
      val changed = next != hlsUrl
      hlsUrl = next
      changed
    }
    if (changed) stopHlsPlayer()
  }

  fun pullFrame(): Map<String, Any> {
    val pixelBuffer = copyLiveVideoPixelBuffer()
    val detection = pixelBuffer?.let(CardInStreamDetect::inspect)
    val cardDetected = detection?.cardDetected == true
    val box = detection?.box
    val identityRgb =
      if (cardDetected && pixelBuffer != null && box != null) {
        LiveVideoIdentityCrop.base64(pixelBuffer, box)
      } else {
        null
      }
    val identityCropJpeg =
      if (cardDetected && pixelBuffer != null && box != null) {
        LiveVideoIdentityCrop.jpegBase64(pixelBuffer, box)
      } else {
        null
      }
    if (pixelBuffer != null && !pixelBuffer.isRecycled) pixelBuffer.recycle()
    val payload = mutableMapOf<String, Any>(
      "source" to "live_video",
      "cardDetected" to cardDetected,
    )
    if (identityRgb != null) payload["identityRgb"] = identityRgb
    if (identityCropJpeg != null) payload["identityCropJpeg"] = identityCropJpeg
    return payload
  }

  private fun copyLiveVideoPixelBuffer(): Bitmap? {
    val session = synchronized(lock) { scannerSession }
    if (!session) return null
    val target = onMain { preferredLiveVideoSurface() }
    if (target != null) {
      val page = when (target) {
        is TextureView -> copyTextureView(target)
        is SurfaceView -> copySurfaceView(target)
        else -> null
      }
      if (page != null && !isBlankFrame(page)) return page
      page?.recycle()
    }
    return copyHlsFrame()
  }

  /// Muted MediaPlayer for the playlist the page exposed. Decoder output, not page pixels.
  private fun copyHlsFrame(): Bitmap? {
    val reader = ensureHlsPlayer() ?: return null
    val image = try {
      reader.acquireLatestImage()
    } catch (_: Throwable) {
      null
    } ?: return null
    try {
      if (image.planes.isEmpty()) return null
      val plane = image.planes[0]
      val pixelStride = plane.pixelStride
      val rowStride = plane.rowStride
      if (pixelStride <= 0 || image.width < 8 || image.height < 8) return null
      val rowWidth = rowStride / pixelStride
      if (rowWidth < image.width) return null
      val buffer = plane.buffer
      buffer.rewind()
      val bitmap = Bitmap.createBitmap(rowWidth, image.height, Bitmap.Config.ARGB_8888)
      bitmap.copyPixelsFromBuffer(buffer)
      val tight = if (rowWidth == image.width) {
        bitmap
      } else {
        val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
        bitmap.recycle()
        cropped
      }
      if (isBlankFrame(tight)) {
        tight.recycle()
        return null
      }
      return tight
    } catch (_: Throwable) {
      return null
    } finally {
      image.close()
    }
  }

  private fun ensureHlsPlayer(): ImageReader? {
    val (session, url, existing) = synchronized(lock) { Triple(scannerSession, hlsUrl, hlsReader) }
    if (!session) return null
    if (existing != null && hlsPlayer != null) return existing
    val playlist = url ?: return null
    val context = activityProvider?.invoke()?.applicationContext ?: return null
    var reader: ImageReader? = null
    var player: MediaPlayer? = null
    return try {
      val nextReader = ImageReader.newInstance(640, 360, PixelFormat.RGBA_8888, 3)
      val nextPlayer = MediaPlayer()
      reader = nextReader
      player = nextPlayer
      nextPlayer.setSurface(nextReader.surface)
      nextPlayer.setVolume(0f, 0f)
      val headers = HashMap<String, String>()
      CookieManager.getInstance().getCookie(playlist)?.let { headers["Cookie"] = it }
      nextPlayer.setDataSource(context, Uri.parse(playlist), headers)
      nextPlayer.setOnPreparedListener { prepared ->
        val current = synchronized(lock) { hlsPlayer }
        if (current !== prepared) return@setOnPreparedListener
        try {
          prepared.start()
        } catch (_: Throwable) {
          // The next pull releases a player that never started.
        }
      }
      nextPlayer.setOnErrorListener { failed, _, _ ->
        if (synchronized(lock) { hlsPlayer === failed }) stopHlsPlayer()
        true
      }
      nextPlayer.prepareAsync()
      synchronized(lock) {
        hlsPlayer = nextPlayer
        hlsReader = nextReader
      }
      nextReader
    } catch (_: Throwable) {
      player?.release()
      reader?.close()
      null
    }
  }

  private fun stopHlsPlayer() {
    val (player, reader) = synchronized(lock) {
      val current = hlsPlayer to hlsReader
      hlsPlayer = null
      hlsReader = null
      current
    }
    if (player != null) {
      try {
        player.stop()
      } catch (_: Throwable) {
        // Already stopped or not prepared.
      }
      player.release()
    }
    reader?.close()
  }

  private fun isBlankFrame(bitmap: Bitmap): Boolean {
    if (bitmap.isRecycled || bitmap.width < 8 || bitmap.height < 8) return true
    val stepX = (bitmap.width / 24).coerceAtLeast(1)
    val stepY = (bitmap.height / 24).coerceAtLeast(1)
    var count = 0
    var sum = 0L
    var sumSq = 0L
    val pixel = IntArray(1)
    var y = 0
    while (y < bitmap.height) {
      var x = 0
      while (x < bitmap.width) {
        bitmap.getPixels(pixel, 0, 1, x, y, 1, 1)
        val color = pixel[0]
        val luma =
          ((color shr 16 and 0xff) * 299 + (color shr 8 and 0xff) * 587 + (color and 0xff) * 114) / 1000
        sum += luma
        sumSq += luma.toLong() * luma
        count++
        x += stepX
      }
      y += stepY
    }
    if (count == 0) return true
    val mean = sum.toDouble() / count
    val variance = sumSq.toDouble() / count - mean * mean
    return mean < 12.0 && variance < 24.0
  }

  private fun preferredLiveVideoSurface(): View? {
    var best: View? = null
    var bestArea = 0
    for (webView in livestreamWebViews()) {
      for (surface in videoSurfacesNear(webView)) {
        val area = surface.width * surface.height
        if (area > bestArea) {
          best = surface
          bestArea = area
        }
      }
    }
    return best
  }

  private fun livestreamWebViews(): List<WebView> {
    return rootViews()
      .flatMap(::findWebViews)
      .filter(::isLivestreamWebView)
      .sortedByDescending { it.width * it.height }
  }

  private fun isLivestreamWebView(webView: WebView): Boolean {
    if (!webView.isShown || webView.width < 160 || webView.height < 160) return false
    val host = Uri.parse(webView.url ?: "").host?.lowercase() ?: ""
    if (host.contains("127.0.0.1") || host.contains("localhost")) return false
    return true
  }

  private fun videoSurfacesNear(webView: WebView): List<View> {
    val found = LinkedHashSet<View>()
    collectVideoSurfaces(webView, found)
    val parent = webView.parent as? ViewGroup
    if (parent != null) collectVideoSurfaces(parent, found)
    return found.filter { overlaps(it, webView) && !isPhoneCameraView(it) }
  }

  private fun collectVideoSurfaces(view: View, into: MutableSet<View>) {
    if (isPhoneCameraView(view)) return
    if ((view is SurfaceView || view is TextureView) && view.width >= 160 && view.height >= 160) {
      into.add(view)
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        collectVideoSurfaces(view.getChildAt(i), into)
      }
    }
  }

  private fun overlaps(a: View, b: View): Boolean {
    val aRect = locationOnScreen(a)
    val bRect = locationOnScreen(b)
    return Rect.intersects(aRect, bRect)
  }

  private fun locationOnScreen(view: View): Rect {
    val origin = IntArray(2)
    view.getLocationOnScreen(origin)
    return Rect(origin[0], origin[1], origin[0] + view.width, origin[1] + view.height)
  }

  private fun isPhoneCameraView(view: View): Boolean {
    var current: Class<*>? = view.javaClass
    while (current != null && current != Any::class.java) {
      val name = current.name
      if (name.startsWith("androidx.camera") || name.startsWith("expo.modules.camera")) {
        return true
      }
      current = current.superclass
    }
    return false
  }

  private fun findWebViews(view: View): List<WebView> {
    val found = mutableListOf<WebView>()
    if (view is WebView) found.add(view)
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        found.addAll(findWebViews(view.getChildAt(i)))
      }
    }
    return found
  }

  private fun rootViews(): List<View> {
    val found = LinkedHashSet<View>()
    try {
      val wmg = Class.forName("android.view.WindowManagerGlobal")
      val instance = wmg.getMethod("getInstance").invoke(null)
      val names = wmg.getMethod("getViewRootNames").invoke(instance) as? Array<*>
      val getRootView = wmg.getMethod("getRootView", String::class.java)
      names?.forEach { name ->
        val view = getRootView.invoke(instance, name) as? View
        if (view != null) found.add(view)
      }
    } catch (_: Throwable) {
      try {
        val wmg = Class.forName("android.view.WindowManagerGlobal")
        val instance = wmg.getMethod("getInstance").invoke(null)
        val field = wmg.getDeclaredField("mViews")
        field.isAccessible = true
        when (val views = field.get(instance)) {
          is List<*> -> views.filterIsInstance<View>().forEach(found::add)
          is Array<*> -> views.filterIsInstance<View>().forEach(found::add)
        }
      } catch (_: Throwable) {
        // Fall through to the current activity window.
      }
    }
    activityProvider?.invoke()?.window?.decorView?.let(found::add)
    return found.toList()
  }

  private fun copyTextureView(view: TextureView): Bitmap? {
    if (!view.isAvailable) return null
    val (width, height) = destSize(view.width, view.height) ?: return null
    return try {
      view.getBitmap(width, height)
    } catch (_: Throwable) {
      null
    }
  }

  private fun copySurfaceView(view: SurfaceView): Bitmap? {
    val (width, height) = destSize(view.width, view.height) ?: return null
    val surface = view.holder.surface
    if (surface == null || !surface.isValid) return null
    val handler = synchronized(lock) { copyHandler } ?: return null
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val latch = CountDownLatch(1)
    var ok = false
    try {
      PixelCopy.request(view, bitmap, { result ->
        ok = result == PixelCopy.SUCCESS
        latch.countDown()
      }, handler)
    } catch (_: Throwable) {
      bitmap.recycle()
      return null
    }
    if (!latch.await(250, TimeUnit.MILLISECONDS) || !ok) {
      bitmap.recycle()
      return null
    }
    return bitmap
  }

  private fun destSize(width: Int, height: Int): Pair<Int, Int>? {
    if (width < 160 || height < 160) return null
    val longSide = max(width, height)
    val maxSide = 640
    if (longSide <= maxSide) return width to height
    val scale = maxSide.toFloat() / longSide
    val destWidth = (width * scale).toInt()
    val destHeight = (height * scale).toInt()
    if (destWidth < 160 || destHeight < 160) return width to height
    return destWidth to destHeight
  }

  private fun <T> onMain(work: () -> T): T? {
    if (Looper.myLooper() == Looper.getMainLooper()) return work()
    val latch = CountDownLatch(1)
    val holder = arrayOfNulls<Any>(1)
    var error: Throwable? = null
    MAIN.post {
      try {
        holder[0] = work()
      } catch (t: Throwable) {
        error = t
      } finally {
        latch.countDown()
      }
    }
    if (!latch.await(400, TimeUnit.MILLISECONDS)) return null
    error?.let { throw it }
    @Suppress("UNCHECKED_CAST")
    return holder[0] as T?
  }
}

/// https playlist only. Same rules as `normalizeLiveHlsUrl` in shared.
private fun normalizeLiveHlsUrl(raw: String?): String? {
  val trimmed = raw?.trim() ?: return null
  if (trimmed.length < 12 || trimmed.length > 2048) return null
  val uri = try {
    Uri.parse(trimmed)
  } catch (_: Throwable) {
    return null
  }
  if (!uri.scheme.equals("https", ignoreCase = true)) return null
  val host = uri.host?.lowercase() ?: return null
  if (host.isEmpty() || host == "localhost" || host == "127.0.0.1") return null
  val haystack = "${uri.encodedPath ?: uri.path ?: ""}?${uri.encodedQuery ?: uri.query ?: ""}".lowercase()
  if (!haystack.contains(".m3u8")) return null
  return uri.toString()
}

/// Pokémon TCG is 63×88 mm (~0.716). Detect a filling rectangle; crop is identity metadata.
private data class CardDetectResult(val cardDetected: Boolean, val box: Rect?)

private object CardInStreamDetect {
  private const val MIN_SHORT_OVER_LONG = 0.60f
  private const val MAX_SHORT_OVER_LONG = 0.82f
  private const val MIN_FILL = 0.10f
  private const val MIN_SIZE = 0.18f
  private const val DETECT_MAX_SIDE = 320
  private const val SOBEL_THRESHOLD_SQ = 48 * 48

  fun inspect(pixelBuffer: Bitmap): CardDetectResult {
    if (pixelBuffer.isRecycled || pixelBuffer.width < 160 || pixelBuffer.height < 160) {
      return CardDetectResult(false, null)
    }
    val scaled = downscale(pixelBuffer)
    try {
      val width = scaled.width
      val height = scaled.height
      val luma = luma(scaled)
      val edges = sobelEdges(luma, width, height)
      val minSide = min(width, height).toFloat()
      val frameArea = (width * height).toFloat()
      var best: Rect? = null
      var bestFill = 0f
      for (box in boundingBoxes(edges, width, height)) {
        val boxWidth = box.width().toFloat()
        val boxHeight = box.height().toFloat()
        val fill = (boxWidth * boxHeight) / frameArea
        if (fill < MIN_FILL) continue
        val shortest = min(boxWidth, boxHeight)
        val longest = max(boxWidth, boxHeight)
        if (longest <= 0f || shortest < MIN_SIZE * minSide) continue
        val ratio = shortest / longest
        if (ratio !in MIN_SHORT_OVER_LONG..MAX_SHORT_OVER_LONG) continue
        if (fill > bestFill) {
          best = box
          bestFill = fill
        }
      }
      val mapped = best?.let { toOriginal(it, pixelBuffer, scaled) }
      return CardDetectResult(mapped != null, mapped)
    } finally {
      if (scaled !== pixelBuffer && !scaled.isRecycled) scaled.recycle()
    }
  }

  private fun toOriginal(box: Rect, src: Bitmap, scaled: Bitmap): Rect {
    if (src === scaled) return box
    val scaleX = src.width.toFloat() / scaled.width
    val scaleY = src.height.toFloat() / scaled.height
    return Rect(
      (box.left * scaleX).toInt(),
      (box.top * scaleY).toInt(),
      (box.right * scaleX).toInt(),
      (box.bottom * scaleY).toInt(),
    )
  }

  private fun downscale(src: Bitmap): Bitmap {
    val longSide = max(src.width, src.height)
    if (longSide <= DETECT_MAX_SIDE) return src
    val scale = DETECT_MAX_SIDE.toFloat() / longSide
    val width = (src.width * scale).toInt().coerceAtLeast(1)
    val height = (src.height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(src, width, height, true)
  }

  private fun luma(bitmap: Bitmap): IntArray {
    val width = bitmap.width
    val height = bitmap.height
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    for (i in pixels.indices) {
      val color = pixels[i]
      val r = color shr 16 and 0xff
      val g = color shr 8 and 0xff
      val b = color and 0xff
      pixels[i] = (r * 299 + g * 587 + b * 114) / 1000
    }
    return pixels
  }

  private fun sobelEdges(luma: IntArray, width: Int, height: Int): BooleanArray {
    val edges = BooleanArray(width * height)
    for (y in 1 until height - 1) {
      for (x in 1 until width - 1) {
        val i = y * width + x
        val a00 = luma[i - width - 1]
        val a01 = luma[i - width]
        val a02 = luma[i - width + 1]
        val a10 = luma[i - 1]
        val a12 = luma[i + 1]
        val a20 = luma[i + width - 1]
        val a21 = luma[i + width]
        val a22 = luma[i + width + 1]
        val gx = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22
        val gy = -a00 - 2 * a01 - a02 + a20 + 2 * a21 + a22
        edges[i] = gx * gx + gy * gy >= SOBEL_THRESHOLD_SQ
      }
    }
    return edges
  }

  private fun boundingBoxes(edges: BooleanArray, width: Int, height: Int): List<Rect> {
    val n = width * height
    val parent = IntArray(n) { it }
    fun find(x: Int): Int {
      var i = x
      while (parent[i] != i) {
        parent[i] = parent[parent[i]]
        i = parent[i]
      }
      return i
    }
    fun union(a: Int, b: Int) {
      val pa = find(a)
      val pb = find(b)
      if (pa != pb) parent[pb] = pa
    }
    for (y in 0 until height) {
      for (x in 0 until width) {
        val i = y * width + x
        if (!edges[i]) continue
        if (x + 1 < width && edges[i + 1]) union(i, i + 1)
        if (y + 1 < height && edges[i + width]) union(i, i + width)
      }
    }
    data class Acc(var minX: Int, var minY: Int, var maxX: Int, var maxY: Int)
    val acc = HashMap<Int, Acc>()
    for (y in 0 until height) {
      for (x in 0 until width) {
        val i = y * width + x
        if (!edges[i]) continue
        val root = find(i)
        val box = acc.getOrPut(root) { Acc(x, y, x, y) }
        if (x < box.minX) box.minX = x
        if (y < box.minY) box.minY = y
        if (x > box.maxX) box.maxX = x
        if (y > box.maxY) box.maxY = y
      }
    }
    return acc.values.map { Rect(it.minX, it.minY, it.maxX + 1, it.maxY + 1) }
  }
}

/// 24×24 packed RGB (pHash) plus a larger JPEG crop (OpenCLIP sidecar).
/// Hash/classify happens on the API, never a page jpeg.
private object LiveVideoIdentityCrop {
  private const val SIZE = 24
  private const val JPEG_MAX_EDGE = 448

  private fun cropBounds(bitmap: Bitmap, box: Rect): Rect? {
    if (bitmap.isRecycled) return null
    val left = box.left.coerceIn(0, bitmap.width - 1)
    val top = box.top.coerceIn(0, bitmap.height - 1)
    val right = box.right.coerceIn(left + 1, bitmap.width)
    val bottom = box.bottom.coerceIn(top + 1, bitmap.height)
    val width = right - left
    val height = bottom - top
    if (width < 8 || height < 8) return null
    val insetX = (width * 0.04f).toInt()
    val insetY = (height * 0.04f).toInt()
    val cropLeft = (left + insetX).coerceAtMost(right - 8)
    val cropTop = (top + insetY).coerceAtMost(bottom - 8)
    val cropRight = (right - insetX).coerceAtLeast(cropLeft + 8)
    val cropBottom = (bottom - insetY).coerceAtLeast(cropTop + 8)
    return Rect(cropLeft, cropTop, cropRight, cropBottom)
  }

  fun base64(bitmap: Bitmap, box: Rect): String? {
    val crop = cropBounds(bitmap, box) ?: return null
    val packed = ByteArray(SIZE * SIZE * 3)
    val pixels = IntArray(1)
    for (y in 0 until SIZE) {
      val srcY = (crop.top + (y + 0.5f) * (crop.bottom - crop.top) / SIZE - 0.5f)
        .toInt()
        .coerceIn(0, bitmap.height - 1)
      for (x in 0 until SIZE) {
        val srcX = (crop.left + (x + 0.5f) * (crop.right - crop.left) / SIZE - 0.5f)
          .toInt()
          .coerceIn(0, bitmap.width - 1)
        bitmap.getPixels(pixels, 0, 1, srcX, srcY, 1, 1)
        val color = pixels[0]
        val i = (y * SIZE + x) * 3
        packed[i] = (color shr 16 and 0xff).toByte()
        packed[i + 1] = (color shr 8 and 0xff).toByte()
        packed[i + 2] = (color and 0xff).toByte()
      }
    }
    return Base64.encodeToString(packed, Base64.NO_WRAP)
  }

  fun jpegBase64(bitmap: Bitmap, box: Rect): String? {
    val crop = cropBounds(bitmap, box) ?: return null
    val width = crop.width()
    val height = crop.height()
    val longest = maxOf(width, height).toFloat()
    val scale = minOf(1f, JPEG_MAX_EDGE / longest)
    val outW = maxOf(8, (width * scale).toInt())
    val outH = maxOf(8, (height * scale).toInt())
    val cropped = Bitmap.createBitmap(bitmap, crop.left, crop.top, width, height)
    val scaled =
      if (outW == width && outH == height) cropped
      else Bitmap.createScaledBitmap(cropped, outW, outH, true)
    if (scaled !== cropped && !cropped.isRecycled) cropped.recycle()
    val stream = ByteArrayOutputStream()
    val ok = scaled.compress(Bitmap.CompressFormat.JPEG, 82, stream)
    if (scaled !== bitmap && !scaled.isRecycled) scaled.recycle()
    if (!ok) return null
    return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
  }
}
