import React from "react";
import { Circle, Ellipse, Path, G } from "react-native-svg";

// Original, hand-authored face parts shared across Tracky moods -- see TrackyBody.tsx's own
// header for the full originality note. Positions are all relative to the shared 100x120
// viewBox TrackyBody.tsx renders in, so these line up when composited in the same <Svg>.

export type TrackyEyeStyle = "normal" | "sleepy" | "heart" | "grumpy" | "closedHappy" | "dot";

const EYE_LX = 36;
const EYE_RX = 64;
const EYE_Y = 46;

export function TrackyEyes({ style, color = "#1F2937" }: { style: TrackyEyeStyle; color?: string }) {
  switch (style) {
    case "sleepy":
      // Droopy half-closed eyes -- a flattened arc over each eye position rather than a full
      // oval, reading as heavy-lidded/tired.
      return (
        <G>
          <Path d={`M${EYE_LX - 9},${EYE_Y} Q${EYE_LX},${EYE_Y + 6} ${EYE_LX + 9},${EYE_Y}`} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
          <Path d={`M${EYE_RX - 9},${EYE_Y} Q${EYE_RX},${EYE_Y + 6} ${EYE_RX + 9},${EYE_Y}`} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
        </G>
      );
    case "heart": {
      const heart = (cx: number) =>
        `M${cx},${EYE_Y + 6} C${cx - 10},${EYE_Y - 4} ${cx - 10},${EYE_Y - 12} ${cx - 3},${EYE_Y - 12} C${cx},${EYE_Y - 12} ${cx},${EYE_Y - 9} ${cx},${EYE_Y - 9} C${cx},${EYE_Y - 9} ${cx},${EYE_Y - 12} ${cx + 3},${EYE_Y - 12} C${cx + 10},${EYE_Y - 12} ${cx + 10},${EYE_Y - 4} ${cx},${EYE_Y + 6} Z`;
      return (
        <G>
          <Path d={heart(EYE_LX)} fill="#E11D48" />
          <Path d={heart(EYE_RX)} fill="#E11D48" />
        </G>
      );
    }
    case "grumpy":
      // Narrowed, inward-angled eyes + a short angled brow stroke above each -- the real
      // "annoyed" cue, not just a plain closed eye.
      return (
        <G>
          <Ellipse cx={EYE_LX} cy={EYE_Y + 2} rx={8} ry={5} fill="#FFFFFF" stroke={color} strokeWidth={2} />
          <Ellipse cx={EYE_RX} cy={EYE_Y + 2} rx={8} ry={5} fill="#FFFFFF" stroke={color} strokeWidth={2} />
          <Circle cx={EYE_LX + 2} cy={EYE_Y + 2} r={2.6} fill={color} />
          <Circle cx={EYE_RX - 2} cy={EYE_Y + 2} r={2.6} fill={color} />
          <Path d={`M${EYE_LX - 10},${EYE_Y - 9} L${EYE_LX + 6},${EYE_Y - 5}`} stroke={color} strokeWidth={3} strokeLinecap="round" />
          <Path d={`M${EYE_RX + 10},${EYE_Y - 9} L${EYE_RX - 6},${EYE_Y - 5}`} stroke={color} strokeWidth={3} strokeLinecap="round" />
        </G>
      );
    case "closedHappy":
      // Upward-curved closed eyes, the classic "content/singing along" look -- distinct from
      // sleepy's flat droop (this one arcs UP at the ends).
      return (
        <G>
          <Path d={`M${EYE_LX - 9},${EYE_Y + 2} Q${EYE_LX},${EYE_Y - 7} ${EYE_LX + 9},${EYE_Y + 2}`} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
          <Path d={`M${EYE_RX - 9},${EYE_Y + 2} Q${EYE_RX},${EYE_Y - 7} ${EYE_RX + 9},${EYE_Y + 2}`} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
        </G>
      );
    case "dot":
      // Minimal small round dot eyes -- used for Spooky's translucent ghost-outline look,
      // deliberately plainer/fainter than the full oval-eye treatment.
      return (
        <G>
          <Circle cx={EYE_LX} cy={EYE_Y} r={4} fill={color} />
          <Circle cx={EYE_RX} cy={EYE_Y} r={4} fill={color} />
        </G>
      );
    case "normal":
    default:
      return (
        <G>
          <Ellipse cx={EYE_LX} cy={EYE_Y} rx={10} ry={13} fill="#FFFFFF" stroke={color} strokeWidth={2} />
          <Ellipse cx={EYE_RX} cy={EYE_Y} rx={10} ry={13} fill="#FFFFFF" stroke={color} strokeWidth={2} />
          <Circle cx={EYE_LX + 1.5} cy={EYE_Y + 3} r={4.4} fill={color} />
          <Circle cx={EYE_RX + 1.5} cy={EYE_Y + 3} r={4.4} fill={color} />
          {/* Tiny highlight dot in each pupil -- a glossy, alive look rather than a flat disc. */}
          <Circle cx={EYE_LX - 1} cy={EYE_Y} r={1.4} fill="#FFFFFF" />
          <Circle cx={EYE_RX - 1} cy={EYE_Y} r={1.4} fill="#FFFFFF" />
        </G>
      );
  }
}

export type TrackyMouthStyle = "smile" | "grin" | "smirk" | "frown" | "flat" | "o";

const MOUTH_CX = 50;
const MOUTH_Y = 68;

export function TrackyMouth({ style, color = "#1F2937" }: { style: TrackyMouthStyle; color?: string }) {
  switch (style) {
    case "grin":
      return <Path d={`M${MOUTH_CX - 12},${MOUTH_Y} Q${MOUTH_CX},${MOUTH_Y + 14} ${MOUTH_CX + 12},${MOUTH_Y} Q${MOUTH_CX},${MOUTH_Y + 8} ${MOUTH_CX - 12},${MOUTH_Y} Z`} fill={color} />;
    case "smirk":
      return <Path d={`M${MOUTH_CX - 9},${MOUTH_Y + 2} Q${MOUTH_CX + 2},${MOUTH_Y + 8} ${MOUTH_CX + 11},${MOUTH_Y - 2}`} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />;
    case "frown":
      return <Path d={`M${MOUTH_CX - 9},${MOUTH_Y + 6} Q${MOUTH_CX},${MOUTH_Y - 2} ${MOUTH_CX + 9},${MOUTH_Y + 6}`} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />;
    case "flat":
      return <Path d={`M${MOUTH_CX - 8},${MOUTH_Y} L${MOUTH_CX + 8},${MOUTH_Y}`} stroke={color} strokeWidth={3} strokeLinecap="round" />;
    case "o":
      return <Ellipse cx={MOUTH_CX} cy={MOUTH_Y + 2} rx={5} ry={7} fill={color} />;
    case "smile":
    default:
      return <Path d={`M${MOUTH_CX - 10},${MOUTH_Y} Q${MOUTH_CX},${MOUTH_Y + 10} ${MOUTH_CX + 10},${MOUTH_Y}`} stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="round" />;
  }
}
