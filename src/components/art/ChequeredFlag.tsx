import React from "react";
import Svg, { Path, Rect } from "react-native-svg";
import { GREEN, INK, WHITE } from "@/theme/colors";

// Our own chequered finish flag (a pole and a 4x3 chequer), for "You've arrived".
export function ChequeredFlag({ size = 40 }: { size?: number }) {
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      cells.push(<Rect key={`${r}-${c}`} x={10 + c * 6} y={6 + r * 6} width={6} height={6} fill={(r + c) % 2 ? INK : WHITE} />);
    }
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={0} y={0} width={40} height={40} rx={20} fill={GREEN} />
      <Path d="M9 5 V35" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" />
      <Rect x={10} y={6} width={24} height={18} fill={WHITE} stroke={WHITE} strokeWidth={1} />
      {cells}
    </Svg>
  );
}
