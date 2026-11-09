import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  muted: boolean;
  onPress: () => void;
  style?: object;
}

// Waze-style round white Sound button, right side mid-screen on the home map -- opens SoundSheet
// (Spoken directions / Current voice). Shows a muted speaker glyph whenever spoken directions
// are actually off, a real reflection of settings.spokenDirections, never just a static icon.
export function SoundButton({ muted, onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={muted ? "Sound, currently off" : "Sound"}
    >
      <Ionicons name={muted ? "volume-mute" : "volume-high"} size={20} color="#111827" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
});
