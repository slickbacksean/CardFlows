require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name           = "CardFlowLiveVideo"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.description    = package["description"]
  s.license        = package["license"]
  s.author         = package["author"]
  s.homepage       = package["homepage"]
  s.platforms      = { :ios => "15.1" }
  s.swift_version  = "5.9"
  # Local Expo module, autolinked from apps/mobile/modules; CocoaPods uses the local path,
  # so this source is metadata only. It points at the real repo instead of a placeholder.
  s.source         = { :git => "https://github.com/slickbacksean/CardFlows.git" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.frameworks     = "AVFoundation", "CoreMedia", "Vision", "WebKit"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
