import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { isOwnerEmail } from "@/config/admin";
import {
  fetchOwnerStats,
  fetchBroadcastHistory,
  sendBroadcastNotification,
  type OwnerStats,
  type BroadcastHistoryEntry,
} from "@/services/ownerDashboard";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const TEXT_MUTED = "#8B95A5";
const TEXT_FAINT = "#5B6472";

// Real refresh cadence for the two live counters below (total installs, active now) -- not a
// true push-based realtime stream (Firestore's count aggregation has no listener form), but a
// genuine re-query against the live collection every time this fires, so the numbers on screen
// are never more than this many seconds stale while the dashboard is actually open.
const STATS_REFRESH_MS = 15 * 1000;

function StatCard({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string; sublabel: string }) {
  return (
    <View style={styles.statCard}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSublabel}>{sublabel}</Text>
    </View>
  );
}

// Real, owner-only usage dashboard -- per explicit request, everything here is a live number
// pulled from Firestore (see ownerDashboard.ts), never invented. Real App Store/Play Store
// download totals live in App Store Connect/Play Console and aren't reachable from inside this
// app at all (that needs separate, credentialed server-side API access this doesn't have) -- so
// "Total installs" here is honestly labeled as real unique devices that have opened this app
// (see deviceSession.ts), not an official store download count.
export function OwnerDashboardScreen() {
  const { user } = useAuth();
  const isOwner = isOwnerEmail(user?.email);

  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [history, setHistory] = useState<BroadcastHistoryEntry[] | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const reloadStats = useCallback(() => {
    if (!isOwner) return;
    fetchOwnerStats()
      .then((s) => {
        setStats(s);
        setStatsError(null);
      })
      .catch((err) => setStatsError(err instanceof Error ? err.message : "Failed to load stats."));
  }, [isOwner]);

  const reloadHistory = useCallback(() => {
    if (!isOwner) return;
    fetchBroadcastHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [isOwner]);

  // Refreshes the moment this screen is opened/returned to, then keeps refreshing on a real
  // interval for as long as it stays focused -- stops the instant it isn't (e.g. the owner
  // backs out to Settings), so this never burns reads in the background.
  useFocusEffect(
    useCallback(() => {
      reloadStats();
      reloadHistory();
      const interval = setInterval(reloadStats, STATS_REFRESH_MS);
      return () => clearInterval(interval);
    }, [reloadStats, reloadHistory])
  );

  const onSend = useCallback(() => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) return;

    Alert.alert(
      "Send to all users?",
      `This sends a real push notification to every device with notifications enabled.\n\n"${trimmedTitle}" — ${trimmedBody}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          style: "destructive",
          onPress: async () => {
            setSending(true);
            setSendResult(null);
            const result = await sendBroadcastNotification(trimmedTitle, trimmedBody);
            setSending(false);
            setSendResult({ ok: result.outcome === "success", message: result.message });
            if (result.outcome === "success") {
              setTitle("");
              setBody("");
              reloadHistory();
            }
          },
        },
      ]
    );
  }, [title, body, reloadHistory]);

  if (!isOwner) {
    return (
      <View style={styles.deniedContainer}>
        <Ionicons name="lock-closed" size={32} color={TEXT_FAINT} />
        <Text style={styles.deniedText}>This dashboard is only available to the app owner.</Text>
      </View>
    );
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !sending;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Live usage</Text>
      <Text style={styles.helperText}>
        Real numbers from every device that's opened this app, refreshed automatically while this
        screen is open. "Total installs" counts real unique devices recorded here — App Store/Play
        Store's own official download totals live in App Store Connect/Play Console and aren't
        reachable from inside the app itself.
      </Text>

      {statsError && <Text style={styles.errorText}>{statsError}</Text>}
      {!statsError && !stats && <ActivityIndicator color={TEXT_MUTED} style={{ marginTop: spacing.lg }} />}

      {stats && (
        <View style={styles.statsRow}>
          <StatCard
            icon={<MaterialCommunityIcons name="cellphone" size={22} color={colors.accent} />}
            label="Total installs"
            value={stats.totalInstalls.toLocaleString()}
            sublabel="Unique devices, all time"
          />
          <StatCard
            icon={<Ionicons name="radio-button-on" size={20} color="#22C55E" />}
            label="Active now"
            value={stats.activeNow.toLocaleString()}
            sublabel="Last 5 minutes"
          />
          <StatCard
            icon={<Ionicons name="person-circle" size={22} color={colors.accent} />}
            label="Logged in"
            value={stats.loggedInAccounts.toLocaleString()}
            sublabel="Real accounts, not guest"
          />
        </View>
      )}

      <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Send notification to all users</Text>
      <Text style={styles.helperText}>
        A real push notification, sent immediately to every device with notifications enabled —
        there's no draft or preview mode, tapping Send always sends for real.
      </Text>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor={TEXT_FAINT}
        maxLength={80}
        style={styles.input}
      />
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Message"
        placeholderTextColor={TEXT_FAINT}
        multiline
        maxLength={200}
        style={[styles.input, styles.inputMultiline]}
      />

      <Pressable
        onPress={onSend}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          !canSend && styles.sendButtonDisabled,
          pressed && canSend && { opacity: pressedOpacity },
        ]}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="send" size={16} color="#FFFFFF" />
            <Text style={styles.sendButtonText}>Send to all users</Text>
          </>
        )}
      </Pressable>

      {sendResult && (
        <Text style={sendResult.ok ? styles.successText : styles.errorText}>{sendResult.message}</Text>
      )}

      <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Recent sends</Text>
      {history === null && <ActivityIndicator color={TEXT_MUTED} style={{ marginTop: spacing.sm }} />}
      {history !== null && history.length === 0 && (
        <Text style={styles.helperText}>No broadcasts sent yet.</Text>
      )}
      {history?.map((entry) => (
        <View key={entry.id} style={styles.historyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>{entry.title}</Text>
            <Text style={styles.historyBody}>{entry.body}</Text>
            <Text style={styles.historyMeta}>
              {entry.sentAt} · {entry.sentCount} delivered{entry.failedCount > 0 ? `, ${entry.failedCount} failed` : ""}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  deniedContainer: {
    flex: 1,
    backgroundColor: "#0B1220",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  deniedText: {
    color: TEXT_MUTED,
    fontSize: 14,
    textAlign: "center",
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  helperText: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  errorText: {
    color: "#F87171",
    fontSize: 13,
    marginTop: spacing.sm,
  },
  successText: {
    color: "#22C55E",
    fontSize: 13,
    marginTop: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#111A2C",
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "flex-start",
    gap: 4,
    ...shadow.low,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  statLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  statSublabel: {
    color: TEXT_FAINT,
    fontSize: 10,
  },
  input: {
    backgroundColor: "#111A2C",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: "#FFFFFF",
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  historyRow: {
    flexDirection: "row",
    backgroundColor: "#111A2C",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  historyTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  historyBody: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  historyMeta: {
    color: TEXT_FAINT,
    fontSize: 11,
    marginTop: 4,
  },
});
