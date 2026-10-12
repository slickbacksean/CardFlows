import AppKit
import Foundation
import Vision

func recognize(path: String) -> String {
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.fileExists(atPath: path) else { return "" }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(url: url, options: [:])
  do {
    try handler.perform([request])
  } catch {
    return ""
  }
  let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  return lines.joined(separator: "\n")
}

func writeResult(_ text: String) {
  let payload = ["text": text]
  guard
    let data = try? JSONSerialization.data(withJSONObject: payload),
    let json = String(data: data, encoding: .utf8)
  else { return }
  print(json)
  fflush(stdout)
}

// One image path: used by a cold call. No arguments: stay up and read paths
// from stdin so Vision's text models stay loaded between scans.
if CommandLine.arguments.count > 1 {
  print(recognize(path: CommandLine.arguments[1]))
  exit(0)
}

while let line = readLine(strippingNewline: true) {
  if line == "quit" { break }
  writeResult(recognize(path: line))
}
