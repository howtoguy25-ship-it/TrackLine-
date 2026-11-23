import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { RouteTimeBubble } from "@/components/RouteSelection";
import { Tracky } from "@/components/trackys/Tracky";
import { RouteLine } from "@/map-v2/layers/RouteLine";
import { PinLayer } from "@/map-v2/layers/PinLayer";
import { MarkerPin } from "@/map-v2/layers/MarkerPin";
import { SchoolZoneLayer, type SchoolZoneDrawing } from "@/map-v2/layers/SchoolZoneLayer";
import { MapIcons, type IconExtras } from "@/map-v2/layers/MapIcons";
import { UserArrow } from "@/map-v2/layers/UserArrow";
import { PresenceLayerV2, presenceIconName } from "@/map-v2/layers/PresenceLayerV2";
import { turnArrowAt, type LatLng } from "@/map-v2/geo";
import { iconsUsed, type MapPin } from "@/map-v2/pins";
import { BADGE_CATEGORIES, badgeIconName } from "@/map/poiBadges";
import type { PresenceDoc } from "@/services/presence";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { colors, radius, shadow, spacing } from "@/theme/tokens";
import { AHEAD_COLOURS, GREEN, LAVENDER, PURPLE_BRIGHT, TRAFFIC } from "@/theme/colors";

// Everything drawn on the Mapbox map, from plain data the map screen already works out: the
// route being driven (travelled part faded, turn callouts, the turn arrow), route choices
// (purple/lavender lines, traffic, time bubbles, start and finish), the driver, other drivers,
// and every icon pin. MapScreen owns the state and the handlers; this only draws.

const ROUTE_PURPLE = colors.routePurple;
const ROUTE_PURPLE_CASING = colors.routePurpleCasing;
/** The live route is wider than in the preview so it reads at a glance while driving. */
export const NAV_ROUTE_WIDTH = 11;
const ROUTE_ALT = colors.routeAlt;
// Traffic on a route: slow amber, heavy red (free-flowing stretches aren't coloured). A faster
// route on offer is "good" green.
const TRAFFIC_SLOW = TRAFFIC.slow;
const TRAFFIC_JAM = TRAFFIC.heavy;
const SUGGESTION_GREEN = GREEN;

export interface RouteSelectionDrawing {
  drawn: { index: number; line: LatLng[] }[];
  selectedIndex: number;
  selectedLine: LatLng[] | null;
  trafficStretches: { coordinates: LatLng[]; speed: "SLOW" | "TRAFFIC_JAM" }[];
  bubbles: { index: number; coordinate: LatLng; timeText: string; tag: string | null; selected: boolean; key: string }[];
  start: LatLng | null;
  destination: LatLng | null;
  onSelect: (index: number) => void;
}

export interface UserDrawing {
  coordinate: LatLng;
  /** null = no heading yet (the arrow keeps its last direction). */
  heading: number | null;
  accuracyMeters: number | null;
  deviceHeading: number | null;
  navigating: boolean;
  markerStyle: MapMarkerStyleKey;
  ghost: boolean;
  /** The fix's own timestamp (orders fixes for the arrow's easing). */
  fixTimeMs?: number;
}

interface Props {
  /** The full route being driven (for the faded travelled part) and what's left of it. */
  navRoute: LatLng[] | null;
  remaining: LatLng[];
  onRoutePress?: () => void;
  turnCallouts: { key: string; coordinate: LatLng; text: string }[];
  /** The next turn point, for the arrow drawn on the route. */
  nextTurn: LatLng | null;
  stopPreview: LatLng[] | null;
  trafficSuggestion: { line: LatLng[]; etaText: string; labelPoint: LatLng | null } | null;
  user: UserDrawing | null;
  presences: PresenceDoc[];
  presenceCellSize: number;
  onSelectPresence: (p: PresenceDoc) => void;
  onPresenceCluster: (lat: number, lng: number) => void;
  selection: RouteSelectionDrawing | null;
  /** While driving, the Routes button's other ways there: line, "+2 min" bubble, tap to switch. */
  navAlternatives?: { key: string; line: LatLng[]; label: string; onPress: () => void }[];
  /** The destination while navigating. */
  arrival: LatLng | null;
  pins: MapPin[];
  onPinPress: (pinId: string) => void;
  selectedComment: { coordinate: LatLng; text: string } | null;
  /** During the approach view: the road through the manoeuvre, the road taken, and the label. */
  manoeuvre?: { through: LatLng[]; exitSide: LatLng[]; callout: { coordinate: LatLng; text: string } | null } | null;
  /** While driving: live traffic on the route still ahead (slow amber, stopped red, over its length). */
  navTraffic?: { coordinates: LatLng[]; speed: "SLOW" | "TRAFFIC_JAM" }[];
  /** Closed stretches on the route (nav/closures.ts), drawn in the closure colour over it. */
  closedStretches?: LatLng[][];
  /** Official school zones nearby (Settings > Road features > School zones > Show on map). */
  schoolZones?: SchoolZoneDrawing[];
}

const FIXED_ICONS = [
  "blank",
  // The brand & popular-place badges the base style draws (map/poiBadges.ts).
  ...BADGE_CATEGORIES.map(badgeIconName),
  "flag",
  "start",
  "alert-cluster",
  "traffic-light-cluster",
  "speed-camera-cluster",
  "fuel-cluster",
  "restaurant-cluster",
  "hotel-cluster",
  "presence-cluster",
];

export function MapboxLayers(props: Props) {
  const { user, selection } = props;
  // The default is our bundled arrow (UserArrow); a chosen vehicle badge is drawn by MapIcons.
  const markerIcon = user && user.markerStyle !== "default" ? `car-arrow:${user.markerStyle}` : null;

  const iconNames = useMemo(
    () => Array.from(new Set([...FIXED_ICONS, ...(markerIcon ? [markerIcon] : []), ...iconsUsed(props.pins), ...props.presences.map(presenceIconName)])),
    [markerIcon, props.pins, props.presences]
  );
  const extras = useMemo<IconExtras>(
    () => ({
      trackyLooks: Object.fromEntries(props.presences.map((p) => [p.uid, { customization: p.look, mood: p.mood }])),
    }),
    [props.presences]
  );

  const turnArrow = useMemo(
    () => (props.nextTurn && props.remaining.length > 1 ? turnArrowAt(props.remaining, props.nextTurn) : []),
    [props.nextTurn, props.remaining]
  );

  const start = selection?.start ?? null;
  const finish = selection?.destination ?? null;
  const arrival = props.arrival;
  const destinationPins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    if (start) out.push({ id: "route-start", coordinate: start, icon: "start", priority: 50 });
    if (finish) out.push({ id: "route-flag", coordinate: finish, icon: "flag", anchor: "bottom", priority: 51 });
    if (arrival) out.push({ id: "arrival-flag", coordinate: arrival, icon: "flag", anchor: "bottom", priority: 51 });
    return out;
  }, [start, finish, arrival]);

  return (
    <>
      <MapIcons names={iconNames} extras={extras} />

      {/* Navigation: ONE purple line with one dark casing, from the arrow onwards (the part
          already driven isn't drawn; it used to sit under the white-cased line ahead and look
          doubled). Wider than in the preview. */}
      {(props.navAlternatives ?? []).map((a) => (
        <RouteLine key={a.key} id={`nav-${a.key}`} coordinates={a.line} color={ROUTE_ALT} width={7} hitbox={44} onPress={a.onPress} />
      ))}
      {props.remaining.length > 1 && (
        <RouteLine
          id="nav-route"
          coordinates={props.remaining}
          color={ROUTE_PURPLE}
          width={NAV_ROUTE_WIDTH}
          casingColor={ROUTE_PURPLE_CASING}
          casingWidth={NAV_ROUTE_WIDTH + 4}
          onPress={props.onRoutePress}
        />
      )}
      {props.remaining.length > 1 &&
        (props.navTraffic ?? []).map((t, i) =>
          t.coordinates.length > 1 ? (
            <RouteLine
              key={`nav-traffic-${i}`}
              id={`nav-traffic-${i}`}
              coordinates={t.coordinates}
              color={t.speed === "TRAFFIC_JAM" ? TRAFFIC_JAM : TRAFFIC_SLOW}
              width={NAV_ROUTE_WIDTH - 3}
              aboveLayerID="nav-route-line"
            />
          ) : null
        )}
      {props.remaining.length > 1 &&
        (props.closedStretches ?? []).map((line, i) =>
          line.length > 1 ? (
            <RouteLine key={`nav-closed-${i}`} id={`nav-closed-${i}`} coordinates={line} color={AHEAD_COLOURS.closure.fill} width={NAV_ROUTE_WIDTH} casingColor="#FFFFFF" casingWidth={NAV_ROUTE_WIDTH + 4} aboveLayerID="nav-route-line" />
          ) : null
        )}
      {turnArrow.length > 1 && (
        <RouteLine id="nav-turn-arrow" coordinates={turnArrow} color="#FFFFFF" width={5} casingColor={ROUTE_PURPLE_CASING} casingWidth={9} aboveLayerID="nav-route-line" />
      )}
      {props.schoolZones && props.schoolZones.length > 0 && <SchoolZoneLayer zones={props.schoolZones} />}
      {/* Approach view: a soft glow on the road being taken, and the route through the split
          wider and brighter on top of the normal route. */}
      {props.manoeuvre && props.manoeuvre.exitSide.length > 1 && (
        <RouteLine id="manoeuvre-glow" coordinates={props.manoeuvre.exitSide} color={LAVENDER} width={26} opacity={0.4} />
      )}
      {props.manoeuvre && props.manoeuvre.through.length > 1 && (
        <RouteLine
          id="manoeuvre-through"
          coordinates={props.manoeuvre.through}
          color={PURPLE_BRIGHT}
          width={12}
          casingColor="#FFFFFF"
          casingWidth={18}
          aboveLayerID="nav-route-line"
        />
      )}
      {props.stopPreview && <RouteLine id="stop-preview" coordinates={props.stopPreview} color={SUGGESTION_GREEN} width={7} />}
      {props.trafficSuggestion && (
        <RouteLine id="traffic-suggestion" coordinates={props.trafficSuggestion.line} color={SUGGESTION_GREEN} width={7} />
      )}

      {/* Route choices: alternatives lavender and tappable, the selected one purple on top of
          them with its slow and jammed stretches over it. */}
      {selection?.drawn
        .filter((d) => d.index !== selection.selectedIndex)
        .map((d) => (
          <RouteLine key={`alt-${d.index}`} id={`route-alt-${d.index}`} coordinates={d.line} color={ROUTE_ALT} width={6} hitbox={44} onPress={() => selection.onSelect(d.index)} />
        ))}
      {selection?.selectedLine && (
        <RouteLine id="route-selected" coordinates={selection.selectedLine} color={ROUTE_PURPLE} width={8} casingColor={ROUTE_PURPLE_CASING} casingWidth={12} />
      )}
      {selection?.trafficStretches.map((s, i) => (
        <RouteLine
          key={`traffic-${i}`}
          id={`route-traffic-${i}`}
          coordinates={s.coordinates}
          color={s.speed === "TRAFFIC_JAM" ? TRAFFIC_JAM : TRAFFIC_SLOW}
          width={8}
          aboveLayerID="route-selected-line"
        />
      ))}

      <PinLayer id="pins" pins={props.pins} onPress={props.onPinPress} />
      <PinLayer id="route-ends" pins={destinationPins} />
      <PresenceLayerV2
        presences={props.presences}
        cellSizeDegrees={props.presenceCellSize}
        onSelect={props.onSelectPresence}
        onClusterPress={props.onPresenceCluster}
      />

      {user && (
        <UserArrow coordinate={user.coordinate} heading={user.heading} accuracyMeters={user.accuracyMeters} markerIcon={markerIcon} fixTimeMs={user.fixTimeMs} />
      )}

      {/* The few things that are text: callouts, bubbles, a report's comment. */}
      {props.turnCallouts.map((c) => (
        <MarkerPin key={c.key} coordinate={c.coordinate} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.turnCallout}>
            <Text style={styles.turnCalloutText} numberOfLines={1}>
              {c.text}
            </Text>
          </View>
        </MarkerPin>
      ))}
      {(props.navAlternatives ?? []).map((a) => {
        const at = a.line[Math.floor(a.line.length / 2)];
        return at ? (
          <MarkerPin key={`nav-alt-bubble-${a.key}`} coordinate={at} anchor={{ x: 0.5, y: 1 }} onPress={a.onPress}>
            <RouteTimeBubble timeText={a.label} tag={null} selected={false} />
          </MarkerPin>
        ) : null;
      })}
      {selection?.bubbles.map((b) => (
        <MarkerPin key={`bubble-${b.key}-${b.selected ? "on" : "off"}`} coordinate={b.coordinate} anchor={{ x: 0.5, y: 1 }} onPress={() => selection.onSelect(b.index)}>
          <RouteTimeBubble timeText={b.timeText} tag={b.tag} selected={b.selected} />
        </MarkerPin>
      ))}
      {props.trafficSuggestion?.labelPoint && (
        <MarkerPin coordinate={props.trafficSuggestion.labelPoint}>
          <View style={styles.suggestionPill}>
            <Text style={styles.suggestionText}>{props.trafficSuggestion.etaText}</Text>
          </View>
        </MarkerPin>
      )}
      {props.manoeuvre?.callout && (
        <MarkerPin coordinate={props.manoeuvre.callout.coordinate} anchor={{ x: 0.5, y: 1.25 }}>
          <View style={styles.manoeuvreCallout} testID="manoeuvre-callout">
            <Text style={styles.manoeuvreCalloutText} numberOfLines={1}>
              {props.manoeuvre.callout.text}
            </Text>
          </View>
        </MarkerPin>
      )}
      {props.selectedComment && (
        <MarkerPin coordinate={props.selectedComment.coordinate} anchor={{ x: 0.5, y: 0 }}>
          <View style={styles.comment}>
            <Text style={styles.commentText} numberOfLines={2}>
              {props.selectedComment.text}
            </Text>
          </View>
        </MarkerPin>
      )}
      {user?.ghost && (
        <MarkerPin coordinate={user.coordinate} anchor={{ x: -0.1, y: 1.4 }}>
          <View style={styles.ghostSlot}>
            <GhostBadge />
          </View>
        </MarkerPin>
      )}
    </>
  );
}

function GhostBadge() {
  return <Tracky mood="spooky" size={28} animated={false} reactOnTap={false} translucent />;
}

const styles = StyleSheet.create({
  turnCallout: {
    maxWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: "#3B0764",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    ...shadow.medium,
  },
  turnCalloutText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
  suggestionPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: SUGGESTION_GREEN,
  },
  suggestionText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  comment: {
    marginTop: 4,
    maxWidth: 180,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(31,33,37,0.78)",
  },
  commentText: { fontSize: 12, color: "#FFFFFF" },
  ghostSlot: { width: 28, height: 28 },
  manoeuvreCallout: {
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "#3B0764",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    ...shadow.medium,
  },
  manoeuvreCalloutText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
