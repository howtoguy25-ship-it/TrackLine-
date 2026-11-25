import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Appear } from "@/components/ui/Appear";
import { GREEN, SURFACES, WHITE } from "@/theme/colors";
import { shadow } from "@/theme/tokens";

// The short chip under the top card after a manoeuvre: green "Exit taken ✓" when the driver is
// confirmed on the new road, grey "Rerouting…" when they missed it.

export type ChipTone = "good" | "neutral";

export const CHIP_COLOURS: Record<ChipTone, { fill: string; text: string }> = {
  good: { fill: GREEN, text: WHITE },
  neutral: { fill: SURFACES.dark.raised, text: WHITE },
};

export function ManoeuvreChip({ text, tone, top }: { text: string; tone: ChipTone; top: number }) {
  const c = CHIP_COLOURS[tone];
  return (
    <View pointerEvents="none" style={[styles.wrap, { top }]}>
      <Appear>
        <View style={[styles.chip, { backgroundColor: c.fill }]} accessibilityLiveRegion="polite" testID="manoeuvre-chip">
          <Text style={[styles.text, { color: c.text }]}>{text}</Text>
        </View>
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  chip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, ...shadow.floating },
  text: { fontSize: 17, fontWeight: "600" },
});
