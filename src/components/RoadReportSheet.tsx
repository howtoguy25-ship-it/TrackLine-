import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { colors, radius, shadow, spacing } from "@/theme/tokens";
import rules from "@/data/schoolZoneRules.json";
import {
  confirmRoadReport,
  pendingReportsNear,
  submitRoadReport,
  type PendingRoadReport,
  type RoadReportInput,
} from "@/services/roadFeatureReports";

// Tap the speed sign: report a missing school zone, a wrong one, or a wrong speed limit -- and
// confirm what other drivers reported here. Nothing goes on anyone's map until 3 other drivers
// confirm it or the owner approves it (server side, roadReportsCore.js).

/** "08:00-09:30, 14:30-16:00" -> [["08:00","09:30"],["14:30","16:00"]], or null if unreadable. */
export function parseHoursText(text: string): [string, string][] | null {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 3) return null;
  const out: [string, string][] = [];
  for (const p of parts) {
    const m = /^(\d{1,2}):?(\d{2})\s*[-–to]+\s*(\d{1,2}):?(\d{2})$/i.exec(p);
    if (!m) return null;
    const a = `${m[1].padStart(2, "0")}:${m[2]}`;
    const b = `${m[3].padStart(2, "0")}:${m[4]}`;
    const ok = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if (!ok(a) || !ok(b) || a >= b) return null;
    out.push([a, b]);
  }
  return out;
}

/** The verified default hours for the region (rule table), as text to prefill; "" if none. */
export function defaultHoursText(region: string | null): string {
  const row = rules.rows.find((r) => r.region === region);
  return row ? row.windows.map(([a, b]) => `${a}-${b}`).join(", ") : "";
}

type Mode = "menu" | "missing" | "wrongLimit";

interface Props {
  visible: boolean;
  onClose: () => void;
  uid: string | null;
  position: { latitude: number; longitude: number } | null;
  heading: number | null;
  region: string | null;
  unit: "km/h" | "mph";
  /** The limit on the sign now (km/h), if any. */
  shownKmh: number | null;
  /** The school zone the car is in now, if any (official or OSM). */
  schoolZoneId: string | null;
}

export function RoadReportSheet({ visible, onClose, uid, position, heading, region, unit, shownKmh, schoolZoneId }: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [pending, setPending] = useState<PendingRoadReport[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<number | null>(null);
  const [hours, setHours] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !uid || !position) return;
    let live = true;
    pendingReportsNear(uid, position.latitude, position.longitude).then((list) => {
      if (live) setPending(list);
    });
    return () => {
      live = false;
    };
  }, [visible, uid, position]);

  const close = () => {
    setMode("menu");
    setMessage(null);
    setSpeed(null);
    onClose();
  };

  const send = async (input: RoadReportInput) => {
    if (!uid || !position) return;
    setBusy(true);
    try {
      await submitRoadReport(uid, position, heading, input);
      setMessage("Thanks -- it goes live once 3 other drivers confirm it.");
      setMode("menu");
    } catch {
      setMessage("Couldn't send the report. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toKmh = (v: number) => (unit === "mph" ? v * 1.609344 : v);
  const zoneSpeeds = unit === "mph" ? [25, 20, 15] : [40, 30, 25, 20];
  const limitSpeeds = unit === "mph" ? [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70] : [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  const parsedHours = parseHoursText(hours);
  const canReport = !!uid && !!position;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close} accessibilityLabel="Close">
        <Pressable style={styles.card} onPress={() => {}} testID="road-report-sheet">
          <ScrollView>
            <Text style={styles.title}>Speed limit and school zones</Text>
            {!canReport && <Text style={styles.body}>Sign in and turn on location to report or confirm.</Text>}
            {message && <Text style={styles.note}>{message}</Text>}

            {mode === "menu" && canReport && (
              <View style={styles.list}>
                {pending.length > 0 && <Text style={styles.section}>Reported by other drivers here</Text>}
                {pending.map((p) => (
                  <View key={p.id} style={styles.pendingRow}>
                    <Text style={styles.pendingText}>
                      {p.summary} ({p.confirmCount}/3 confirmed)
                    </Text>
                    <Button
                      variant="secondary"
                     
                      label={confirmed.has(p.id) ? "Confirmed" : "Confirm"}
                      disabled={confirmed.has(p.id)}
                      onPress={() =>
                        confirmRoadReport(p.id, uid!)
                          .then(() => setConfirmed((s) => new Set(s).add(p.id)))
                          .catch(() => setMessage("Couldn't confirm (already confirmed, or offline)."))
                      }
                      testID={`confirm-report-${p.id}`}
                    />
                  </View>
                ))}
                <Text style={styles.section}>Report</Text>
                <Button
                  variant="secondary"
                  fullWidth
                  label="Missing school zone here"
                  onPress={() => {
                    setHours(defaultHoursText(region));
                    setSpeed(unit === "mph" ? 20 : region?.startsWith("AU-") ? 40 : null);
                    setMode("missing");
                  }}
                  testID="report-missing-zone"
                />
                {schoolZoneId && (
                  <>
                    <Button variant="secondary" fullWidth label="No school zone here" loading={busy} onPress={() => send({ kind: "school_zone_wrong", reason: "not_here", zoneId: schoolZoneId })} />
                    <Button variant="secondary" fullWidth label="School zone hours are wrong" loading={busy} onPress={() => send({ kind: "school_zone_wrong", reason: "wrong_hours", zoneId: schoolZoneId })} />
                  </>
                )}
                <Button variant="secondary" fullWidth label="Wrong speed limit" onPress={() => setMode("wrongLimit")} testID="report-wrong-limit" />
              </View>
            )}

            {mode === "missing" && (
              <View style={styles.list}>
                <Text style={styles.section}>School zone speed ({unit})</Text>
                <View style={styles.chips}>
                  {zoneSpeeds.map((v) => (
                    <Button key={v} variant={speed === v ? "primary" : "secondary"} label={String(v)} onPress={() => setSpeed(v)} />
                  ))}
                </View>
                <Text style={styles.section}>Hours on the sign</Text>
                <TextInput
                  value={hours}
                  onChangeText={setHours}
                  placeholder="08:00-09:30, 14:30-16:00"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  autoCapitalize="none"
                  testID="report-hours-input"
                />
                <Text style={styles.body}>
                  {"Report it on the road it's on, facing along it -- it covers only this stretch, in this direction (either way)."}
                </Text>
                <Button
                  variant="primary"
                  fullWidth
                  label="Send report"
                  loading={busy}
                  disabled={!speed || !parsedHours || heading == null}
                  onPress={() => speed && parsedHours && send({ kind: "school_zone_missing", speed, unit, windows: parsedHours })}
                  testID="send-missing-zone"
                />
                {heading == null && <Text style={styles.body}>Drive a few metres first so the direction of the road is known.</Text>}
                <Button variant="ghost" fullWidth label="Back" onPress={() => setMode("menu")} />
              </View>
            )}

            {mode === "wrongLimit" && (
              <View style={styles.list}>
                <Text style={styles.section}>The sign on the road says ({unit})</Text>
                <View style={styles.chips}>
                  {limitSpeeds.map((v) => (
                    <Button
                      key={v}
                      variant="secondary"
                     
                      label={String(v)}
                      loading={busy}
                      onPress={() => send({ kind: "speed_limit_wrong", postedKmh: Math.round(toKmh(v)), shownKmh: shownKmh != null ? Math.round(shownKmh) : null })}
                    />
                  ))}
                </View>
                <Button variant="ghost" fullWidth label="Back" onPress={() => setMode("menu")} />
              </View>
            )}
            <Button variant="ghost" fullWidth label="Close" onPress={close} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "80%",
    ...shadow.high,
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: spacing.sm },
  body: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  note: { fontSize: 14, color: colors.text, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pendingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  pendingText: { flex: 1, fontSize: 14, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
});
