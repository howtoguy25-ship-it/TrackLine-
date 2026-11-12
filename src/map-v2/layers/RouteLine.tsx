import React, { useMemo } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { collection, isDrawableLine, lineFeature, type LatLng } from "@/map-v2/geo";

// One line on the map (a route, an alternative, a traffic stretch), optionally with a casing
// drawn underneath it. Drawn under the map's own labels so street names stay readable.

export const LABELS_BOTTOM_LAYER = "suburb-labels";

interface Props {
  id: string;
  coordinates: LatLng[];
  color: string;
  width: number;
  casingColor?: string;
  casingWidth?: number;
  opacity?: number;
  /** Draw above this other line layer id (e.g. traffic stretches over the selected route). */
  aboveLayerID?: string;
  onPress?: () => void;
}

export function RouteLine({ id, coordinates, color, width, casingColor, casingWidth, opacity = 1, aboveLayerID, onPress }: Props) {
  const Mapbox = loadMapbox();
  const shape = useMemo(() => collection([lineFeature(id, coordinates)]), [id, coordinates]);
  if (!Mapbox || !isDrawableLine(coordinates)) return null;
  const { ShapeSource, LineLayer } = Mapbox;
  const placement = aboveLayerID ? { aboveLayerID } : { belowLayerID: LABELS_BOTTOM_LAYER };
  return (
    <ShapeSource id={`${id}-src`} shape={shape as never} onPress={onPress ? () => onPress() : undefined} hitbox={{ width: 24, height: 24 }}>
      {[
        ...(casingColor
          ? [
              <LineLayer
                key="casing"
                id={`${id}-casing`}
                {...placement}
                style={{ lineColor: casingColor, lineWidth: casingWidth ?? width + 4, lineCap: "round", lineJoin: "round", lineOpacity: opacity }}
              />,
            ]
          : []),
        <LineLayer
          key="line"
          id={`${id}-line`}
          {...(casingColor ? { aboveLayerID: `${id}-casing` } : placement)}
          style={{ lineColor: color, lineWidth: width, lineCap: "round", lineJoin: "round", lineOpacity: opacity }}
        />,
      ]}
    </ShapeSource>
  );
}
