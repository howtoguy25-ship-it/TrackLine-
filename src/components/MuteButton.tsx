import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useSettings } from "@/context/SettingsContext";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// How long the volume slider stays open after the last drag before it auto-collapses back
// to just the icon -- long enough to actually adjust without a second tap, short enough
// that it doesn't linger as a permanent extra control taking up map space.
const SLIDER_AUTO_HIDE_MS = 3000;

export function MuteButton() {
  const { voiceEnabled, toggleVoiceEnabled, voiceVolume, setVoiceVolume } = useSettings();
  const [sliderOpen, setSliderOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // React Native's Pressable fires onPress on release even after onLongPress already fired for
  // the same touch -- without this guard, holding the button to open the volume slider ALSO
  // toggled mute the instant you lifted your finger, which is exactly the "volume button plays
  // up" bug: every attempt to adjust the volume muted/unmuted voice guidance as a side effect.
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const scheduleAutoHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setSliderOpen(false), SLIDER_AUTO_HIDE_MS);
  };

  return (
    <View style={styles.wrap}>
      {/* Only reachable while voice guidance is actually on -- there's nothing to set the
          volume of while muted, and hiding it then keeps that state's meaning unambiguous. */}
      {sliderOpen && voiceEnabled && (
        <View style={styles.sliderCard}>
          <Ionicons name="volume-low" size={14} color={colors.textMuted} />
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            value={voiceVolume}
            onValueChange={(value) => {
              setVoiceVolume(value);
              scheduleAutoHide();
            }}
            minimumTrackTintColor={colors.accent}
          />
          <Ionicons name="volume-high" size={14} color={colors.textMuted} />
        </View>
      )}
      <Pressable
        onPress={() => {
          // Swallow the onPress that follows a long-press release -- see longPressTriggeredRef's
          // own comment above.
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
          }
          toggleVoiceEnabled();
        }}
        onLongPress={() => {
          if (!voiceEnabled) return;
          longPressTriggeredRef.current = true;
          setSliderOpen(true);
          scheduleAutoHide();
        }}
        style={({ pressed }) => [styles.button, pressed && { opacity: pressedOpacity }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          voiceEnabled
            ? "Mute voice guidance. Hold to adjust volume."
            : "Unmute voice guidance"
        }
      >
        <Ionicons name={voiceEnabled ? "volume-high" : "volume-mute"} size={26} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  // Deliberately bigger than a standard 40px topRightControls circle -- explicit request to
  // make the volume control an easier, more obvious mid-drive target.
  button: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  sliderCard: {
    position: "absolute",
    right: 56,
    top: 0,
    height: 40,
    width: 150,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    ...shadow.low,
  },
  slider: {
    flex: 1,
  },
});
