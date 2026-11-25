import React from "react";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { Icon, type IconName } from "@/components/ui/Icon";
import { isRoundabout, roundaboutDrawing, roundaboutExitAngle } from "@/nav/roundabout";
import type { LatLng } from "@/utils/polyline";

// TrackLine's own roundabout picture (fix pass 5 §6), drawn from primitives: the circle dimmed,
// the way in from the bottom, the path round the circle and out along the exit arm in full
// colour with an arrowhead, and the exit number in the middle. Clockwise for left-hand traffic.

export function RoundaboutIcon({
  size,
  color,
  dim,
  exit,
  angle,
  drivingSide = "left",
}: {
  size: number;
  color: string;
  /** The circle and the arms you don't take. */
  dim: string;
  exit: number | null;
  /** Exit direction relative to the way in (nav/roundabout.ts). */
  angle: number;
  drivingSide?: "left" | "right";
}) {
  const d = roundaboutDrawing(angle, drivingSide);
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" testID="roundabout-icon" accessibilityLabel={exit ? `Roundabout, exit ${exit}` : "Roundabout"}>
      <Circle cx={d.ring.cx} cy={d.ring.cy} r={d.ring.r} stroke={dim} strokeWidth={5} fill="none" />
      <Path d={d.route} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={d.arrow} fill={color} />
      {exit != null ? (
        <SvgText x={32} y={37} fontSize={14} fontWeight="800" fill={color} textAnchor="middle" testID="roundabout-exit">
          {String(exit)}
        </SvgText>
      ) : null}
    </Svg>
  );
}

/**
 * The one manoeuvre picture everywhere (top bar, directions list, turn callout): our roundabout
 * for roundabouts, the line icon set for everything else.
 */
export function ManeuverIcon({
  maneuver,
  icons,
  size,
  color,
  dim,
  exit,
  drivingSide,
  approach,
  after,
  fallback = "straight",
}: {
  maneuver: string | null | undefined;
  icons: Record<string, IconName>;
  size: number;
  color: string;
  dim: string;
  exit?: number | null;
  drivingSide?: "left" | "right";
  approach?: LatLng[];
  after?: LatLng[];
  fallback?: IconName;
}) {
  if (isRoundabout(maneuver)) {
    const angle = roundaboutExitAngle({ exit, drivingSide, approach, after });
    return <RoundaboutIcon size={size} color={color} dim={dim} exit={exit ?? null} angle={angle} drivingSide={drivingSide} />;
  }
  return <Icon name={(maneuver && icons[maneuver]) || fallback} size={size} color={color} strokeWidth={2.6} />;
}
