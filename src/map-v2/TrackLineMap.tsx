import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useLatest } from "@/hooks/useLatest";
import { BADGE_CANDIDATE_LAYER_ID, RANKED_BADGE_LAYER_ID, withRankedBadges } from "@/map/poiBadges";
import { candidateFromFeature, rankBadges, rankedBadgeCollection, type BadgeCandidate } from "@/map/poiRanking";
import { cachedPopularity, loadPopularity } from "@/services/poiPopularity";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import type { CameraStop, MapView as MapboxMapView } from "@rnmapbox/maps";
import { loadMapbox } from "@/map-v2/mapbox";
import { TRAFFIC } from "@/theme/colors";
import { GestureTracker } from "@/map-v2/gestures";
import {
  BUILDING_EXTRUSION_MIN_PITCH,
  ROAD_SCALES,
  SATELLITE_LABEL_PALETTE,
  SHIELD_IMAGE,
  SHIELD_PLATES,
  SHIELD_PLATE_COLOURS,
  THEME_PALETTES,
  AU_SUBURB_LAYER_ID,
  AU_SUBURB_MIN_ZOOM,
  auSuburbLabelStyle,
  buildStyle,
  mapboxNameField,
  LABEL_FONT,
  type LabelLanguage,
  type ThemeKey,
} from "@/map-v2/styles/buildStyle";
import trackLineLight from "@/map-v2/styles/trackline-light.json";
import { auSuburbFeatures } from "@/map-v2/auSuburbs";
import trackLineDark from "@/map-v2/styles/trackline-dark.json";
import trackLineSatellite from "@/map-v2/styles/trackline-satellite-streets.json";
import {
  boundsOfPoints,
  boundsOfRegion,
  cameraStopFrom,
  fromPosition,
  googleZoomFromMapbox,
  regionFromBounds,
  type CameraLike,
  type LatLng,
  type Region,
} from "@/map-v2/geo";

// The app's map, drawn by Mapbox. Everything on it (routes, pins, the car) is a child layer from
// src/map-v2/layers. Its ref offers the same camera calls the map screen has always used --
// animateCamera, animateToRegion, fitToCoordinates, getCamera, with zoom levels on the scale the
// screen was tuned on (see geo.ts MAPBOX_ZOOM_OFFSET) -- so the navigation logic didn't change.

export interface EdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapHandle {
  animateCamera(camera: Partial<CameraLike>, options?: { duration?: number }): void;
  animateToRegion(region: Region, duration?: number): void;
  fitToCoordinates(coords: LatLng[], options?: { edgePadding?: Partial<EdgePadding>; animated?: boolean }): void;
  getCamera(): Promise<CameraLike>;
}

export interface PoiPress {
  name: string;
  coordinate: LatLng;
}

interface Props {
  theme: ThemeKey;
  /** Settings > Map appearance > Map labels. */
  labelLanguage?: LabelLanguage;
  roadThickness: keyof typeof ROAD_SCALES;
  satellite: boolean;
  /** Fades the base map while routes are being chosen. */
  dimmed: boolean;
  show3DBuildings: boolean;
  showTraffic: boolean;
  /** Space covered by the app's cards and sheets; the camera centres in what's left. */
  padding: EdgePadding;
  initialCenter: LatLng;
  /** On the Google zoom scale (see geo.ts). */
  initialZoom: number;
  onRegionChangeComplete?: (region: Region, details: { isGesture: boolean }) => void;
  /** Once when the driver starts moving the map by hand. */
  onPanDrag?: () => void;
  onPress?: (coordinate: LatLng) => void;
  /** A tap on a named place drawn on the map itself (shops, parks...). */
  onPoiPress?: (poi: PoiPress) => void;
  onMapReady?: () => void;
  /** The driver's position, for the badges' "nearby" boost. */
  driver?: LatLng | null;
  /** Brand / popular-place badges (owner dashboard can switch them off). Default on. */
  badges?: boolean;
  children?: React.ReactNode;
}


/** The one Camera method this file uses (the package doesn't export its ref type). */
interface CameraRef {
  setCamera(stop: CameraStop): void;
}

export function styleFor(theme: ThemeKey, roadThickness: keyof typeof ROAD_SCALES, satellite: boolean, dimmed: boolean, labels: LabelLanguage = "local", locale: string | null = deviceLocale()): string {
  const local = labels === "local";
  const labelOpt = local ? undefined : { mode: labels, field: mapboxNameField(locale) };
  // Brand / popular-place badges are ranked and drawn by the app (map/poiRanking.ts), so every
  // style gets the invisible candidate layer in place of the native badge layers.
  const out = (style: unknown) => JSON.stringify(withRankedBadges(style as { layers: { id: string }[] }));
  if (satellite) return out(local ? trackLineSatellite : buildStyle(SATELLITE_LABEL_PALETTE, { satellite: true, labels: labelOpt }));
  const scale = ROAD_SCALES[roadThickness] ?? 1;
  if (local && !dimmed && scale === 1 && (theme === "light" || theme === "normal")) return out(trackLineLight);
  if (local && !dimmed && scale === 1 && theme === "dark") return out(trackLineDark);
  const palette = THEME_PALETTES[theme] ?? SATELLITE_LABEL_PALETTE;
  return out(buildStyle(palette, { roadScale: scale, dimmed, labels: labelOpt }));
}

/** The phone's language ("en-AU"), for "My app language" labels. */
function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

export const TrackLineMap = forwardRef<MapHandle, Props>(function TrackLineMap(props, ref) {
  const Mapbox = loadMapbox();
  const mapRef = useRef<MapboxMapView | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const lastCamera = useRef<CameraLike>({ center: props.initialCenter, heading: 0, pitch: 0, zoom: props.initialZoom });
  const gestures = useRef(new GestureTracker());
  const [raised, setRaised] = useState(false);
  const paddingRef = useLatest(props.padding);

  const styleJSON = useMemo(
    () => styleFor(props.theme, props.roadThickness, props.satellite, props.dimmed, props.labelLanguage ?? "local"),
    [props.theme, props.roadThickness, props.satellite, props.dimmed, props.labelLanguage]
  );

  const mapboxPadding = (extra?: Partial<EdgePadding>) => {
    const p = paddingRef.current;
    return {
      paddingTop: p.top + (extra?.top ?? 0),
      paddingRight: p.right + (extra?.right ?? 0),
      paddingBottom: p.bottom + (extra?.bottom ?? 0),
      paddingLeft: p.left + (extra?.left ?? 0),
    };
  };

  useImperativeHandle(ref, () => ({
    animateCamera(camera, options) {
      cameraRef.current?.setCamera(cameraStopFrom(camera, options?.duration));
    },
    animateToRegion(region, duration = 500) {
      const { ne, sw } = boundsOfRegion(region);
      cameraRef.current?.setCamera({
        bounds: { ne, sw },
        padding: mapboxPadding(),
        heading: 0,
        pitch: 0,
        animationDuration: duration,
        animationMode: duration > 0 ? "easeTo" : "none",
      });
    },
    fitToCoordinates(coords, options) {
      const bounds = boundsOfPoints(coords);
      if (!bounds) return;
      cameraRef.current?.setCamera({
        bounds,
        padding: mapboxPadding(options?.edgePadding),
        heading: 0,
        pitch: 0,
        animationDuration: options?.animated === false ? 0 : 600,
        animationMode: options?.animated === false ? "none" : "easeTo",
      });
    },
    getCamera() {
      return Promise.resolve(lastCamera.current);
    },
  }));

  type CameraState = {
    properties: { center: number[]; zoom: number; heading: number; pitch: number; bounds: { ne: number[]; sw: number[] } };
  };
  const remember = (state: CameraState) => {
    const { center, zoom, heading, pitch } = state.properties;
    lastCamera.current = { center: fromPosition(center), zoom: googleZoomFromMapbox(zoom), heading, pitch };
    const shouldRaise = props.show3DBuildings && pitch > BUILDING_EXTRUSION_MIN_PITCH;
    if (shouldRaise !== raised) setRaised(shouldRaise);
  };

  const onUserCameraChanged = useCallback(
    (event: { nativeEvent: { properties?: { isUserInteraction?: boolean } } }) => {
      if (gestures.current.cameraChanged(!!event.nativeEvent.properties?.isUserInteraction)) props.onPanDrag?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onPanDrag]
  );

  // ---- brand / popular-place badges, ranked (map/poiRanking.ts) ----
  const window = useWindowDimensions();
  const [rankedBadges, setRankedBadges] = useState<ReturnType<typeof rankedBadgeCollection>>(() => rankedBadgeCollection([]));
  const rankSeq = useRef(0);
  const driverRef = useLatest(props.driver ?? null);
  const nameField = ((props.labelLanguage ?? "local") === "local" ? null : mapboxNameField(deviceLocale())) ?? "name";
  const rankBadgesNow = async (zoom: number) => {
    const seq = ++rankSeq.current;
    const map = mapRef.current;
    if (!map || zoom < 13 || props.badges === false) {
      setRankedBadges(rankedBadgeCollection([]));
      return;
    }
    try {
      const fc = await map.queryRenderedFeaturesInRect([], [], [BADGE_CANDIDATE_LAYER_ID]);
      const features = (fc?.features ?? []).slice(0, 120);
      const candidates: BadgeCandidate[] = [];
      for (const f of features) {
        const coords = (f.geometry as { coordinates?: number[] })?.coordinates;
        if (!coords) continue;
        const pt = await map.getPointInView(coords as [number, number]);
        const c = candidateFromFeature(f as never, [pt[0], pt[1]], nameField);
        if (c) candidates.push(c);
      }
      if (seq !== rankSeq.current) return;
      const rank = () =>
        rankBadges(candidates, {
          zoom,
          driver: driverRef.current,
          popularity: cachedPopularity(),
          screen: { width: window.width, height: window.height },
        });
      setRankedBadges(rankedBadgeCollection(rank()));
      // Real popularity arrives a moment later; re-rank when it does.
      if (await loadPopularity(candidates.map((c) => ({ key: c.key, name: c.name, lat: c.lat, lng: c.lng })))) {
        if (seq === rankSeq.current) setRankedBadges(rankedBadgeCollection(rank()));
      }
    } catch {
      // Query not available (e.g. style still loading): keep what's shown.
    }
  };

  const onMapIdle = (state: CameraState) => {
    remember(state);
    rankBadgesNow(state.properties.zoom);
    const region = regionFromBounds(state.properties.bounds.ne, state.properties.bounds.sw);
    props.onRegionChangeComplete?.(region, { isGesture: gestures.current.idle() });
  };

  const onPress = async (feature: { geometry: { coordinates: number[] }; properties: { screenPointX: number; screenPointY: number } }) => {
    const coordinate = fromPosition(feature.geometry.coordinates);
    props.onPress?.(coordinate);
    if (!props.onPoiPress || !mapRef.current) return;
    try {
      const hit = await mapRef.current.queryRenderedFeaturesAtPoint(
        [feature.properties.screenPointX, feature.properties.screenPointY],
        [],
        ["poi-labels", RANKED_BADGE_LAYER_ID]
      );
      const poi = hit?.features?.[0];
      const name = poi?.properties?.name_en ?? poi?.properties?.name;
      if (poi && typeof name === "string" && poi.geometry.type === "Point") {
        props.onPoiPress({ name, coordinate: fromPosition(poi.geometry.coordinates as number[]) });
      }
    } catch {
      // Nothing under the tap.
    }
  };

  if (!Mapbox) return <View style={[StyleSheet.absoluteFill, styles.unavailable]} />;
  const { MapView, Camera, Images, Image, FillExtrusionLayer, VectorSource, LineLayer, CameraGestureObserver, ShapeSource, SymbolLayer } = Mapbox;
  const labelPalette = props.satellite ? SATELLITE_LABEL_PALETTE : (THEME_PALETTES[props.theme] ?? SATELLITE_LABEL_PALETTE);

  return (
    <MapView
      ref={(r) => {
        mapRef.current = r;
      }}
      style={StyleSheet.absoluteFill}
      styleJSON={styleJSON}
      compassEnabled={false}
      scaleBarEnabled={false}
      logoPosition={{ bottom: 8, left: 8 }}
      attributionPosition={{ bottom: 8, right: 8 }}
      pitchEnabled
      rotateEnabled
      onMapIdle={onMapIdle as never}
      onCameraChanged={remember as never}
      onPress={onPress as never}
      onDidFinishLoadingMap={props.onMapReady}
    >
      <CameraGestureObserver onCameraChanged={onUserCameraChanged as never} />
      <Camera
        ref={(r) => {
          cameraRef.current = r;
        }}
        defaultSettings={{
          centerCoordinate: [props.initialCenter.longitude, props.initialCenter.latitude],
          zoomLevel: Math.max(0, props.initialZoom - 1),
        }}
        padding={mapboxPadding()}
        animationDuration={300}
      />
      {/* Australian suburb names with postcodes (official ABS data), zoom 11-15. */}
      <ShapeSource id="au-suburbs" shape={auSuburbFeatures()}>
        <SymbolLayer
          id={AU_SUBURB_LAYER_ID}
          minZoomLevel={AU_SUBURB_MIN_ZOOM}
          maxZoomLevel={16}
          belowLayerID="road-label-motorway"
          style={auSuburbLabelStyle(labelPalette) as never}
        />
      </ShapeSource>
      <Images>
        {/* Highway-shield plates, one per colour; the style picks one from each road's own shield
            type and stretches it around the route number. */}
        {SHIELD_PLATES.map((plate) => (
          <Image key={plate} name={`${SHIELD_IMAGE}-${plate}`} stretchX={[[6, 14]]} stretchY={[[6, 14]]}>
            <View style={[styles.shield, { backgroundColor: SHIELD_PLATE_COLOURS[plate], borderColor: plate === "white" ? "#1A1A1A" : "#FFFFFF" }]} />
          </Image>
        ))}
      </Images>
      {raised && (
        <FillExtrusionLayer
          id="buildings-3d"
          sourceID="composite"
          sourceLayerID="building"
          belowLayerID="road-label-service"
          filter={["==", ["get", "extrude"], "true"]}
          minZoomLevel={14}
          maxZoomLevel={22}
          style={{
            fillExtrusionColor: "#E6E8EA",
            fillExtrusionOpacity: 0.85,
            fillExtrusionHeight: ["get", "height"],
            fillExtrusionBase: ["get", "min_height"],
          }}
        />
      )}
      {/* Brand / popular-place badges: the ranked top ones, drawn by us (at most ~12 a screen). */}
      <ShapeSource id="ranked-badges-src" shape={rankedBadges as never}>
        <SymbolLayer
          id={RANKED_BADGE_LAYER_ID}
          minZoomLevel={13}
          style={{
            iconImage: ["get", "icon"],
            iconAnchor: "bottom",
            iconAllowOverlap: true,
            symbolSortKey: ["get", "rank"],
            textField: ["get", "name"],
            textFont: LABEL_FONT,
            textSize: 12,
            textMaxWidth: 9,
            textAnchor: "left",
            textOffset: [1.3, -1.5],
            textOptional: true,
            textColor: labelPalette.streetLabel,
            textHaloColor: labelPalette.labelHalo,
            textHaloWidth: 1.4,
          }}
        />
      </ShapeSource>
      {props.showTraffic && (
        <VectorSource id="traffic" url="mapbox://mapbox.mapbox-traffic-v1">
          <LineLayer
            id="traffic-lines"
            sourceLayerID="traffic"
            belowLayerID="road-label-service"
            filter={["match", ["get", "congestion"], ["moderate", "heavy", "severe"], true, false]}
            style={{
              lineColor: ["match", ["get", "congestion"], "moderate", TRAFFIC.slow, "heavy", TRAFFIC.heavy, "severe", TRAFFIC.standstill, "#00000000"],
              lineWidth: ["interpolate", ["exponential", 1.5], ["zoom"], 10, 1.5, 14, 3, 18, 8],
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        </VectorSource>
      )}
      {props.children}
    </MapView>
  );
});

const styles = StyleSheet.create({
  unavailable: { backgroundColor: "#F7F8F7" },
  shield: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5 },
});
