import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { colors, radius, spacing } from "@/theme/tokens";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useLocation } from "@/context/LocationContext";
import { syncApproxLocation, syncPrefs } from "@/services/targeting";
import { GUEST_WARNING, dismissSavePrompt, onSavePrompt, type SaveMoment } from "@/guest/savePrompt";
import { navigationRef } from "@/navigation/deepLinks";

// Keeps this install's deviceSessions doc current for the dashboard's message targeting (the
// Notification settings, which features are on, a rough ~1 km location), and shows the
// "Save your TrackLine" prompt to guests at the moments guest/savePrompt.ts picks.
const MOMENT_TEXT: Record<SaveMoment, string> = {
  savedHomeWork: "You've saved a place.",
  purchase: "You've made a purchase.",
  tripEnded: "Nice drive!",
};

export function BackgroundSync() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { location } = useLocation();
  const [moment, setMoment] = useState<SaveMoment | null>(null);

  const prefsKey = `${settings.notifyFun}${settings.notifyNews}${settings.notifyTraffic}${settings.showTrackysOnMap}${settings.schoolZonesShowOnMap}${settings.showLiveTraffic}${settings.showSpeedometer}${settings.shareArrivals}`;
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => syncPrefs(user.uid, settings).catch(() => {}), 1500);
    return () => clearTimeout(t);
    // Only when one of the synced values changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, prefsKey]);

  const lat = location?.coords.latitude;
  const lng = location?.coords.longitude;
  useEffect(() => {
    if (user && typeof lat === "number" && typeof lng === "number") syncApproxLocation(user.uid, lat, lng).catch(() => {});
  }, [user, lat, lng]);

  useEffect(() => onSavePrompt(setMoment), []);

  return (
    <Modal visible={!!moment} transparent animationType="fade" onRequestClose={() => setMoment(null)}>
      <View style={styles.back}>
        <View style={styles.card} testID="save-trackline-prompt">
          <Text style={styles.title}>Save your TrackLine</Text>
          <Text style={styles.text}>{moment ? `${MOMENT_TEXT[moment]} ` : ""}{GUEST_WARNING} Creating an account keeps everything you have now.</Text>
          <Button
            variant="primary"
            label="Create an account"
            fullWidth
            onPress={() => {
              setMoment(null);
              if (navigationRef.isReady()) navigationRef.navigate("SignIn");
            }}
          />
          <Button
            variant="secondary"
            label="Not now"
            fullWidth
            onPress={() => {
              setMoment(null);
              dismissSavePrompt().catch(() => {});
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  text: { fontSize: 15, color: colors.textMuted },
});
