import React from "react";
import { Path, Ellipse, Defs, ClipPath, G } from "react-native-svg";
import { shadeColor } from "@/utils/color";

// TrackLine's own original mascot family -- "Trackys". Real, explicit request: a rounded
// map-pin-shaped blob with a soft tail (inspired by this app's own location-pin logo, NOT a
// ghost/droplet-with-wheels shape, and not resembling Waze's "wazers" or any other existing
// mascot). Every path below is hand-authored for this app -- no traced, downloaded, or
// AI-generated reference art, and no third-party icon packs. See COPYRIGHT_AUDIT.md for the
// full originality record.
//
// Body silhouette: a wide rounded head tapering to a soft, blunt tail -- deliberately NOT a
// sharp point (that would read as a literal map-pin icon, not a character) and deliberately NOT
// a circle-on-a-stick/droplet-with-wheels silhouette. A single closed cubic-bezier path, in a
// 100x120 box, reused for every mood (only fill colour + face/accessory change per mood).
//
// Renders only SVG primitives (<G>/<Path>/...), no own <Svg>/<ClipPath id> collision risk
// across instances -- Tracky.tsx is the one place that opens the actual <Svg> so body, face,
// and accessory all share one coordinate space and layer correctly.
export const TRACKY_BODY_PATH =
  "M50,8 " +
  "C74,8 92,27 92,50 " +
  "C92,68 80,80 66,90 " +
  "C58,96 52,104 50,114 " +
  "C48,104 42,96 34,90 " +
  "C20,80 8,68 8,50 " +
  "C8,27 26,8 50,8 " +
  "Z";

// Tiny stubby arms either side of the body, roughly a third of the way down -- a short rounded
// capsule each, not full limbs (per the brief's own "tiny stubby arms").
const LEFT_ARM_PATH = "M12,56 C4,58 2,66 6,72 C9,77 16,76 18,70 Z";
const RIGHT_ARM_PATH = "M88,56 C96,58 98,66 94,72 C91,77 84,76 82,70 Z";

export interface TrackyBodyProps {
  color: string;
  // Real, explicit request -- a two-tone option (top/bottom), used by Birthday today and the
  // customiser add-on later; undefined just means a flat single-colour body.
  colorBottom?: string;
  // Real, explicit request -- Ghost mode's own translucent outline look for the Spooky mood
  // (and for the driver's own marker while hidden). Drops the fill opacity on the body/arms but
  // keeps the outline/face at full strength so it still reads as "there, just faint" rather
  // than "fully invisible."
  translucent?: boolean;
  // A stable, unique id for this instance's clip path -- required once more than one Tracky can
  // render on screen at once (map markers), since SVG id collisions across sibling <Svg> trees
  // can leak clipping between instances on some renderers.
  instanceId: string;
}

/** The shared body shell every mood/outfit is drawn on top of -- flat vector fill, a single 2px
 *  darker outline of the same hue (shadeColor, no separate stroke-color system to keep in sync),
 *  and one subtle top highlight ellipse + one soft inner-shadow ellipse near the base, per the
 *  brief's own "flat vector, one soft inner shadow, 2px outline, subtle top highlight, no
 *  gradients" style rule. */
export function TrackyBody({ color, colorBottom, translucent, instanceId }: TrackyBodyProps) {
  const outline = shadeColor(color, -0.32);
  const innerShadow = shadeColor(colorBottom ?? color, -0.18);
  const highlight = shadeColor(color, 0.35);
  const clipId = `trackyBodyClip-${instanceId}`;
  const bodyOpacity = translucent ? 0.4 : 1;

  return (
    <G>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={TRACKY_BODY_PATH} />
        </ClipPath>
      </Defs>

      {/* Arms drawn first so the body overlaps their inner edge, reading as attached. */}
      <Path d={LEFT_ARM_PATH} fill={color} stroke={outline} strokeWidth={2} opacity={bodyOpacity} />
      <Path d={RIGHT_ARM_PATH} fill={color} stroke={outline} strokeWidth={2} opacity={bodyOpacity} />

      <Path d={TRACKY_BODY_PATH} fill={color} stroke={outline} strokeWidth={2} opacity={bodyOpacity} />

      {/* Two-tone bottom half, clipped to the body silhouette so it never spills past the
          outline -- only rendered when a bottom colour actually differs from the top. */}
      {colorBottom && colorBottom !== color && (
        <Path
          d="M4,66 C4,66 50,66 96,66 L96,120 L4,120 Z"
          fill={colorBottom}
          opacity={bodyOpacity}
          clipPath={`url(#${clipId})`}
        />
      )}

      {/* Soft inner shadow -- a low-opacity darker ellipse hugging the lower-inside of the
          body, clipped to the silhouette, giving real depth without an actual gradient fill. */}
      <Ellipse cx={50} cy={96} rx={30} ry={22} fill={innerShadow} opacity={translucent ? 0.1 : 0.22} clipPath={`url(#${clipId})`} />

      {/* Subtle top highlight -- a small soft-edged light ellipse near the crown, same real
          "catching the light" convention this app's other badge-style markers already use. */}
      <Ellipse cx={40} cy={26} rx={16} ry={10} fill={highlight} opacity={translucent ? 0.18 : 0.35} clipPath={`url(#${clipId})`} />
    </G>
  );
}
