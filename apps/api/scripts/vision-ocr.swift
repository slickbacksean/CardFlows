import AppKit
import Foundation
import Vision

let path = CommandLine.arguments.dropFirst().first ?? ""
guard !path.isEmpty else {
  fputs("usage: vision-ocr image\n", stderr)
  exit(2)
}

let url = URL(fileURLWithPath: path)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(url: url, options: [:])
try handler.perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
