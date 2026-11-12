import React, { useMemo } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { pinsToFeatures, type MapPin } from "@/map-v2/pins";

// Any number of icon pins as ONE native symbol layer. Icons come from MapIcons (registered by
// name); a tap reports the pin's id.

interface Props {
  id: string;
  pins: readonly MapPin[];
  onPress?: (pinId: string) => void;
}

export function PinLayer({ id, pins, onPress }: Props) {
  const Mapbox = loadMapbox();
  const shape = useMemo(() => pinsToFeatures(pins), [pins]);
  if (!Mapbox || pins.length === 0) return null;
  const { ShapeSource, SymbolLayer } = Mapbox;
  return (
    <ShapeSource
      id={`${id}-src`}
      shape={shape as never}
      hitbox={{ width: 28, height: 28 }}
      onPress={(event) => {
        const pinId = event.features?.[0]?.properties?.id;
        if (typeof pinId === "string") onPress?.(pinId);
      }}
    >
      <SymbolLayer
        id={`${id}-symbols`}
        style={{
          iconImage: ["get", "icon"],
          iconSize: ["get", "size"],
          iconAnchor: ["get", "anchor"],
          iconRotate: ["get", "rotate"],
          iconAllowOverlap: true,
          iconIgnorePlacement: true,
          symbolSortKey: ["get", "priority"],
          textField: ["get", "label"],
          textFont: ["DIN Pro Bold", "Arial Unicode MS Bold"],
          textSize: 13,
          textColor: "#FFFFFF",
          textAllowOverlap: true,
          textIgnorePlacement: true,
        }}
      />
    </ShapeSource>
  );
}
