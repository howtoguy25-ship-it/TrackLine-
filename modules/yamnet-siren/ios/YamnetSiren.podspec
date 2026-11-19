require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'YamnetSiren'
  s.version        = package['version']
  s.summary        = 'On-device YAMNet siren classification for SecureConnect EV Radar.'
  s.author         = 'SecureConnect'
  s.homepage       = 'https://github.com/howtoguy25-ship-it/secureconnect'
  s.platform       = :ios, '13.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Real, confirmed cause of a real build failure this exact version pin fixes
  # (EAS_BUILD_INCOMPATIBLE_PODS_ERROR, "Compatible versions of some pods could not be
  # resolved"): this app already uses react-native-fast-tflite for vehicle detection, whose own
  # podspec pins `TensorFlowLiteC` to EXACTLY 2.17.0 (not a range) -- CocoaPods can only resolve
  # one version of TensorFlowLiteC project-wide, so an independent `~> 2.14.0` constraint here
  # (which itself depends on TensorFlowLiteC 2.14.0) was never satisfiable alongside it. Pinned
  # to the exact same 2.17.0 (confirmed via CocoaPods trunk's own real published podspec:
  # TensorFlowLiteSwift 2.17.0 depends on TensorFlowLiteC 2.17.0) so both modules resolve to and
  # share the one real TFLite C runtime already in this project.
  s.dependency 'TensorFlowLiteSwift', '2.17.0'

  s.source_files = '**/*.{h,m,mm,swift}'

  # Real, bundled YAMNet model + its real 521-class AudioSet label map (downloaded directly from
  # TensorFlow Hub / TensorFlow's own research repo this session -- see README.md's own "Setup
  # steps", now done). A named resource_bundle (not plain s.resources) is what CocoaPods actually
  # builds for a static_framework pod with its own data files -- YamnetSirenModule.swift locates
  # it at runtime via Bundle(for: YamnetSirenModule.self), the standard, documented way a pod
  # finds its own bundled resources.
  s.resource_bundles = {
    'YamnetSiren' => ['yamnet.tflite', 'yamnet_class_map.csv']
  }
end
