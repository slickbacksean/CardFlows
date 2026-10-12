/**
 * Pre-ship YOLO26n card detect (CoreML). Rectangle detect remains the fallback.
 *
 * TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics
 * Enterprise license before App Store / production ship. Pre-ship testing only.
 * Never enable this path on EAS production / store profiles.
 */
import CoreML
import Foundation
import Vision

enum LiveCardDetect {
  struct Decision {
    let crop: CardDetectResult
    let cropSource: String
    let latencyMs: Double
    let abPayload: [String: Any]?
    let cardQuad: [String: Any]?
    let imageWidth: Int
    let imageHeight: Int
  }

  static func run(_ pixelBuffer: CVPixelBuffer) -> Decision {
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let mode = Yolo26nCardDetect.mode
    if !Yolo26nCardDetect.enabled || mode == "rectangle" {
      let started = CFAbsoluteTimeGetCurrent()
      let rectangle = CardInStreamDetect.inspect(pixelBuffer)
      return Decision(
        crop: rectangle,
        cropSource: "rectangle",
        latencyMs: (CFAbsoluteTimeGetCurrent() - started) * 1000,
        abPayload: nil,
        cardQuad: nil,
        imageWidth: width,
        imageHeight: height
      )
    }

    if mode == "ab" {
      let yoloStarted = CFAbsoluteTimeGetCurrent()
      let yolo = Yolo26nCardDetect.inspect(pixelBuffer)
      let yoloMs = (CFAbsoluteTimeGetCurrent() - yoloStarted) * 1000
      let rectStarted = CFAbsoluteTimeGetCurrent()
      let rectangle = CardInStreamDetect.inspect(pixelBuffer)
      let rectMs = (CFAbsoluteTimeGetCurrent() - rectStarted) * 1000
      let yoloHit = yolo?.cardDetected == true
      let crop = yoloHit ? yolo! : rectangle
      let cropSource = yoloHit ? "yolo26n" : (rectangle.cardDetected ? "fallback_rectangle" : "rectangle")
      return Decision(
        crop: crop,
        cropSource: cropSource,
        latencyMs: yoloMs,
        abPayload: [
          "yolo": observationPayload("yolo26n", yolo, yoloMs),
          "rectangle": observationPayload("rectangle", rectangle, rectMs),
          "iou": boxIou(yolo?.boundingBox, rectangle.boundingBox) as Any,
          "agreement": detectorsAgree(yolo, rectangle),
          "cropSource": cropSource,
        ],
        cardQuad: yoloHit ? cardQuad(from: yolo?.boundingBox, width: width, height: height) : nil,
        imageWidth: width,
        imageHeight: height
      )
    }

    let started = CFAbsoluteTimeGetCurrent()
    if let yolo = Yolo26nCardDetect.inspect(pixelBuffer), yolo.cardDetected {
      return Decision(
        crop: yolo,
        cropSource: "yolo26n",
        latencyMs: (CFAbsoluteTimeGetCurrent() - started) * 1000,
        abPayload: nil,
        cardQuad: cardQuad(from: yolo.boundingBox, width: width, height: height),
        imageWidth: width,
        imageHeight: height
      )
    }
    let fallbackStarted = CFAbsoluteTimeGetCurrent()
    let rectangle = CardInStreamDetect.inspect(pixelBuffer)
    return Decision(
      crop: rectangle,
      cropSource: rectangle.cardDetected ? "fallback_rectangle" : "rectangle",
      latencyMs: (CFAbsoluteTimeGetCurrent() - fallbackStarted) * 1000,
      abPayload: nil,
      cardQuad: nil,
      imageWidth: width,
      imageHeight: height
    )
  }

  /// Vision box is bottom-left; CardQuad corners are top-left pixels, TL TR BR BL.
  static func cardQuad(from visionBox: CGRect?, width: Int, height: Int, confidence: Double = 0.45) -> [String: Any]? {
    guard let visionBox, width >= 8, height >= 8 else { return nil }
    let x1 = visionBox.origin.x * CGFloat(width)
    let y1 = (1 - visionBox.origin.y - visionBox.height) * CGFloat(height)
    let x2 = x1 + visionBox.width * CGFloat(width)
    let y2 = y1 + visionBox.height * CGFloat(height)
    return [
      "version": 1,
      "source": "yolo26n-ab",
      "sourceVersion": "yolo26n-ab@pre-ship",
      "imageWidth": width,
      "imageHeight": height,
      "corners": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
      "confidence": confidence,
      "accepted": true,
      "outOfPlaneDeg": NSNull(),
      "rejectReasons": [] as [String],
    ]
  }

  private static func observationPayload(
    _ backend: String,
    _ result: CardDetectResult?,
    _ latencyMs: Double
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "backend": backend,
      "cardDetected": result?.cardDetected == true,
      "latencyMs": latencyMs,
    ]
    if let box = result?.boundingBox {
      payload["box"] = [
        "x": box.origin.x,
        "y": 1 - box.origin.y - box.height,
        "width": box.width,
        "height": box.height,
      ]
    }
    return payload
  }

  private static func boxIou(_ a: CGRect?, _ b: CGRect?) -> Double? {
    guard let a, let b, a.width > 0, a.height > 0, b.width > 0, b.height > 0 else {
      return nil
    }
    let inter = a.intersection(b)
    if inter.isNull || inter.isEmpty { return 0 }
    let union = a.width * a.height + b.width * b.height - inter.width * inter.height
    if union <= 0 { return 0 }
    return Double(inter.width * inter.height / union)
  }

  private static func detectorsAgree(_ yolo: CardDetectResult?, _ rectangle: CardDetectResult) -> Bool {
    let yoloHit = yolo?.cardDetected == true
    if yoloHit != rectangle.cardDetected { return false }
    if !yoloHit { return true }
    guard let iou = boxIou(yolo?.boundingBox, rectangle.boundingBox) else { return false }
    return iou >= 0.5
  }
}

enum Yolo26nCardDetect {
  static var enabled = false
  static var mode = "rectangle"
  private static var visionModel: VNCoreMLModel?
  private static let lock = NSLock()

  static func configure(_ config: [String: Any]) {
    let nextEnabled = bool(config["yoloEnabled"])
    let nextMode = string(config["mode"]) ?? "rectangle"
    let modelPath = string(config["modelPath"])
    lock.lock()
    enabled = nextEnabled
    mode = nextMode
    if !nextEnabled {
      visionModel = nil
      lock.unlock()
      return
    }
    lock.unlock()
    visionModel = loadModel(path: modelPath)
  }

  static func inspect(_ pixelBuffer: CVPixelBuffer) -> CardDetectResult? {
    guard enabled, let model = visionModel else { return nil }
    let request = VNCoreMLRequest(model: model)
    request.imageCropAndScaleOption = .scaleFit
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return nil
    }
    if let objects = request.results as? [VNRecognizedObjectObservation] {
      return bestCard(from: objects)
    }
    return nil
  }

  private static func bestCard(from objects: [VNRecognizedObjectObservation]) -> CardDetectResult {
    var best: VNRecognizedObjectObservation?
    var bestFill: CGFloat = 0
    for observation in objects {
      guard observation.confidence >= 0.25 else { continue }
      let box = observation.boundingBox
      let fill = box.width * box.height
      guard fill >= CardInStreamDetect.minFill else { continue }
      let shortest = min(box.width, box.height)
      let longest = max(box.width, box.height)
      guard longest > 0 else { continue }
      let ratio = shortest / longest
      guard ratio >= CardInStreamDetect.minShortOverLong && ratio <= CardInStreamDetect.maxShortOverLong else {
        continue
      }
      if fill > bestFill {
        best = observation
        bestFill = fill
      }
    }
    guard let best else {
      return CardDetectResult(cardDetected: false, boundingBox: nil)
    }
    return CardDetectResult(cardDetected: true, boundingBox: best.boundingBox)
  }

  private static func loadModel(path: String?) -> VNCoreMLModel? {
    guard let url = modelURL(path: path) else { return nil }
    do {
      let compiled = try compiledURL(url)
      let model = try MLModel(contentsOf: compiled)
      return try VNCoreMLModel(for: model)
    } catch {
      return nil
    }
  }

  private static func modelURL(path: String?) -> URL? {
    if let path, FileManager.default.fileExists(atPath: path) {
      return URL(fileURLWithPath: path)
    }
    let names = ["yolo26n-card", "yolo26n"]
    let exts = ["mlmodelc", "mlpackage", "mlmodel"]
    for name in names {
      for ext in exts {
        if let url = Bundle.main.url(forResource: name, withExtension: ext) {
          return url
        }
      }
    }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    for name in ["yolo26n-card.mlpackage", "yolo26n-card.mlmodelc", "yolo26n.mlpackage"] {
      if let url = docs?.appendingPathComponent("models").appendingPathComponent(name),
         FileManager.default.fileExists(atPath: url.path)
      {
        return url
      }
    }
    return nil
  }

  private static func compiledURL(_ url: URL) throws -> URL {
    if url.pathExtension == "mlmodelc" { return url }
    return try MLModel.compileModel(at: url)
  }

  private static func bool(_ value: Any?) -> Bool {
    if let value = value as? Bool { return value }
    if let value = value as? NSNumber { return value.boolValue }
    if let value = value as? String { return value.trimmingCharacters(in: .whitespaces).lowercased() == "true" }
    return false
  }

  private static func string(_ value: Any?) -> String? {
    if let value = value as? String {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
    return nil
  }
}
