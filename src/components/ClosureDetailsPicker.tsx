import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Segmented } from "@/components/ui/Segmented";
import { colors, spacing } from "@/theme/tokens";
import { DIRECTION_LABEL, LANES_LABEL, UNTIL_LABEL, type ClosureDetails, type ClosureUntil } from "@/nav/closures";

// The details asked when reporting a road closure (gap item 14): which way, how much of the road,
// how long. Shown in the report placement bar; sent with the report (nav/closures.ts).

const UNTIL_KEYS: ClosureUntil[] = ["1h", "today", "days", "unknown"];
const UNTIL_SHORT: Record<ClosureUntil, string> = { "1h": "1 hour", today: "Today", days: "Days", unknown: "Not sure" };

export function ClosureDetailsPicker({ value, onChange }: { value: ClosureDetails; onChange: (next: ClosureDetails) => void }) {
  return (
    <View style={styles.wrap} testID="closure-details">
      <Text style={styles.label}>Which way is closed?</Text>
      <Segmented
        options={(["mine", "both"] as const).map((k) => ({ key: k, label: DIRECTION_LABEL[k] }))}
        value={value.direction}
        onChange={(direction) => onChange({ ...value, direction })}
        testID="closure-direction"
      />
      <Text style={styles.label}>How much of the road?</Text>
      <Segmented
        options={(["all", "some"] as const).map((k) => ({ key: k, label: LANES_LABEL[k] }))}
        value={value.lanes}
        onChange={(lanes) => onChange({ ...value, lanes })}
        testID="closure-lanes"
      />
      <Text style={styles.label}>For how long?</Text>
      <Segmented
        options={UNTIL_KEYS.map((k) => ({ key: k, label: UNTIL_SHORT[k] }))}
        value={value.until}
        onChange={(until) => onChange({ ...value, until })}
        testID="closure-until"
      />
      <Text style={styles.hint} accessibilityLiveRegion="polite">{`${UNTIL_LABEL[value.until]}${value.until === "unknown" ? " — it stays up to 6 hours unless drivers confirm it" : ""}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: spacing.xs },
  hint: { fontSize: 12, color: colors.textMuted },
});
