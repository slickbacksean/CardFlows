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

    AsyncFunction("setYoloDetect") { active: Boolean ->
      LiveVideoSamplePump.shared.setYoloDetect(active)
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
  private var yoloDetect = false
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

  fun setYoloDetect(active: Boolean) {
    synchronized(lock) { yoloDetect = active }
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
    android.util.Log.i(
      "CardFlowLive",
      "frame=${pixelBuffer != null} card=${detection?.cardDetected == true}",
    )
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
    val sendFrame = synchronized(lock) { yoloDetect }
    val videoFrameJpeg =
      if (sendFrame && pixelBuffer != null && !pixelBuffer.isRecycled) frameJpegBase64(pixelBuffer) else null
    if (pixelBuffer != null && !pixelBuffer.isRecycled) pixelBuffer.recycle()
    val payload = mutableMapOf<String, Any>(
      "source" to "live_video",
      "cardDetected" to cardDetected,
    )
    if (identityRgb != null) payload["identityRgb"] = identityRgb
    if (identityCropJpeg != null) payload["identityCropJpeg"] = identityCropJpeg
    if (videoFrameJpeg != null) payload["videoFrameJpeg"] = videoFrameJpeg
    return payload
  }

  private fun frameJpegBase64(bitmap: Bitmap): String? {
    val longSide = max(bitmap.width, bitmap.height)
    val scaled = if (longSide <= 480) bitmap else {
      val scale = 480f / longSide
      Bitmap.createScaledBitmap(
        bitmap,
        max(8, (bitmap.width * scale).toInt()),
        max(8, (bitmap.height * scale).toInt()),
        true,
      )
    }
    return try {
      val stream = ByteArrayOutputStream()
      val ok = scaled.compress(Bitmap.CompressFormat.JPEG, 55, stream)
      if (scaled !== bitmap && !scaled.isRecycled) scaled.recycle()
      if (!ok) null else Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    } catch (_: Throwable) {
      if (scaled !== bitmap && !scaled.isRecycled) scaled.recycle()
      null
    }
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
    val shot = onMain { livestreamWebViewBounds() }
    val webViewFrame = shot?.let(::copyWindowShot)
    if (webViewFrame != null) return webViewFrame
    return copyHlsFrame()
  }

  private data class WindowShot(val window: android.view.Window, val rect: Rect)

  /// Chromium often paints the live picture into the WebView instead of a
  /// separate video SurfaceView. The rect is only that WebView.
  private fun livestreamWebViewBounds(): WindowShot? {
    val webView = livestreamWebViews().firstOrNull() ?: return null
    val width = webView.width
    val height = webView.height
    if (width < 160 || height < 160) return null
    val origin = IntArray(2)
    webView.getLocationInWindow(origin)
    val window = windowOf(webView) ?: return null
    return WindowShot(window, Rect(origin[0], origin[1], origin[0] + width, origin[1] + height))
  }

  private fun copyWindowShot(shot: WindowShot): Bitmap? {
    val width = shot.rect.width()
    val height = shot.rect.height()
    if (width < 160 || height < 160) return null
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val handler = synchronized(lock) { copyHandler } ?: run {
      bitmap.recycle()
      return null
    }
    val latch = CountDownLatch(1)
    var ok = false
    try {
      PixelCopy.request(shot.window, shot.rect, bitmap, { result ->
        ok = result == PixelCopy.SUCCESS
        latch.countDown()
      }, handler)
    } catch (_: Throwable) {
      bitmap.recycle()
      return null
    }
    if (!latch.await(250, TimeUnit.MILLISECONDS) || !ok || isBlankFrame(bitmap)) {
      bitmap.recycle()
      return null
    }
    val (destWidth, destHeight) = destSize(width, height) ?: return bitmap
    if (destWidth == width && destHeight == height) return bitmap
    val scaled = Bitmap.createScaledBitmap(bitmap, destWidth, destHeight, true)
    bitmap.recycle()
    return scaled
  }

  private fun windowOf(view: View): android.view.Window? {
    var context = view.context
    while (context is android.content.ContextWrapper) {
      if (context is Activity) return context.window
      context = context.baseContext
    }
    return activityProvider?.invoke()?.window
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
    if (isAppChromeSurface(view)) return
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

  private fun isAppChromeSurface(view: View): Boolean {
    val name = view.javaClass.name
    return name.contains("ReactSurfaceView") || name.contains("DebuggingOverlay")
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

/// Pokémon TCG is 63×88 mm (~0.716). A window is a card only with that
/// proportion, a border, and artwork inside. Chat and flat buttons fail.
private data class CardDetectResult(val cardDetected: Boolean, val box: Rect?)

private object CardInStreamDetect {
  private const val MIN_SHORT_OVER_LONG = 0.64f
  private const val MAX_SHORT_OVER_LONG = 0.82f
  private const val MIN_FILL = 0.02f
  private const val MAX_FILL = 0.55f
  private const val MIN_SIZE = 0.12f
  private const val DETECT_MAX_SIDE = 160

  fun inspect(pixelBuffer: Bitmap): CardDetectResult {
    if (pixelBuffer.isRecycled || pixelBuffer.width < 160 || pixelBuffer.height < 160) {
      return CardDetectResult(false, null)
    }
    val scaled = downscale(pixelBuffer)
    try {
      val width = scaled.width
      val height = scaled.height
      val luma = luma(scaled)
      val magnitude = sobelMagnitude(luma, width, height)
      val best = searchCardWindow(luma, magnitude, width, height)
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

  /// Card-shaped windows only. Flat chat and buttons lose to artwork inside a border.
  private fun searchCardWindow(
    luma: IntArray,
    magnitude: IntArray,
    width: Int,
    height: Int,
  ): Rect? {
    val frameMin = min(width, height).toFloat()
    val frameArea = (width * height).toFloat()
    var bestScore = 0.0
    var best: Rect? = null
    val longFractions = floatArrayOf(0.24f, 0.34f, 0.46f, 0.62f, 0.80f)
    val aspects = floatArrayOf(0.716f)
    for (portrait in booleanArrayOf(true, false)) {
      for (longFrac in longFractions) {
        val longSide = (frameMin * longFrac).toInt()
        if (longSide < MIN_SIZE * frameMin) continue
        for (aspect in aspects) {
          if (aspect !in MIN_SHORT_OVER_LONG..MAX_SHORT_OVER_LONG) continue
          val shortSide = (longSide * aspect).toInt()
          val boxWidth = if (portrait) shortSide else longSide
          val boxHeight = if (portrait) longSide else shortSide
          if (boxWidth < 16 || boxHeight < 16 || boxWidth >= width || boxHeight >= height) continue
          val fill = (boxWidth * boxHeight) / frameArea
          if (fill < MIN_FILL || fill > MAX_FILL) continue
          val stepX = max(boxWidth / 4, 12)
          val stepY = max(boxHeight / 4, 12)
          var top = 0
          while (top + boxHeight < height) {
            var left = 0
            while (left + boxWidth < width) {
              val border = borderMean(magnitude, width, left, top, boxWidth, boxHeight)
              val interior = interiorStats(luma, width, left, top, boxWidth, boxHeight)
              if (interior.stddev >= 16.0 && interior.busyFraction >= 0.28 && border >= 12.0) {
                val cx = (left + boxWidth / 2f) / width - 0.5f
                val cy = (top + boxHeight / 2f) / height - 0.5f
                val score = border + interior.stddev * 0.45 + (1.0 - (cx * cx + cy * cy) * 4.0) * 4.0
                if (score > bestScore) {
                  bestScore = score
                  best = Rect(left, top, left + boxWidth, top + boxHeight)
                }
              }
              left += stepX
            }
            top += stepY
          }
        }
      }
    }
    if (bestScore < 28.0) return null
    return best
  }

  private data class InteriorStats(val stddev: Double, val busyFraction: Double)

  /// Inner artwork. A flat button or a text bar on one color stays under the gate.
  private fun interiorStats(
    luma: IntArray,
    stride: Int,
    left: Int,
    top: Int,
    boxWidth: Int,
    boxHeight: Int,
  ): InteriorStats {
    val x0 = left + boxWidth / 5
    val x1 = left + (boxWidth * 4) / 5
    val y0 = top + boxHeight / 5
    val y1 = top + (boxHeight * 4) / 5
    if (x1 <= x0 || y1 <= y0) return InteriorStats(0.0, 0.0)
    var sum = 0.0
    var sumSq = 0.0
    var count = 0
    val step = 2
    var y = y0
    while (y < y1) {
      var x = x0
      while (x < x1) {
        val value = luma[y * stride + x].toDouble()
        sum += value
        sumSq += value * value
        count++
        x += step
      }
      y += step
    }
    if (count < 8) return InteriorStats(0.0, 0.0)
    val mean = sum / count
    val variance = (sumSq / count - mean * mean).coerceAtLeast(0.0)
    var busy = 0
    y = y0
    while (y < y1) {
      var x = x0
      while (x < x1) {
        if (kotlin.math.abs(luma[y * stride + x] - mean) >= 22.0) busy++
        x += step
      }
      y += step
    }
    return InteriorStats(kotlin.math.sqrt(variance), busy.toDouble() / count)
  }

  private fun borderMean(
    magnitude: IntArray,
    stride: Int,
    left: Int,
    top: Int,
    boxWidth: Int,
    boxHeight: Int,
  ): Double {
    var sum = 0.0
    var count = 0
    val step = 2
    fun sample(x: Int, y: Int) {
      sum += magnitude[y * stride + x]
      count++
    }
    var x = left
    while (x < left + boxWidth) {
      sample(x, top)
      sample(x, top + boxHeight - 1)
      x += step
    }
    var y = top
    while (y < top + boxHeight) {
      sample(left, y)
      sample(left + boxWidth - 1, y)
      y += step
    }
    if (count == 0) return 0.0
    return sum / count
  }

  private fun sobelMagnitude(luma: IntArray, width: Int, height: Int): IntArray {
    val magnitude = IntArray(width * height)
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
        magnitude[i] = kotlin.math.sqrt((gx * gx + gy * gy).toDouble()).toInt()
      }
    }
    return magnitude
  }
}

/// 24×24 packed RGB (pHash) plus a larger JPEG crop (OpenCLIP sidecar).
/// Hash/classify happens on the API, never a page jpeg.
private object LiveVideoIdentityCrop {
  private const val SIZE = 24
  private const val JPEG_MAX_EDGE = 224

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
