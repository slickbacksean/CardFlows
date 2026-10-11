/**
 * Pre-ship YOLO26n card detect (LiteRT / TFLite). Rectangle detect remains the fallback.
 *
 * TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics
 * Enterprise license before App Store / production ship. Pre-ship testing only.
 * Never enable this path on EAS production / store profiles.
 *
 * TFLite is loaded by reflection so production / store binaries do not need
 * the runtime on the classpath. Missing class or missing weights → rectangle.
 */
package expo.modules.cardflowlivevideo

import android.graphics.Bitmap
import android.graphics.Rect
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

internal data class LiveCardDecision(
  val crop: CardDetectResult,
  val cropSource: String,
  val latencyMs: Double,
  val abPayload: Map<String, Any>?,
)

internal object LiveCardDetect {
  fun run(bitmap: Bitmap): LiveCardDecision {
    val mode = Yolo26nCardDetect.mode
    if (!Yolo26nCardDetect.enabled || mode == "rectangle") {
      val started = System.nanoTime()
      val rectangle = CardInStreamDetect.inspect(bitmap)
      return LiveCardDecision(
        crop = rectangle,
        cropSource = "rectangle",
        latencyMs = (System.nanoTime() - started) / 1_000_000.0,
        abPayload = null,
      )
    }
    if (mode == "ab") {
      val yoloStarted = System.nanoTime()
      val yolo = Yolo26nCardDetect.inspect(bitmap)
      val yoloMs = (System.nanoTime() - yoloStarted) / 1_000_000.0
      val rectStarted = System.nanoTime()
      val rectangle = CardInStreamDetect.inspect(bitmap)
      val rectMs = (System.nanoTime() - rectStarted) / 1_000_000.0
      val yoloHit = yolo?.cardDetected == true
      val crop = if (yoloHit) yolo!! else rectangle
      val cropSource =
        if (yoloHit) "yolo26n"
        else if (rectangle.cardDetected) "fallback_rectangle"
        else "rectangle"
      return LiveCardDecision(
        crop = crop,
        cropSource = cropSource,
        latencyMs = yoloMs,
        abPayload = mapOf(
          "yolo" to observationPayload("yolo26n", yolo, yoloMs, bitmap),
          "rectangle" to observationPayload("rectangle", rectangle, rectMs, bitmap),
          "iou" to (boxIou(yolo?.box, rectangle.box) ?: Unit),
          "agreement" to detectorsAgree(yolo, rectangle),
          "cropSource" to cropSource,
        ).filterValues { it !== Unit },
      )
    }
    val started = System.nanoTime()
    val yolo = Yolo26nCardDetect.inspect(bitmap)
    if (yolo?.cardDetected == true) {
      return LiveCardDecision(
        crop = yolo,
        cropSource = "yolo26n",
        latencyMs = (System.nanoTime() - started) / 1_000_000.0,
        abPayload = null,
      )
    }
    val fallbackStarted = System.nanoTime()
    val rectangle = CardInStreamDetect.inspect(bitmap)
    return LiveCardDecision(
      crop = rectangle,
      cropSource = if (rectangle.cardDetected) "fallback_rectangle" else "rectangle",
      latencyMs = (System.nanoTime() - fallbackStarted) / 1_000_000.0,
      abPayload = null,
    )
  }

  private fun observationPayload(
    backend: String,
    result: CardDetectResult?,
    latencyMs: Double,
    bitmap: Bitmap,
  ): Map<String, Any> {
    val payload = mutableMapOf<String, Any>(
      "backend" to backend,
      "cardDetected" to (result?.cardDetected == true),
      "latencyMs" to latencyMs,
    )
    val box = result?.box
    if (box != null && bitmap.width > 0 && bitmap.height > 0) {
      payload["box"] = mapOf(
        "x" to box.left.toFloat() / bitmap.width,
        "y" to box.top.toFloat() / bitmap.height,
        "width" to box.width().toFloat() / bitmap.width,
        "height" to box.height().toFloat() / bitmap.height,
      )
    }
    return payload
  }

  private fun boxIou(a: Rect?, b: Rect?): Double? {
    if (a == null || b == null) return null
    val inter = Rect()
    if (!inter.setIntersect(a, b)) return 0.0
    val interArea = inter.width().toDouble() * inter.height()
    val union = a.width().toDouble() * a.height() + b.width().toDouble() * b.height() - interArea
    if (union <= 0.0) return 0.0
    return interArea / union
  }

  private fun detectorsAgree(yolo: CardDetectResult?, rectangle: CardDetectResult): Boolean {
    val yoloHit = yolo?.cardDetected == true
    if (yoloHit != rectangle.cardDetected) return false
    if (!yoloHit) return true
    val iou = boxIou(yolo?.box, rectangle.box) ?: return false
    return iou >= 0.5
  }
}

internal object Yolo26nCardDetect {
  @Volatile var enabled: Boolean = false
  @Volatile var mode: String = "rectangle"
  @Volatile private var modelPath: String? = null
  @Volatile private var interpreter: Any? = null

  fun configure(config: Map<String, Any?>) {
    val buildAllows = try {
      BuildConfig.YOLO26N_ONDEVICE
    } catch (_: Throwable) {
      false
    }
    enabled = bool(config["yoloEnabled"]) && buildAllows
    mode = string(config["mode"]) ?: "rectangle"
    modelPath = string(config["modelPath"])
    if (!enabled) {
      closeInterpreter()
      return
    }
    interpreter = loadInterpreter(resolveModelFile())
  }

  fun inspect(bitmap: Bitmap): CardDetectResult? {
    if (!enabled) return null
    val loaded = interpreter ?: loadInterpreter(resolveModelFile()).also { interpreter = it }
    if (loaded == null) return null
    return Yolo26nTflite.inspect(bitmap, loaded)
  }

  private fun resolveModelFile(): File? {
    val explicit = modelPath?.let(::File)
    if (explicit != null && explicit.isFile) return explicit
    val candidates = listOf(
      File("/data/local/tmp/cardflow/yolo26n-card.tflite"),
      File("/data/local/tmp/cardflow/yolo26n.tflite"),
    )
    return candidates.firstOrNull { it.isFile }
  }

  private fun loadInterpreter(model: File?): Any? {
    if (model == null) return null
    return try {
      val clazz = Class.forName("org.tensorflow.lite.Interpreter")
      val ctor = clazz.getConstructor(File::class.java)
      ctor.newInstance(model)
    } catch (_: Throwable) {
      null
    }
  }

  private fun closeInterpreter() {
    val current = interpreter
    interpreter = null
    if (current == null) return
    try {
      current.javaClass.getMethod("close").invoke(current)
    } catch (_: Throwable) {
      // Interpreter was never opened or already released.
    }
  }

  private fun bool(value: Any?): Boolean {
    return when (value) {
      is Boolean -> value
      is Number -> value.toInt() != 0
      is String -> value.trim().equals("true", ignoreCase = true)
      else -> false
    }
  }

  private fun string(value: Any?): String? {
    val text = value as? String ?: return null
    val trimmed = text.trim()
    return trimmed.ifEmpty { null }
  }
}

internal object Yolo26nTflite {
  private const val INPUT = 640
  private const val MIN_CONF = 0.25f

  fun inspect(bitmap: Bitmap, interpreter: Any): CardDetectResult? {
    if (bitmap.isRecycled || bitmap.width < 8 || bitmap.height < 8) return null
    return try {
      val input = letterbox(bitmap)
      val output = run(interpreter, input.buffer) ?: return null
      val box = bestCard(output, input) ?: return CardDetectResult(false, null)
      CardDetectResult(true, box)
    } catch (_: Throwable) {
      null
    }
  }

  private data class Letterbox(
    val buffer: ByteBuffer,
    val scale: Float,
    val padX: Float,
    val padY: Float,
    val srcWidth: Int,
    val srcHeight: Int,
  )

  private fun letterbox(src: Bitmap): Letterbox {
    val scale = INPUT.toFloat() / max(src.width, src.height)
    val newW = max(1, (src.width * scale).toInt())
    val newH = max(1, (src.height * scale).toInt())
    val padX = (INPUT - newW) / 2f
    val padY = (INPUT - newH) / 2f
    val scaled = Bitmap.createScaledBitmap(src, newW, newH, true)
    val pixels = IntArray(newW * newH)
    scaled.getPixels(pixels, 0, newW, 0, 0, newW, newH)
    if (scaled !== src && !scaled.isRecycled) scaled.recycle()
    val buffer = ByteBuffer.allocateDirect(1 * INPUT * INPUT * 3 * 4).order(ByteOrder.nativeOrder())
    val row = FloatArray(INPUT * 3)
    for (y in 0 until INPUT) {
      java.util.Arrays.fill(row, 0f)
      val sy = y - padY.toInt()
      if (sy in 0 until newH) {
        for (x in 0 until newW) {
          val color = pixels[sy * newW + x]
          val dest = ((padX.toInt() + x) * 3).coerceIn(0, row.size - 3)
          row[dest] = (color shr 16 and 0xff) / 255f
          row[dest + 1] = (color shr 8 and 0xff) / 255f
          row[dest + 2] = (color and 0xff) / 255f
        }
      }
      row.forEach { buffer.putFloat(it) }
    }
    buffer.rewind()
    return Letterbox(buffer, scale, padX, padY, src.width, src.height)
  }

  private fun run(interpreter: Any, input: ByteBuffer): Array<FloatArray>? {
    val clazz = interpreter.javaClass
    val outShape = try {
      val outputTensor = clazz.getMethod("getOutputTensor", Int::class.javaPrimitiveType).invoke(interpreter, 0)
      outputTensor.javaClass.getMethod("shape").invoke(outputTensor) as IntArray
    } catch (_: Throwable) {
      intArrayOf(1, 300, 6)
    }
    val output = allocateOutput(outShape)
    clazz.getMethod("run", Any::class.java, Any::class.java).invoke(interpreter, input, output)
    return flattenDetections(output, outShape)
  }

  private fun allocateOutput(shape: IntArray): Any {
    return when (shape.size) {
      3 -> Array(shape[0]) { Array(shape[1]) { FloatArray(shape[2]) } }
      2 -> Array(shape[0]) { FloatArray(shape[1]) }
      else -> Array(1) { Array(300) { FloatArray(6) } }
    }
  }

  private fun flattenDetections(raw: Any, shape: IntArray): Array<FloatArray>? {
    if (raw is Array<*> && raw.isNotEmpty() && raw[0] is Array<*>) {
      val batch = raw[0] as Array<*>
      return Array(batch.size) { index ->
        val row = batch[index]
        if (row is FloatArray) row else FloatArray(0)
      }
    }
    if (raw is Array<*> && raw.isNotEmpty() && raw[0] is FloatArray) {
      val first = raw[0] as FloatArray
      // Ultralytics NMS-off: (1, 4+nc, 8400) channels-first.
      if (shape.size == 3 && shape[1] < shape[2]) {
        return transposeChannelsFirst(raw as Array<FloatArray>)
      }
      return arrayOf(first)
    }
    return null
  }

  private fun transposeChannelsFirst(channels: Array<FloatArray>): Array<FloatArray> {
    if (channels.isEmpty()) return emptyArray()
    val count = channels[0].size
    val width = channels.size
    return Array(count) { i ->
      FloatArray(width) { c -> channels[c][i] }
    }
  }

  private fun bestCard(rows: Array<FloatArray>, letterbox: Letterbox): Rect? {
    var best: Rect? = null
    var bestScore = MIN_CONF
    for (row in rows) {
      if (row.size < 5) continue
      val parsed = parseRow(row) ?: continue
      if (parsed.score < bestScore) continue
      val mapped = toSource(parsed, letterbox) ?: continue
      val width = mapped.width().toFloat()
      val height = mapped.height().toFloat()
      val fill = (width * height) / (letterbox.srcWidth * letterbox.srcHeight).toFloat()
      if (fill < 0.10f) continue
      val shortest = min(width, height)
      val longest = max(width, height)
      if (longest <= 0f) continue
      val ratio = shortest / longest
      if (ratio !in 0.60f..0.82f) continue
      best = mapped
      bestScore = parsed.score
    }
    return best
  }

  private data class Parsed(val cx: Float, val cy: Float, val w: Float, val h: Float, val score: Float)

  private fun parseRow(row: FloatArray): Parsed? {
    // NMS-on: x1,y1,x2,y2,conf,cls  or xywh + conf
    if (row.size >= 6 && row[4] in 0f..1f && row[0] < row[2]) {
      val x1 = row[0]
      val y1 = row[1]
      val x2 = row[2]
      val y2 = row[3]
      return Parsed((x1 + x2) / 2f, (y1 + y2) / 2f, x2 - x1, y2 - y1, row[4])
    }
    val conf = if (row.size >= 5) row[4] else row[row.lastIndex]
    if (conf !in 0f..1f) return null
    return Parsed(row[0], row[1], row[2], row[3], conf)
  }

  private fun toSource(parsed: Parsed, letterbox: Letterbox): Rect? {
    val pixel = parsed.cx > 1.5f || parsed.cy > 1.5f || parsed.w > 1.5f
    val cx = if (pixel) parsed.cx else parsed.cx * INPUT
    val cy = if (pixel) parsed.cy else parsed.cy * INPUT
    val w = if (pixel) parsed.w else parsed.w * INPUT
    val h = if (pixel) parsed.h else parsed.h * INPUT
    val x1 = ((cx - w / 2f - letterbox.padX) / letterbox.scale).toInt()
    val y1 = ((cy - h / 2f - letterbox.padY) / letterbox.scale).toInt()
    val x2 = ((cx + w / 2f - letterbox.padX) / letterbox.scale).toInt()
    val y2 = ((cy + h / 2f - letterbox.padY) / letterbox.scale).toInt()
    val left = x1.coerceIn(0, letterbox.srcWidth - 1)
    val top = y1.coerceIn(0, letterbox.srcHeight - 1)
    val right = x2.coerceIn(left + 1, letterbox.srcWidth)
    val bottom = y2.coerceIn(top + 1, letterbox.srcHeight)
    if (right - left < 8 || bottom - top < 8) return null
    return Rect(left, top, right, bottom)
  }
}
