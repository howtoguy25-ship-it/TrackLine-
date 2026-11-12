import React from "react";
import { Pressable } from "react-native";
import { loadMapbox } from "@/map-v2/mapbox";
import { toPosition, type LatLng } from "@/map-v2/geo";

// A real React view pinned to a coordinate (Mapbox MarkerView). Only for the handful of things
// that are text or need to change often -- route time bubbles, turn callouts, a selected report's
// comment. Everything else is a symbol layer (PinLayer), which scales to hundreds of pins.

interface Props {
  coordinate: LatLng;
  /** Where the coordinate sits on the view: {x: 0.5, y: 1} = bottom centre. */
  anchor?: { x: number; y: number };
  onPress?: () => void;
  children: React.ReactElement;
}

export function MarkerPin({ coordinate, anchor = { x: 0.5, y: 0.5 }, onPress, children }: Props) {
  const Mapbox = loadMapbox();
  if (!Mapbox) return null;
  const { MarkerView } = Mapbox;
  return (
    <MarkerView coordinate={toPosition(coordinate)} anchor={anchor} allowOverlap allowOverlapWithPuck>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={6}>
          {children}
        </Pressable>
      ) : (
        children
      )}
    </MarkerView>
  );
}
