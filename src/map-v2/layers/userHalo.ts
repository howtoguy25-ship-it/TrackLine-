/**
 * Map look 2: a soft grey disc under the arrow so you can always find yourself (screen points,
 * lying flat on the map like the arrow). Neutral grey: visible on light, dark and satellite.
 */
export const USER_HALO = {
  radius: ["interpolate", ["linear"], ["zoom"], 10, 15, 14, 19, 17, 25, 20, 30],
  color: "rgba(128, 134, 145, 0.30)",
  stroke: "rgba(128, 134, 145, 0.45)",
} as const;
