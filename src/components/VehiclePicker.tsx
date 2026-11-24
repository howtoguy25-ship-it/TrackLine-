// Waze-match §3: "What's your ride?" -- shown once on first open (after the location question,
// before the home map), and the same choice list in Settings > Driving preferences > Vehicle type.
// Our own illustration (a car and a motorbike on a road, drawn here), our own icons and wording.
import React, { useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Pressable, View } from "@/components/ui/Surface";
import { colors, pressedOpacity, scaleFor } from "@/theme/tokens";
import { BLUE, BLUE_TEXT, PURPLE } from "@/theme/colors";
import { DEFAULT_VEHICLE, VEHICLE_OPTIONS, type VehicleType } from "@/services/vehicle";

export const VEHICLE_PICKER_TITLE = "What's your ride?";
export const VEHICLE_PICKER_LINE = "Set your vehicle for better routes and more accurate arrival times. You can change it anytime.";

/** The rows: our icon, the name, a blue tick on the chosen one, separators between. */
export function VehicleChoiceList({ value, onChange }: { value: VehicleType; onChange: (v: VehicleType) => void }) {
  return (
    <View testID="vehicle-list">
      {VEHICLE_OPTIONS.map((o, i) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={o.label}
            testID={`vehicle-${o.key}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: pressedOpacity }]}
          >
            <Icon name={o.icon} size={26} color={colors.text} />
            <Text style={styles.rowLabel}>{o.label}</Text>
            {selected ? <Icon name="checkmark" size={24} color={BLUE_TEXT} /> : <View style={styles.tickSpace} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Our own drawing: a road, a car and a motorbike. */
export function RideIllustration({ width }: { width: number }) {
  const h = width * 0.5;
  return (
    <Svg width={width} height={h} viewBox="0 0 320 160" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx="160" cy="80" r="76" fill="#EEF4FF" />
      <Path d="M20 132 H300" stroke="#C9D2E0" strokeWidth="6" strokeLinecap="round" />
      <Path d="M60 132 H90 M130 132 H160 M200 132 H230" stroke="#FFFFFF" strokeWidth="2" />
      {/* car */}
      <Path d="M70 112 L82 88 Q86 80 96 80 H150 Q160 80 166 88 L180 104 Q196 106 198 116 V122 H66 V116 Q66 112 70 112 Z" fill={PURPLE} />
      <Path d="M92 88 H124 V104 H86 Z M130 88 H152 Q156 88 159 92 L168 104 H130 Z" fill="#DCCBFA" />
      <Circle cx="96" cy="124" r="12" fill="#1F2125" />
      <Circle cx="96" cy="124" r="5" fill="#C9D2E0" />
      <Circle cx="168" cy="124" r="12" fill="#1F2125" />
      <Circle cx="168" cy="124" r="5" fill="#C9D2E0" />
      {/* motorbike */}
      <Circle cx="222" cy="122" r="12" fill="none" stroke="#1F2125" strokeWidth="5" />
      <Circle cx="276" cy="122" r="12" fill="none" stroke="#1F2125" strokeWidth="5" />
      <Path d="M222 122 L242 100 H262 L276 122" stroke={BLUE_TEXT} strokeWidth="6" strokeLinejoin="round" fill="none" />
      <Rect x="236" y="92" width="26" height="10" rx="5" fill={BLUE} />
      <Path d="M262 100 L268 86 H276" stroke="#1F2125" strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** First run: full screen, Private car preselected; Done saves the choice, Skip keeps car. */
export function VehiclePickerScreen({ onDone }: { onDone: (vehicle: VehicleType) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const k = scaleFor(width);
  const [vehicle, setVehicle] = useState<VehicleType>(DEFAULT_VEHICLE);
  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="vehicle-picker">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24 * k, paddingHorizontal: 24 * k, paddingBottom: 16 }}>
        <View style={styles.art}>
          <RideIllustration width={Math.min(320, width - 48)} />
        </View>
        <Text style={[styles.title, { fontSize: 28 * k }]} accessibilityRole="header">
          {VEHICLE_PICKER_TITLE}
        </Text>
        <Text style={[styles.line, { fontSize: 17 * k }]}>{VEHICLE_PICKER_LINE}</Text>
        <VehicleChoiceList value={vehicle} onChange={setVehicle} />
      </ScrollView>
      <View style={{ paddingHorizontal: 24 * k, paddingBottom: insets.bottom + 16, gap: 4 }}>
        <Button variant="primary" size="large" fullWidth label="Done" onPress={() => onDone(vehicle)} testID="vehicle-done" />
        <Button variant="ghost" size="medium" fullWidth label="Skip" onPress={() => onDone(DEFAULT_VEHICLE)} testID="vehicle-skip" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surface, zIndex: 100 },
  art: { alignItems: "center", marginBottom: 16 },
  title: { fontWeight: "700", color: colors.text, textAlign: "center" },
  line: { color: colors.textMuted, textAlign: "center", marginTop: 8, marginBottom: 20, lineHeight: 23 },
  row: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 60, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { flex: 1, fontSize: 18, fontWeight: "500", color: colors.text },
  tickSpace: { width: 24 },
});
