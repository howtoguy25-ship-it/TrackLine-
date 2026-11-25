import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { colors, radius } from "@/theme/tokens";

// A segmented control: two or three choices in one rounded track, the chosen one a white raised
// segment (Plan a drive's From and Arrive by / Leave at). Each segment is 44pt tall.

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  disabled?: boolean;
}

export const SEGMENT_HEIGHT = 44;

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist" testID={testID}>
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <PressableScale
            key={o.key}
            haptic={false}
            disabled={o.disabled}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: !!o.disabled }}
            accessibilityLabel={o.label}
            style={[styles.segment, selected && styles.selected, o.disabled && styles.disabled]}
            testID={testID ? `${testID}-${o.key}` : undefined}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: 3, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 3 },
  segment: { flex: 1, height: SEGMENT_HEIGHT - 6, borderRadius: radius.md - 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  selected: { backgroundColor: colors.surface, boxShadow: "0px 1px 3px rgba(16,24,40,0.18)" },
  disabled: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: "500", color: colors.textMuted },
  labelSelected: { color: colors.text, fontWeight: "700" },
});
