import React, { useSyncExternalStore } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Text } from "@/components/AppText";
import { colors } from "@/theme/tokens";
import { isTouchDebugEnabled, setTouchDebugEnabled, subscribeTouchDebug } from "@/debug/touchDebug";

/** Settings > Developer: switches the touch debugger (debug/touchDebug.ts) on and off. */
export function TouchDebuggerRow() {
  const enabled = useSyncExternalStore(subscribeTouchDebug, isTouchDebugEnabled);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>Outline what each touch hits</Text>
        <Text style={styles.hint}>Red box + component name on every tap; presses and the screen they open are logged.</Text>
      </View>
      <Switch value={enabled} onValueChange={setTouchDebugEnabled} accessibilityLabel="Touch debugger" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  label: { fontSize: 16, fontWeight: "500", color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
