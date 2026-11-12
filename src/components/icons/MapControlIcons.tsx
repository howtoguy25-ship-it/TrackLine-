import React from "react";
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";

// The home map's own control artwork, drawn here as plain SVG shapes. Original to TrackLine:
// each is a few primitives written by hand, not traced or adapted from another app's icons.

/**
 * Report: a black warning triangle outline with a "+", drawn on the yellow Report button. Its
 * stroke is the line set's 1.75 at 24pt (3.5 on this 48-unit canvas).
 */
export function ReportIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M24 7 L43 40 Q43.8 41.5 42.1 41.5 L5.9 41.5 Q4.2 41.5 5 40 Z"
        fill="none"
        stroke="#000000"
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <Line x1="24" y1="20" x2="24" y2="34" stroke="#000000" strokeWidth={3.5} strokeLinecap="round" />
      <Line x1="17" y1="27" x2="31" y2="27" stroke="#000000" strokeWidth={3.5} strokeLinecap="round" />
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
