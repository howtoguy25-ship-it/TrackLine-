import React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/components/AppText";
import { Chip } from "@/components/ui/Button";
import { colors, spacing } from "@/theme/tokens";
import { TITLE_MAX, VEHICLE_LABEL, WHAT_LABEL, titleProblem, type SirenDraft, type SirenVehicle, type SirenWhat } from "@/nav/sirenRadar";

// The siren radar's "Yes" sheet: what you saw, an optional title (only while stopped), three quick
// pin spots, and what happened. Sits in the report placement bar; the pin itself is the normal
// draggable placement pin (MapScreen). Report goes through the normal report pipeline.

const VEHICLES: SirenVehicle[] = ["ambulance", "police", "unmarkedPolice", "fire", "rescue", "other"];
const WHATS: SirenWhat[] = ["passing", "crash", "blocked", "policeStop", "unknown"];

export type QuickPinSpot = "ahead" | "behind" | "heard";

export function SirenReportPicker({
  value,
  onChange,
  stopped,
  onQuickPin,
}: {
  value: SirenDraft;
  onChange: (next: SirenDraft) => void;
  /** Typing is only allowed while the car is stopped. */
  stopped: boolean;
  onQuickPin: (spot: QuickPinSpot) => void;
}) {
  const problem = titleProblem(value.title);
  return (
    <View style={styles.wrap} testID="siren-report">
      <Text style={styles.label}>What did you see?</Text>
      <View style={styles.chips}>
        {VEHICLES.map((v) => (
          <Chip
            key={v}
            label={VEHICLE_LABEL[v]}
            selected={value.vehicle === v}
            onPress={() => onChange({ ...value, vehicle: v })}
            testID={`siren-vehicle-${v}`}
          />
        ))}
      </View>
      <TextInput
        value={value.title}
        onChangeText={(title) => onChange({ ...value, title: title.slice(0, TITLE_MAX) })}
        editable={stopped}
        placeholder={stopped ? "Add a title (optional)" : "Stop to add a title"}
        placeholderTextColor={colors.textFaint}
        maxLength={TITLE_MAX}
        style={[styles.input, !stopped && styles.inputOff, problem ? styles.inputError : null]}
        accessibilityLabel="Title, optional"
        testID="siren-title"
      />
      {problem ? <Text style={styles.error}>{problem}</Text> : null}
      <Text style={styles.label}>Where was it?</Text>
      {/* Chips, not three equal buttons: "Where I heard it" doesn't fit a third of the sheet. */}
      <View style={styles.chips}>
        <Chip label="Ahead of me" icon="chevron-up" onPress={() => onQuickPin("ahead")} testID="siren-pin-ahead" />
        <Chip label="Behind me" icon="chevron-down" onPress={() => onQuickPin("behind")} testID="siren-pin-behind" />
        <Chip label="Where I heard it" icon="location" onPress={() => onQuickPin("heard")} testID="siren-pin-heard" />
      </View>
      <Text style={styles.label}>What happened?</Text>
      <View style={styles.chips}>
        {WHATS.map((w) => (
          <Chip
            key={w}
            label={WHAT_LABEL[w]}
            selected={value.what === w}
            onPress={() => onChange({ ...value, what: w })}
            testID={`siren-what-${w}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 16, color: colors.text },
  inputOff: { opacity: 0.5 },
  inputError: { borderColor: colors.danger },
  error: { fontSize: 12, color: colors.danger },
});
