import React, { useMemo } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { collection, metersRadiusExpression, pointFeature, toPosition, type LatLng } from "@/map-v2/geo";

// The driver on the map. The app's own position (live GPS, GPS replay or a simulated drive) is
// handed to Mapbox through a CustomLocationProvider, and Mapbox's native location puck draws it --
// it interpolates between fixes on the native side at the display's frame rate, so the arrow
// glides rather than jumping from fix to fix. Under it: the GPS accuracy circle (true metres at
// every zoom) and, while navigating, the phone-compass "flashlight" cone.

/** A transparent image (registered by MapIcons as "blank"). */
export const BLANK_ICON = "blank";

interface Props {
  coordinate: LatLng;
  /** Travel heading, degrees. */
  heading: number;
  /** GPS accuracy in metres (circle hidden under 3 m or when unknown). */
  accuracyMeters: number | null;
  /** The phone's own compass heading (the cone), while navigating. */
  deviceHeading: number | null;
  /** Arrow (navigating) or dot (browsing). */
  navigating: boolean;
  /** Icon names registered via MapIcons. */
  arrowIcon: string;
  dotIcon: string;
  coneIcon: string;
}

export function UserPuck({ coordinate, heading, accuracyMeters, deviceHeading, navigating, arrowIcon, dotIcon, coneIcon }: Props) {
  const Mapbox = loadMapbox();
  const point = useMemo(
    () => collection([pointFeature("me", coordinate, { heading: deviceHeading ?? 0 })]),
    [coordinate, deviceHeading]
  );
  if (!Mapbox) return null;
  const { CustomLocationProvider, LocationPuck, ShapeSource, CircleLayer, SymbolLayer } = Mapbox;
  const showAccuracy = accuracyMeters != null && accuracyMeters >= 3;

  return (
    <>
      <CustomLocationProvider coordinate={toPosition(coordinate)} heading={heading} />
      {(showAccuracy || (navigating && deviceHeading != null)) && (
        <ShapeSource id="me-src" shape={point as never}>
          {[
            ...(showAccuracy
              ? [
                  <CircleLayer
                    key="acc"
                    id="me-accuracy"
                    style={{
                      circleRadius: metersRadiusExpression(accuracyMeters!, coordinate.latitude) as never,
                      circleColor: "rgba(20, 184, 166, 0.12)",
                      circleStrokeColor: "rgba(20, 184, 166, 0.5)",
                      circleStrokeWidth: 1,
                      circlePitchAlignment: "map",
                    }}
                  />,
                ]
              : []),
            ...(navigating && deviceHeading != null
              ? [
                  <SymbolLayer
                    key="cone"
                    id="me-cone"
                    style={{
                      iconImage: coneIcon,
                      iconAnchor: "bottom",
                      iconRotate: ["get", "heading"],
                      iconRotationAlignment: "map",
                      iconAllowOverlap: true,
                      iconIgnorePlacement: true,
                    }}
                  />,
                ]
              : []),
          ]}
        </ShapeSource>
      )}
      <LocationPuck
        puckBearingEnabled={navigating}
        puckBearing="heading"
        // Every slot is filled: a slot left empty gets Mapbox's own default dot.
        {...(navigating
          ? { bearingImage: arrowIcon, topImage: BLANK_ICON, shadowImage: BLANK_ICON }
          : { topImage: dotIcon, bearingImage: BLANK_ICON, shadowImage: BLANK_ICON })}
        visible
      />
    </>
  );
}
