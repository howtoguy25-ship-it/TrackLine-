import React, { useMemo } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { collection, metersRadiusExpression, pointFeature, toPosition, type LatLng } from "@/map-v2/geo";

// The driver on the map. The app's own position (live GPS, GPS replay or a simulated drive) is
// handed to Mapbox through a CustomLocationProvider, and Mapbox's native location puck draws it --
// it interpolates between fixes on the native side at the display's frame rate, so the arrow
// glides rather than jumping from fix to fix. It's TrackLine's 3D arrow (or the vehicle the driver
// chose) on the home map and while navigating, over the GPS accuracy circle (true metres at
// every zoom). The old flat compass cone and browsing dot are gone.

/** A transparent image (registered by MapIcons as "blank"). */
export const BLANK_ICON = "blank";

interface Props {
  coordinate: LatLng;
  /** Travel heading, degrees. */
  heading: number;
  /** GPS accuracy in metres (circle hidden under 3 m or when unknown). */
  accuracyMeters: number | null;
  /** The phone's own compass heading. No longer drawn (the flat "heading cone" is gone). */
  deviceHeading?: number | null;
  /** Kept for callers: the arrow now shows on the home map and while navigating alike. */
  navigating?: boolean;
  /** Icon name registered via MapIcons: the 3D arrow, or the chosen vehicle badge. */
  arrowIcon: string;
}

/** A little smaller zoomed out, full size at street level. */
export const PUCK_SCALE = ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 0.8, 17, 1.0, 20, 1.15];

export function UserPuck({ coordinate, heading, accuracyMeters, arrowIcon }: Props) {
  const Mapbox = loadMapbox();
  const point = useMemo(() => collection([pointFeature("me", coordinate, {})]), [coordinate]);
  if (!Mapbox) return null;
  const { CustomLocationProvider, LocationPuck, ShapeSource, CircleLayer } = Mapbox;
  const showAccuracy = accuracyMeters != null && accuracyMeters >= 3;

  return (
    <>
      <CustomLocationProvider coordinate={toPosition(coordinate)} heading={heading} />
      {showAccuracy && (
        <ShapeSource id="me-src" shape={point as never}>
          <CircleLayer
            id="me-accuracy"
            style={{
              circleRadius: metersRadiusExpression(accuracyMeters!, coordinate.latitude) as never,
              circleColor: "rgba(20, 184, 166, 0.12)",
              circleStrokeColor: "rgba(20, 184, 166, 0.5)",
              circleStrokeWidth: 1,
              circlePitchAlignment: "map",
            }}
          />
        </ShapeSource>
      )}
      <LocationPuck
        // The same arrow on the home map and while navigating, turned to the travel heading.
        puckBearingEnabled
        puckBearing="heading"
        scale={PUCK_SCALE as never}
        // Every slot is filled: a slot left empty gets Mapbox's own default dot.
        bearingImage={arrowIcon}
        topImage={BLANK_ICON}
        shadowImage={BLANK_ICON}
        visible
      />
    </>
  );
}
