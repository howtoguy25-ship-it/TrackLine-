import React from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { colors } from "@/theme/tokens";

// Plan a drive's empty-state picture (TrackLine's own): a clock face with a road arrow sweeping
// round to a flag, i.e. "leave at the right time, arrive on time".
export function ArriveOnTimeArt({ size = 160 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx="80" cy="80" r="74" fill={colors.accentSoft} />
      <Circle cx="80" cy="80" r="46" fill={colors.surface} stroke={colors.accent} strokeWidth="6" />
      {[0, 90, 180, 270].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return <Line key={deg} x1={80 + Math.sin(r) * 36} y1={80 - Math.cos(r) * 36} x2={80 + Math.sin(r) * 41} y2={80 - Math.cos(r) * 41} stroke={colors.text} strokeWidth="4" strokeLinecap="round" />;
      })}
      <Line x1="80" y1="80" x2="80" y2="54" stroke={colors.text} strokeWidth="5" strokeLinecap="round" />
      <Line x1="80" y1="80" x2="98" y2="88" stroke={colors.text} strokeWidth="5" strokeLinecap="round" />
      <Circle cx="80" cy="80" r="5" fill={colors.text} />
      <Path d="M30 128 C 40 150, 120 150, 132 118" fill="none" stroke={colors.routePurple} strokeWidth="9" strokeLinecap="round" />
      <Path d="M122 112 L 138 112 L 132 128 Z" fill={colors.routePurple} />
      <Line x1="136" y1="44" x2="136" y2="84" stroke={colors.text} strokeWidth="4" strokeLinecap="round" />
      <Rect x="136" y="44" width="18" height="14" rx="2" fill={colors.good} />
    </Svg>
  );
}
