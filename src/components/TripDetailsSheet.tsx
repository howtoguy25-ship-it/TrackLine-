import React from "react";
import { Linking, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Route } from "@/services/directions";
import { fareLine, timelineFor, type Realtime } from "@/travel/transitTimeline";
import { bookingLink, ferryDetailsFor } from "@/travel/ferryDetails";
import { colors, radius, spacing } from "@/theme/tokens";

// Trip details for a transit or ferry option: the timeline (walks and rides, line, stops, times,
// live/late from Transport for NSW when available), the fare or how to pay (Opal in NSW), and
// ferry details (wharves, departures, crossing time, cars, the operator's booking link).
export function TripDetailsSheet({
  visible,
  route,
  alternatives,
  realtime,
  realtimeNote,
  inNsw,
  onClose,
}: {
  visible: boolean;
  route: Route | null;
  /** All options for this trip (ferry departures are listed across them). */
  alternatives: readonly Route[];
  realtime: readonly (Realtime | null)[];
  /** e.g. "Live times need the Transport for NSW key on the server" when realtime isn't set up. */
  realtimeNote: string | null;
  inNsw: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!route) return null;
  const timeline = timelineFor(route, realtime);
  const ferry = ferryDetailsFor(route.transitSummary?.legs.some((l) => l.vehicleType === "FERRY") ? alternatives : [route]);
  const link = bookingLink(ferry?.bookingUrl ?? null);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="trip-details-sheet">
          <View style={styles.header}>
            <Text style={styles.title}>Trip details</Text>
            <Button variant="ghost" icon="close" onPress={onClose} accessibilityLabel="Close" />
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {timeline.map((e, i) =>
              e.kind === "walk" ? (
                <View key={i} style={styles.walk} testID="timeline-walk">
                  <Icon name="walk" size={18} color={colors.textMuted} />
                  <Text style={styles.walkText}>{e.text}</Text>
                </View>
              ) : (
                <View key={i} style={styles.ride} testID="timeline-ride">
                  <View style={[styles.lineBadge, { backgroundColor: e.leg.lineColor ?? colors.accent }]}>
                    <Text style={[styles.lineText, { color: e.leg.lineTextColor ?? "#FFFFFF" }]}>{e.leg.lineName}</Text>
                  </View>
                  <View style={styles.rideText}>
                    <Text style={styles.rideTitle}>{e.title}</Text>
                    <Text style={styles.rideSub}>{`${e.from} → ${e.to}`}</Text>
                    <Text style={styles.rideSub}>{[e.times, e.stops].filter(Boolean).join(" · ")}</Text>
                    <Text style={[styles.status, e.late && styles.late]} testID="timeline-status">{e.status}</Text>
                  </View>
                </View>
              )
            )}
            {realtimeNote && <Text style={styles.note}>{realtimeNote}</Text>}
            {route.transitSummary && <Text style={styles.fare} testID="trip-fare">{fareLine(route, inNsw)}</Text>}
            {ferry && (
              <View style={styles.ferry} testID="ferry-details">
                <Text style={styles.ferryTitle}>{ferry.name ? `Ferry: ${ferry.name}` : "Ferry"}</Text>
                {ferry.fromWharf && ferry.toWharf && <Text style={styles.rideSub}>{`${ferry.fromWharf} → ${ferry.toWharf}`}</Text>}
                {ferry.departures.length > 0 && <Text style={styles.rideSub}>{`Departures: ${ferry.departures.join(", ")}`}</Text>}
                {ferry.crossingMinutes !== null && <Text style={styles.rideSub}>{`Crossing: about ${ferry.crossingMinutes} min`}</Text>}
                <Text style={styles.rideSub}>{ferry.carsAllowed === true ? "Cars: yes (vehicle ferry)" : ferry.carsAllowed === false ? "Cars: no (passengers only)" : "Cars: unknown"}</Text>
                {link && <Button variant="secondary" label="Tickets and timetable" icon="open" onPress={() => Linking.openURL(link)} accessibilityLabel="Open the operator's tickets and timetable page" testID="ferry-booking" />}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "80%", backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  body: { gap: spacing.md, paddingVertical: spacing.md },
  walk: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.sm },
  walkText: { fontSize: 14, color: colors.textMuted },
  ride: { flexDirection: "row", gap: spacing.md },
  lineBadge: { minWidth: 44, paddingHorizontal: 6, height: 28, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  lineText: { fontSize: 13, fontWeight: "700" },
  rideText: { flex: 1, gap: 2 },
  rideTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rideSub: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  late: { color: colors.danger },
  note: { fontSize: 12, color: colors.textMuted },
  fare: { fontSize: 14, color: colors.text },
  ferry: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: 4 },
  ferryTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
});
