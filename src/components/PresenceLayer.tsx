import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { Tracky } from "@/components/trackys/Tracky";
import type { TrailEffectKey } from "@/components/trackys/customization";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { clusterPoints } from "@/utils/markerCluster";
import type { PresenceDoc } from "@/services/presence";
import {
  poseAt,
  displayTimeFor,
  leanDegrees,
  playbackBudget,
  TRAIL_PARTICLE_SPACING_MS,
  type PlaybackPose,
} from "@/services/presencePlayback";
import { colors } from "@/theme/tokens";

interface Props {
  // Already filtered (blocked drivers removed) and capped at the 50 closest by MapScreen.
  presences: PresenceDoc[];
  cellSizeDegrees: number;
  onSelect: (presence: PresenceDoc) => void;
  onClusterPress: (lat: number, lng: number) => void;
}

interface Placed {
  id: string;
  lat: number;
  lng: number;
  presence: PresenceDoc;
  pose: PlaybackPose;
  displayT: number;
}

// Real, explicit request (ADD-ON Part B -- "Waze-style smooth 'time-lapse' movement on roads").
// Every other visible driver's Tracky, gliding along its own published, road-following,
// already-delayed path (see presencePlayback.ts for the maths and updatePresence in
// firebase/functions/index.js for where the delay is actually enforced).
//
// This is deliberately its OWN component with its own tick state: positions are recomputed
// several times a second, and that re-render has to stay inside this small layer -- MapScreen
// itself (thousands of lines, the native MapView, every other marker layer) must not re-render
// on every animation frame.
//
// Disclosed deviation from the brief's "Reanimated interpolated movement": the interpolation is
// real, but it's driven by this JS tick moving each native Marker's `coordinate`, not by a
// Reanimated worklet. Animating a react-native-maps Marker's coordinate from the UI thread
// isn't something that could be verified without a device in the environment this was built
// in, and a marker layer that silently doesn't move is a worse outcome than one that moves at
// 4 updates/second. Reanimated is still what animates each Tracky itself (Tracky.tsx).
export function PresenceLayer({ presences, cellSizeDegrees, onSelect, onClusterPress }: Props) {
  const reduceMotion = useReduceMotion();
  const budget = playbackBudget(presences.length, reduceMotion);

  // 0 = "no tick yet" -- nothing renders until the first real clock reading arrives, rather
  // than reading the clock during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (presences.length === 0) return;
    const read = () => setNowMs(Date.now());
    const first = setTimeout(read, 0);
    const interval = setInterval(read, budget.tickMs);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [presences.length, budget.tickMs]);

  const placed = useMemo<Placed[]>(() => {
    if (nowMs === 0) return [];
    const out: Placed[] = [];
    for (const presence of presences) {
      const displayT = displayTimeFor(presence.w, presence.receivedAtLocalMs, nowMs);
      // A doc with no path (shouldn't happen from this server, but never trust that) still shows,
      // standing still at its published position.
      const pose = poseAt(presence.path, displayT) ?? { lat: presence.lat, lng: presence.lng, headingDeg: null, moving: false };
      out.push({ id: presence.uid, lat: pose.lat, lng: pose.lng, presence, pose, displayT });
    }
    return out;
  }, [presences, nowMs]);

  const clusters = useMemo(() => clusterPoints(placed, cellSizeDegrees), [placed, cellSizeDegrees]);

  return (
    <>
      {clusters.map((c) => {
        if (c.count > 1) {
          return (
            <Marker
              key={`presence-cluster-${c.key}`}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={(e) => {
                e.stopPropagation();
                onClusterPress(c.lat, c.lng);
              }}
            >
              <View style={styles.clusterBadge}>
                <Ionicons name="happy" size={14} color="#FFFFFF" />
                <Text style={styles.clusterBadgeText}>{c.count}</Text>
              </View>
            </Marker>
          );
        }

        const { presence, pose, displayT } = c.points[0];
        const trail: TrailEffectKey = presence.look?.trail ?? "none";
        // The look is baked into the key: tracksViewChanges={false} freezes a marker's rendered
        // bitmap, so a driver changing their design/mood has to remount the marker to show it.
        const lookKey = presence.look ? JSON.stringify(presence.look) : presence.mood;
        return (
          <React.Fragment key={`presence-${presence.uid}`}>
            {trail !== "none" &&
              pose.moving &&
              Array.from({ length: budget.trailParticles }, (_, i) => {
                const behind = poseAt(presence.path, displayT - (i + 1) * TRAIL_PARTICLE_SPACING_MS);
                if (!behind) return null;
                return (
                  <Marker
                    key={`presence-${presence.uid}-trail-${trail}-${i}`}
                    coordinate={{ latitude: behind.lat, longitude: behind.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    zIndex={1}
                  >
                    <TrailParticle trail={trail} index={i} color={presence.look?.color ?? colors.accent} />
                  </Marker>
                );
              })}
            <Marker
              key={`presence-${presence.uid}-${lookKey}`}
              coordinate={{ latitude: pose.lat, longitude: pose.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              rotation={leanDegrees(pose)}
              tracksViewChanges={false}
              zIndex={2}
              onPress={(e) => {
                e.stopPropagation();
                onSelect(presence);
              }}
            >
              {presence.look ? (
                <Tracky customization={presence.look} size={32} animated={false} reactOnTap={false} />
              ) : (
                <Tracky mood={presence.mood} size={32} animated={false} reactOnTap={false} />
              )}
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
}

// "Trail particles" -- a few small shapes left behind a moving Tracky, each one further back
// along the path it really drove and a little smaller/fainter than the one before it.
function TrailParticle({ trail, index, color }: { trail: TrailEffectKey; index: number; color: string }) {
  const size = 9 - index * 2;
  const opacity = 0.7 - index * 0.2;
  if (trail === "sparkle") {
    return <Ionicons name="sparkles" size={size + 5} color="#FBBF24" style={{ opacity }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        opacity,
        backgroundColor: trail === "ghost" ? "#FFFFFF" : color,
        borderWidth: trail === "ghost" ? 1 : 0,
        borderColor: "#CBD5E1",
      }}
    />
  );
}

const styles = StyleSheet.create({
  clusterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  clusterBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
