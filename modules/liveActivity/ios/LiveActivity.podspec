require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = package['version']
  s.summary        = 'Real native ActivityKit bridge for TrackLine background navigation Live Activities.'
  s.author         = 'TrackLine'
  s.homepage       = 'https://github.com/howtoguy25-ship-it/trackline-'
  # ActivityKit's Activity<T>.request/update/end are iOS 16.1+ APIs (Apple's own minimum for
  # Live Activities) -- this pod's own minimum has to match or Xcode won't compile it. This is
  # the only pod in the app that needs 16.1 (Map3D's own podspec sits at 16.0), so this is the
  # real, accepted minimum-OS bump this feature costs the whole app: iOS 16.0.x devices (a
  # vanishingly small population at this point) lose support. Every call in
  # LiveActivityModule.swift is additionally guarded with `if #available(iOS 16.1, *)` so this
  # is defense in depth, not the only thing preventing a crash on an old OS.
  s.platform       = :ios, '16.1'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
