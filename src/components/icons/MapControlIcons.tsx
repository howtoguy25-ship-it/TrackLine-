import React from "react";
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";

// The home map's own control artwork, drawn here as plain SVG shapes. Original to TrackLine:
// each is a few primitives written by hand, not traced or adapted from another app's icons.

/** Report: a yellow warning triangle with a black outline and a black "+". */
export function ReportIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M24 6.5 L43.5 40 Q44.4 41.6 42.6 41.6 L5.4 41.6 Q3.6 41.6 4.5 40 Z"
        fill="#FFE55C"
        stroke="#1F2125"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Line x1="24" y1="20" x2="24" y2="35" stroke="#1F2125" strokeWidth={3.4} strokeLinecap="round" />
      <Line x1="16.5" y1="27.5" x2="31.5" y2="27.5" stroke="#1F2125" strokeWidth={3.4} strokeLinecap="round" />
    </Svg>
  );
}

/** Re-centre: a white crosshair ring with a white heading arrow inside it. */
export function RecenterIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Circle cx="24" cy="24" r="15" stroke="#FFFFFF" strokeWidth={2.4} fill="none" />
      <Line x1="24" y1="3" x2="24" y2="10" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
      <Line x1="24" y1="38" x2="24" y2="45" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
      <Line x1="3" y1="24" x2="10" y2="24" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
      <Line x1="38" y1="24" x2="45" y2="24" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
      <Polygon points="24,14.5 31,31.5 24,27.6 17,31.5" fill="#FFFFFF" />
    </Svg>
  );
}

/** Compass needle: red half points north, grey half south. The parent rotates it. */
export function CompassNeedle({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Polygon points="24,5 31,24 17,24" fill="#E5342B" />
      <Polygon points="24,43 31,24 17,24" fill="#9AA0A8" />
      <Circle cx="24" cy="24" r="3" fill="#FFFFFF" stroke="#6B7078" strokeWidth={1} />
    </Svg>
  );
}
