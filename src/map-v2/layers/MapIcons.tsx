import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { loadMapbox } from "@/map-v2/mapbox";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { CarNavArrow } from "@/components/LocationMarkers";
import { CheckeredFlagPin, StartDot } from "@/components/RouteSelection";
import { Tracky } from "@/components/trackys/Tracky";
import type { TrackyMoodKey } from "@/components/trackys/moods";
import type { TrackyCustomization } from "@/components/trackys/customization";
import { ALERT_PIN, type AlertType } from "@/types/alert";
import { SPEED_CAMERA_MARKER, TRAFFIC_LIGHT_MARKER } from "@/utils/osmMarkerStyle";
import { HazardTriangleArt, RoadFeatureArt, RoadMarkArt, SpeedCameraArt, TrafficLightArt } from "@/components/art/RoadSignArt";
import { AheadGlyph } from "@/components/art/AheadGlyph";
import type { AheadKind } from "@/nav/ahead/aheadKinds";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { colors } from "@/theme/tokens";
import { AHEAD_COLOURS, LIVE_TRAFFIC_BADGE, MAP_DOT, ROAD_SIGN_ART } from "@/theme/colors";
import { Icon, isIconName } from "@/components/ui/Icon";
import { Text } from "@/components/AppText";
import { BADGE_COLOURS, type BadgeCategory } from "@/map/poiBadges";
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";

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
    case "alert-mid": {
      // Mid zoom (map/zoomStates.ts): the report's badge without its pointer (drawn at 60%).
      const type = rest[0] as AlertType;
      const pin = ALERT_PIN[type];
      return (
        <Badge color={pin?.fill ?? colors.text} size={30}>
          <AlertTypeGlyph type={type} size={17} color={pin?.glyph ?? "#FFFFFF"} />
        </Badge>
      );
    }
    case "dot": {
      // Far zoom: a small dot in the report's meaning colour with a white ring.
      const c = MAP_DOT[rest[0] as keyof typeof MAP_DOT] ?? MAP_DOT.other;
      return <View testID={`map-dot-${rest[0]}`} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c, borderWidth: 1.5, borderColor: MAP_DOT.ring }} />;
    }
    case "traffic-light":
      // Our own little traffic light (components/art/RoadSignArt.tsx).
      return <TrafficLightArt height={30} />;
    case "speed-camera":
      return <SpeedCameraArt size={30} />;
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
    case "feature": {
      // "feature:<reportItemId>" -- a Settings > Reports item from OpenStreetMap (a railway
      // crossing, a red light camera ...): that item's own colour and glyph, small.
      const item = REPORT_ITEM_BY_ID[rest[0] as ReportItemId];
      if (!item) return null;
      if (item.id === "trafficLights") return <TrafficLightArt height={30} />;
      if (item.section === "speedCameras" || item.section === "laneCameras" || item.section === "behaviourCameras") {
        // Every camera is the camera sign, with what it checks in a small corner badge.
        const badge = item.icon.badge;
        return (
          <View style={styles.cameraWrap}>
            <SpeedCameraArt size={30} />
            {badge && (
              <View style={styles.cameraBadge}>
                <MaterialCommunityIcons name={badge as never} size={10} color={item.icon.colour} />
              </View>
            )}
          </View>
        );
      }
      return (
        <Badge color={item.icon.colour} size={24} border={1.5}>
          <MaterialCommunityIcons name={item.icon.glyph as never} size={14} color="#FFFFFF" />
        </Badge>
      );
    }
    case "road-feature": {
      // A road feature at street zoom: small, grey, its own drawing (map/roadSignVisibility.ts).
      const item = REPORT_ITEM_BY_ID[rest[0] as ReportItemId];
      if (!item) return null;
      return (
        <RoadFeatureArt
          speedBump={item.id === "speedBump"}
          glyph={<MaterialCommunityIcons name={item.icon.glyph as never} size={11} color={ROAD_SIGN_ART.featureGlyph} />}
        />
      );
    }
    case "road-mark":
      return <RoadMarkArt />;
    case "saved": {
      // "saved:home|work|custom" -- your own saved places.
      const name = rest[0] === "home" ? "home" : rest[0] === "work" ? "briefcase" : "star";
      return (
        <View style={styles.column}>
          <Badge color={colors.accent} size={28}>
            <Icon name={name} size={15} color="#FFFFFF" />
          </Badge>
          <View style={[styles.pointer, { borderTopColor: colors.accent }]} />
        </View>
      );
    }
    case "parking":
      // Your parking spot: a P.
      return (
        <View style={styles.column}>
          <View style={[styles.square, { backgroundColor: colors.accent }]}>
            <Text style={styles.squareLetter}>P</Text>
          </View>
          <View style={[styles.pointer, { borderTopColor: colors.accent }]} />
        </View>
      );
    case "live-camera":
      return (
        <Badge color={colors.accent} size={26}>
          <Ionicons name="videocam" size={16} color="#FFFFFF" />
        </Badge>
      );
    case "incident": {
      // An official NSW / Australian government hazard, roadwork, closure or crash: a warning
      // triangle in its type's colour with its glyph, and a small white "i" saying it's official.
      const [color, glyph, , icon, major] = rest;
      const size = major === "1" ? 36 : 30;
      const name = isIconName(icon) ? icon : "warning";
      return (
        <View style={{ width: size + 6, height: size + 4, alignItems: "center", justifyContent: "flex-end" }}>
          <HazardTriangleArt size={size} fill={color} glyphColor={glyph} glyph={name} />
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>i</Text>
          </View>
        </View>
      );
    }
    case "ahead": {
      // An ahead alert at its exact spot on the route (nav/ahead): a raised pin -- round icon in
      // the kind's meaning colour with a white ring, a pointer, and a small shadow base.
      const kind = rest[0] as AheadKind;
      const c = AHEAD_COLOURS[kind];
      if (!c) return null;
      return (
        <View style={styles.column} testID={`ahead-pin-${kind}`}>
          <View style={[styles.aheadPin, { backgroundColor: c.fill }]}>
            <AheadGlyph kind={kind} size={20} color={c.glyph} />
          </View>
          <View style={[styles.pointer, { borderTopColor: c.fill }]} />
          <View style={styles.aheadBase} />
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
    case "badge": {
      // Brand & popular places (map/poiBadges.ts): a rounded square with a pointer and our own
      // category glyph -- never a brand's logo (those only for signed partners, "logo:<brand>").
      const category = rest[0] as BadgeCategory;
      const fill = BADGE_COLOURS[category];
      if (!fill) return null;
      const glyph = BADGE_GLYPH[category];
      return (
        <View style={styles.column}>
          <View style={[styles.square, { backgroundColor: fill }]}>
            {glyph.icon ? <Icon name={glyph.icon} size={15} color="#FFFFFF" /> : <Text style={styles.squareLetter}>{glyph.letter}</Text>}
          </View>
          <View style={[styles.pointer, { borderTopColor: fill }]} />
        </View>
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

const BADGE_GLYPH: Record<BadgeCategory, { icon?: "gas-station" | "cart" | "coffee" | "restaurant" | "shopping-bag"; letter?: string }> = {
  fuel: { icon: "gas-station" },
  hospital: { letter: "H" },
  cart: { icon: "cart" },
  cup: { icon: "coffee" },
  fork: { icon: "restaurant" },
  bag: { icon: "shopping-bag" },
  parking: { letter: "P" },
};

const styles = StyleSheet.create({
  column: { alignItems: "center" },
  square: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  squareLetter: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
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
  aheadPin: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  aheadBase: { width: 12, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: "rgba(16,24,40,0.35)" },
  cameraWrap: { width: 36, height: 36, alignItems: "flex-start", justifyContent: "flex-end" },
  cameraBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
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
});
