import React from "react";
import type { CameraTrack, LiveStatus } from "@/nav/liveScene";

// Loads the camera half of the live road view (components/LiveVehicleCamera.tsx) only when the
// view is actually shown, so the map screen never pulls the native camera modules in otherwise.
type Props = { attempt: number; egoSpeedKmh: number | null; onTracks: (t: CameraTrack[], frameWidth: number) => void; onStatus: (s: LiveStatus) => void };

export function LiveCameraSlot(props: Props) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on demand (native camera modules)
  const { LiveVehicleCamera } = require("@/components/LiveVehicleCamera") as typeof import("@/components/LiveVehicleCamera");
  return <LiveVehicleCamera {...props} />;
}
