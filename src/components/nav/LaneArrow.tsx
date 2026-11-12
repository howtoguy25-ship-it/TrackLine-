import React from "react";
import Svg, { G, Path, Polyline } from "react-native-svg";
import type { LaneIndication } from "@/nav/lanes";

// TrackLine's own lane arrows: a thick rounded shaft and an open arrow head, drawn for the right-
// hand directions and mirrored for the left ones. Original artwork (a few strokes each).

interface Shape {
  shaft: string;
  head: string;
}

// 32 x 32 canvas; the lane enters at the bottom centre.
const RIGHT_SHAPES: Record<"straight" | "slight" | "turn" | "sharp" | "uturn" | "merge", Shape> = {
  straight: { shaft: "M16 29 L16 6", head: "9.5,12.5 16,6 22.5,12.5" },
  slight: { shaft: "M14 29 L14 19 Q14 13 23 7", head: "15.5,6.5 23.5,6.5 22.5,14.5" },
  turn: { shaft: "M11 29 L11 16 Q11 11 16 11 L26 11", head: "20.5,5 26.5,11 20.5,17" },
  sharp: { shaft: "M10 29 L10 9 L23 23", head: "15.5,23.5 23.5,23.5 23.5,15.5" },
  uturn: { shaft: "M20 29 L20 12 Q20 5 13.5 5 Q7 5 7 12 L7 22", head: "1.5,17 7,23 12.5,17" },
  merge: { shaft: "M21 29 L21 19 L13 10 L13 4", head: "7,9.5 13,3.5 19,9.5" },
};

function shapeFor(indication: LaneIndication): { shape: Shape; mirror: boolean } {
  switch (indication) {
    case "slight right":
      return { shape: RIGHT_SHAPES.slight, mirror: false };
    case "slight left":
      return { shape: RIGHT_SHAPES.slight, mirror: true };
    case "right":
      return { shape: RIGHT_SHAPES.turn, mirror: false };
    case "left":
      return { shape: RIGHT_SHAPES.turn, mirror: true };
    case "sharp right":
      return { shape: RIGHT_SHAPES.sharp, mirror: false };
    case "sharp left":
      return { shape: RIGHT_SHAPES.sharp, mirror: true };
    case "uturn":
      // Australia drives on the left, so U-turns swing right.
      return { shape: RIGHT_SHAPES.uturn, mirror: true };
    case "merge to left":
      return { shape: RIGHT_SHAPES.merge, mirror: false };
    case "merge to right":
      return { shape: RIGHT_SHAPES.merge, mirror: true };
    default:
      // "straight", and unmarked lanes ("none"), which carry straight on.
      return { shape: RIGHT_SHAPES.straight, mirror: false };
  }
}

interface Props {
  indications: LaneIndication[];
  /** The arrow that applies to this route; drawn on top, the others faded. */
  highlight?: LaneIndication;
  color: string;
  /** Colour for this lane's other arrows. */
  dimColor: string;
  size: number;
}

export function LaneArrow({ indications, highlight, color, dimColor, size }: Props) {
  const list = indications.length ? indications : (["none"] as LaneIndication[]);
  // Draw the faded ones first so the route's arrow sits on top.
  const ordered = [...list].sort((a, b) => Number(a === highlight) - Number(b === highlight));
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {ordered.map((ind, i) => {
        const { shape, mirror } = shapeFor(ind);
        const stroke = !highlight || ind === highlight ? color : dimColor;
        return (
          <G key={`${ind}-${i}`} transform={mirror ? "translate(32,0) scale(-1,1)" : undefined}>
            <Path d={shape.shaft} stroke={stroke} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Polyline points={shape.head} stroke={stroke} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </G>
        );
      })}
    </Svg>
  );
}
