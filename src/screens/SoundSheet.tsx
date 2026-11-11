import React, { forwardRef, useEffect, useState } from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSettings } from "@/context/SettingsContext";
import { getVoiceDisplayName } from "@/services/voiceLabel";
import {
  describeAudioRoute,
  getAudioRoute,
  isAudioRouteAvailable,
  showAudioRoutePicker,
  type AudioRoute,
  type AudioRouteType,
} from "audio-route";
import type { SpokenDirectionsMode } from "@/services/settings";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// Taller than it was, to fit the "Listening on" row without clipping the voice row below it.
const SNAP_POINTS = ["58%"];

const ROUTE_ICONS: Record<AudioRouteType, React.ComponentProps<typeof Ionicons>["name"]> = {
  speaker: "volume-high-outline",
  phone: "call-outline",
  headphones: "headset-outline",
  bluetooth: "bluetooth-outline",
  car: "car-outline",
  airplay: "tv-outline",
  usb: "hardware-chip-outline",
  hdmi: "tv-outline",
  other: "volume-medium-outline",
};
// How often the current output is re-read while the sheet is open -- so connecting to the car
// or pulling out headphones shows up without closing and reopening it.
const ROUTE_REFRESH_MS = 2000;

const SPOKEN_DIRECTIONS_OPTIONS: { key: SpokenDirectionsMode; label: string; description: string }[] = [
  { key: "normal", label: "Normal", description: "Hear every turn and alert" },
  { key: "lessChatty", label: "Less chatty", description: "Fewer routine turn call-outs" },
  { key: "onlyAlerts", label: "Only alerts", description: "Police, hazards and cameras only -- no turn-by-turn speech" },
  { key: "off", label: "Off", description: "No spoken guidance at all" },
];

interface Props {
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  onOpenVoiceSettings: () => void;
}

// Waze-style Sound button's bottom sheet -- opened from the round Sound button mid-right on the
// home map (see MapScreen.tsx). "Listening on" shows where the phone is really playing audio
// right now (modules/audio-route) and opens the system's own output picker; on a build that
// predates that native module the row is simply left out rather than showing a made-up name.
export const SoundSheet = forwardRef<BottomSheet, Props>(function SoundSheet(
  { onClose, onSheetChange, onOpenVoiceSettings },
  ref
) {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, voiceIdentifier } = useSettings();

  // The current audio output, re-read while the sheet is open. Null until the first read lands
  // (or for good, if the system won't say).
  const [sheetOpen, setSheetOpen] = useState(false);
  const [audioRoute, setAudioRoute] = useState<AudioRoute | null>(null);
  useEffect(() => {
    if (!sheetOpen || !isAudioRouteAvailable) return;
    let cancelled = false;
    const read = () => {
      getAudioRoute().then((route) => {
        if (!cancelled) setAudioRoute(route);
      });
    };
    read();
    const timer = setInterval(read, ROUTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sheetOpen]);

  const [currentVoiceLabel, setCurrentVoiceLabel] = useState("Default (device)");
  useEffect(() => {
    let cancelled = false;
    getVoiceDisplayName(voiceIdentifier, "Default (device)")
      .then((label) => {
        if (!cancelled) setCurrentVoiceLabel(label);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [voiceIdentifier]);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={(index) => {
        setSheetOpen(index >= 0);
        onSheetChange?.(index);
      }}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Sound</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Spoken directions</Text>
        {SPOKEN_DIRECTIONS_OPTIONS.map((option) => {
          const selected = settings.spokenDirections === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => updateSettings({ spokenDirections: option.key })}
              style={({ pressed }) => [styles.radioRow, pressed && { opacity: pressedOpacity }]}
              accessibilityLabel={`${option.label}. ${option.description}`}
            >
              <View style={styles.radioTextWrap}>
                <Text style={styles.radioLabel}>{option.label}</Text>
                <Text style={styles.radioDescription}>{option.description}</Text>
              </View>
              <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                {selected && <View style={styles.radioInner} />}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        {isAudioRouteAvailable && (
          <Pressable
            onPress={() => {
              showAudioRoutePicker().catch(() => {});
            }}
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
            accessibilityRole="button"
            accessibilityLabel={
              audioRoute
                ? `Listening on ${describeAudioRoute(audioRoute, Platform.OS)}. Tap to change.`
                : "Listening on. Tap to choose where sound plays."
            }
          >
            <Ionicons
              name={ROUTE_ICONS[audioRoute?.type ?? "other"]}
              size={20}
              color={colors.accent}
              style={styles.routeIcon}
            />
            <View style={styles.rowTextWrap}>
              <Text style={styles.radioLabel}>Listening on</Text>
              <Text style={styles.radioDescription}>
                {audioRoute ? describeAudioRoute(audioRoute, Platform.OS) : "Tap to choose where sound plays"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        )}

        <Pressable
          onPress={onOpenVoiceSettings}
          style={({ pressed }) => [styles.linkRow, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel={`Current voice: ${currentVoiceLabel}`}
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.radioLabel}>Current voice</Text>
            <Text style={styles.radioDescription}>{currentVoiceLabel}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handleIndicator: {
    backgroundColor: colors.surfaceMuted,
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
  },
  radioTextWrap: {
    flex: 1,
  },
  rowTextWrap: {
    flex: 1,
  },
  radioLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  radioDescription: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: colors.accent,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  routeIcon: { width: 24, textAlign: "center" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 4,
    gap: spacing.md,
  },
});
