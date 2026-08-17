import ActivityKit

// MUST stay field-for-field identical to targets/liveActivity/TrackLineLiveActivityBundle.swift's
// own copy of this same struct -- see that file's own comment for why there are two copies at
// all (ActivityKit needs the attributes type compiled into both the requesting process, the main
// app via this file, and the rendering process, the widget extension via that file; the two
// targets don't share a source file here).
struct TrackLineActivityAttributes: ActivityAttributes {
    let destinationName: String

    struct ContentState: Codable, Hashable {
        var instruction: String
        var maneuverSymbol: String
        var distanceText: String
        var etaText: String
        var roadName: String
        var currentSpeedKmh: Int?
        var speedLimitKmh: Int?
    }
}
