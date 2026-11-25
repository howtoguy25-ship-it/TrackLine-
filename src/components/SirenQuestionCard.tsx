import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { SURFACES } from "@/theme/colors";
import { shadow } from "@/theme/tokens";
import { QUESTION_TIMEOUT_MS } from "@/nav/sirenRadar";
import { SirenArt } from "@/components/art/SirenArt";
import { SIREN_RED } from "@/components/EmergencyVehicleBanner";

// "Did you see an emergency vehicle or incident?" -- asked once the car has (nearly) stopped after
// the radar heard a siren. Yes opens the report sheet, No just closes it; unanswered it goes away
// after 10 s. MapScreen also listens for a spoken "yes" / "no" when voice is on.

export function SirenQuestionCard({ top, dark, onYes, onNo, listening }: { top: number; dark: boolean; onYes: () => void; onNo: () => void; listening: boolean }) {
  useEffect(() => {
    const t = setTimeout(onNo, QUESTION_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [onNo]);
  const surface = dark ? SURFACES.dark : SURFACES.light;
  return (
    <View style={[styles.wrap, { top }]} testID="siren-question">
      <View style={[styles.card, { backgroundColor: surface.raised }]}>
        <View style={styles.head}>
          <View style={styles.icon}>
            <SirenArt size={22} />
          </View>
          <View style={styles.text}>
            <Text style={[styles.title, { color: surface.text }]} accessibilityRole="header">
              Did you see an emergency vehicle or incident?
            </Text>
            {listening ? <Text style={[styles.hint, { color: surface.textMuted }]}>Say “yes” or “no”</Text> : null}
          </View>
        </View>
        <View style={styles.row}>
          <Button variant="secondary" label="No" onPress={onNo} style={styles.flex} testID="siren-question-no" />
          <Button variant="primary" label="Yes" onPress={onYes} style={styles.flex} testID="siren-question-yes" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12 },
  card: { borderRadius: 20, padding: 16, gap: 14, ...shadow.floating },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: SIREN_RED, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, fontWeight: "700", lineHeight: 22 },
  hint: { fontSize: 13 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
});
