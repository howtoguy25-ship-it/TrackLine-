import React from "react";
import { Path, Circle, Ellipse, Rect, G, Line } from "react-native-svg";
import { shadeColor } from "@/utils/color";

// Original, hand-authored mood accessories -- simple flat-geometric shapes (circles/rects/short
// paths), deliberately plain rather than detailed illustration, so each reads clearly at 32pt
// on a map marker while staying confidently original (no traced reference, no icon-pack
// assets). See TrackyBody.tsx's header and COPYRIGHT_AUDIT.md for the full originality record.
// Every shape here is positioned for the shared 100x120 viewBox TrackyBody.tsx uses.

export type TrackyAccessoryKey =
  | "sunglasses"
  | "sparkles"
  | "zzz"
  | "fork"
  | "partyHat"
  | "headband"
  | "cap"
  | "roundGlasses"
  | "whistle"
  | "headphones"
  | "umbrella"
  | "sunHat"
  | "bucketHat"
  | "cake";

export function TrackySunglasses() {
  return (
    <G>
      <Rect x={24} y={38} width={20} height={14} rx={6} fill="#111827" />
      <Rect x={56} y={38} width={20} height={14} rx={6} fill="#111827" />
      <Line x1={44} y1={43} x2={56} y2={43} stroke="#111827" strokeWidth={2} />
    </G>
  );
}

export function TrackyRoundGlasses() {
  return (
    <G>
      <Circle cx={36} cy={46} r={12} fill="none" stroke="#166534" strokeWidth={3} />
      <Circle cx={64} cy={46} r={12} fill="none" stroke="#166534" strokeWidth={3} />
      <Line x1={48} y1={46} x2={52} y2={46} stroke="#166534" strokeWidth={3} />
    </G>
  );
}

export function TrackySparkles() {
  const star = (cx: number, cy: number, r: number) =>
    `M${cx},${cy - r} L${cx + r * 0.3},${cy - r * 0.3} L${cx + r},${cy} L${cx + r * 0.3},${cy + r * 0.3} L${cx},${cy + r} L${cx - r * 0.3},${cy + r * 0.3} L${cx - r},${cy} L${cx - r * 0.3},${cy - r * 0.3} Z`;
  return (
    <G fill="#FBBF24">
      <Path d={star(14, 30, 8)} />
      <Path d={star(90, 24, 6)} />
      <Path d={star(84, 54, 5)} />
    </G>
  );
}

export function TrackyZzz() {
  return (
    <G stroke="#6D28D9" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <Path d="M78,16 L90,16 L78,26 L90,26" />
      <Path d="M86,30 L94,30 L86,37 L94,37" />
    </G>
  );
}

export function TrackyFork() {
  return (
    <G stroke="#78716C" strokeWidth={3} strokeLinecap="round" fill="none">
      <Line x1={82} y1={20} x2={82} y2={48} />
      <Line x1={76} y1={14} x2={76} y2={26} />
      <Line x1={82} y1={14} x2={82} y2={26} />
      <Line x1={88} y1={14} x2={88} y2={26} />
      <Path d="M76,26 Q76,30 82,30 Q88,30 88,26" />
    </G>
  );
}

export function TrackyPartyHat() {
  return (
    <G>
      <Path d="M50,-6 L34,20 L66,20 Z" fill="#EC4899" />
      <Circle cx={50} cy={-6} r={4} fill="#FBBF24" />
      <Rect x={34} y={18} width={32} height={4} rx={2} fill="#FBBF24" />
    </G>
  );
}

export function TrackyHeadband({ color = "#2563EB" }: { color?: string }) {
  return <Rect x={14} y={24} width={72} height={10} rx={5} fill={color} />;
}

export function TrackyCap({ color = "#111827" }: { color?: string }) {
  const brim = shadeColor(color, -0.2);
  return (
    <G>
      <Path d="M18,20 C18,2 82,2 82,20 L82,24 L18,24 Z" fill={color} />
      <Path d="M50,20 L88,22 C88,28 78,28 72,26 Z" fill={brim} />
    </G>
  );
}

export function TrackyWhistle() {
  return (
    <G>
      <Path d="M50,76 L72,86" stroke="#9CA3AF" strokeWidth={3} strokeLinecap="round" />
      <Ellipse cx={78} cy={89} rx={10} ry={7} fill="#E5E7EB" stroke="#9CA3AF" strokeWidth={2} />
      <Circle cx={78} cy={89} r={2.5} fill="#9CA3AF" />
    </G>
  );
}

export function TrackyHeadphones() {
  return (
    <G>
      <Path d="M14,30 C14,2 86,2 86,30" fill="none" stroke="#581C87" strokeWidth={5} strokeLinecap="round" />
      <Rect x={6} y={28} width={16} height={22} rx={7} fill="#581C87" />
      <Rect x={78} y={28} width={16} height={22} rx={7} fill="#581C87" />
    </G>
  );
}

export function TrackyUmbrella() {
  return (
    <G>
      <Path d="M68,10 C68,-2 92,-2 92,10 L68,10 Z" fill="#475569" />
      <Line x1={80} y1={10} x2={80} y2={34} stroke="#475569" strokeWidth={2.5} />
      <Path d="M80,34 Q84,38 88,34" stroke="#475569" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </G>
  );
}

export function TrackySunHat() {
  return (
    <G>
      <Ellipse cx={50} cy={16} rx={44} ry={9} fill="#EAB308" />
      <Path d="M30,16 C30,2 70,2 70,16 Z" fill="#FDE047" />
    </G>
  );
}

export function TrackyBucketHat({ color = "#D6C7A1" }: { color?: string }) {
  return (
    <G>
      <Ellipse cx={50} cy={18} rx={38} ry={8} fill={color} />
      <Path d="M24,18 C24,2 76,2 76,18 Z" fill={shadeColor(color, -0.12)} />
    </G>
  );
}

export function TrackyCake() {
  return (
    <G>
      <Rect x={38} y={10} width={24} height={14} rx={2} fill="#F472B6" />
      <Rect x={38} y={6} width={24} height={5} fill="#FBCFE8" />
      <Line x1={50} y1={-2} x2={50} y2={6} stroke="#F59E0B" strokeWidth={2} />
      <Path d="M50,-8 C53,-5 53,-2 50,-2 C47,-2 47,-5 50,-8 Z" fill="#FDE047" />
    </G>
  );
}

export function TrackyAccessory({ accessory, color }: { accessory: TrackyAccessoryKey; color?: string }) {
  switch (accessory) {
    case "sunglasses":
      return <TrackySunglasses />;
    case "roundGlasses":
      return <TrackyRoundGlasses />;
    case "sparkles":
      return <TrackySparkles />;
    case "zzz":
      return <TrackyZzz />;
    case "fork":
      return <TrackyFork />;
    case "partyHat":
      return <TrackyPartyHat />;
    case "headband":
      return <TrackyHeadband color={color} />;
    case "cap":
      return <TrackyCap color={color} />;
    case "whistle":
      return <TrackyWhistle />;
    case "headphones":
      return <TrackyHeadphones />;
    case "umbrella":
      return <TrackyUmbrella />;
    case "sunHat":
      return <TrackySunHat />;
    case "bucketHat":
      return <TrackyBucketHat color={color} />;
    case "cake":
      return <TrackyCake />;
    default:
      return null;
  }
}
