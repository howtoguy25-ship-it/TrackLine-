import React from "react";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { REPORT_STATUS } from "@/theme/colors";
import { colors } from "@/theme/tokens";
import type { OdometerReading } from "@/vehicleCheck/model";

// The recorded odometer readings as a timeline: date along the bottom, kilometres up the side.
// A reading lower than an earlier one (beyond the same 100 km tolerance the server uses) is
// drawn red -- the "went backwards" the report warns about.

const ROLLBACK_TOLERANCE_KM = 100;

export function chartPoints(readings: OdometerReading[], width: number, height: number, pad = 28) {
  const list = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (list.length === 0) return [];
  const t = list.map((r) => Date.parse(r.date));
  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  const kMax = Math.max(...list.map((r) => r.km), 1);
  let maxSoFar = -Infinity;
  return list.map((r, i) => {
    const backwards = r.km < maxSoFar - ROLLBACK_TOLERANCE_KM;
    maxSoFar = Math.max(maxSoFar, r.km);
    return {
      ...r,
      x: pad + (tMax === tMin ? (width - 2 * pad) / 2 : ((t[i] - tMin) / (tMax - tMin)) * (width - 2 * pad)),
      y: height - pad - (r.km / kMax) * (height - 2 * pad),
      backwards,
    };
  });
}

export function OdometerChart({ readings, width, height = 170 }: { readings: OdometerReading[]; width: number; height?: number }) {
  const pts = chartPoints(readings, width, height);
  if (pts.length === 0) return null;
  const kMax = Math.max(...pts.map((p) => p.km));
  return (
    <Svg width={width} height={height} accessibilityLabel={`Odometer readings: ${pts.map((p) => `${p.date} ${p.km} km`).join(", ")}`}>
      <Line x1={28} y1={height - 28} x2={width - 8} y2={height - 28} stroke={colors.border} strokeWidth={1} />
      <SvgText x={4} y={22} fontSize={10} fill={colors.textMuted}>{`${Math.round(kMax / 1000)}k km`}</SvgText>
      <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={colors.primary} strokeWidth={2} />
      {pts.map((p) => (
        <React.Fragment key={`${p.date}-${p.km}`}>
          <Circle cx={p.x} cy={p.y} r={p.backwards ? 6 : 4.5} fill={p.backwards ? REPORT_STATUS.red.dot : colors.primary} stroke="#FFFFFF" strokeWidth={1.5} />
          <SvgText x={p.x} y={height - 12} fontSize={9} fill={colors.textMuted} textAnchor="middle">
            {p.date.slice(0, 7)}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}
