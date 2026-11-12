import React, { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { CompassNeedle, RecenterIcon, ReportIcon } from "@/components/icons/MapControlIcons";
import { FLOATING_GAP, floatingButtonsInteractive, floatingButtonsOpacity } from "@/map/homeMapLogic";
import { colors, shadow, scaleFor } from "@/theme/tokens";

// Every floating button on the idle home map, in one place:
//
//   top-left      Menu (red dot when the Inbox has unread items), Compass under it
//   top-right     Audio player (only when switched on in Settings), Sound under it
//   bottom-right  Report      } these two ride on the top edge of the "Where to?" sheet,
//   bottom-left   Re-centre   } 12pt above it, and move up and down with it
//
// All of them fade out once the sheet rises past its half height, so nothing ever floats on top
// of the sheet. Position and fade are driven by the sheet's own shared value on the UI thread --
// dragging the sheet doesn't re-render this component.

interface Props {
  /** How much of the sheet is showing (written by ThreeSnapBottomSheet). */
  sheetVisibleHeight: SharedValue<number>;
  sheetHalfHeight: number;
  /** Height of whatever sits under the sheet (the ad banner + safe area). */
  bottomInset: number;
  topInset: number;

  unreadCount: number;
  /** Small camera badge on Menu: the dashcam needs attention (it lives in the Menu now). */
  dashcamBadge: boolean;
  onMenu: () => void;
  onMenuLongPress?: () => void;

  showCompass: boolean;
  /** Map bearing in degrees; the needle turns against it so red keeps pointing north. */
  bearing: SharedValue<number>;
  onCompass: () => void;

  showAudioPlayer: boolean;
  onAudioPlayer: () => void;

  soundOff: boolean;
  onSound: () => void;

  onReport: () => void;

  /** True only once the driver has panned or zoomed away from their own position. */
  showRecenter: boolean;
  onRecenter: () => void;
}

export function HomeMapControls(props: Props) {
  const { width } = useWindowDimensions();
  const k = scaleFor(width);
  const size = {
    menu: 56 * k,
    round: 56 * k,
    report: 68 * k,
    recenter: 58 * k,
    side: 16 * k,
    gap: 8 * k,
  };
  const { sheetVisibleHeight, sheetHalfHeight, bottomInset } = props;

  const opacity = useDerivedValue(() => floatingButtonsOpacity(sheetVisibleHeight.value, sheetHalfHeight));
  // A faded-out button must not be tappable. Touchability is ordinary React state, flipped only
  // when the fade crosses its midpoint -- twice per drag, not once per frame.
  // Starts from where the sheet is right now, so a screen that opens with the sheet already
  // pulled up never has tappable-but-invisible buttons for a frame.
  const [interactive, setInteractive] = useState(() =>
    floatingButtonsInteractive(sheetVisibleHeight.get(), sheetHalfHeight)
  );
  useAnimatedReaction(
    () => opacity.value > 0.5,
    (now, before) => {
      if (now !== before) runOnJS(setInteractive)(now);
    }
  );

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const aboveSheetStyle = useAnimatedStyle(() => ({
    bottom: sheetVisibleHeight.value + bottomInset + FLOATING_GAP,
  }));
  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-props.bearing.value}deg` }] }));
  // Re-centre fades in when the driver pans away and out again once they're back.
  const recenterStyle = useAnimatedStyle(() => ({
    opacity: withTiming(props.showRecenter ? 1 : 0, { duration: 220 }),
  }));

  const top = props.topInset + 8 * k;

  return (
    <Animated.View
      pointerEvents={interactive ? "box-none" : "none"}
      style={[StyleSheet.absoluteFill, fadeStyle]}
    >
      {/* Top-left: Menu, then Compass */}
      <View pointerEvents="box-none" style={[styles.column, { top, left: size.side, gap: size.gap }]}>
        <PressableScale
          onPress={props.onMenu}
          onLongPress={props.onMenuLongPress}
          style={[styles.white, { width: size.menu, height: size.menu, borderRadius: 14 * k }]}
          accessibilityRole="button"
          accessibilityLabel={props.unreadCount > 0 ? `Menu, ${props.unreadCount} unread in Inbox` : "Menu"}
        >
          <Ionicons name="menu" size={24 * k} color={colors.text} />
          {props.unreadCount > 0 && <View style={styles.unreadDot} pointerEvents="none" />}
          {props.dashcamBadge && (
            <View style={styles.dashcamBadge} pointerEvents="none">
              <Ionicons name="videocam" size={10} color="#FFFFFF" />
            </View>
          )}
        </PressableScale>

        {props.showCompass && (
          <PressableScale
            onPress={props.onCompass}
            style={[styles.white, { width: size.round, height: size.round, borderRadius: size.round / 2 }]}
            accessibilityRole="button"
            accessibilityLabel="Compass. Tap to face north."
          >
            <Animated.View style={needleStyle}>
              <CompassNeedle size={34 * k} />
            </Animated.View>
          </PressableScale>
        )}
      </View>

      {/* Top-right: Audio player (optional), then Sound */}
      <View pointerEvents="box-none" style={[styles.column, { top, right: size.side, gap: size.gap }]}>
        {props.showAudioPlayer && (
          <PressableScale
            onPress={props.onAudioPlayer}
            style={[styles.white, { width: size.round, height: size.round, borderRadius: size.round / 2 }]}
            accessibilityRole="button"
            accessibilityLabel="Audio player"
          >
            <Ionicons name="musical-notes" size={24 * k} color={colors.text} />
          </PressableScale>
        )}
        <PressableScale
          onPress={props.onSound}
          style={[styles.white, { width: size.round, height: size.round, borderRadius: size.round / 2 }]}
          accessibilityRole="button"
          accessibilityLabel={props.soundOff ? "Sound: off" : "Sound"}
        >
          <Ionicons name={props.soundOff ? "volume-mute" : "volume-high"} size={24 * k} color={colors.text} />
        </PressableScale>
      </View>

      {/* Bottom-right, riding on the sheet: Report */}
      <Animated.View pointerEvents="box-none" style={[styles.anchored, { right: size.side }, aboveSheetStyle]}>
        <PressableScale
          onPress={props.onReport}
          style={[styles.report, { width: size.report, height: size.report, borderRadius: 18 * k }]}
          accessibilityRole="button"
          accessibilityLabel="Report something on the road"
        >
          <ReportIcon size={44 * k} />
        </PressableScale>
      </Animated.View>

      {/* Bottom-left, riding on the sheet: Re-centre -- only after panning away */}
      <Animated.View
        pointerEvents={props.showRecenter ? "box-none" : "none"}
        style={[styles.anchored, { left: size.side }, aboveSheetStyle, recenterStyle]}
      >
        <PressableScale
          onPress={props.onRecenter}
          style={[styles.recenter, { width: size.recenter, height: size.recenter, borderRadius: size.recenter / 2 }]}
          accessibilityRole="button"
          accessibilityLabel="Re-centre on my location"
        >
          <RecenterIcon size={38 * k} />
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { position: "absolute", alignItems: "center" },
  anchored: { position: "absolute" },
  white: { backgroundColor: "#FFFFFF", ...shadow.floating },
  report: { backgroundColor: colors.reportYellow, ...shadow.floating },
  // 90% opaque dark grey, so the road shows faintly through it.
  recenter: { backgroundColor: "rgba(74, 77, 82, 0.9)", ...shadow.floating },
  unreadDot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  dashcamBadge: {
    position: "absolute",
    bottom: 5,
    right: 5,
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
});
