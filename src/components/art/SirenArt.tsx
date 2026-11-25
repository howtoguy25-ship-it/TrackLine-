import React from "react";
import Svg, { Path, Rect } from "react-native-svg";

/** Our own siren light: a dome on a base with three light rays, white on the banner's red disc. */
export function SirenArt({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M8 19 V14 a6 6 0 0 1 12 0 V19 Z" fill="#FFFFFF" />
      <Rect x={6} y={19.5} width={16} height={3.5} rx={1.5} fill="#FFFFFF" />
      <Path d="M14 3 V6.5 M5.5 6.5 L7.8 8.8 M22.5 6.5 L20.2 8.8" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
