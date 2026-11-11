import React from "react";
import { View, StyleSheet } from "react-native";
import { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { incidentStyle, type NearbyIncident } from "@/services/trafficNswModel";

// Live Traffic NSW pins: one per current incident near the driver (crash, heavy traffic,
// roadwork, flood, fire...). Kept as its own memoised component so a change in the incident
// list re-renders these markers and nothing else on the (very large) map screen, and so the
// map's own per-GPS-tick re-renders don't touch them at all.

interface Props {
  incidents: NearbyIncident[];
  onSelect: (incident: NearbyIncident) => void;
}

export const TrafficIncidentLayer = React.memo(function TrafficIncidentLayer({ incidents, onSelect }: Props) {
  return (
    <>
      {incidents.map((incident) => {
        const style = incidentStyle(incident);
        return (
          <Marker
            key={`traffic-${incident.id}`}
            coordinate={{ latitude: incident.lat, longitude: incident.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            // Major incidents sit above ordinary ones where pins overlap.
            zIndex={incident.major ? 6 : 5}
            onPress={(event) => {
              event.stopPropagation();
              onSelect(incident);
            }}
          >
            <View
              style={[styles.badge, { backgroundColor: style.color }, incident.major && styles.badgeMajor]}
              accessibilityLabel={`${style.label}${incident.where ? `, ${incident.where}` : ""}`}
            >
              <Ionicons name={style.icon} size={incident.major ? 17 : 14} color="#FFFFFF" />
            </View>
          </Marker>
        );
      })}
    </>
  );
});

const styles = StyleSheet.create({
  badge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    // A rounded square, tilted to a diamond -- the road-sign shape for "hazard ahead", and
    // unmistakably different from the round pins every other layer on this map uses.
    transform: [{ rotate: "45deg" }],
  },
  badgeMajor: { width: 32, height: 32, borderRadius: 9 },
});
