import ActivityKit
import WidgetKit
import SwiftUI

// Real ActivityAttributes schema for TrackLine's background navigation overlay -- per explicit
// request, a real native Live Activity (Lock Screen banner + Dynamic Island), not a third-party
// Expo widget package. This EXACT struct (same property names/types) is duplicated in
// modules/liveActivity/ios/TrackLineActivityAttributes.swift, which the main app target compiles
// against to call Activity<TrackLineActivityAttributes>.request/update/end -- ActivityKit
// requires the attributes type to be available in both the requesting process (the main app) and
// the rendering process (this widget extension), and the two targets don't share a source file
// here, so both copies must be kept in sync by hand. Codable/Hashable only care about field
// name+type, not declaration order, so as long as both files match field-for-field this works.
struct TrackLineActivityAttributes: ActivityAttributes {
    // Set once when navigation starts, never changed for the life of this activity.
    let destinationName: String

    struct ContentState: Codable, Hashable {
        var instruction: String
        // SF Symbol name -- see maneuverSymbol(for:) in the native bridge module for the
        // Ionicons-maneuver -> SF Symbol mapping this is generated from.
        var maneuverSymbol: String
        var distanceText: String
        var etaText: String
        var roadName: String
        // Optional -- null whenever a real reading isn't available yet (no GPS fix, or no
        // posted-limit lookup resolved for this road), same "never a guess" rule the in-app
        // speed dial/sign already follow.
        var currentSpeedKmh: Int?
        var speedLimitKmh: Int?
    }
}

struct TrackLineLiveActivityView: View {
    let context: ActivityViewContext<TrackLineActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: context.state.maneuverSymbol)
                .font(.title)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.blue))

            VStack(alignment: .leading, spacing: 2) {
                Text(context.state.instruction)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(context.state.distanceText)
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                    if !context.state.roadName.isEmpty {
                        Text(context.state.roadName)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(context.state.etaText)
                    .font(.headline)
                    .foregroundStyle(.white)
                if let speed = context.state.currentSpeedKmh {
                    let over = context.state.speedLimitKmh.map { speed > $0 + 2 } ?? false
                    Text("\(speed) km/h")
                        .font(.caption.bold())
                        .foregroundStyle(over ? .red : .white.opacity(0.7))
                }
            }
        }
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.white)
    }
}

struct TrackLineLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrackLineActivityAttributes.self) { context in
            TrackLineLiveActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.maneuverSymbol)
                        .foregroundStyle(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.etaText)
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.instruction)
                        .font(.subheadline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.distanceText)
                        Spacer()
                        if !context.state.roadName.isEmpty {
                            Text(context.state.roadName)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .font(.caption)
                }
            } compactLeading: {
                Image(systemName: context.state.maneuverSymbol)
                    .foregroundStyle(.blue)
            } compactTrailing: {
                Text(context.state.distanceText)
                    .font(.caption2)
            } minimal: {
                Image(systemName: context.state.maneuverSymbol)
                    .foregroundStyle(.blue)
            }
        }
    }
}

@main
struct TrackLineLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        TrackLineLiveActivity()
    }
}
