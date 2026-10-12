/**
 * In-stream live-video sample buffers from Capgo InAppBrowser / WKWebView media.
 * Never a WebView page still, never Capture jpeg, never the phone camera.
 */
import AVFoundation
import CoreImage
import ExpoModulesCore
import ObjectiveC
import UIKit
import Vision
import WebKit

public final class CardFlowLiveVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardFlowLiveVideo")

    AsyncFunction("setScannerSession") { (active: Bool) in
      LiveVideoSamplePump.shared.setScannerSession(active)
    }

    AsyncFunction("setPlaybackUrl") { (url: String?) in
      LiveVideoSamplePump.shared.noteHlsUrl(url)
    }

    AsyncFunction("setYoloDetect") { (active: Bool) in
      LiveVideoSamplePump.shared.setYoloDetect(active)
    }

    AsyncFunction("pullSampleBuffer") { () -> [String: Any] in
      LiveVideoSamplePump.shared.pullFrame()
    }
  }
}

/// Copies CM/CV sample buffers from in-app live-page video. Detect + identity crop.
final class LiveVideoSamplePump {
  static let shared = LiveVideoSamplePump()

  private let lock = NSLock()
  private let players = NSHashTable<AVPlayer>.weakObjects()
  private var videoOutput: AVPlayerItemVideoOutput?
  private weak var outputItem: AVPlayerItem?
  private var didInstallHooks = false
  private var scannerSession = false
  private var yoloDetect = false
  private var hlsPlayer: AVPlayer?
  private var hlsUrl: String?
  private var hlsCookies: [HTTPCookie] = []
  private var hlsCookiesReady = false
  private var hlsCookieGeneration = UUID()
  private var hlsAppliedCookieCount = -1

  /// The play() hook is installed for the process, but players are kept only
  /// during a scanner session and only when they sit in the livestream page.
  func setYoloDetect(_ active: Bool) {
    lock.lock()
    yoloDetect = active
    lock.unlock()
  }

  func setScannerSession(_ active: Bool) {
    lock.lock()
    scannerSession = active
    if !active {
      players.removeAllObjects()
    }
    let shouldInstall = active && !didInstallHooks
    if shouldInstall { didInstallHooks = true }
    lock.unlock()
    if !active {
      onMain { self.stopHlsPlayer() }
      return
    }
    guard shouldInstall else { return }
    LiveVideoPlayerHooks.install { [weak self] player in
      self?.observe(player)
    }
  }

  func noteHlsUrl(_ raw: String?) {
    let next = LiveHlsUrl.normalize(raw)
    lock.lock()
    let changed = next != hlsUrl
    hlsUrl = next
    hlsCookies = []
    hlsCookiesReady = next == nil
    hlsAppliedCookieCount = -1
    let generation = UUID()
    hlsCookieGeneration = generation
    lock.unlock()
    if changed {
      onMain { self.stopHlsPlayer() }
    }
    guard next != nil else { return }
    WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self else { return }
      var restart = false
      self.lock.lock()
      if self.hlsCookieGeneration == generation {
        let applied = self.hlsAppliedCookieCount
        self.hlsCookies = cookies
        self.hlsCookiesReady = true
        restart = self.hlsPlayer != nil && cookies.count != applied
      }
      self.lock.unlock()
      if restart {
        self.onMain { self.stopHlsPlayer() }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
      guard let self else { return }
      self.lock.lock()
      defer { self.lock.unlock() }
      guard self.hlsCookieGeneration == generation else { return }
      self.hlsCookiesReady = true
    }
  }

  func observe(_ player: AVPlayer) {
    let session = lock.withLock { scannerSession }
    guard session else { return }
    if player === hlsPlayer { return }
    let inPage = onMain { self.playerIsInLivestreamPage(player) }
    guard inPage else { return }
    lock.lock()
    players.add(player)
    lock.unlock()
  }

  func pullFrame() -> [String: Any] {
    let pixelBuffer = onMain { self.copyLiveVideoPixelBuffer() }
    guard let pixelBuffer else {
      return [
        "source": "live_video",
        "cardDetected": false,
      ]
    }
    let detectStart = CFAbsoluteTimeGetCurrent()
    let detection = CardInStreamDetect.inspect(pixelBuffer)
    let detectMs = (CFAbsoluteTimeGetCurrent() - detectStart) * 1000
    var payload: [String: Any] = [
      "source": "live_video",
      "cardDetected": detection.cardDetected,
      "detectMs": detectMs,
    ]
    if detection.cardDetected,
       let box = detection.boundingBox
    {
      // Normalized, top-left origin (Vision is bottom-left). Used for IoU tracking.
      payload["cardBox"] = [
        "x": box.minX,
        "y": 1 - box.maxY,
        "width": box.width,
        "height": box.height,
      ]
      if let identityRgb = LiveVideoIdentityCrop.base64(from: pixelBuffer, normalizedBox: box) {
        payload["identityRgb"] = identityRgb
      }
      if let crop = LiveVideoIdentityCrop.jpegBase64(
        from: pixelBuffer,
        normalizedBox: box,
        corners: detection.corners
      ) {
        payload["identityCropJpeg"] = crop.jpeg
        // TL, TR, BR, BL in the JPEG's pixel space; the server straightens with these.
        if let quad = crop.quad { payload["identityCropQuad"] = quad }
      }
      payload["cropMs"] = (CFAbsoluteTimeGetCurrent() - detectStart) * 1000 - detectMs
    }
    let sendFrame = lock.withLock { yoloDetect }
    if sendFrame, let frameJpeg = LiveVideoIdentityCrop.frameJpegBase64(from: pixelBuffer) {
      payload["videoFrameJpeg"] = frameJpeg
    }
    return payload
  }

  private func copyLiveVideoPixelBuffer() -> CVPixelBuffer? {
    let session = lock.withLock { scannerSession }
    guard session else { return nil }
    if let player = preferredLivePlayer() {
      return copyPixelBuffer(from: player)
    }
    guard let player = ensureHlsPlayer() else { return nil }
    return copyPixelBuffer(from: player)
  }

  /// Muted AVPlayer for the playlist the page exposed. No layer, no page surface.
  private func ensureHlsPlayer() -> AVPlayer? {
    let (session, urlString, ready, cookies) = lock.withLock {
      (scannerSession, hlsUrl, hlsCookiesReady, hlsCookies)
    }
    guard session, ready, let urlString, let url = URL(string: urlString) else { return nil }
    if let hlsPlayer { return hlsPlayer }
    let shared = HTTPCookieStorage.shared.cookies ?? []
    let matched = (cookies + shared).filter { cookie in
      guard let host = url.host?.lowercased() else { return false }
      let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
      return host == domain || host.hasSuffix("." + domain)
    }
    var options: [String: Any] = [:]
    if !matched.isEmpty {
      options[AVURLAssetHTTPHeaderFieldsKey] = HTTPCookie.requestHeaderFields(with: matched)
    }
    lock.lock()
    hlsAppliedCookieCount = matched.count
    lock.unlock()
    let asset = AVURLAsset(url: url, options: options)
    let item = AVPlayerItem(asset: asset)
    let player = AVPlayer(playerItem: item)
    player.isMuted = true
    player.automaticallyWaitsToMinimizeStalling = false
    hlsPlayer = player
    player.play()
    return player
  }

  private func stopHlsPlayer() {
    guard let player = hlsPlayer else { return }
    player.pause()
    if let item = player.currentItem, let videoOutput, outputItem === item {
      if item.outputs.contains(videoOutput) {
        item.remove(videoOutput)
      }
      self.videoOutput = nil
      self.outputItem = nil
    }
    player.replaceCurrentItem(with: nil)
    hlsPlayer = nil
  }

  private func playerIsInLivestreamPage(_ player: AVPlayer) -> Bool {
    livestreamWebViews().contains { playerLayer(of: player, in: $0) != nil }
  }

  /// Only an AVPlayer hosted in the livestream page. No app-wide player, no page surface.
  private func preferredLivePlayer() -> AVPlayer? {
    let liveWebViews = livestreamWebViews()
    guard !liveWebViews.isEmpty else { return nil }
    let known = lock.withLock { players.allObjects }
    let inPage = known.filter { player in
      liveWebViews.contains { webView in playerLayer(of: player, in: webView) != nil }
    }
    if let playing = inPage.first(where: { $0.rate > 0 && $0.currentItem != nil }) {
      return playing
    }
    if let layered = inPage.first(where: { $0.currentItem != nil }) {
      return layered
    }
    for webView in liveWebViews {
      if let player = findPlayer(in: webView) { return player }
    }
    return nil
  }

  private func copyPixelBuffer(from player: AVPlayer) -> CVPixelBuffer? {
    guard let item = player.currentItem, item.status == .readyToPlay else { return nil }
    let output = output(for: item)
    let itemTime = output.itemTime(forHostTime: CACurrentMediaTime())
    if output.hasNewPixelBuffer(forItemTime: itemTime),
       let buffer = output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil) {
      return buffer
    }
    output.requestNotificationOfMediaDataChange(with: itemTime)
    return output.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil)
  }

  private func output(for item: AVPlayerItem) -> AVPlayerItemVideoOutput {
    if let videoOutput, outputItem === item {
      return videoOutput
    }
    let attributes: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
    ]
    let next = AVPlayerItemVideoOutput(pixelBufferAttributes: attributes)
    if let videoOutput, let outputItem, outputItem.outputs.contains(videoOutput) {
      outputItem.remove(videoOutput)
    }
    item.add(next)
    videoOutput = next
    outputItem = item
    return next
  }

  private func livestreamWebViews() -> [WKWebView] {
    windows()
      .flatMap { findWebViews(in: $0) }
      .filter(isLivestreamWebView)
      .sorted { $0.bounds.width * $0.bounds.height > $1.bounds.width * $1.bounds.height }
  }

  private func isLivestreamWebView(_ webView: WKWebView) -> Bool {
    if webView.isHidden || webView.bounds.width < 160 || webView.bounds.height < 160 {
      return false
    }
    let host = webView.url?.host?.lowercased() ?? ""
    if host.contains("127.0.0.1") || host.contains("localhost") {
      return false
    }
    return true
  }

  private func windows() -> [UIWindow] {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
  }

  private func findWebViews(in view: UIView) -> [WKWebView] {
    var found: [WKWebView] = []
    if let webView = view as? WKWebView {
      found.append(webView)
    }
    for subview in view.subviews {
      found.append(contentsOf: findWebViews(in: subview))
    }
    return found
  }

  private func findPlayer(in view: UIView) -> AVPlayer? {
    if let player = findPlayer(in: view.layer) {
      return player
    }
    for subview in view.subviews {
      if let player = findPlayer(in: subview) {
        return player
      }
    }
    return nil
  }

  private func findPlayer(in layer: CALayer) -> AVPlayer? {
    if let playerLayer = layer as? AVPlayerLayer, let player = playerLayer.player {
      return player
    }
    for sublayer in layer.sublayers ?? [] {
      if let player = findPlayer(in: sublayer) {
        return player
      }
    }
    return nil
  }

  private func playerLayer(of player: AVPlayer, in view: UIView) -> AVPlayerLayer? {
    if let playerLayer = view.layer as? AVPlayerLayer, playerLayer.player === player {
      return playerLayer
    }
    for sublayer in view.layer.sublayers ?? [] {
      if let playerLayer = playerLayer(of: player, in: sublayer) {
        return playerLayer
      }
    }
    for subview in view.subviews {
      if let playerLayer = playerLayer(of: player, in: subview) {
        return playerLayer
      }
    }
    return nil
  }

  private func playerLayer(of player: AVPlayer, in layer: CALayer) -> AVPlayerLayer? {
    if let playerLayer = layer as? AVPlayerLayer, playerLayer.player === player {
      return playerLayer
    }
    for sublayer in layer.sublayers ?? [] {
      if let playerLayer = playerLayer(of: player, in: sublayer) {
        return playerLayer
      }
    }
    return nil
  }

  private func onMain<T>(_ work: () -> T) -> T {
    if Thread.isMainThread { return work() }
    return DispatchQueue.main.sync(execute: work)
  }
}

private extension NSLock {
  func withLock<T>(_ work: () -> T) -> T {
    lock()
    defer { unlock() }
    return work()
  }
}

private struct CardDetectResult {
  let cardDetected: Bool
  let boundingBox: CGRect?
  /// Vision corners (normalized, bottom-left origin): TL, TR, BR, BL.
  var corners: [CGPoint]? = nil
}

/// Pokémon TCG is 63×88 mm (~0.716). Vision only proposes rectangles.
/// A box is a card when it has that proportion, a border on every side, and artwork inside.
/// Chat, buttons, and the video frame itself fail that check.
private enum CardInStreamDetect {
  static let minShortOverLong: CGFloat = 0.64
  static let maxShortOverLong: CGFloat = 0.82
  static let minFill: CGFloat = 0.02
  static let maxFill: CGFloat = 0.55
  static let detectMaxSide = 640
  private static let detectContext = CIContext(options: [
    .workingColorSpace: NSNull(),
    .outputColorSpace: NSNull(),
  ])

  static func inspect(_ pixelBuffer: CVPixelBuffer) -> CardDetectResult {
    let buffer = downscaled(pixelBuffer) ?? pixelBuffer
    let request = VNDetectRectanglesRequest()
    request.minimumConfidence = 0.35
    request.minimumAspectRatio = 0.5
    request.maximumAspectRatio = 1.85
    request.minimumSize = 0.10
    request.quadratureTolerance = 45
    request.maximumObservations = 8

    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return CardDetectResult(cardDetected: false, boundingBox: nil)
    }

    var best: VNRectangleObservation?
    var bestScore: CGFloat = 0
    for observation in request.results ?? [] {
      guard observation.confidence >= 0.35 else { continue }
      let fill = observation.boundingBox.width * observation.boundingBox.height
      guard fill >= minFill && fill <= maxFill else { continue }
      let ratio = shortOverLong(observation)
      guard ratio >= minShortOverLong && ratio <= maxShortOverLong else { continue }
      let evidence = cardEvidence(buffer, box: observation.boundingBox)
      guard evidence > 0 else { continue }
      let score = evidence + fill * 6
      if score > bestScore {
        best = observation
        bestScore = score
      }
    }
    guard let best else {
      return CardDetectResult(cardDetected: false, boundingBox: nil)
    }
    return CardDetectResult(
      cardDetected: true,
      boundingBox: best.boundingBox,
      corners: [best.topLeft, best.topRight, best.bottomRight, best.bottomLeft]
    )
  }

  static func shortOverLong(_ observation: VNRectangleObservation) -> CGFloat {
    let top = hypot(
      observation.topRight.x - observation.topLeft.x,
      observation.topRight.y - observation.topLeft.y
    )
    let side = hypot(
      observation.bottomLeft.x - observation.topLeft.x,
      observation.bottomLeft.y - observation.topLeft.y
    )
    let shortest = min(top, side)
    let longest = max(top, side)
    guard longest > 0 else { return 0 }
    return shortest / longest
  }

  /// 0 rejects the box. Artwork fills the inside of a card; chat and buttons do not.
  /// Each side needs an edge, so a text bar or an open video frame cannot pass.
  static func cardEvidence(_ pixelBuffer: CVPixelBuffer, box: CGRect) -> CGFloat {
    guard let grid = lumaGrid(pixelBuffer, box: box, cols: 16, rows: 22) else { return 0 }
    let cols = 16
    let rows = 22
    let interior = interiorSamples(grid, cols: cols, rows: rows)
    guard interior.count >= 12 else { return 0 }
    let spread = stddev(interior)
    guard spread >= 16 else { return 0 }
    let mean = interior.reduce(0, +) / CGFloat(interior.count)
    let busy = interior.filter { abs($0 - mean) >= 22 }.count
    guard CGFloat(busy) / CGFloat(interior.count) >= 0.28 else { return 0 }
    let sides = sideEdges(grid, cols: cols, rows: rows)
    let weakest = sides.min() ?? 0
    let average = sides.reduce(0, +) / CGFloat(sides.count)
    guard weakest >= 4, average >= 9 else { return 0 }
    return average * 0.55 + spread * 0.7
  }

  static func interiorSamples(_ grid: [CGFloat], cols: Int, rows: Int) -> [CGFloat] {
    var values: [CGFloat] = []
    let y0 = rows / 5
    let y1 = rows - rows / 5
    let x0 = cols / 5
    let x1 = cols - cols / 5
    for y in y0..<y1 {
      for x in x0..<x1 {
        values.append(grid[y * cols + x])
      }
    }
    return values
  }

  static func sideEdges(_ grid: [CGFloat], cols: Int, rows: Int) -> [CGFloat] {
    func meanDiff(_ pairs: [(Int, Int)]) -> CGFloat {
      guard !pairs.isEmpty else { return 0 }
      let total = pairs.reduce(CGFloat(0)) { partial, pair in
        partial + abs(grid[pair.0] - grid[pair.1])
      }
      return total / CGFloat(pairs.count)
    }
    var top: [(Int, Int)] = []
    var bottom: [(Int, Int)] = []
    var left: [(Int, Int)] = []
    var right: [(Int, Int)] = []
    for x in 0..<cols {
      top.append((x, cols + x))
      bottom.append(((rows - 1) * cols + x, (rows - 2) * cols + x))
    }
    for y in 0..<rows {
      left.append((y * cols, y * cols + 1))
      right.append((y * cols + cols - 1, y * cols + cols - 2))
    }
    return [meanDiff(top), meanDiff(bottom), meanDiff(left), meanDiff(right)]
  }

  static func stddev(_ values: [CGFloat]) -> CGFloat {
    guard !values.isEmpty else { return 0 }
    let mean = values.reduce(0, +) / CGFloat(values.count)
    let variance = values.reduce(CGFloat(0)) { partial, value in
      let delta = value - mean
      return partial + delta * delta
    } / CGFloat(values.count)
    return sqrt(variance)
  }

  /// Vision boxes are normalized with a lower-left origin.
  static func lumaGrid(
    _ pixelBuffer: CVPixelBuffer,
    box: CGRect,
    cols: Int,
    rows: Int
  ) -> [CGFloat]? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
          let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard width >= cols, height >= rows, bytesPerRow >= width * 4 else { return nil }
    let originX = box.minX * CGFloat(width)
    let originY = (1 - box.maxY) * CGFloat(height)
    let boxWidth = box.width * CGFloat(width)
    let boxHeight = box.height * CGFloat(height)
    guard boxWidth >= 8, boxHeight >= 8 else { return nil }
    let pixels = base.assumingMemoryBound(to: UInt8.self)
    var grid = [CGFloat](repeating: 0, count: cols * rows)
    for row in 0..<rows {
      let y = Int(originY + (CGFloat(row) + 0.5) * boxHeight / CGFloat(rows))
      let clampedY = min(height - 1, max(0, y))
      for col in 0..<cols {
        let x = Int(originX + (CGFloat(col) + 0.5) * boxWidth / CGFloat(cols))
        let clampedX = min(width - 1, max(0, x))
        let offset = clampedY * bytesPerRow + clampedX * 4
        let b = CGFloat(pixels[offset])
        let g = CGFloat(pixels[offset + 1])
        let r = CGFloat(pixels[offset + 2])
        grid[row * cols + col] = (r * 0.299 + g * 0.587 + b * 0.114)
      }
    }
    return grid
  }

  /// Vision on a full HD frame is too slow for a card that is only up for a few seconds.
  /// Normalized boxes still map onto the original buffer.
  static func downscaled(_ pixelBuffer: CVPixelBuffer) -> CVPixelBuffer? {
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let longSide = max(width, height)
    guard longSide > detectMaxSide, width > 8, height > 8 else { return nil }
    let scale = CGFloat(detectMaxSide) / CGFloat(longSide)
    let outW = max(8, Int((CGFloat(width) * scale).rounded()))
    let outH = max(8, Int((CGFloat(height) * scale).rounded()))
    var output: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      outW,
      outH,
      kCVPixelFormatType_32BGRA,
      nil,
      &output
    )
    guard status == kCVReturnSuccess, let output else { return nil }
    let source = CIImage(cvPixelBuffer: pixelBuffer)
    let extent = source.extent
    let image = source.transformed(
      by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY)
        .scaledBy(x: scale, y: scale)
    )
    detectContext.render(
      image,
      to: output,
      bounds: CGRect(x: 0, y: 0, width: outW, height: outH),
      colorSpace: CGColorSpaceCreateDeviceRGB()
    )
    return output
  }
}

/// 24×24 packed RGB (pHash) plus a larger JPEG crop (OpenCLIP sidecar).
/// Hash/classify happens on the API, never a page jpeg.
private enum LiveVideoIdentityCrop {
  static let size = 24
  static let jpegMaxEdge: CGFloat = 224
  private static let context = CIContext(options: [
    .workingColorSpace: NSNull(),
    .outputColorSpace: NSNull(),
  ])

  static func cropRect(for pixelBuffer: CVPixelBuffer, normalizedBox: CGRect) -> CGRect? {
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    let extent = image.extent
    guard extent.width >= 8, extent.height >= 8 else { return nil }
    var crop = CGRect(
      x: extent.minX + normalizedBox.origin.x * extent.width,
      y: extent.minY + normalizedBox.origin.y * extent.height,
      width: normalizedBox.width * extent.width,
      height: normalizedBox.height * extent.height
    ).integral
    crop = crop.intersection(extent)
    guard crop.width >= 8, crop.height >= 8 else { return nil }
    let inset = crop.insetBy(dx: crop.width * 0.04, dy: crop.height * 0.04)
    if inset.width >= 8 && inset.height >= 8 {
      crop = inset
    }
    return crop
  }

  static func base64(from pixelBuffer: CVPixelBuffer, normalizedBox: CGRect) -> String? {
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard let crop = cropRect(for: pixelBuffer, normalizedBox: normalizedBox) else { return nil }
    let scaleX = CGFloat(size) / crop.width
    let scaleY = CGFloat(size) / crop.height
    let scaled = image
      .cropped(to: crop)
      .transformed(
        by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY).scaledBy(x: scaleX, y: scaleY)
      )
    let outputRect = CGRect(x: 0, y: 0, width: size, height: size)
    guard let cgImage = context.createCGImage(scaled, from: outputRect) else { return nil }
    return packedRgbBase64(cgImage)
  }

  /// Whole live-video frame, short enough for the identify body limit. Not a page still.
  static func frameJpegBase64(from pixelBuffer: CVPixelBuffer) -> String? {
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    let extent = image.extent
    guard extent.width >= 8, extent.height >= 8 else { return nil }
    let longest = max(extent.width, extent.height)
    let scale = min(1, 480 / longest)
    let outW = max(8, (extent.width * scale).rounded())
    let outH = max(8, (extent.height * scale).rounded())
    let scaled = image.transformed(
      by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY).scaledBy(x: scale, y: scale)
    )
    let outputRect = CGRect(x: 0, y: 0, width: outW, height: outH)
    guard let cgImage = context.createCGImage(scaled, from: outputRect) else { return nil }
    guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.55) else { return nil }
    return data.base64EncodedString()
  }

  static func jpegBase64(
    from pixelBuffer: CVPixelBuffer,
    normalizedBox: CGRect,
    corners: [CGPoint]? = nil
  ) -> (jpeg: String, quad: [Double]?)? {
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard let crop = cropRect(for: pixelBuffer, normalizedBox: normalizedBox) else { return nil }
    let longest = max(crop.width, crop.height)
    let scale = min(1, jpegMaxEdge / longest)
    let outW = max(8, (crop.width * scale).rounded())
    let outH = max(8, (crop.height * scale).rounded())
    let scaled = image
      .cropped(to: crop)
      .transformed(
        by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY).scaledBy(x: scale, y: scale)
      )
    let outputRect = CGRect(x: 0, y: 0, width: outW, height: outH)
    guard let cgImage = context.createCGImage(scaled, from: outputRect) else { return nil }
    guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.82) else { return nil }
    var quad: [Double]?
    if let corners, corners.count == 4 {
      let extent = image.extent
      // Normalized bottom-left → JPEG pixels, top-left origin.
      quad = corners.flatMap { point -> [Double] in
        let x = (extent.minX + point.x * extent.width - crop.minX) * scale
        let y = outH - (extent.minY + point.y * extent.height - crop.minY) * scale
        return [Double(x), Double(y)]
      }
    }
    return (data.base64EncodedString(), quad)
  }

  static func packedRgbBase64(_ image: CGImage) -> String? {
    var rgba = [UInt8](repeating: 0, count: size * size * 4)
    guard let ctx = CGContext(
      data: &rgba,
      width: size,
      height: size,
      bitsPerComponent: 8,
      bytesPerRow: size * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    ctx.interpolationQuality = .medium
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    var rgb = [UInt8](repeating: 0, count: size * size * 3)
    for i in 0..<(size * size) {
      rgb[i * 3] = rgba[i * 4]
      rgb[i * 3 + 1] = rgba[i * 4 + 1]
      rgb[i * 3 + 2] = rgba[i * 4 + 2]
    }
    return Data(rgb).base64EncodedString()
  }
}

/// https playlist only. Same rules as `normalizeLiveHlsUrl`.
private enum LiveHlsUrl {
  static func normalize(_ raw: String?) -> String? {
    guard let raw else { return nil }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count >= 12, trimmed.count <= 2048 else { return nil }
    guard let components = URLComponents(string: trimmed) else { return nil }
    guard components.scheme?.lowercased() == "https" else { return nil }
    let host = components.host?.lowercased() ?? ""
    if host.isEmpty || host == "localhost" || host == "127.0.0.1" { return nil }
    let haystack = (components.path + (components.query.map { "?\($0)" } ?? "")).lowercased()
    guard haystack.contains(".m3u8") else { return nil }
    return components.url?.absoluteString
  }
}

/// Remember AVPlayers that start inside the livestream page during a scanner session.
private enum LiveVideoPlayerHooks {
  static func install(observe: @escaping (AVPlayer) -> Void) {
    observer = observe
    guard !installed else { return }
    installed = true
    swap(#selector(AVPlayer.play), with: #selector(AVPlayer.cardflow_play))
    swap(
      #selector(AVPlayer.playImmediately(atRate:)),
      with: #selector(AVPlayer.cardflow_playImmediately(atRate:))
    )
  }

  static func note(_ player: AVPlayer) {
    observer?(player)
  }

  private static var installed = false
  private static var observer: ((AVPlayer) -> Void)?

  private static func swap(_ original: Selector, with swizzled: Selector) {
    guard
      let originalMethod = class_getInstanceMethod(AVPlayer.self, original),
      let swizzledMethod = class_getInstanceMethod(AVPlayer.self, swizzled)
    else { return }
    method_exchangeImplementations(originalMethod, swizzledMethod)
  }
}

private extension AVPlayer {
  @objc func cardflow_play() {
    LiveVideoPlayerHooks.note(self)
    cardflow_play()
  }

  @objc func cardflow_playImmediately(atRate rate: Float) {
    LiveVideoPlayerHooks.note(self)
    cardflow_playImmediately(atRate: rate)
  }
}
