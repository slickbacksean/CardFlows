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
  private var hlsPlayer: AVPlayer?
  private var hlsUrl: String?
  private var hlsCookies: [HTTPCookie] = []
  private var hlsCookiesReady = false
  private var hlsCookieGeneration = UUID()

  /// The play() hook is installed for the process, but players are kept only
  /// during a scanner session and only when they sit in the livestream page.
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
    let generation = UUID()
    hlsCookieGeneration = generation
    lock.unlock()
    if changed {
      onMain { self.stopHlsPlayer() }
    }
    guard next != nil else { return }
    WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self else { return }
      self.lock.lock()
      defer { self.lock.unlock() }
      guard self.hlsCookieGeneration == generation else { return }
      self.hlsCookies = cookies
      self.hlsCookiesReady = true
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
    let detection = CardInStreamDetect.inspect(pixelBuffer)
    var payload: [String: Any] = [
      "source": "live_video",
      "cardDetected": detection.cardDetected,
    ]
    if detection.cardDetected,
       let box = detection.boundingBox
    {
      if let identityRgb = LiveVideoIdentityCrop.base64(from: pixelBuffer, normalizedBox: box) {
        payload["identityRgb"] = identityRgb
      }
      if let cropJpeg = LiveVideoIdentityCrop.jpegBase64(from: pixelBuffer, normalizedBox: box) {
        payload["identityCropJpeg"] = cropJpeg
      }
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
    guard let item = player.currentItem else { return nil }
    let output = output(for: item)
    let itemTime = output.itemTime(forHostTime: CACurrentMediaTime())
    if output.hasNewPixelBuffer(forItemTime: itemTime) {
      return output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil)
    }
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
}

/// Pokémon TCG is 63×88 mm (~0.716). Detect a filling rectangle; crop is identity metadata.
private enum CardInStreamDetect {
  static let minShortOverLong: CGFloat = 0.60
  static let maxShortOverLong: CGFloat = 0.82
  static let minFill: CGFloat = 0.10

  static func inspect(_ pixelBuffer: CVPixelBuffer) -> CardDetectResult {
    let request = VNDetectRectanglesRequest()
    request.minimumConfidence = 0.45
    request.minimumAspectRatio = 0.5
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.18
    request.quadratureTolerance = 22
    request.maximumObservations = 6

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return CardDetectResult(cardDetected: false, boundingBox: nil)
    }

    var best: VNRectangleObservation?
    var bestFill: CGFloat = 0
    for observation in request.results ?? [] {
      guard observation.confidence >= 0.45 else { continue }
      let fill = observation.boundingBox.width * observation.boundingBox.height
      guard fill >= minFill else { continue }
      let ratio = shortOverLong(observation)
      guard ratio >= minShortOverLong && ratio <= maxShortOverLong else { continue }
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
}

/// 24×24 packed RGB (pHash) plus a larger JPEG crop (OpenCLIP sidecar).
/// Hash/classify happens on the API, never a page jpeg.
private enum LiveVideoIdentityCrop {
  static let size = 24
  static let jpegMaxEdge: CGFloat = 448
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

  static func jpegBase64(from pixelBuffer: CVPixelBuffer, normalizedBox: CGRect) -> String? {
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
    return data.base64EncodedString()
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
