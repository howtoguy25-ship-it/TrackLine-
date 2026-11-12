import React, { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { FloatingButton } from "@/components/ui/Button";
import { CompassNeedle, ReportIcon } from "@/components/icons/MapControlIcons";
import { FLOATING_GAP, floatingButtonsInteractive, floatingButtonsOpacity } from "@/map/homeMapLogic";
import { colors, scaleFor } from "@/theme/tokens";

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
  // Floating buttons are 56pt (the Menu one a rounded square); re-centre is 58pt.
  const size = {
    round: 56 * k,
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
        <FloatingButton
          tone="map"
          shape="menu"
          size={size.round}
          icon="menu"
          onPress={props.onMenu}
          onLongPress={props.onMenuLongPress}
          accessibilityLabel={props.unreadCount > 0 ? `Menu, ${props.unreadCount} unread in Inbox` : "Menu"}
          badge={
            <>
              {props.unreadCount > 0 && <View style={styles.unreadDot} pointerEvents="none" />}
              {props.dashcamBadge && (
                <View style={styles.dashcamBadge} pointerEvents="none">
                  <Icon name="videocam" size={10} color="#FFFFFF" strokeWidth={2.25} />
                </View>
              )}
            </>
          }
        />

        {props.showCompass && (
          <FloatingButton tone="map" size={size.round} onPress={props.onCompass} accessibilityLabel="Compass. Tap to face north.">
            <Animated.View style={needleStyle}>
              <CompassNeedle size={34 * k} />
            </Animated.View>
          </FloatingButton>
        )}
      </View>

      {/* Top-right: Audio player (optional), then Sound */}
      <View pointerEvents="box-none" style={[styles.column, { top, right: size.side, gap: size.gap }]}>
        {props.showAudioPlayer && (
          <FloatingButton tone="map" size={size.round} icon="musical-notes" onPress={props.onAudioPlayer} accessibilityLabel="Audio player" />
        )}
        <FloatingButton
          tone="map"
          size={size.round}
          icon={props.soundOff ? "volume-mute" : "volume-high"}
          onPress={props.onSound}
          accessibilityLabel={props.soundOff ? "Sound: off" : "Sound"}
        />
      </View>

      {/* Bottom-right, riding on the sheet: Report */}
      <Animated.View pointerEvents="box-none" style={[styles.anchored, { right: size.side }, aboveSheetStyle]}>
        <FloatingButton tone="report" size={size.round} onPress={props.onReport} accessibilityLabel="Report something on the road">
          <ReportIcon size={34 * k} />
        </FloatingButton>
      </Animated.View>

      {/* Bottom-left, riding on the sheet: Re-centre -- only after panning away */}
      <Animated.View
        pointerEvents={props.showRecenter ? "box-none" : "none"}
        style={[styles.anchored, { left: size.side }, aboveSheetStyle, recenterStyle]}
      >
        <FloatingButton tone="recenter" size={size.recenter} icon="locate" onPress={props.onRecenter} accessibilityLabel="Re-centre on my location" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { position: "absolute", alignItems: "center" },
  anchored: { position: "absolute" },
  unreadDot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: colors.dangerFill,
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
    backgroundColor: colors.dangerFill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
});
