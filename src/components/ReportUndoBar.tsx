import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { ALERT_COLORS, ALERT_LABELS, type AlertType } from "@/types/alert";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

// The 3 s after sending a report: it's held on the server (pendingReports) and only goes on the
// map when this runs out. Undo takes it back (the server allows 2 undos an hour).
export function ReportUndoBar({ type, label, untilMs, onUndo, onDone, bottom }: { type: AlertType; label?: string; untilMs: number; onUndo: () => void; onDone: () => void; bottom: number }) {
  const name = label ?? ALERT_LABELS[type];
  const [left, setLeft] = useState(() => Math.max(0, untilMs - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, untilMs - Date.now());
      setLeft(l);
      if (l === 0) {
        clearInterval(t);
        onDone();
      }
    }, 200);
    return () => clearInterval(t);
  }, [untilMs, onDone]);
  return (
    <View style={[styles.bar, { bottom }]} accessibilityLiveRegion="polite" testID="report-undo-bar">
      <View style={[styles.icon, { backgroundColor: ALERT_COLORS[type] }]}>
        <AlertTypeGlyph type={type} size={16} color="#FFFFFF" />
      </View>
      <Text style={styles.text}>{`${name} reported · ${Math.ceil(left / 1000)}`}</Text>
      <Button variant="secondary" label="Undo" onPress={onUndo} accessibilityLabel={`Undo ${name} report`} testID="report-undo" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.dark,
    borderRadius: radius.lg,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    ...shadow.medium,
  },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
