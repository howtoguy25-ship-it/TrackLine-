import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadMapbox } from "@/map-v2/mapbox";
import { collection, metersRadiusExpression, pointFeature, type LatLng } from "@/map-v2/geo";
import { MotionSmoother, type Pose } from "@/map-v2/userMotion";

// THE one thing that draws the driver (permanent fix §1) -- on the home map, in route preview and
// while navigating. Root cause of the "blue ball" and the lag: the driver used to be Mapbox's
// native LocationPuck, whose arrow was an image MapIcons snapshots from a React view
// asynchronously; until that snapshot registered, Mapbox drew its own default blue dot, and the
// puck ran its own interpolation separate from what the camera followed. Now: our arrow is a
// bundled PNG (assets/map/user-arrow.png, @2x, @3x, registered with the style, never missing), drawn by
// a SymbolLayer from one position stream, eased between fixes at display rate (userMotion.ts).
// Nothing else may draw the user: eslint.config.js bans LocationPuck / UserLocation /
// showsUserLocation in src, and __tests__/map/userArrow.test.tsx checks there's exactly one.

export const USER_ARROW_ICON = "user-arrow";
const USER_ARROW_PNG = require("../../../assets/map/user-arrow.png");

/** A little smaller zoomed out, full size at street level. */
export const ARROW_SCALE = ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 0.8, 17, 1.0, 20, 1.15];

/** The icon: a chosen vehicle badge when that image is ready, else our arrow -- never nothing, never Mapbox's dot. */
export function arrowIconExpression(markerIcon: string | null): unknown {
  return markerIcon ? ["coalesce", ["image", markerIcon], ["image", USER_ARROW_ICON]] : USER_ARROW_ICON;
}

interface Props {
  coordinate: LatLng;
  /** Travel heading (degrees) after the no-flip filter; null = none yet (keeps the last / north). */
  heading: number | null;
  /** GPS accuracy in metres (circle hidden under 3 m or when unknown). */
  accuracyMeters: number | null;
  /** A chosen vehicle badge icon name (registered by MapIcons), or null for our arrow. */
  markerIcon: string | null;
  /** The fix's own time (location.timestamp), for ordering; defaults to now. */
  fixTimeMs?: number;
}

/** Eases the drawn pose toward each new fix, one frame at a time, and stops when it arrives. */
function useSmoothedPose(coordinate: LatLng, heading: number | null, fixTimeMs: number | undefined): Pose | null {
  const smoother = useRef(new MotionSmoother());
  const [pose, setPose] = useState<Pose | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const s = smoother.current;
    const now = Date.now();
    if (!s.push({ latitude: coordinate.latitude, longitude: coordinate.longitude, heading, timeMs: fixTimeMs ?? now }, now)) return;
    const step = () => {
      const t = Date.now();
      setPose(s.at(t));
      frame.current = s.moving(t) ? requestAnimationFrame(step) : null;
    };
    if (frame.current != null) cancelAnimationFrame(frame.current);
    step();
  }, [coordinate.latitude, coordinate.longitude, heading, fixTimeMs]);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    []
  );
  return pose;
}

export function UserArrow({ coordinate, heading, accuracyMeters, markerIcon, fixTimeMs }: Props) {
  const Mapbox = loadMapbox();
  const pose = useSmoothedPose(coordinate, heading, fixTimeMs);
  const shape = useMemo(
    () => (pose ? collection([pointFeature("me", { latitude: pose.latitude, longitude: pose.longitude }, { heading: pose.heading })]) : null),
    [pose]
  );
  if (!Mapbox || !shape || !pose) return null;
  const { Images, ShapeSource, SymbolLayer, CircleLayer } = Mapbox;
  const showAccuracy = accuracyMeters != null && accuracyMeters >= 3;
  return (
    <>
      <Images images={{ [USER_ARROW_ICON]: USER_ARROW_PNG }} />
      <ShapeSource id="me-src" shape={shape as never}>
        {/* Two children, always: Mapbox's ShapeSource wants elements, not null. */}
        <CircleLayer
            id="me-accuracy"
            style={{
              circleRadius: (showAccuracy ? metersRadiusExpression(accuracyMeters!, pose.latitude) : 0) as never,
              circleColor: "rgba(20, 184, 166, 0.12)",
              circleStrokeColor: "rgba(20, 184, 166, 0.5)",
              circleStrokeWidth: 1,
              circlePitchAlignment: "map",
            }}
          />
        <SymbolLayer
          id="me-arrow"
          style={{
            iconImage: arrowIconExpression(markerIcon) as never,
            iconSize: ARROW_SCALE as never,
            iconRotate: ["get", "heading"] as never,
            // Lies on the road and turns with the map, like a car would.
            iconRotationAlignment: "map",
            iconPitchAlignment: "map",
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
          }}
        />
      </ShapeSource>
    </>
  );
}
