import React, { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient, Path, Polygon, Rect, Stop } from "react-native-svg";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { AMBER, PURPLE_BRIGHT, SURFACES, WHITE } from "@/theme/colors";
import { shadow } from "@/theme/tokens";
import { KIND_SIZE, LANE_WIDTH_M, ME_Z_M, STATUS_TEXT, project, type LiveStatus, type LocalPoint, type SceneVehicle, type View as SceneView } from "@/nav/liveScene";

// The live road view panel (the Tesla-style view): your route as a purple line down a 3D road,
// and every vehicle the camera is tracking right now, at the distance and side it really is, sized
// by kind. Nothing is drawn that the camera didn't see: no vehicles = an empty road and a line
// saying so. Status lines are real: starting, no camera access, model didn't load (Try again).

type Palette = { sky: string; ground: string; road: string; edge: string; lane: string; body: string; top: string; me: string };
const PALETTE: Record<"dark" | "light", Palette> = {
  dark: { sky: "#0E1218", ground: "#151A22", road: "#262D38", edge: "#5B6472", lane: "#7C8594", body: "#C9CED6", top: "#E6E9EE", me: "#5DB4FF" },
  light: { sky: "#E9EDF2", ground: "#DDE2E8", road: "#C3CAD3", edge: "#8A94A2", lane: "#F7F8FA", body: "#59616D", top: "#7A828E", me: "#1E6BD6" },
};

type Pt = { u: number; v: number };

function poly(points: (Pt | null)[]): string | null {
  if (points.some((p) => !p)) return null;
  return (points as Pt[]).map((p) => `${p.u.toFixed(1)},${p.v.toFixed(1)}`).join(" ");
}

/** A line `offset` metres to the side of the route path. */
function offsetPath(path: readonly LocalPoint[], offset: number): LocalPoint[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / len) * offset, z: p.z - (dx / len) * offset };
  });
}

function pathD(path: readonly LocalPoint[], view: SceneView): string {
  let d = "";
  for (const p of path) {
    const s = project(p, view);
    if (!s) continue;
    d += `${d ? "L" : "M"}${s.u.toFixed(1)} ${s.v.toFixed(1)} `;
  }
  return d;
}

function VehicleBox({ v, view, colours, me }: { v: { x: number; z: number; kind: keyof typeof KIND_SIZE; close?: boolean }; view: SceneView; colours: Palette; me?: boolean }) {
  const s = KIND_SIZE[v.kind];
  const hw = s.w / 2;
  // The box's back (nearest) face starts at the vehicle's distance; it extends away from you.
  const z0 = v.z;
  const z1 = v.z + s.l;
  const back = poly([project({ x: v.x - hw, z: z0 }, view), project({ x: v.x + hw, z: z0 }, view), project({ x: v.x + hw, z: z0 }, view, s.h), project({ x: v.x - hw, z: z0 }, view, s.h)]);
  const top = poly([project({ x: v.x - hw, z: z0 }, view, s.h), project({ x: v.x + hw, z: z0 }, view, s.h), project({ x: v.x + hw, z: z1 }, view, s.h), project({ x: v.x - hw, z: z1 }, view, s.h)]);
  const fill = me ? colours.me : v.close ? AMBER : colours.body;
  if (!back || !top) return null;
  return (
    <>
      <Polygon points={top} fill={me ? colours.me : v.close ? AMBER : colours.top} opacity={0.95} />
      <Polygon points={back} fill={fill} />
    </>
  );
}

export function LiveRoadView({
  status,
  vehicles,
  route,
  dark,
  height,
  onTurnOff,
  onRetry,
  onOpenSettings,
  cameraPreview,
}: {
  status: LiveStatus;
  vehicles: readonly SceneVehicle[];
  /** Your route ahead in the car's frame (nav/liveScene.ts routeAhead). */
  route: readonly LocalPoint[];
  dark: boolean;
  height: number;
  onTurnOff: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  /** The live camera thumbnail (components/LiveVehicleCamera.tsx), so you can see it's real. */
  cameraPreview?: React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const colours = dark ? PALETTE.dark : PALETTE.light;
  const surface = dark ? SURFACES.dark : SURFACES.light;
  const view = useMemo(() => ({ width, height }), [width, height]);
  // No route geometry yet (first fix): the road runs straight ahead until it arrives.
  const path = useMemo(() => (route.length >= 2 ? route : [{ x: 0, z: 0 }, { x: 0, z: 100 }]), [route]);
  const roadHalf = LANE_WIDTH_M * 1.5;
  const roadD = useMemo(() => {
    if (!width) return "";
    const l = offsetPath(path, -roadHalf);
    const r = offsetPath(path, roadHalf).reverse();
    return `${pathD(l, view)} L${pathD(r, view).slice(1)} Z`;
  }, [path, roadHalf, view, width]);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const seen = status === "running" ? vehicles.length : 0;
  return (
    <View style={[styles.card, { height, backgroundColor: colours.sky }]} onLayout={onLayout} testID="live-road-view">
      {width > 0 ? (
        <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Defs>
            <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colours.sky} />
              <Stop offset="0.25" stopColor={colours.ground} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#ground)" />
          <Path d={roadD} fill={colours.road} />
          <Path d={pathD(offsetPath(path, -roadHalf), view)} stroke={colours.edge} strokeWidth={2} fill="none" />
          <Path d={pathD(offsetPath(path, roadHalf), view)} stroke={colours.edge} strokeWidth={2} fill="none" />
          {[-LANE_WIDTH_M / 2, LANE_WIDTH_M / 2].map((o) => (
            <Path key={o} d={pathD(offsetPath(path, o), view)} stroke={colours.lane} strokeWidth={2} strokeDasharray="10 12" fill="none" />
          ))}
          <Path d={pathD(path.filter((p) => p.z >= ME_Z_M), view)} stroke={PURPLE_BRIGHT} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} testID="live-route-line" />
          {status === "running" ? vehicles.map((v) => <VehicleBox key={v.id} v={v} view={view} colours={colours} />) : null}
          <VehicleBox v={{ x: 0, z: ME_Z_M, kind: "car" }} view={view} colours={colours} me />
        </Svg>
      ) : null}
      <View style={styles.header} pointerEvents="box-none">
        <View style={[styles.pill, { backgroundColor: dark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.85)" }]}>
          <Text style={[styles.pillText, { color: surface.text }]} accessibilityLiveRegion="polite" testID="live-road-count">
            {status === "running" ? (seen === 0 ? "Live view · no vehicles in view" : `Live view · ${seen} vehicle${seen === 1 ? "" : "s"}`) : "Live view"}
          </Text>
        </View>
        <Button variant="ghost" icon="close" onPress={onTurnOff} accessibilityLabel="Turn off live view" iconColor={surface.text} testID="live-road-off" />
      </View>
      {cameraPreview ? <View style={styles.preview}>{cameraPreview}</View> : null}
      {status !== "running" ? (
        <View style={[styles.status, { backgroundColor: dark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.9)" }]} testID={`live-road-${status}`}>
          <Text style={[styles.statusText, { color: surface.text }]}>{STATUS_TEXT[status]}</Text>
          {status === "modelFailed" ? <Button variant="secondary" label="Try again" onPress={onRetry} testID="live-road-retry" /> : null}
          {status === "noPermission" ? <Button variant="secondary" label="Open settings" onPress={onOpenSettings} testID="live-road-settings" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, overflow: "hidden", ...shadow.floating },
  header: { position: "absolute", top: 6, left: 10, right: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 13, fontWeight: "600" },
  preview: { position: "absolute", right: 10, bottom: 10, width: 72, height: 54, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: WHITE },
  status: { position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: 14, padding: 12, gap: 8, alignItems: "flex-start" },
  statusText: { fontSize: 14, fontWeight: "600" },
});
