import React, { useEffect, useMemo, useState } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { PinLayer } from "@/map-v2/layers/PinLayer";
import { collection, pointFeature, type LatLng } from "@/map-v2/geo";
import type { MapPin } from "@/map-v2/pins";
import { clusterPoints } from "@/utils/markerCluster";
import type { PresenceDoc } from "@/services/presence";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { poseAt, displayTimeFor, leanDegrees, playbackBudget, TRAIL_PARTICLE_SPACING_MS } from "@/services/presencePlayback";
import { colors } from "@/theme/tokens";

// Other drivers' Trackys on the Mapbox map, each gliding along the road path it really drove
// (services/presencePlayback.ts), grouped into a counted bubble where several overlap. Same
// maths as the old layer; drawn as one symbol layer plus one circle layer for the trail dots,
// re-rendered only inside this component on its own tick.

interface Props {
  presences: PresenceDoc[];
  cellSizeDegrees: number;
  onSelect: (presence: PresenceDoc) => void;
  onClusterPress: (lat: number, lng: number) => void;
}

export function presenceIconName(p: PresenceDoc): string {
  return `tracky:${p.uid}`;
}

export function PresenceLayerV2({ presences, cellSizeDegrees, onSelect, onClusterPress }: Props) {
  const Mapbox = loadMapbox();
  const reduceMotion = useReduceMotion();
  const budget = playbackBudget(presences.length, reduceMotion);
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

  const placed = useMemo(() => {
    if (nowMs === 0) return [];
    return presences.map((presence) => {
      const displayT = displayTimeFor(presence.w, presence.receivedAtLocalMs, nowMs);
      const pose = poseAt(presence.path, displayT) ?? { lat: presence.lat, lng: presence.lng, headingDeg: null, moving: false };
      return { id: presence.uid, lat: pose.lat, lng: pose.lng, presence, pose, displayT };
    });
  }, [presences, nowMs]);

  const clusters = useMemo(() => clusterPoints(placed, cellSizeDegrees), [placed, cellSizeDegrees]);

  const pins = useMemo<MapPin[]>(
    () =>
      clusters.map((c) =>
        c.count > 1
          ? { id: `presence-cluster:${c.lat},${c.lng}`, coordinate: { latitude: c.lat, longitude: c.lng }, icon: "presence-cluster", label: String(c.count), priority: 40 }
          : {
              id: `presence:${c.points[0].presence.uid}`,
              coordinate: { latitude: c.points[0].lat, longitude: c.points[0].lng },
              icon: presenceIconName(c.points[0].presence),
              rotate: leanDegrees(c.points[0].pose),
              priority: 41,
            }
      ),
    [clusters]
  );

  // Trail dots behind moving drivers who picked a trail, each a little smaller further back.
  const trail = useMemo(() => {
    const features = [];
    for (const c of clusters) {
      if (c.count !== 1) continue;
      const { presence, pose, displayT } = c.points[0];
      if ((presence.look?.trail ?? "none") === "none" || !pose.moving) continue;
      for (let i = 0; i < budget.trailParticles; i++) {
        const behind = poseAt(presence.path, displayT - (i + 1) * TRAIL_PARTICLE_SPACING_MS);
        if (!behind) continue;
        const at: LatLng = { latitude: behind.lat, longitude: behind.lng };
        features.push(pointFeature(`${presence.uid}-t${i}`, at, { r: 5 - i, color: presence.look?.color ?? colors.accent, o: 0.7 - i * 0.15 }));
      }
    }
    return collection(features);
  }, [clusters, budget.trailParticles]);

  if (!Mapbox) return null;
  const { ShapeSource, CircleLayer } = Mapbox;
  const onPress = (pinId: string) => {
    if (pinId.startsWith("presence-cluster:")) {
      const [lat, lng] = pinId.slice("presence-cluster:".length).split(",").map(Number);
      onClusterPress(lat, lng);
      return;
    }
    const uid = pinId.slice("presence:".length);
    const presence = presences.find((p) => p.uid === uid);
    if (presence) onSelect(presence);
  };

  return (
    <>
      {trail.features.length > 0 && (
        <ShapeSource id="presence-trail-src" shape={trail as never}>
          <CircleLayer
            id="presence-trail"
            style={{ circleRadius: ["get", "r"], circleColor: ["get", "color"], circleOpacity: ["get", "o"] }}
          />
        </ShapeSource>
      )}
      <PinLayer id="presence" pins={pins} onPress={onPress} />
    </>
  );
}
