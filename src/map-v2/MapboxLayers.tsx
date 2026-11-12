import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { RouteTimeBubble } from "@/components/RouteSelection";
import { Tracky } from "@/components/trackys/Tracky";
import { RouteLine } from "@/map-v2/layers/RouteLine";
import { PinLayer } from "@/map-v2/layers/PinLayer";
import { MarkerPin } from "@/map-v2/layers/MarkerPin";
import { MapIcons, type IconExtras } from "@/map-v2/layers/MapIcons";
import { UserPuck, BLANK_ICON } from "@/map-v2/layers/UserPuck";
import { PresenceLayerV2, presenceIconName } from "@/map-v2/layers/PresenceLayerV2";
import { splitRouteAt, turnArrowAt, type LatLng } from "@/map-v2/geo";
import { iconsUsed, type MapPin } from "@/map-v2/pins";
import type { PresenceDoc } from "@/services/presence";
import type { MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { colors, radius, shadow, spacing } from "@/theme/tokens";
import { GREEN, LAVENDER, PURPLE_BRIGHT, TRAFFIC } from "@/theme/colors";

// Everything drawn on the Mapbox map, from plain data the map screen already works out: the
// route being driven (travelled part faded, turn callouts, the turn arrow), route choices
// (purple/lavender lines, traffic, time bubbles, start and finish), the driver, other drivers,
// and every icon pin. MapScreen owns the state and the handlers; this only draws.

const ROUTE_PURPLE = colors.routePurple;
const ROUTE_PURPLE_CASING = colors.routePurpleCasing;
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
  heading: number;
  accuracyMeters: number | null;
  deviceHeading: number | null;
  navigating: boolean;
  markerStyle: MapMarkerStyleKey;
  ghost: boolean;
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
  /** The destination while navigating. */
  arrival: LatLng | null;
  pins: MapPin[];
  onPinPress: (pinId: string) => void;
  selectedComment: { coordinate: LatLng; text: string } | null;
  /** During the approach view: the road through the manoeuvre, the road taken, and the label. */
  manoeuvre?: { through: LatLng[]; exitSide: LatLng[]; callout: { coordinate: LatLng; text: string } | null } | null;
}

const FIXED_ICONS = [
  BLANK_ICON,
  "person-dot",
  "heading-cone",
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
  const arrowIcon = `car-arrow:${user?.markerStyle ?? "default"}`;

  const iconNames = useMemo(
    () => Array.from(new Set([...FIXED_ICONS, arrowIcon, ...iconsUsed(props.pins), ...props.presences.map(presenceIconName)])),
    [arrowIcon, props.pins, props.presences]
  );
  const extras = useMemo<IconExtras>(
    () => ({
      trackyLooks: Object.fromEntries(props.presences.map((p) => [p.uid, { customization: p.look, mood: p.mood }])),
    }),
    [props.presences]
  );

  const split = useMemo(
    () => (props.navRoute && user ? splitRouteAt(props.navRoute, user.coordinate) : null),
    [props.navRoute, user]
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

      {/* Navigation: the part already driven fades, the rest is the purple band. */}
      {split && split.travelled.length > 1 && (
        <RouteLine id="nav-travelled" coordinates={split.travelled} color={ROUTE_PURPLE} width={8} opacity={0.3} />
      )}
      {props.remaining.length > 1 && (
        <RouteLine
          id="nav-route"
          coordinates={props.remaining}
          color={ROUTE_PURPLE}
          width={8}
          casingColor="#FFFFFF"
          casingWidth={14}
          onPress={props.onRoutePress}
        />
      )}
      {turnArrow.length > 1 && (
        <RouteLine id="nav-turn-arrow" coordinates={turnArrow} color="#FFFFFF" width={5} casingColor={ROUTE_PURPLE_CASING} casingWidth={9} aboveLayerID="nav-route-line" />
      )}
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
          <RouteLine key={`alt-${d.index}`} id={`route-alt-${d.index}`} coordinates={d.line} color={ROUTE_ALT} width={6} onPress={() => selection.onSelect(d.index)} />
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
        <UserPuck
          coordinate={user.coordinate}
          heading={user.heading}
          accuracyMeters={user.accuracyMeters}
          deviceHeading={user.deviceHeading}
          navigating={user.navigating}
          arrowIcon={arrowIcon}
          dotIcon="person-dot"
          coneIcon="heading-cone"
        />
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
