import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tracky } from "@/components/trackys/Tracky";
import { TRACKY_MOODS } from "@/components/trackys/moods";
import { reverseGeocode } from "@/services/places";
import {
  callSendWave,
  getWaveCooldownRemainingMs,
  blockUser,
  reportUser,
  type PresenceDoc,
  type UserReportReason,
} from "@/services/presence";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const REPORT_REASONS: { key: UserReportReason; label: string }[] = [
  { key: "inappropriate_name", label: "Inappropriate name" },
  { key: "harassment", label: "Harassment" },
  { key: "other", label: "Other" },
];

interface Props {
  presence: PresenceDoc | null;
  selfUid: string;
  onClose: () => void;
  onBlocked: (uid: string) => void;
}

// Real, explicit request (Ghost mode + visibility control, Part 3 client) -- "Tap→card: mood,
// name/'A Tracky', 'Driving on <road>', [Wave 👋] rate-limited 1/10min/blockable... Block/
// report from card." The road name is resolved on-demand the moment this card opens (a plain
// reverseGeocode call, same one MapScreen's own currentRoadName chip already uses) rather than
// stored on the presence doc itself -- that doc only ever holds what updatePresence actually
// writes (lat/lng/heading/mood/displayName), never a resolved address.
export function PresenceCard({ presence, selfUid, onClose, onBlocked }: Props) {
  // Keyed by uid (not a plain reset-then-fetch) -- the only setState calls below happen inside
  // the async resolve/reject callbacks, never synchronously in the effect body itself, and the
  // render derives "still loading for the CURRENT presence" by comparing uids rather than
  // relying on an explicit reset call that could otherwise race with a fast card-to-card swap.
  const [roadNameByUid, setRoadNameByUid] = useState<{ uid: string; name: string | null } | null>(null);
  const [waveCooldownByUid, setWaveCooldownByUid] = useState<{ uid: string; ms: number } | null>(null);
  const [waving, setWaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!presence) return;
    let cancelled = false;
    reverseGeocode({ latitude: presence.lat, longitude: presence.lng })
      .then((name) => {
        if (!cancelled) setRoadNameByUid({ uid: presence.uid, name });
      })
      .catch(() => {
        if (!cancelled) setRoadNameByUid({ uid: presence.uid, name: null });
      });
    getWaveCooldownRemainingMs(presence.uid).then((ms) => {
      if (!cancelled) setWaveCooldownByUid({ uid: presence.uid, ms });
    });
    return () => {
      cancelled = true;
    };
  }, [presence]);

  if (!presence) return null;
  const mood = TRACKY_MOODS[presence.mood] ?? TRACKY_MOODS.happy;
  const roadName = roadNameByUid?.uid === presence.uid ? roadNameByUid.name : null;
  const waveCooldownMs = waveCooldownByUid?.uid === presence.uid ? waveCooldownByUid.ms : 0;

  const onWave = async () => {
    setWaving(true);
    const result = await callSendWave(presence.uid);
    setWaving(false);
    if (result.outcome === "rate_limited") {
      setWaveCooldownByUid({ uid: presence.uid, ms: await getWaveCooldownRemainingMs(presence.uid) });
      Alert.alert("Already waved recently", "You can wave at this driver again in a little while.");
    } else if (result.outcome === "success") {
      setWaveCooldownByUid({ uid: presence.uid, ms: await getWaveCooldownRemainingMs(presence.uid) });
      Alert.alert("Wave sent!", "");
    } else {
      Alert.alert("Couldn't send your wave", "Try again in a moment.");
    }
  };

  const handleClose = () => {
    setReportOpen(false);
    onClose();
  };

  const onBlock = () => {
    Alert.alert("Block this driver?", "You'll never see their Tracky on the map again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          await blockUser(selfUid, presence.uid);
          onBlocked(presence.uid);
          handleClose();
        },
      },
    ]);
  };

  const onSubmitReport = async (reason: UserReportReason) => {
    await reportUser(presence.uid, reason, selfUid);
    setReportOpen(false);
    Alert.alert("Report sent", "Thanks -- our team will take a look.");
  };

  return (
    <Modal transparent visible={!!presence} animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            {presence.look ? (
              <Tracky customization={presence.look} size={56} animated={false} reactOnTap={false} />
            ) : (
              <Tracky mood={presence.mood} size={56} animated={false} reactOnTap={false} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{presence.displayName ?? "A Tracky"}</Text>
              <Text style={styles.moodLabel}>{presence.look ? "Custom Tracky" : mood.label}</Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={12} style={styles.closeButton} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <Text style={styles.roadLine}>
            {roadName === null ? "Locating..." : roadName ? `Driving on ${roadName}` : "Driving nearby"}
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.waveButton,
              (waveCooldownMs > 0 || waving) && styles.waveButtonDisabled,
              pressed && waveCooldownMs === 0 && !waving && { opacity: pressedOpacity },
            ]}
            onPress={onWave}
            disabled={waveCooldownMs > 0 || waving}
          >
            {waving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.waveButtonText}>{waveCooldownMs > 0 ? "Waved 👋" : "Wave 👋"}</Text>
            )}
          </Pressable>

          {reportOpen ? (
            <View style={styles.reportReasons}>
              {REPORT_REASONS.map((r) => (
                <Pressable
                  key={r.key}
                  style={({ pressed }) => [styles.reportChip, pressed && { opacity: pressedOpacity }]}
                  onPress={() => onSubmitReport(r.key)}
                >
                  <Text style={styles.reportChipText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.footerRow}>
              <Pressable style={({ pressed }) => [styles.footerLink, pressed && { opacity: pressedOpacity }]} onPress={onBlock}>
                <Text style={styles.footerLinkText}>Block</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.footerLink, pressed && { opacity: pressedOpacity }]} onPress={() => setReportOpen(true)}>
                <Text style={styles.footerLinkText}>Report</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.high,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontSize: 16, fontWeight: "800", color: colors.text },
  moodLabel: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  roadLine: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md },
  waveButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
  },
  waveButtonDisabled: { backgroundColor: colors.surfaceMuted },
  waveButtonText: { fontSize: 14, fontWeight: "800", color: "#FFFFFF" },
  footerRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md, justifyContent: "center" },
  footerLink: { paddingVertical: spacing.xs },
  footerLinkText: { fontSize: 13, fontWeight: "700", color: colors.textFaint },
  reportReasons: { marginTop: spacing.md, gap: spacing.sm },
  reportChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
  },
  reportChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
});
