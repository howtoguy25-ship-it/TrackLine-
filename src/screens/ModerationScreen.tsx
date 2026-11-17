import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { ReportItemIcon } from "@/components/settings/ReportItemIcon";
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";
import { getModerationQueue, moderateReport, type QueueItem } from "@/services/moderation";
import { colors, radius, spacing } from "@/theme/tokens";

// Owner/admin only: approve or reject fixed cameras and road features drivers reported. Approved
// ones stay on the map for good; rejected ones are removed. (Three drivers confirming one does
// the same as approving it.)
export function ModerationScreen() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    getModerationQueue()
      .then((list) => {
        setError(null);
        setItems(list);
      })
      .catch((e: { message?: string }) => setError(e?.message ?? "Couldn't load the queue."));
  }, []);
  useEffect(load, [load]);
  const decide = (id: string, approve: boolean) =>
    moderateReport(id, approve)
      .then(() => setItems((list) => (list ?? []).filter((i) => i.id !== id)))
      .catch((e: { message?: string }) => setError(e?.message ?? "Couldn't save that."));

  return (
    <ScrollView contentContainerStyle={styles.content} testID="moderation-screen">
      <Text style={styles.intro}>Fixed cameras and road features drivers reported. Approve to keep one on the map for good; reject to remove it.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {items === null && !error && <ActivityIndicator />}
      {items?.length === 0 && <Text style={styles.empty}>Nothing waiting.</Text>}
      {items?.map((q) => {
        const item = REPORT_ITEM_BY_ID[q.item as ReportItemId];
        return (
          <View key={q.id} style={styles.row} testID={`moderation-row-${q.id}`}>
            {item && <ReportItemIcon id={item.id} size={36} />}
            <View style={styles.text}>
              <Text style={styles.title}>{item?.title ?? q.item}</Text>
              <Text style={styles.sub}>{`${q.lat.toFixed(5)}, ${q.lng.toFixed(5)} · ${q.confirmCount} confirmed · ${q.denyCount} not there`}</Text>
              {q.comment ? <Text style={styles.sub}>{`“${q.comment}”`}</Text> : null}
            </View>
            <View style={styles.actions}>
              <Button variant="primary" label="Approve" onPress={() => decide(q.id, true)} accessibilityLabel={`Approve ${item?.title ?? q.item}`} testID={`approve-${q.id}`} />
              <Button variant="secondary" label="Reject" onPress={() => decide(q.id, false)} accessibilityLabel={`Reject ${item?.title ?? q.item}`} testID={`reject-${q.id}`} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { fontSize: 14, color: colors.textMuted },
  error: { fontSize: 14, color: colors.danger },
  empty: { fontSize: 15, color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  text: { gap: 2 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: "row", gap: spacing.sm },
});
