import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button, Chip } from "@/components/ui/Button";
import { colors, radius, spacing } from "@/theme/tokens";
import { parsePriceInput, reportAnswerText, reportFuelPrice } from "@/places/driverFuelPrices";
import { FUEL_TYPES, type FuelTypeKey, type NearbyResult } from "@/places/nearbyNew";
import type { LatLng } from "@/utils/polyline";

// "Report a price" for the station you're at (gap item 18). Opens a small form: the price on the
// sign for the selected fuel. The server keeps it until 3 drivers agree; the answer says which.

type Phase = { s: "closed" } | { s: "open" } | { s: "sending" } | { s: "done"; text: string } | { s: "error"; text: string };

export function FuelPriceReport({ station, fuelType, me }: { station: NearbyResult; fuelType: FuelTypeKey; me: LatLng }) {
  const [phase, setPhase] = useState<Phase>({ s: "closed" });
  const [text, setText] = useState("");
  const fuelLabel = FUEL_TYPES.find((f) => f.key === fuelType)?.label ?? fuelType;
  const cents = parsePriceInput(text);
  if (fuelType === "ev") return null;
  if (phase.s === "closed") {
    return <Chip label={`Report ${fuelLabel} price at ${station.name}`} icon="flag" onPress={() => setPhase({ s: "open" })} testID="fuel-report-open" />;
  }
  const send = () => {
    if (cents == null) return;
    setPhase({ s: "sending" });
    reportFuelPrice(station, fuelType, cents, me).then(
      (a) => setPhase({ s: "done", text: reportAnswerText(a, fuelLabel) }),
      (e: unknown) => setPhase({ s: "error", text: e instanceof Error ? e.message : "Couldn't send — try again." })
    );
  };
  return (
    <View style={styles.box} testID="fuel-report">
      <Text style={styles.title}>
        {fuelLabel} at {station.name}
      </Text>
      {phase.s === "done" ? (
        <Text style={styles.note} testID="fuel-report-done">
          {phase.text}
        </Text>
      ) : (
        <>
          <View style={styles.row}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Price on the sign, e.g. 189.9"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
              style={styles.input}
              accessibilityLabel={`${fuelLabel} price in cents per litre`}
              testID="fuel-report-input"
            />
            <Button variant="primary" label="Send" onPress={send} disabled={cents == null || phase.s === "sending"} loading={phase.s === "sending"} testID="fuel-report-send" />
          </View>
          {text && cents == null ? <Text style={styles.error}>Cents per litre, between 80 and 400.</Text> : null}
          {phase.s === "error" ? (
            <Text style={styles.error} testID="fuel-report-error">
              {phase.text}
            </Text>
          ) : null}
          <Text style={styles.note}>Shown to others once 3 drivers report the same price. Official prices always come first.</Text>
        </>
      )}
      <Button variant="ghost" label={phase.s === "done" ? "Close" : "Cancel"} onPress={() => setPhase({ s: "closed" })} inline testID="fuel-report-close" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 12, fontSize: 16, color: colors.text },
  note: { fontSize: 13, color: colors.textMuted },
  error: { fontSize: 13, color: colors.danger },
});
