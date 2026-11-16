import React, { useMemo } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { LABELS_BOTTOM_LAYER } from "@/map-v2/layers/RouteLine";
import { SCHOOL_ZONE } from "@/theme/colors";
import type { LatLng } from "@/map-v2/geo";

// Official school zones on the map: a subtle amber overlay along the road -- bright while the
// zone is in force, faded otherwise. Drawn under the map's labels so street names stay readable.

export interface SchoolZoneDrawing {
  id: string;
  rings: LatLng[][];
  active: boolean;
}

export function SchoolZoneLayer({ zones }: { zones: SchoolZoneDrawing[] }) {
  const Mapbox = loadMapbox();
  const shape = useMemo(
    () => ({
      type: "FeatureCollection",
      features: zones.flatMap((z) =>
        z.rings
          .filter((r) => r.length >= 4)
          .map((r, i) => ({
            type: "Feature",
            id: `${z.id}-${i}`,
            properties: { active: z.active ? 1 : 0 },
            geometry: { type: "Polygon", coordinates: [r.map((p) => [p.longitude, p.latitude])] },
          }))
      ),
    }),
    [zones]
  );
  if (!Mapbox || zones.length === 0) return null;
  const { ShapeSource, FillLayer, LineLayer } = Mapbox;
  return (
    <ShapeSource id="school-zones-src" shape={shape as never}>
      <FillLayer
        id="school-zones-fill"
        belowLayerID={LABELS_BOTTOM_LAYER}
        style={{ fillColor: SCHOOL_ZONE, fillOpacity: ["case", ["==", ["get", "active"], 1], 0.5, 0.16] as never }}
      />
      <LineLayer
        id="school-zones-edge"
        aboveLayerID="school-zones-fill"
        style={{ lineColor: SCHOOL_ZONE, lineWidth: 1.2, lineOpacity: ["case", ["==", ["get", "active"], 1], 0.9, 0.3] as never }}
      />
    </ShapeSource>
  );
}
