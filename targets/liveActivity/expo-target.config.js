// @bacons/apple-targets target config -- generates a real iOS Widget Extension target during
// `expo prebuild`, per explicit request to build the "keep navigating in a mini-screen after
// leaving the app" feature for real with native Swift/ActivityKit code, not a deprecated
// (expo-live-activity) or alpha (expo-widgets) third-party Expo package. This plugin only wires
// the Xcode target/build settings; the actual Live Activity UI and lifecycle code
// (TrackLineLiveActivity.swift below, and modules/liveActivity's native bridge) is real,
// hand-written Swift, not a pre-built widget from anywhere.
//
// type: "widget" -- the same extension type WidgetKit home-screen widgets use; ActivityKit Live
// Activities are declared inside a widget extension too (see Apple's own ActivityConfiguration
// docs), there's no separate "live activity" extension type.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "TrackLineLiveActivity",
  displayName: "TrackLine Navigation",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  // ActivityKit itself needs iOS 16.1+ (Apple's own minimum for Live Activities) -- set on this
  // target only, so the main app's own deployment target (and every device below 16.1 running
  // it) is untouched; the native bridge module guards every call with `if #available(iOS 16.1)`
  // so older devices simply never start an activity instead of crashing.
  deploymentTarget: "16.1",
};
