import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { AheadKind } from "@/nav/ahead/aheadKinds";

// Our own glyph for every kind of ahead alert, drawn as simple strokes in a 24-unit box: a hump,
// a cone, a traffic light with a crack, two cars meeting, a badge, queued cars, a camera, a child
// crossing, a barrier, a bending road... Nothing is taken from another app's artwork.

const W = 2.2;

function paths(kind: AheadKind, c: string): React.ReactNode {
  const stroke = { stroke: c, strokeWidth: W, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (kind) {
    case "hump":
      return <Path d="M2.5 17.5 H6.5 C9 17.5 9.5 10.5 12 10.5 C14.5 10.5 15 17.5 17.5 17.5 H21.5" {...stroke} />;
    case "roadwork":
      return (
        <>
          <Path d="M12 3.5 L17 18.5 H7 Z" {...stroke} />
          <Path d="M9.6 11 H14.4 M8.5 14.8 H15.5 M4.5 20.5 H19.5" {...stroke} />
        </>
      );
    case "brokenLight":
      return (
        <>
          <Rect x={8} y={2.5} width={8} height={16} rx={3} {...stroke} />
          <Path d="M12 18.5 V21.5" {...stroke} />
          <Path d="M15.5 4.5 L12.6 9 L14.4 10.8 L11.2 16" {...stroke} />
          <Circle cx={10.4} cy={6.5} r={1.2} fill={c} />
        </>
      );
    case "signal":
      return (
        <>
          <Rect x={8} y={2.5} width={8} height={16} rx={3} {...stroke} />
          <Path d="M12 18.5 V21.5" {...stroke} />
          <Circle cx={12} cy={6.6} r={1.5} fill={c} />
          <Circle cx={12} cy={10.6} r={1.5} fill={c} />
          <Circle cx={12} cy={14.5} r={1.5} fill={c} />
        </>
      );
    case "crash":
      return (
        <>
          <Path d="M2.5 16.5 L4.5 11.5 H10.5 L12.5 16.5 Z" {...stroke} />
          <Circle cx={5.5} cy={18.5} r={1.4} fill={c} />
          <Circle cx={9.5} cy={18.5} r={1.4} fill={c} />
          <Path d="M16 4.5 L17 8 M21 6.5 L18.4 9.2 M21.5 12 L18 11.2 M14.6 9.5 L13.5 6.5" {...stroke} />
        </>
      );
    case "police":
      return (
        <>
          <Path d="M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z" {...stroke} />
          <Path d="M12 8.3 L13.1 10.6 L15.6 10.9 L13.8 12.6 L14.2 15.1 L12 13.9 L9.8 15.1 L10.2 12.6 L8.4 10.9 L10.9 10.6 Z" fill={c} />
        </>
      );
    case "heavyTraffic":
    case "standstill":
    case "slowdown":
      return (
        <>
          <Path d="M3 11 L4.6 7 H9.4 L11 11 V14 H3 Z" {...stroke} />
          <Path d="M13 17 L14.6 13 H19.4 L21 17 V20 H13 Z" {...stroke} />
          {kind === "slowdown" ? <Path d="M17.5 3.5 V9 M15.3 7 L17.5 9.2 L19.7 7" {...stroke} /> : null}
        </>
      );
    case "camera":
      return (
        <>
          <Path d="M4 9 L16 6.5 L17.6 13.5 L5.6 16 Z" {...stroke} />
          <Circle cx={13.2} cy={11.1} r={1.8} fill={c} />
          <Path d="M17.5 8.6 L21 7.8 M10 15.4 L11 20.5 M7.5 20.5 H14" {...stroke} />
        </>
      );
    case "schoolZone":
      return (
        <>
          <Circle cx={9} cy={5} r={2} fill={c} />
          <Path d="M9 8 V14 M9 10 L5.5 12.5 M9 10 L12 12 M9 14 L6.5 20 M9 14 L11.5 20" {...stroke} />
          <Circle cx={16.5} cy={8} r={1.6} fill={c} />
          <Path d="M16.5 10.5 V15 M16.5 15 L14.8 20 M16.5 15 L18.2 20 M16.5 12 L19.2 13.6" {...stroke} />
        </>
      );
    case "closure":
      return (
        <>
          <Rect x={2.5} y={7} width={19} height={6} rx={1.5} {...stroke} />
          <Path d="M7 7.5 L4.5 12.5 M12 7.5 L9.5 12.5 M17 7.5 L14.5 12.5 M21 8.5 L19.5 12" {...stroke} />
          <Path d="M5.5 13 V20 M18.5 13 V20" {...stroke} />
        </>
      );
    case "curve":
      return (
        <>
          <Path d="M7 21 V14 C7 9 17 10.5 17 5" {...stroke} />
          <Path d="M13.8 6.8 L17 3.5 L20.2 6.8" {...stroke} />
        </>
      );
    case "crossing":
      return <Path d="M4 4.5 V19.5 M8 4.5 V19.5 M12 4.5 V19.5 M16 4.5 V19.5 M20 4.5 V19.5" {...stroke} />;
    case "toll":
      return (
        <>
          <Rect x={3} y={9} width={4} height={11} rx={1} {...stroke} />
          <Path d="M7 11 H21" {...stroke} />
          <Path d="M10.5 11 L12.5 7.5 M14.5 11 L16.5 7.5 M18.5 11 L20.5 7.5" {...stroke} />
        </>
      );
    case "emergency":
      return (
        <>
          <Path d="M6 19 V13 C6 9.7 8.7 7 12 7 C15.3 7 18 9.7 18 13 V19 Z" {...stroke} />
          <Path d="M4 19.5 H20 M12 2.5 V4.5 M5 5 L6.4 6.4 M19 5 L17.6 6.4" {...stroke} />
        </>
      );
    case "object":
      return (
        <>
          <Rect x={7.5} y={8} width={9} height={8} rx={1.5} {...stroke} />
          <Path d="M3 20 H21" {...stroke} />
        </>
      );
    case "carOnShoulder":
      return (
        <>
          <Path d="M3 13 L5 8 H12 L14 13 V16.5 H3 Z" {...stroke} />
          <Path d="M19 3.5 V7 M19 10 V13.5 M19 16.5 V20" {...stroke} />
        </>
      );
    case "weather":
      return (
        <>
          <Path d="M7 15 H17 C19.2 15 21 13.4 21 11.2 C21 9.1 19.4 7.5 17.4 7.4 C16.6 5.1 14.5 3.5 12 3.5 C9 3.5 6.6 5.8 6.4 8.8 C4.4 9.1 3 10.6 3 12.5 C3 14 4.6 15 7 15 Z" {...stroke} />
          <Path d="M8 18 L7 20.5 M12.5 18 L11.5 20.5 M17 18 L16 20.5" {...stroke} />
        </>
      );
    case "hazard":
      return (
        <>
          <Path d="M12 5 V14" {...stroke} />
          <Circle cx={12} cy={18.5} r={1.6} fill={c} />
        </>
      );
    case "roadFeature":
    default:
      return <Path d="M8 3.5 L4.5 20.5 M16 3.5 L19.5 20.5 M12 4.5 V7 M12 10.5 V13.5 M12 17 V20" {...stroke} />;
  }
}

export function AheadGlyph({ kind, size = 28, color }: { kind: AheadKind; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`ahead-glyph-${kind}`}>
      {paths(kind, color)}
    </Svg>
  );
}
