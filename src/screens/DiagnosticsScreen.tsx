import React, { useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, getDocFromServer } from "firebase/firestore";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { env } from "@/config/env";
import { getBuildStamp } from "@/config/getBuildStamp";
import { TOKEN_STATE_TEXT, mapboxTokenState, mapboxTokenTail } from "@/config/mapboxToken";
import { getDiagnostics, subscribeDiagnostics, type DirectionsRecord } from "@/diagnostics/diagnostics";
import { isMapboxNativeLinked } from "@/map-v2/mapbox";
import { auth, db } from "@/services/firebase";
import { colors, radius, spacing } from "@/theme/tokens";

// Settings > About > Diagnostics: what's really working in this build, checkable on the phone.
// Keys are never shown -- only yes/no, and the last 4 characters of the Mapbox public token.

export const DIRECTIONS_ROWS: [key: string, label: string][] = [
  ["drive", "Drive"],
  ["motorbike", "Motorbike"],
  ["bike", "Bike"],
  ["walk", "Walk"],
  ["navigation", "Navigation route (Mapbox)"],
  ["reroute", "Reroute (Mapbox)"],
];

export function directionsLine(rec: DirectionsRecord | undefined): string {
  if (!rec) return "Not asked yet this session";
  const who = rec.provider === "mapbox" ? "Mapbox" : "Google";
  const status = rec.status != null ? `HTTP ${rec.status}` : "no answer";
  return `${rec.ok ? "OK" : "Failed"} · ${who} · ${status} · ${rec.message}`;
}

type FirebaseCheck = { state: "checking" } | { state: "ok"; uid: string | null } | { state: "failed"; reason: string };

/** A real round trip to Firestore (not the local cache): the public app config document. */
async function probeFirebase(): Promise<FirebaseCheck> {
  try {
    await Promise.race([
      getDocFromServer(doc(db, "appConfig", "current")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 8 s")), 8000)),
    ]);
    return { state: "ok", uid: auth.currentUser?.uid ?? null };
  } catch (err) {
    return { state: "failed", reason: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

export function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const diag = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getDiagnostics);
  const [firebase, setFirebase] = useState<FirebaseCheck>({ state: "checking" });

  const [checkRun, setCheckRun] = useState(0);
  useEffect(() => {
    let live = true;
    probeFirebase().then((r) => {
      if (live) setFirebase(r);
    });
    return () => {
      live = false;
    };
  }, [checkRun]);
  const checkFirebase = () => {
    setFirebase({ state: "checking" });
    setCheckRun((n) => n + 1);
  };

  const tokenState = mapboxTokenState(env.mapboxPublicToken);
  const tail = mapboxTokenTail();
  const style = diag.mapStyle;

  const rows: [string, string, boolean | null][] = [
    ["Mapbox token present", tokenState === "ok" ? `Yes (…${tail})` : `No -- ${TOKEN_STATE_TEXT[tokenState]}`, tokenState === "ok"],
    ["Mapbox map engine in this build", isMapboxNativeLinked() ? "Yes" : "No", isMapboxNativeLinked()],
    [
      "Mapbox style loaded",
      style == null ? "Map not opened yet" : style.loaded ? "Yes" : `No -- ${style.error ?? "unknown error"}`,
      style == null ? null : style.loaded,
    ],
    ...DIRECTIONS_ROWS.map(([key, label]): [string, string, boolean | null] => {
      const rec = diag.directions[key];
      return [`Directions: ${label}`, directionsLine(rec), rec ? rec.ok : null];
    }),
    ["Google key present", env.googleDirectionsApiKey && env.googlePlacesApiKey ? "Yes" : "No", !!(env.googleDirectionsApiKey && env.googlePlacesApiKey)],
    [
      "Firebase connected",
      firebase.state === "checking" ? "Checking…" : firebase.state === "ok" ? `Yes${firebase.uid ? " (signed in)" : " (not signed in)"}` : `No -- ${firebase.reason}`,
      firebase.state === "checking" ? null : firebase.state === "ok",
    ],
    ["Build", getBuildStamp(), null],
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]} testID="diagnostics-screen">
      <Text style={styles.title}>Diagnostics</Text>
      <Text style={styles.helper}>What&apos;s working in this build right now. Directions rows fill in as you look up routes.</Text>
      {rows.map(([label, value, ok]) => (
        <View key={label} style={styles.row} testID={`diag-${label}`}>
          <Text style={styles.label}>
            {ok === true ? "✅ " : ok === false ? "❌ " : "• "}
            {label}
          </Text>
          <Text style={styles.value} selectable>
            {value}
          </Text>
        </View>
      ))}
      <Button variant="secondary" label="Check again" onPress={checkFirebase} testID="diag-recheck" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  helper: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  value: { fontSize: 14, color: colors.textMuted },
});
