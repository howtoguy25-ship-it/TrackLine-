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
  s.dependency 'TensorFlowLiteSwift', '~> 2.14.0'

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
