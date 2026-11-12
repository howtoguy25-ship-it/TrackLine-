import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { loadMapbox } from "@/map-v2/mapbox";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { CarNavArrow, PersonLocationDot } from "@/components/LocationMarkers";
import { CheckeredFlagPin, StartDot } from "@/components/RouteSelection";
import { Tracky } from "@/components/trackys/Tracky";
import type { TrackyMoodKey } from "@/components/trackys/moods";
import type { TrackyCustomization } from "@/components/trackys/customization";
import { ALERT_PIN, type AlertType } from "@/types/alert";
import { SPEED_CAMERA_MARKER, TRAFFIC_LIGHT_MARKER } from "@/utils/osmMarkerStyle";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { colors } from "@/theme/tokens";
import { LIVE_TRAFFIC_BADGE } from "@/theme/colors";
import { Icon, isIconName } from "@/components/ui/Icon";
import { Text } from "@/components/AppText";

// Every icon the Mapbox map draws, each one an ordinary React view rendered ONCE into a map
// image (Mapbox's Images/Image), then reused by any number of pins through the SymbolLayer.
// That keeps hundreds of pins cheap -- they're one native layer, not hundreds of views.
//
// An icon is named by what it shows, e.g. "alert:POLICE", "fuel", "incident:#F5A623:#1F2125:circle:flame:1".
// `iconView(name)` turns a name back into its view; unknown names get nothing.

const CLUSTER_COLORS: Record<string, string> = {
  "alert-cluster": colors.text,
  "traffic-light-cluster": TRAFFIC_LIGHT_MARKER.color,
  "speed-camera-cluster": SPEED_CAMERA_MARKER.color,
  "fuel-cluster": "#16A34A",
  "restaurant-cluster": "#F97316",
  "hotel-cluster": "#6366F1",
  "presence-cluster": colors.accent,
};

function Badge({ color, size, children, border = 2 }: { color: string; size: number; children?: React.ReactNode; border?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: border }]}>
      {children}
    </View>
  );
}

/** The view for one icon name, or null if the name isn't one this map knows. */
export function iconView(name: string, extras: IconExtras = {}): React.ReactElement | null {
  const [kind, ...rest] = name.split(":");
  switch (kind) {
    case "alert": {
      const type = rest[0] as AlertType;
      const pin = ALERT_PIN[type];
      const color = pin?.fill ?? colors.text;
      return (
        <View style={styles.column}>
          <Badge color={color} size={30}>
            <AlertTypeGlyph type={type} size={17} color={pin?.glyph ?? "#FFFFFF"} />
          </Badge>
          <View style={[styles.pointer, { borderTopColor: color }]} />
        </View>
      );
    }
    case "traffic-light":
      return (
        <Badge color={TRAFFIC_LIGHT_MARKER.color} size={TRAFFIC_LIGHT_MARKER.badgeSize} border={1.5}>
          <MaterialCommunityIcons name={TRAFFIC_LIGHT_MARKER.icon} size={TRAFFIC_LIGHT_MARKER.glyphSize} color="#FFFFFF" />
        </Badge>
      );
    case "speed-camera":
      return (
        <Badge color={SPEED_CAMERA_MARKER.color} size={SPEED_CAMERA_MARKER.badgeSize}>
          <MaterialCommunityIcons name={SPEED_CAMERA_MARKER.icon} size={SPEED_CAMERA_MARKER.glyphSize} color="#FFFFFF" />
        </Badge>
      );
    case "fuel":
      return (
        <Badge color="#16A34A" size={30}>
          <MaterialCommunityIcons name="gas-station" size={16} color="#FFFFFF" />
        </Badge>
      );
    case "restaurant":
      return (
        <Badge color="#F97316" size={30}>
          <Ionicons name="restaurant" size={15} color="#FFFFFF" />
        </Badge>
      );
    case "hotel":
      return (
        <Badge color="#6366F1" size={30}>
          <Ionicons name="bed" size={15} color="#FFFFFF" />
        </Badge>
      );
    case "live-camera":
      return (
        <Badge color={colors.accent} size={26}>
          <Ionicons name="videocam" size={16} color="#FFFFFF" />
        </Badge>
      );
    case "incident": {
      // A Live Traffic NSW report: its type's colour and shape (roadwork is a diamond, the rest
      // circles) with a small white "i" badge saying where it came from.
      const [color, glyph, shape, icon, major] = rest;
      const big = major === "1";
      const size = big ? 32 : 26;
      const diamond = shape === "diamond";
      const name = isIconName(icon) ? icon : "warning";
      return (
        <View style={{ width: size + 8, height: size + 8, alignItems: "center", justifyContent: "center" }}>
          <View
            style={[
              styles.incident,
              { width: size, height: size, backgroundColor: color, borderRadius: diamond ? 6 : size / 2 },
              diamond && styles.diamond,
            ]}
          >
            <View style={diamond ? styles.unrotate : undefined}>
              <Icon name={name} size={big ? 17 : 14} color={glyph} strokeWidth={2.25} />
            </View>
          </View>
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>i</Text>
          </View>
        </View>
      );
    }
    case "place-page":
      return (
        <View style={styles.placePin}>
          <View style={styles.placePinDot} />
        </View>
      );
    case "origin":
      return <Ionicons name="location" size={40} color={colors.accent} />;
    case "flag":
      return <CheckeredFlagPin />;
    case "start":
      return <StartDot />;
    case "car-arrow":
      return <CarNavArrow markerStyle={(rest[0] as MapMarkerStyleKey) ?? "default"} />;
    case "blank":
      return <View style={styles.blank} />;
    case "person-dot":
      return <PersonLocationDot />;
    case "heading-cone":
      return <View style={styles.cone} />;
    case "ghost-badge":
      return <Tracky mood="spooky" size={28} animated={false} reactOnTap={false} translucent />;
    case "tracky": {
      // "tracky:<uid>" -- the look comes from extras, since it's a whole customisation object.
      const look = extras.trackyLooks?.[rest.join(":")];
      if (!look) return null;
      return look.customization ? (
        <Tracky customization={look.customization} size={32} animated={false} reactOnTap={false} />
      ) : (
        <Tracky mood={look.mood ?? "chill"} size={32} animated={false} reactOnTap={false} />
      );
    }
    default:
      if (CLUSTER_COLORS[kind]) return <Badge color={CLUSTER_COLORS[kind]} size={30} />;
      return null;
  }
}

export interface IconExtras {
  /** Per-driver Tracky looks for "tracky:<uid>" icons. */
  trackyLooks?: Record<string, { customization?: TrackyCustomization; mood?: TrackyMoodKey }>;
}

/** Registers the named icons with the map. Render it inside TrackLineMap. */
export function MapIcons({ names, extras }: { names: readonly string[]; extras?: IconExtras }) {
  const Mapbox = loadMapbox();
  if (!Mapbox || names.length === 0) return null;
  const { Images, Image } = Mapbox;
  return (
    <Images>
      {names.flatMap((name) => {
        const view = iconView(name, extras);
        return view
          ? [
              <Image key={name} name={name}>
                {view}
              </Image>,
            ]
          : [];
      })}
    </Images>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: "center" },
  blank: { width: 1, height: 1, opacity: 0 },
  badge: { borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  pointer: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  incident: { borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  diamond: { transform: [{ rotate: "45deg" }] },
  unrotate: { transform: [{ rotate: "-45deg" }] },
  infoBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LIVE_TRAFFIC_BADGE.fill,
    borderWidth: 1,
    borderColor: "rgba(16,24,40,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  infoBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: "700", fontStyle: "italic", color: LIVE_TRAFFIC_BADGE.glyph },
  placePin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E5342B",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  placePinDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FFFFFF" },
  cone: {
    width: 0,
    height: 0,
    borderLeftWidth: 26,
    borderRightWidth: 26,
    borderTopWidth: 46,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(20, 184, 166, 0.28)",
  },
});
