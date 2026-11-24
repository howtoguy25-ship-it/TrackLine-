// Startup §1: what shows while the map's first tiles load -- a soft grid in our own colours (light
// or dark with the map), never a blank white or black screen. It fades away the moment the map has
// drawn its first frame. Colours from MAP_LOADING_GRID (tested for contrast in
// __tests__/startup/startup.test.tsx).
import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

import { GRID_STEP, MAP_LOADING_GRID } from "@/map-v2/loadingGridColours";
export { GRID_STEP, MAP_LOADING_GRID };

export function LoadingGrid({ dark }: { dark: boolean }) {
  const c = dark ? MAP_LOADING_GRID.dark : MAP_LOADING_GRID.light;
  return (
    <Animated.View pointerEvents="none" exiting={FadeOut.duration(250)} style={StyleSheet.absoluteFill} testID="map-loading-grid">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="tl-grid" width={GRID_STEP * 4} height={GRID_STEP * 4} patternUnits="userSpaceOnUse">
            <Rect width={GRID_STEP * 4} height={GRID_STEP * 4} fill={c.ground} />
            <Path d={`M ${GRID_STEP} 0 V ${GRID_STEP * 4} M ${GRID_STEP * 2} 0 V ${GRID_STEP * 4} M ${GRID_STEP * 3} 0 V ${GRID_STEP * 4} M 0 ${GRID_STEP} H ${GRID_STEP * 4} M 0 ${GRID_STEP * 2} H ${GRID_STEP * 4} M 0 ${GRID_STEP * 3} H ${GRID_STEP * 4}`} stroke={c.line} strokeWidth={1} />
            <Path d={`M 0 0 V ${GRID_STEP * 4} M 0 0 H ${GRID_STEP * 4}`} stroke={c.major} strokeWidth={1.5} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#tl-grid)" />
      </Svg>
    </Animated.View>
  );
}
