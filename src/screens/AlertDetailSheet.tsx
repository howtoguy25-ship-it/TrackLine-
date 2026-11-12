import React, { forwardRef, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ALERT_COLORS, ALERT_PIN, ALERT_LABELS, type AlertDoc } from "@/types/alert";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

interface Props {
  alert: AlertDoc | null;
  currentUid: string | null;
  onDelete: (alert: AlertDoc) => void;
  onHide: (alert: AlertDoc) => void;
  onConfirmStillHere: (alert: AlertDoc) => void;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
}

function timeAgo(timestampMs: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - timestampMs) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
}

export const AlertDetailSheet = forwardRef<BottomSheet, Props>(function AlertDetailSheet(
  { alert, currentUid, onDelete, onHide, onConfirmStillHere, onClose, onSheetChange },
  ref
) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["38%"], []);
  const isOwner = !!alert && !!currentUid && alert.createdBy === currentUid;

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={onSheetChange}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        {alert && (
          <>
            <View style={styles.header}>
              <View style={[styles.iconWrap, { backgroundColor: ALERT_COLORS[alert.type] }]}>
                <AlertTypeGlyph type={alert.type} size={26} color={ALERT_PIN[alert.type].glyph} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{ALERT_LABELS[alert.type]}</Text>
                <Text style={styles.subtitle}>
                  Reported {timeAgo(alert.createdAt)} · {alert.confirmCount} confirmed
                </Text>
              </View>
              <Button
                variant="ghost"
                icon="close"
                iconColor={colors.textMuted}
                onPress={onClose}
                accessibilityLabel="Close"
              />
            </View>

            {/* The reporter's own optional "up to 7 words" comment (see commentFilter.ts) --
                shown in full here (the map pin's own caption, see AlertMarker, truncates to 2
                lines at a much smaller size to fit on the map itself). */}
            {alert.comment && (
              <View style={styles.commentBox}>
                <Text style={styles.commentText}>"{alert.comment}"</Text>
              </View>
            )}

            <Button
              variant="secondary"
              icon="check-circle-outline"
              label="Still here"
              onPress={() => onConfirmStillHere(alert)}
            />

            {isOwner ? (
              // Only the reporter can ever delete their own alert -- a real, global removal,
              // unlike Hide below (self-only, time-boxed) which every other user gets instead.
              <Button variant="destructive" label="Delete" onPress={() => onDelete(alert)} />
            ) : (
              // Self-only, per explicit request -- hides this alert from just this account's own
              // view for 1 hour (see alerts.ts's HIDE_DURATION_MS), then it reappears unless
              // hidden again. Never affects what any other user sees.
              <Button variant="secondary" label="Hide for 1 hour" onPress={() => onHide(alert)} />
            )}
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.md + 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  commentBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  commentText: {
    fontSize: 13,
    fontStyle: "italic",
    color: colors.text,
  },
});
