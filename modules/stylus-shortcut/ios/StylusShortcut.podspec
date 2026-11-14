require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'StylusShortcut'
  s.version = package['version']
  s.summary = 'Native Pencil and stylus button shortcut events'
  s.description = 'Non-consuming stylus shortcut bridge for the focused note viewer.'
  s.author = ''
  s.homepage = 'https://github.com/nathankim6/orun-note'
  s.platforms = { :ios => '15.1' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end
