import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Marker } from "react-native-maps";
import { ALERT_COLORS, type AlertDoc } from "@/types/alert";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { useSettings } from "@/context/SettingsContext";

interface Props {
  alert: AlertDoc;
  onPress: (alert: AlertDoc) => void;
  // True only while this exact alert's detail sheet is the one currently open (see MapScreen's
  // selectedAlert) -- per explicit request, the comment caption isn't a permanent map fixture:
  // it shows while a user is actively viewing this alert and hides again the moment they swipe
  // the sheet away (or tap a different alert), reappearing if they come back to it later.
  isSelected: boolean;
}

// Memoized so MapScreen re-renders (e.g. every GPS tick, which changes currentLatLng but not
// the alerts list itself) don't cascade into reconciling every marker on screen -- onPress is
// already a stable useCallback([]) from MapScreen (onMarkerPress), so only a real change to
// this specific alert actually re-renders it.
// Fixed layout numbers (not measured at runtime) for the optional comment caption below the pin
// -- see the `anchor` comment on the Marker itself for why these need to be exact constants
// rather than whatever the comment's own text happens to lay out to.
const PIN_SIZE = 34;
const COMMENT_GAP = 3;
const COMMENT_HEIGHT = 30;

export const AlertMarker = React.memo(function AlertMarker({ alert, onPress, isSelected }: Props) {
  // Real, confirmed bug this fixes: tracksViewChanges={false} below (the correct, cheap default
  // for a marker with no comment) ALSO froze this pin's rendered bitmap at whatever
  // alertIconTheme was active the moment it first mounted -- picking a different icon pack in
  // Settings silently did nothing for any alert already on screen, even though AlertTypeGlyph
  // (which reads this same setting) was genuinely re-rendering the right glyph internally the
  // whole time; react-native-maps just never re-snapshotted the native bitmap to show it. Reading
  // the setting directly here (not just inside the AlertTypeGlyph child) and keying the Marker on
  // it forces a real remount -- a fresh native marker, not a no-op re-render -- the instant the
  // theme changes, which sidesteps needing tracksViewChanges for this case entirely.
  const { settings } = useSettings();
  // react-native-maps anchors a Marker's geographic coordinate to a FRACTION of its own
  // rendered content box (default {x:0.5, y:1}, i.e. bottom-center) -- which was fine when the
  // pin circle was the marker's only content, but a comment caption stacked below it (per
  // explicit request: "small... placed under the alert") would grow that content box downward,
  // and with the default anchor unchanged the coordinate would then point at the bottom of the
  // CAPTION instead of the bottom of the pin -- silently shifting every alert with a comment
  // away from where it was actually reported, exactly the class of bug already root-caused and
  // fixed once this session for the placement pin itself. Computed here instead from the real,
  // fixed pixel sizes above (not measured after layout, which react-native-maps has no hook for
  // anyway) so the pin's own bottom edge -- not the caption's -- stays the true anchor point
  // regardless of whether this alert has a comment.
  const anchor = alert.comment
    ? { x: 0.5, y: PIN_SIZE / (PIN_SIZE + COMMENT_GAP + COMMENT_HEIGHT) }
    : { x: 0.5, y: 1 };
  return (
    <Marker
      key={settings.alertIconTheme}
      coordinate={{ latitude: alert.lat, longitude: alert.lng }}
      anchor={anchor}
      // react-native-maps fires MapView's own onPress *in addition to* a tapped Marker's onPress
      // on the same touch (confirmed native iOS behavior, same class of issue already worked
      // around for the speed-camera cluster markers) -- without stopping it here, tapping an
      // alert also ran MapScreen's onMapPress Places lookup for whatever's directly underneath,
      // opening the street/POI info sheet on top of this alert's own detail sheet a moment
      // later. Real, confirmed root cause of "tapping an alert also shows the street" -- this
      // stops the tap here so only the alert's own sheet ever opens.
      onPress={(e) => {
        e.stopPropagation();
        onPress(alert);
      }}
      // false (the default, cheap path) for every marker with no comment at all, same as
      // before. Alerts WITH a comment need this true instead -- tracksViewChanges is what makes
      // react-native-maps actually re-rasterize the marker's native bitmap when isSelected
      // toggles below; left false, the very first render (whichever selection state that
      // happened to be) would be frozen forever, and the show/hide-on-select behavior would
      // never actually appear on screen. Real, deliberate cost only for the subset of alerts
      // that actually have a comment, not a blanket regression for every marker.
      tracksViewChanges={!!alert.comment}
    >
      <View style={styles.column}>
        <View style={[styles.pin, { backgroundColor: ALERT_COLORS[alert.type] }]}>
          <AlertTypeGlyph type={alert.type} size={18} color="#FFFFFF" />
        </View>
        {/* Small, semi-transparent (not fully opaque, not so transparent it's hard to read --
            per explicit request) caption directly under the pin -- only while this alert is the
            one currently selected/being viewed (isSelected), hiding again once its detail sheet
            is swiped away and reappearing if reopened (see MapScreen's own comment on where
            selectedAlert gets cleared). The OUTER wrap still always renders at its fixed height
            whenever there's a comment at all, selected or not -- only the bubble inside is
            conditional -- so the anchor math above (computed purely from whether a comment
            exists) never has to account for a layout height that changes with selection too. */}
        {alert.comment && (
          <View style={styles.commentWrap}>
            {isSelected && (
              <View style={styles.commentBubble}>
                <Text style={styles.commentText} numberOfLines={2}>
                  {alert.comment}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  column: {
    alignItems: "center",
  },
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  commentWrap: {
    marginTop: COMMENT_GAP,
    height: COMMENT_HEIGHT,
    justifyContent: "center",
  },
  commentBubble: {
    maxWidth: 140,
    // Semi-transparent -- not fully opaque, not so see-through it's hard to read against a
    // busy map background -- per explicit request ("transparent but not too transparent... very
    // easy for users to read").
    backgroundColor: "rgba(17, 24, 39, 0.72)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  commentText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "600",
    textAlign: "center",
  },
});
