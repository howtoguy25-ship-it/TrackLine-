import ExpoModulesCore
import ActivityKit

// Real ActivityKit bridge for TrackLine's background navigation Live Activity -- per explicit
// request, built with real native Swift (this file + TrackLineActivityAttributes.swift +
// targets/liveActivity's own widget UI), not a deprecated/alpha third-party Expo package.
// Every call updates the SAME activity in place via `.update()` (never starts a second one
// alongside an existing one) -- startActivity ends any stale activity first, matching the real
// one-active-trip-at-a-time shape MapScreen's own navigation state already has. pushType is
// always nil: every update comes straight from the app process itself (foreground or background
// location updates -- no server, no APNs, no push token/entitlement needed for that).
public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    // Real, honest capability check -- false whenever Live Activities are unavailable (OS too
    // old, or the user has actually turned them off in Settings > Face ID & Passcode > Live
    // Activities), so the JS side can skip calling start/update entirely instead of every call
    // silently failing.
    AsyncFunction("isSupported") { () -> Bool in
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("startActivity") {
      (
        destinationName: String,
        instruction: String,
        maneuverSymbol: String,
        distanceText: String,
        etaText: String,
        roadName: String,
        currentSpeedKmh: Int?,
        speedLimitKmh: Int?
      ) in
      guard #available(iOS 16.1, *) else { return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

      // Only ever one live trip at a time -- end whatever's already running (a stale activity
      // from a previous trip that never got a clean endActivity call, e.g. the app was killed
      // mid-trip) before starting the new one, rather than leaving two stacked on the Lock
      // Screen.
      for activity in Activity<TrackLineActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }

      let attributes = TrackLineActivityAttributes(destinationName: destinationName)
      let state = TrackLineActivityAttributes.ContentState(
        instruction: instruction,
        maneuverSymbol: maneuverSymbol,
        distanceText: distanceText,
        etaText: etaText,
        roadName: roadName,
        currentSpeedKmh: currentSpeedKmh,
        speedLimitKmh: speedLimitKmh
      )
      do {
        _ = try Activity<TrackLineActivityAttributes>.request(
          attributes: attributes,
          content: ActivityContent(state: state, staleDate: nil),
          pushType: nil
        )
      } catch {
        // Real, non-fatal failure (the OS can refuse to start one for reasons outside this
        // app's control, e.g. the user has started too many activities system-wide) -- swallowed
        // here rather than thrown back to JS, the exact same "auto-recovers, never dead-ends"
        // principle the rest of this app's own background loops already follow. Live navigation
        // itself (the in-app UI) is completely unaffected either way.
      }
    }

    AsyncFunction("updateActivity") {
      (
        instruction: String,
        maneuverSymbol: String,
        distanceText: String,
        etaText: String,
        roadName: String,
        currentSpeedKmh: Int?,
        speedLimitKmh: Int?
      ) in
      guard #available(iOS 16.1, *) else { return }
      let state = TrackLineActivityAttributes.ContentState(
        instruction: instruction,
        maneuverSymbol: maneuverSymbol,
        distanceText: distanceText,
        etaText: etaText,
        roadName: roadName,
        currentSpeedKmh: currentSpeedKmh,
        speedLimitKmh: speedLimitKmh
      )
      for activity in Activity<TrackLineActivityAttributes>.activities {
        await activity.update(ActivityContent(state: state, staleDate: nil))
      }
    }

    AsyncFunction("endActivity") { () in
      guard #available(iOS 16.1, *) else { return }
      for activity in Activity<TrackLineActivityAttributes>.activities {
        // .default dismissal -- removes it from the Lock Screen almost immediately once
        // navigation genuinely ends, rather than lingering there looking stale.
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
