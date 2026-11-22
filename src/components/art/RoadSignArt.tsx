import React from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ROAD_SIGN_ART as A } from "@/theme/colors";

// Our own map art for the things drivers recognise at a glance -- drawn here, not taken from any
// other app:
//   * TrafficLightArt: a small upright traffic light, dark housing with red, amber and green lamps
//   * SpeedCameraArt:  a rounded purple badge with a white camera body and a dark lens
//   * HazardTriangleArt: a rounded warning triangle in the incident type's colour with a white rim
//     and that type's glyph inside (roadwork cone, crash, flood, fire...) -- every official
//     NSW / Australian government hazard and roadwork is drawn as one
// Each is rendered once into a map image (map-v2/layers/MapIcons.tsx).

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
};

export function TrafficLightArt({ height = 30 }: { height?: number }) {
  const width = height * (16 / 30);
  return (
    <View style={{ width, height }} testID="art-traffic-light">
      <Svg width={width} height={height} viewBox="0 0 16 30" {...hidden}>
        <Rect
          x={1}
          y={1}
          width={14}
          height={28}
          rx={5}
          fill={A.housing}
          stroke={A.rim}
          strokeWidth={1.5}
        />
        <Circle cx={8} cy={7.5} r={3} fill={A.lampRed} />
        <Circle cx={8} cy={15} r={3} fill={A.lampAmber} />
        <Circle cx={8} cy={22.5} r={3} fill={A.lampGreen} />
      </Svg>
    </View>
  );
}

export function SpeedCameraArt({ size = 30 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }} testID="art-speed-camera">
      <Svg width={size} height={size} viewBox="0 0 30 30" {...hidden}>
        <Rect
          x={1}
          y={1}
          width={28}
          height={28}
          rx={8}
          fill={A.camera}
          stroke={A.rim}
          strokeWidth={2}
        />
        {/* The camera: a body angled down at the road, its lens, and the mount. */}
        <Path
          d="M7 11.5 L19 9 L20.6 16.4 L8.6 18.9 Z"
          fill={A.rim}
          strokeLinejoin="round"
        />
        <Circle cx={16.4} cy={13.9} r={2} fill={A.cameraLens} />
        <Path d="M20.4 12.4 L24 11.6 L24.6 14.6 L21 15.4 Z" fill={A.rim} />
        <Path
          d="M12.5 18 L13.6 23 M10 23.2 H17.4"
          stroke={A.rim}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

/** A rounded warning triangle; `glyph` is drawn in its lower middle. */
export function HazardTriangleArt({
  size = 32,
  fill,
  glyphColor,
  glyph,
}: {
  size?: number;
  fill: string;
  glyphColor: string;
  glyph: IconName;
}) {
  return (
    <View style={{ width: size, height: size }} testID="art-hazard-triangle">
      <Svg width={size} height={size} viewBox="0 0 32 32" {...hidden}>
        <Path
          d="M16 3.2 C17 3.2 17.8 3.7 18.3 4.6 L29.6 25.2 C30.6 27 29.3 29 27.3 29 H4.7 C2.7 29 1.4 27 2.4 25.2 L13.7 4.6 C14.2 3.7 15 3.2 16 3.2 Z"
          fill={fill}
          stroke={A.rim}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: size * 0.36,
          alignItems: "center",
        }}
      >
        <Icon
          name={glyph}
          size={size * 0.42}
          color={glyphColor}
          strokeWidth={2.4}
        />
      </View>
    </View>
  );
}
