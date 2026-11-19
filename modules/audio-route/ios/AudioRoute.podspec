require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioRoute'
  s.version        = package['version']
  s.summary        = 'Reads the current audio output route and opens the system route picker.'
  s.author         = 'TrackLine'
  s.homepage       = 'https://github.com/howtoguy25-ship-it/trackline-'
  s.platform       = :ios, '13.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'AVKit', 'UIKit'

  s.source_files = '**/*.{h,m,mm,swift}'
end
