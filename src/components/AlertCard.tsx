import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { FadeOut, SlideInUp, SlideOutUp } from "react-native-reanimated";
import { View } from "@/components/ui/Surface";
import { Text } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { HazardTriangleArt } from "@/components/art/RoadSignArt";
import { ALERT_PIN } from "@/types/alert";
import { BLUE } from "@/theme/colors";
import { incidentStyle, type TrafficIncident } from "@/services/trafficNswModel";
import { ALERT_CARD_IDLE_MS, bylineText, type AlertCardModel } from "@/map/alertCard";

// The dark card that slides down from the top when a report pin is tapped (REPORT ALERT CARDS
// spec, section 1): what it is, how far away it is right now, where, the reporter's note, who
// reported it and when, a big round icon, and a thumbs-up with the real count.
//
// Two sizes. The full card is for the home map, together with the spotlight (MapSpotlight) and
// the camera easing to the pin. The compact card is for navigation: no dim, no camera move, and
// MapScreen places it below the instruction card and lane strip so it never covers them.
//
// It closes itself after eight seconds without a touch, or when swiped up; tapping the map
// closes it too (MapScreen). Tapping the card opens the full details sheet (delete, hide,
// "Still here", the official advice in full) -- those stay where they were.

export const ALERT_CARD_BG = "#202124";
// The spec's thumbs-up blue is the theme's go-blue (one step darker on green so white
// text on it meets 3:1 -- theme/colors.ts).
export const THANKS_BLUE = BLUE;

interface Props {
  card: AlertCardModel;
  /** For an official card's icon (its category picks the glyph). */
  incident?: Pick<TrafficIncident, "kind" | "category"> | null;
  /** "1.0 km away" / "Here", live; null while no position is known. */
  distanceText: string | null;
  /** "Canterbury Rd, Punchbowl" -- null until known (the line is left out, never guessed). */
  place: string | null;
  now: number;
  /** This user has already thanked it (the pill shows that, and does nothing). */
  thanked: boolean;
  compact: boolean;
  /** Distance from the top of the screen to the card's top edge. */
  top: number;
  scale: number;
  onThanks: () => void;
  onOpenDetails: () => void;
  onDismiss: () => void;
}

const SLIDE_MS = 220;
const SWIPE_UP_PX = 30;

export function AlertCard(props: Props) {
  const { card, incident, distanceText, place, now, thanked, compact, top, scale, onThanks, onOpenDetails, onDismiss } = props;

  // Eight seconds without a touch closes it; every touch restarts the clock.
  const [lastTouch, setLastTouch] = useState(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), ALERT_CARD_IDLE_MS);
    return () => clearTimeout(t);
  }, [card.key, lastTouch]);

  // Swipe up to dismiss: measured from where the finger went down to where it came up. A swipe
  // isn't also a tap (which would open the details).
  const touchStartY = useRef<number | null>(null);
  const swiped = useRef(false);

  const iconSize = (compact ? 56 : 110) * scale;
  const ring = (compact ? 3 : 6) * scale;
  const s = (n: number) => n * scale;
  const showThanks = card.source === "report";
  const thanksDisabled = card.own || thanked;
  const byline = bylineText(card, now);

  const icon = (
    <RoundIcon card={card} incident={incident ?? null} size={iconSize} ring={ring} />
  );

  return (
    <Animated.View
      entering={SlideInUp.duration(SLIDE_MS)}
      exiting={compact ? FadeOut.duration(200) : SlideOutUp.duration(200)}
      style={[styles.wrap, { top, paddingHorizontal: s(12) }]}
      pointerEvents="box-none"
      testID={compact ? "alert-card-compact" : "alert-card"}
    >
      <Pressable
        onTouchStart={(e) => {
          setLastTouch(Date.now());
          touchStartY.current = e.nativeEvent.pageY;
          swiped.current = false;
        }}
        onTouchEnd={(e) => {
          const start = touchStartY.current;
          touchStartY.current = null;
          if (start !== null && e.nativeEvent.pageY - start < -SWIPE_UP_PX) {
            swiped.current = true;
            onDismiss();
          }
        }}
        onPress={() => {
          if (!swiped.current) onOpenDetails();
        }}
        accessibilityRole="button"
        accessibilityLabel={[card.title, distanceText, place].filter(Boolean).join(", ")}
        accessibilityHint="Opens the full details. Swipe up to close."
        style={[styles.card, { borderRadius: s(compact ? 18 : 24), padding: s(compact ? 12 : 18) }]}
      >
        <View style={styles.row}>
          <View style={styles.textCol}>
            <Text
              style={[styles.title, { fontSize: s(compact ? 20 : 34), lineHeight: s(compact ? 24 : 40) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              testID="alert-card-title"
            >
              {card.title}
            </Text>
            {distanceText && (
              <Text
                style={[styles.distance, { fontSize: s(compact ? 28 : 48), lineHeight: s(compact ? 32 : 54) }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                testID="alert-card-distance"
              >
                {distanceText}
              </Text>
            )}
            {place && (
              <Text style={[styles.place, { fontSize: s(compact ? 15 : 20) }]} numberOfLines={compact ? 1 : 2} testID="alert-card-place">
                {place}
              </Text>
            )}
          </View>
          {icon}
        </View>

        {!compact && card.note && (
          <Text style={[styles.note, { fontSize: s(17), marginTop: s(10) }]} numberOfLines={3} testID="alert-card-note">
            {`“${card.note}”`}
          </Text>
        )}

        {!compact && card.facts && card.facts.length > 0 && (
          <View style={{ marginTop: s(10), gap: s(4) }} testID="alert-card-facts">
            {card.facts.map((f) => (
              <Text key={f.label} style={[styles.fact, { fontSize: s(15) }]} numberOfLines={2}>
                <Text style={styles.factLabel}>{`${f.label}: `}</Text>
                {f.value}
              </Text>
            ))}
          </View>
        )}

        <View style={[styles.footer, { marginTop: s(compact ? 8 : 14) }]}>
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.byline, { fontSize: s(compact ? 13 : 15) }]} numberOfLines={1} testID="alert-card-byline">
              {byline}
            </Text>
            {!compact && (
              <Text style={[styles.byline, { fontSize: s(12) }]} numberOfLines={1} testID="alert-card-source">
                {card.sourceLine}
              </Text>
            )}
          </View>
          {showThanks && (
            <Pressable
              onPress={thanksDisabled ? undefined : onThanks}
              disabled={thanksDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: thanksDisabled, selected: thanked }}
              accessibilityLabel={
                card.own ? `Your report, ${card.thanks} thanks` : thanked ? `You thanked this, ${card.thanks} thanks` : `Thank the reporter, ${card.thanks} thanks so far`
              }
              hitSlop={8}
              style={[
                styles.thanks,
                { height: s(compact ? 36 : 44), paddingHorizontal: s(compact ? 12 : 16), borderRadius: s(22) },
                card.own ? styles.thanksOwn : thanked ? styles.thanksDone : null,
              ]}
              testID="alert-card-thanks"
            >
              <Icon name="thumbs-up" size={s(compact ? 18 : 22)} color="#FFFFFF" />
              <Text style={[styles.thanksCount, { fontSize: s(compact ? 15 : 18) }]} testID="alert-card-thanks-count">
                {card.thanks}
              </Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function RoundIcon({
  card,
  incident,
  size,
  ring,
}: {
  card: AlertCardModel;
  incident: Pick<TrafficIncident, "kind" | "category"> | null;
  size: number;
  ring: number;
}) {
  const official = card.alertType ? null : incident ? incidentStyle(incident) : null;
  if (official) {
    // Official hazards are the warning triangle, as on the map.
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} testID="alert-card-icon">
        <HazardTriangleArt size={size} fill={official.color} glyphColor={official.glyph} glyph={official.icon} />
      </View>
    );
  }
  const fill = card.alertType ? ALERT_PIN[card.alertType].fill : "#5F6368";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ring,
        borderColor: "#FFFFFF",
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
      }}
      testID="alert-card-icon"
    >
      {card.alertType ? (
        <AlertTypeGlyph type={card.alertType} size={size * 0.5} color={ALERT_PIN[card.alertType].glyph} />
      ) : (
        <Icon name="warning" size={size * 0.48} color="#FFFFFF" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, zIndex: 40 },
  card: {
    backgroundColor: ALERT_CARD_BG,
    boxShadow: "0px 6px 18px rgba(0,0,0,0.35)",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  textCol: { flex: 1, minWidth: 0 },
  title: { color: "#FFFFFF", fontWeight: "400" },
  distance: { color: "#FFFFFF", fontWeight: "700" },
  place: { color: "#FFFFFF", fontWeight: "500", marginTop: 2 },
  note: { color: "#E8EAED", fontWeight: "400", fontStyle: "italic" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  fact: { color: "#E8EAED", fontWeight: "400" },
  factLabel: { color: "#BDC1C6", fontWeight: "500" },
  byline: { color: "#BDC1C6", fontWeight: "400", flexShrink: 1 },
  thanks: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: THANKS_BLUE },
  thanksDone: { opacity: 0.75 },
  thanksOwn: { backgroundColor: "#5F6368" },
  thanksCount: { color: "#FFFFFF", fontWeight: "700" },
});
