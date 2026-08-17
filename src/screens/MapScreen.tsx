import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Share, ActivityIndicator, TextInput } from "react-native";
import MapView, {
  PROVIDER_GOOGLE,
  Polyline,
  Marker,
  Circle,
  type Region,
  type MapPressEvent,
} from "react-native-maps";
import { Map3DView, isMap3DSupported, type Map3DViewHandle } from "map3d";
import * as Location from "expo-location";
import { usePowerState } from "expo-battery";
import { loadBoxedTFLiteModel } from "@/services/tfliteVehicleModel";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import BottomSheet from "@gorhom/bottom-sheet";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { MAP_THEME_STYLES } from "@/utils/mapStyle";
import { TRAFFIC_LIGHT_MARKER, SPEED_CAMERA_MARKER } from "@/utils/osmMarkerStyle";
import { clusterPoints } from "@/utils/markerCluster";

import { useLocation } from "@/context/LocationContext";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { MuteButton } from "@/components/MuteButton";
import { CarNavArrow, PersonLocationDot } from "@/components/LocationMarkers";
import { DestinationSearchBar, MY_LOCATION_PLACE_ID } from "@/components/DestinationSearchBar";
import { NavigationInstructionCard } from "@/components/NavigationInstructionCard";
import { NavBottomBar } from "@/components/NavBottomBar";
import { NavOptionsSheet } from "@/screens/NavOptionsSheet";
import { RouteDirectionsSheet } from "@/screens/RouteDirectionsSheet";
import { RouteOptionsCard } from "@/components/RouteOptionsCard";
import { AlertMarker } from "@/components/AlertMarker";
import { AlertBanner } from "@/components/AlertBanner";
import { BannerAdBar } from "@/components/BannerAdBar";
import { AdsErrorBoundary } from "@/components/AdsErrorBoundary";
import { AlertReportSheet } from "@/screens/AlertReportSheet";
import { AlertDetailSheet } from "@/screens/AlertDetailSheet";
import { PlaceInfoSheet } from "@/screens/PlaceInfoSheet";
import { OsmMarkerSheet, type OsmMarkerKind } from "@/screens/OsmMarkerSheet";
import { LiveCameraSheet } from "@/screens/LiveCameraSheet";
import { RestaurantsSheet } from "@/screens/RestaurantsSheet";
import { HotelsSheet } from "@/screens/HotelsSheet";
import { fetchLiveTrafficCameras, type LiveTrafficCamera } from "@/services/liveTrafficCameras";
import {
  getDirections,
  getRouteOptions,
  getDirectionsForMode,
  getModeRouteOptions,
  DirectionsApiError,
  type Route,
  type RouteProfileKey,
  type TravelMode,
} from "@/services/directions";
import {
  findNearestPlace,
  findNearestTransitStation,
  getPlaceInfo,
  reverseGeocode,
  type PlaceDetails,
  type PlaceInfo,
} from "@/services/places";
import {
  distanceKm,
  bearingDegrees,
  distanceToPolylineMeters,
  pointAheadOnPolylineMeters,
  offsetLatLngByHeading,
} from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";
import { createGuidanceState, evaluateGuidance } from "@/services/navigationGuidance";
import { speak, stopSpeaking } from "@/services/voice";
import { formatArrivalClock } from "@/utils/navFormat";
import {
  subscribeVisibleAlerts,
  reportAlert,
  deleteAlert,
  hideAlertForUser,
  confirmAlert,
} from "@/services/alerts";
import { classifyAuRegion } from "@/utils/auStates";
import { sirenDetection } from "@/services/sirenDetection";
import { containsBlockedLanguage, clampToWordLimit, MAX_ALERT_COMMENT_WORDS } from "@/utils/commentFilter";
import { fetchOsmTrafficData, fetchSpeedLimitNear, type OsmTrafficData } from "@/services/osmTrafficData";
import { createLiveShare, updateLiveShare, endLiveShare } from "@/services/liveShare";
import { setNavigationActive } from "@/services/navState";
import { VehicleDetectionScreen } from "@/screens/VehicleDetectionScreen";
import { VehicleDetectionErrorBoundary } from "@/components/VehicleDetectionErrorBoundary";
import type { AlertDoc, AlertType } from "@/types/alert";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { Sentry } from "@/services/sentry";

const DIAGNOSTIC_DISABLE_MAPVIEW = false;
// See onMapPress's POI lookup -- rankby=distance has no radius bound, so this is the sanity
// check that keeps an empty tap (open water, a park, a gap between buildings) from confidently
// showing whatever real business happens to be nearest, however far that actually is.
const MAX_POI_TAP_DISTANCE_METERS = 120;
// Traffic-light cluster badges show this many small light glyphs before folding the rest into a
// "+N" suffix -- see the badge's own render for why (a badge that just kept growing wider for a
// 15-light intersection would stop being a compact marker).
const MAX_CLUSTER_ICONS = 5;
// Same idea for speed-camera clusters, capped lower since that glyph renders much bigger.
const MAX_SPEED_CAMERA_CLUSTER_ICONS = 3;

// Real live-location markers -- see components/LocationMarkers.tsx: a directional arrow badge
// (rotated live with heading via flat+rotation, exactly like the original CSS triangle) while
// actively navigating/driving, and a pulsing location dot (never rotated -- a walking/browsing
// position doesn't have a meaningful "facing direction" the way a moving vehicle does)
// everywhere else. Both replace the platform's native blue dot entirely (showsUserLocation is
// now always false below) so the same custom marker is what's on screen in both states, not a
// dot that swaps to an icon only sometimes.

// Real traffic-jam reroute suggestion (see the periodic check effect below) -- how often to
// re-check, how long to stay quiet after a decline, the minimum genuine time savings worth
// interrupting for, and how close to the destination it stops bothering to check at all.
const TRAFFIC_CHECK_INTERVAL_MS = 90_000;
const TRAFFIC_SUGGESTION_COOLDOWN_MS = 8 * 60_000;
const MIN_SAVED_SECONDS_TO_SUGGEST = 180;
const MIN_REMAINING_METERS_TO_CHECK = 1500;
// How long the suggestion banner stays up before auto-dismissing if the driver doesn't tap
// Yes/No/X -- per explicit request. An unattended banner clears itself the same way a manual
// dismiss does (same cooldown applies) rather than lingering over the map indefinitely.
const TRAFFIC_SUGGESTION_DISPLAY_MS = 10_000;
// The actual trigger window, per explicit request ("traffic ... from their location live -to
// 1km") -- the suggestion only fires off a real, live-traffic delay detected in the next 1km
// of the route ahead of the driver, not an average over the whole remaining trip (which could
// hide a real jam right ahead behind an otherwise-clear rest of the trip, or flag one that's
// nowhere near the driver yet).
const NEAR_TERM_TRAFFIC_CHECK_METERS = 1000;

// Driving's 3-way route picker order -- same order/keys RouteOptionsCard.tsx's own local
// PROFILE_ORDER uses for its list rows, kept here too (not shared/exported) since this is the
// only other place that needs it and duplicating one small array beats a wider shared-module
// refactor for it.
const ROUTE_PROFILE_ORDER: RouteProfileKey[] = ["normal", "fastest", "safest"];
// Where along each route's own polyline its floating ETA pill lands -- staggered per profile
// (not all at the literal midpoint) so three pills sitting on largely overlapping road sections
// don't all render in exactly the same spot. Index-matched to ROUTE_PROFILE_ORDER.
const ROUTE_ETA_PILL_FRACTIONS = [0.35, 0.5, 0.65];

// Index-based (not distance-based) point along a polyline -- good enough for placing a small
// floating label roughly along a route's own path without needing real cumulative-distance
// walking the way pointAheadOnPolylineMeters (used for live driving position) does.
function pointAtPolylineFraction(polyline: LatLng[], fraction: number): LatLng | null {
  if (polyline.length === 0) return null;
  const idx = Math.min(polyline.length - 1, Math.max(0, Math.floor(polyline.length * fraction)));
  return polyline[idx];
}

export function MapScreen() {
  const { location } = useLocation();
  const { user } = useAuth();
  const { settings, updateSettings, voiceEnabled, voiceVolume } = useSettings();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const mapRef = useRef<MapView>(null);
  // True once the native MapView has actually attached its ref (react-native-maps' own
  // onMapReady) -- see the SF-placeholder correction effect below for why this matters: without
  // it, that effect could fire (and permanently mark itself done via recenteredOnFixRef) before
  // mapRef.current was non-null yet, silently no-op through the `?.`, and never get a second
  // chance.
  const [mapReady, setMapReady] = useState(false);
  const reportSheetRef = useRef<BottomSheet>(null);
  const detailSheetRef = useRef<BottomSheet>(null);
  const placeInfoSheetRef = useRef<BottomSheet>(null);
  const osmMarkerSheetRef = useRef<BottomSheet>(null);
  const liveCameraSheetRef = useRef<BottomSheet>(null);
  const restaurantsSheetRef = useRef<BottomSheet>(null);
  const hotelsSheetRef = useRef<BottomSheet>(null);
  const directionsSheetRef = useRef<BottomSheet>(null);
  const navOptionsSheetRef = useRef<BottomSheet>(null);

  const [route, setRoute] = useState<Route | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  // Keeps the module-level navState flag (read by AppOpenAdManager, mounted outside this
  // screen entirely) in sync with whether turn-by-turn is actually active -- the app-open ad
  // frequency-capping logic must never show a full-screen ad over an in-progress route, even
  // when that "app open" is really just a background->foreground resume mid-navigation.
  useEffect(() => {
    setNavigationActive(!!route);
    return () => setNavigationActive(false);
  }, [route]);
  // Real measured height of NavigationInstructionCard (see its onHeightChange) -- the button
  // column below it (Recenter/mute/settings) positions off this instead of a fixed guess, so
  // it never ends up partly hidden behind a taller-than-expected card. 96 is just the
  // reasonable single-line fallback for the one frame before the first real measurement lands.
  const [instructionCardHeight, setInstructionCardHeight] = useState(96);
  // Same pattern as instructionCardHeight above, for RouteOptionsCard (see its onHeightChange)
  // -- the route-preview polyline's fitToCoordinates bottom padding uses this real number
  // instead of a fixed guess, so the previewed route never ends up partly hidden behind the
  // card. 320 is a reasonable fallback for the one frame before the first real measurement.
  const [routeCardHeight, setRouteCardHeight] = useState(320);
  // Same measured-height pattern again, for the new bottom trip bar (NavBottomBar) -- the FAB
  // column's bottom offset (see its render call site) adds this so the two never overlap. 76
  // is a reasonable fallback for the one frame before the first real measurement lands.
  const [bottomBarHeight, setBottomBarHeight] = useState(76);
  const guidanceRef = useRef(createGuidanceState());
  // Real, confirmed cause of the reported "volume glitching while adjusting it during
  // navigation": the guidance-advancement effect below used to list voiceVolume as a dependency
  // just so its own speak() call could read the current value -- meaning every single tick of
  // dragging the in-app volume slider (many times a second) re-ran the ENTIRE guidance
  // evaluation (evaluateGuidance, which mutates guidanceRef's own shared state) even though the
  // driver's position hadn't changed at all. That's a lot of redundant native TTS-adjacent work
  // firing in a tight loop exactly while the slider is being dragged. A ref instead of a
  // dependency lets speak() still read the live volume without the effect needing to re-run
  // (and re-touch guidance state) just because volume changed.
  const voiceVolumeRef = useRef(voiceVolume);
  voiceVolumeRef.current = voiceVolume;
  // True only while a fresh route is actively being fetched after drifting off the current one
  // -- drives the small "Rerouting..." banner below.
  const [rerouting, setRerouting] = useState(false);
  // Exact arrival coordinate for the highlighted destination marker below -- kept separate
  // from route.polyline's last point so it's the real picked place, not whatever pixel the
  // polyline decoder happened to end on.
  const [destinationLatLng, setDestinationLatLng] = useState<LatLng | null>(null);
  // "hybrid" = satellite imagery + road/place labels, not bare "satellite" -- an unlabeled
  // satellite view is close to unusable while actually navigating, and this is what most map
  // apps' own "Satellite" button actually switches to.
  const [mapType, setMapType] = useState<"standard" | "hybrid">("standard");

  // Route-choice flow: destination picked -> fetch all 3 profiles -> user picks one (with a
  // live preview of that profile's line on the map) -> Start commits it into `route` above.
  const [pendingDestination, setPendingDestination] = useState<PlaceDetails | null>(null);
  const [stopLocation, setStopLocation] = useState<LatLng | null>(null);
  const [pickingStop, setPickingStop] = useState(false);
  // Real custom "From" -- Google/Apple-Maps-style, lets a route be planned between any two real
  // searched places, not just always starting from the driver's own live GPS fix. null means
  // "use my live location" (the previous, only behavior) -- deliberately not a frozen LatLng
  // snapshot, so routeOriginLatLng below stays live (keeps tracking GPS) whenever the driver
  // hasn't actually picked a different starting point. Reset back to null (My Location) whenever
  // the route-planning flow closes (Start or Cancel), so a custom origin never silently carries
  // over into the *next*, unrelated destination search.
  const [originOverride, setOriginOverride] = useState<PlaceDetails | null>(null);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [routeOptions, setRouteOptions] = useState<Record<RouteProfileKey, Route> | null>(null);
  // Driving gets the 3-way Normal/Fastest/Safest picker above; every other travel mode gets a
  // single real route here instead -- Google has exactly one meaningful route per mode in the
  // overwhelming majority of cases (transit in particular is governed by real timetables, not
  // alternative road choices), so a 3-way picker wouldn't mean anything for them.
  const [modeRoute, setModeRoute] = useState<Route | null>(null);
  // Every real alternative Google returned for the current walking/bicycling/transit trip --
  // `modeRoute` above always mirrors whichever one of these is currently selected/previewed,
  // so every other place that already reads `modeRoute` (preview polyline, Start, reroute)
  // keeps working unchanged; this list only exists to drive the picker itself.
  const [modeRouteOptions, setModeRouteOptions] = useState<Route[]>([]);
  const [selectedModeRouteIndex, setSelectedModeRouteIndex] = useState(0);
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [loadingRouteOptions, setLoadingRouteOptions] = useState(false);
  const [routeOptionsError, setRouteOptionsError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<RouteProfileKey>("normal");

  const [nearbyAlerts, setNearbyAlerts] = useState<AlertDoc[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertDoc | null>(null);

  // Static OSM traffic-light/speed-camera layer -- fetched per visible map region (debounced
  // on region-change-complete, gated behind a min-zoom so a zoomed-out view doesn't fire an
  // Overpass query over a huge area), independent of the live community AlertType markers.
  const [osmData, setOsmData] = useState<OsmTrafficData | null>(null);
  const [osmLoading, setOsmLoading] = useState(false);
  // Current zoom level (region.latitudeDelta), tracked purely to size the traffic-light
  // clustering grid below -- bigger delta (zoomed out) means bigger cluster cells, so a huge
  // real-world cluster of signals stays a handful of markers until you actually zoom in on it.
  const [osmZoomDelta, setOsmZoomDelta] = useState(0.05);
  const osmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bannerVisible, setBannerVisible] = useState(false);
  const [placingAlert, setPlacingAlert] = useState(false);
  // Real "set incidents from 2 views" toggle, only offered while reporting during active
  // navigation -- pitches the camera to a front/driving perspective at whatever spot the user
  // has already panned to (see togglePlacementFrontView below), for easier placement of a
  // location just passed. Deliberately resets to false whenever placement starts/ends so it
  // never carries a stale tilt into the next report.
  const [placementFrontView, setPlacementFrontView] = useState(false);
  // Tracks whether either alert sheet is actually open (not just mounted -- both are always
  // mounted, controlled via ref) so the FAB column below can hide itself while a sheet
  // covers most of the screen -- previously the FABs stayed rendered at their normal
  // position underneath, and whichever one happened to sit just above the sheet's top edge
  // showed as an oddly clipped sliver peeking out from behind it.
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [placeInfoSheetOpen, setPlaceInfoSheetOpen] = useState(false);
  const [directionsSheetOpen, setDirectionsSheetOpen] = useState(false);
  const [osmMarkerSheetOpen, setOsmMarkerSheetOpen] = useState(false);
  const [liveCameraSheetOpen, setLiveCameraSheetOpen] = useState(false);
  const [navOptionsSheetOpen, setNavOptionsSheetOpen] = useState(false);
  const [restaurantsSheetOpen, setRestaurantsSheetOpen] = useState(false);
  const [hotelsSheetOpen, setHotelsSheetOpen] = useState(false);
  const anySheetOpen =
    reportSheetOpen ||
    detailSheetOpen ||
    placeInfoSheetOpen ||
    osmMarkerSheetOpen ||
    liveCameraSheetOpen ||
    directionsSheetOpen ||
    navOptionsSheetOpen ||
    restaurantsSheetOpen ||
    hotelsSheetOpen;
  const [alertPlacementLatLng, setAlertPlacementLatLng] = useState<LatLng | null>(null);
  // Real, confirmed cause of alerts appearing twice: confirmAlertPlacement is async
  // (reportAlert is a real Firestore write), and nothing previously stopped a second tap on
  // "Set" -- landing before the first write resolves and placingAlert flips back to false --
  // from firing reportAlert a second time, creating two separate documents for the one report.
  // A ref (not just the submittingAlert state below) because it must block synchronously on
  // the very next tap, not after a re-render; submittingAlert itself just drives the button's
  // visible disabled/spinner state.
  const submittingAlertRef = useRef(false);
  const [submittingAlert, setSubmittingAlert] = useState(false);
  // Optional "up to 7 words" comment, per explicit request -- typed while placing the pin
  // (below), clamped live to the word cap on every keystroke (see commentFilter.ts) and
  // re-validated for blocked language both here (blocks Set, see confirmAlertPlacement) and
  // again inside reportAlert itself before it's ever written. Reset on both a successful submit
  // and Cancel so the next report always starts blank.
  const [alertComment, setAlertComment] = useState("");
  const alertCommentBlocked = containsBlockedLanguage(alertComment);
  const onChangeAlertComment = useCallback((text: string) => {
    setAlertComment(clampToWordLimit(text));
  }, []);

  // Real "tap a shop, see its info" -- iOS's native MapKit provider here has no onPoiClick
  // event (react-native-maps only fires that on Google Maps/Android), so instead any map tap
  // looks up whatever business is closest to that point via Places Nearby Search + Details.
  const [placeInfo, setPlaceInfo] = useState<PlaceInfo | null>(null);
  const [placeInfoLoading, setPlaceInfoLoading] = useState(false);

  const [osmMarkerKind, setOsmMarkerKind] = useState<OsmMarkerKind | null>(null);
  const [osmMarkerLocation, setOsmMarkerLocation] = useState<LatLng | null>(null);
  const onOsmMarkerPress = useCallback((kind: OsmMarkerKind, location: LatLng) => {
    setOsmMarkerKind(kind);
    setOsmMarkerLocation(location);
    osmMarkerSheetRef.current?.expand();
  }, []);

  // Real NSW government live traffic camera feed -- see services/liveTrafficCameras.ts.
  // Small (~197 camera), near-static dataset, so this fetches the full list once the layer is
  // first turned on rather than re-querying per map pan. Mirrors web's App.tsx exactly.
  const [liveCameras, setLiveCameras] = useState<LiveTrafficCamera[]>([]);
  const [selectedLiveCamera, setSelectedLiveCamera] = useState<LiveTrafficCamera | null>(null);
  useEffect(() => {
    if (!settings.showLiveCameras || liveCameras.length > 0) return;
    fetchLiveTrafficCameras()
      .then(setLiveCameras)
      .catch((err) => console.warn("[map] failed to load live traffic cameras", err));
  }, [settings.showLiveCameras, liveCameras.length]);
  const onLiveCameraPress = useCallback((camera: LiveTrafficCamera) => {
    setSelectedLiveCamera(camera);
    liveCameraSheetRef.current?.expand();
  }, []);
  const [bannerMessage, setBannerMessage] = useState("");
  const [detectionOpen, setDetectionOpen] = useState(false);
  // Same live reading/threshold Settings' own battery notice uses (see SettingsScreen.tsx) --
  // shown here as a small crossed-battery badge on the AI Detection entry points themselves
  // (the FAB and the nav options row) so the warning is visible right where a driver decides to
  // open it, not just buried in Settings. Deliberately advisory only, never disables the
  // Pressable or blocks the tap -- the driver can still open detection under 50% if they want
  // to. And because this only reads live here in MapScreen (not inside VehicleDetectionScreen
  // itself), a session already open when battery crosses under 50% is completely unaffected --
  // the badge only ever shows on the closed-screen entry points, never interrupts a session
  // already running.
  const { batteryLevel: detectionBatteryLevel } = usePowerState();
  const detectionBatteryLow = detectionBatteryLevel >= 0 && detectionBatteryLevel * 100 < 50;
  // Starts loading the vehicle-detection model (the native TFLite model a Frame Processor calls
  // into -- see tfliteVehicleModel.ts) in the background the moment the map screen is up,
  // instead of only starting when the driver actually taps "AI Detection" -- the model load
  // itself is genuine, real computation that takes real time no matter when it runs; this just
  // moves that wait to happen silently while the driver is looking at the map, not as a
  // blocking screen the instant they ask for the feature. loadBoxedTFLiteModel() caches its
  // result in a module-level promise, so if this finishes before AI Detection is opened, opening
  // it is instant; if it's still in flight, the detection screen just awaits the same promise
  // instead of starting a second load. 300ms delay to yield to the map's own initial
  // render/GPS fix at cold-launch, per the same "opening AI Detection should feel instant" ask
  // that originally set this up for the older tfjs model this replaced: the model is fully
  // bundled in the app binary (no network dependency to worry about competing for bandwidth with
  // anything else at launch), so there's very little real reason to keep the driver waiting on
  // this beyond a single frame's worth of head start for the map's own first paint. Errors are
  // swallowed here on purpose -- a failed background preload isn't user-facing;
  // VehicleDetectionScreen's own retry UI handles a real failure if the driver actually opens
  // the feature.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadBoxedTFLiteModel().catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  // Real photorealistic 3D satellite (Android only for now, see modules/map3d) -- Stage 1:
  // core rendering + live position + the active route only, mirroring the web build's own
  // staged rollout. Renders as an overlay on top of the existing MapView, matching how the
  // web version layers its own Map3DElement over the classic 2D map.
  const [show3D, setShow3D] = useState(false);
  // Tilted, near-horizontal "front view" of the 3D tiles/buildings on top of the default
  // top-down 3D angle -- the module's own `tilt(deltaDeg)` is relative, not absolute, but
  // since Map3DView is only ever mounted while show3D is true (unmounts fully when it's
  // toggled off), each mount starts from the same default camera, so a fixed +60/-60 delta
  // pair is a safe, always-correct toggle rather than needing to track absolute angle.
  const [frontView, setFrontView] = useState(false);
  const map3DRef = useRef<Map3DViewHandle>(null);

  useEffect(() => {
    if (!show3D) setFrontView(false);
  }, [show3D]);

  const toggleFrontView = useCallback(() => {
    setFrontView((was) => {
      const next = !was;
      map3DRef.current?.tilt(next ? 60 : -60);
      return next;
    });
  }, []);

  // Apple-Maps-style close-follow camera: tilted, zoomed in, rotates to match the direction
  // of travel. Uses react-native-maps' own `camera`/`animateCamera` API (pitch/heading/zoom),
  // NOT the custom Map3DView module above -- a standard MapView camera call, zero native-module
  // risk, which matters given the iOS crash history around the custom 3D module. Defaults on
  // whenever navigation starts, and the user can drop back to a flat top-down view without
  // exiting navigation entirely.
  const [followTilt, setFollowTilt] = useState(true);

  // Whether the tilted chase-cam is currently pulled back to the wider "overview" pose (same
  // pose enterOverviewMode below already uses when tapping the route line) or the tight
  // close-follow pose -- purely a camera distance/tilt choice, independent of followTilt
  // itself. Unlike the X/Recenter pair (which fully drops out of following on manual pan or
  // tap), both states here keep the camera actively tracking live position/heading -- this is
  // the small circle toggle button's own state, not an "exit follow" action.
  // Defaults false -- explicit request: navigation should start already in the tight, tilted
  // "front view" (pitch 60/zoom 18, matching a driver's-eye chase-cam), not the pulled-back
  // overview, and never require a manual adjustment to get there. The pulled-back pose is now
  // the opt-in one, reached via the locate button (see onLocateButtonPress below).
  const [overviewMode, setOverviewMode] = useState(false);
  useEffect(() => {
    // Exiting follow entirely (manual pan, or the X button) always resets this back to the
    // default front-view pose for next time -- resuming follow (Recenter) shouldn't silently
    // land back in the pulled-back overview from a previous session.
    if (!followTilt) setOverviewMode(false);
  }, [followTilt]);

  const currentLatLng = useMemo(
    () =>
      location
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null,
    [location]
  );

  // The real route origin -- a custom "From" place if one's been picked, otherwise the driver's
  // own live GPS fix (the only behavior before this existed). Only meaningful for the
  // pre-Start planning flow below (fetchRouteOptions/onSelectTravelMode) -- once a trip is
  // actually started, live navigation/reroute always tracks real GPS via currentLatLng directly,
  // same as before, since you can't actually be turn-by-turn guided from a place you're not at.
  const routeOriginLatLng = originOverride?.location ?? currentLatLng;
  // Real live street address (house number + street) for the driver's own current position,
  // reverse-geocoded from GPS -- shown in the persistent origin row near the search bar instead
  // of the generic "My Location" placeholder, and kept live as the driver actually moves (e.g.
  // resolves to their home address while parked there, then updates to wherever they are once
  // they drive off). "My Location" is only ever the fallback for the brief window before the
  // very first reverse-geocode resolves, or if a lookup fails -- liveAddress itself is never
  // cleared on a failed refresh, so a transient network hiccup doesn't blank out an address that
  // was already showing.
  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const lastAddressFetchRef = useRef<LatLng | null>(null);
  const addressFetchInFlightRef = useRef(false);
  useEffect(() => {
    if (!currentLatLng) return;
    const last = lastAddressFetchRef.current;
    const movedFar =
      !last || distanceKm(last.latitude, last.longitude, currentLatLng.latitude, currentLatLng.longitude) >= 0.08;
    if (!movedFar) return;
    if (addressFetchInFlightRef.current) return;

    lastAddressFetchRef.current = currentLatLng;
    addressFetchInFlightRef.current = true;
    reverseGeocode(currentLatLng)
      .then((address) => {
        if (address) setLiveAddress(address);
      })
      .catch((err) => {
        Sentry.logger.error("map: reverse geocode failed", { error: String(err) });
      })
      .finally(() => {
        addressFetchInFlightRef.current = false;
      });
  }, [currentLatLng]);
  const routeOriginLabel = originOverride?.name ?? liveAddress ?? "My Location";

  // iOS's real 3D-buildings path -- deliberately NOT the custom Map3DView module above (that
  // one wraps Google's still-experimental, pre-GA "Maps 3D SDK for iOS", which has a real,
  // confirmed device-specific crash history on this exact app -- see followTilt's own comment
  // further down). Instead this tilts the SAME already-running, already-stable classic Google
  // Maps SDK camera (react-native-maps, zero new native code, the exact mechanism the
  // chase-cam during navigation already uses every single drive) far enough that its own
  // native 3D building extrusion kicks in -- literally the same "tilt to see buildings in 3D"
  // behavior Google Maps' own app has, just triggered from a standalone toggle instead of only
  // while navigating. Only runs while NOT actively navigating (`!route`), so it can never
  // fight the chase-cam's own pitch/zoom ownership during a real drive.
  useEffect(() => {
    if (isMap3DSupported || !currentLatLng || route) return;
    if (show3D) {
      mapRef.current?.animateCamera(
        { center: currentLatLng, pitch: 65, zoom: 18.5 },
        { duration: 700 }
      );
    } else {
      mapRef.current?.animateCamera({ pitch: 0 }, { duration: 500 });
    }
  }, [show3D, isMap3DSupported, currentLatLng, route]);

  // `initialRegion` above is a mount-time-only prop, so it never moves the map once the very
  // first real GPS fix actually lands -- this is that correction, firing exactly once as soon
  // as a real position exists (skipped while navigating since confirmRoute/the chase-cam
  // effects already own the camera then). Without this, a location permission grant + first fix
  // landing even a moment after the map's first render left the map stuck on the placeholder
  // coordinate for the rest of the session -- the real, confirmed "why is it showing San
  // Francisco" bug, not a rare edge case.
  //
  // Also gated on mapReady, not just currentLatLng -- a real, confirmed second cause of the
  // exact same symptom: on a fast GPS fix (already-granted permission from a previous session),
  // currentLatLng can resolve before the native MapView has actually attached mapRef. Without
  // this gate, the effect fired anyway, `mapRef.current?.animateCamera` silently no-op'd through
  // the `?.`, and recenteredOnFixRef was already marked done -- a real correction that was
  // supposed to happen just silently never did, permanently, for the rest of the session.
  const recenteredOnFixRef = useRef(false);
  useEffect(() => {
    if (recenteredOnFixRef.current || !currentLatLng || route || !mapReady) return;
    recenteredOnFixRef.current = true;
    mapRef.current?.animateCamera({ center: currentLatLng }, { duration: 500 });
  }, [currentLatLng, route, mapReady]);

  // GPS "course" heading (location.coords.heading) is a real device/OS-reported value, but a
  // genuinely unreliable one -- iOS commonly reports it as -1 ("invalid") at low speed, right
  // after a stop, or for a few fixes after starting to move again, which is exactly when a
  // driver is most likely to be turning onto a new street. Defaulting straight to 0 in that
  // case (the old behavior) meant the map silently snapped to "facing north" and stayed there
  // instead of rotating with an actual turn -- a real, confirmed bug, not just a rare edge case.
  // The fallback below derives a real heading from the bearing between the last two GPS fixes
  // instead of giving up -- genuine, live movement direction, just computed from position deltas
  // rather than read off the GPS chip's own course field.
  const derivedHeadingRef = useRef(0);
  const prevLatLngForHeadingRef = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!currentLatLng) return;
    const prev = prevLatLngForHeadingRef.current;
    prevLatLngForHeadingRef.current = currentLatLng;
    if (!prev) return;
    const movedMeters =
      distanceKm(prev.latitude, prev.longitude, currentLatLng.latitude, currentLatLng.longitude) * 1000;
    // Skip tiny/noisy movement (GPS jitter while stationary or barely moving) -- recomputing a
    // bearing from a couple of meters of noise would make the arrow/camera spin erratically
    // instead of just holding the last known real direction of travel, which is what every real
    // nav app does while stopped at a light or in traffic.
    if (movedMeters < 3) return;
    derivedHeadingRef.current = bearingDegrees(
      prev.latitude,
      prev.longitude,
      currentLatLng.latitude,
      currentLatLng.longitude
    );
  }, [currentLatLng]);

  const heading =
    location?.coords.heading != null && location.coords.heading >= 0
      ? location.coords.heading
      : derivedHeadingRef.current;

  // Real posted speed limit for the road the driver is currently on, from OpenStreetMap's
  // maxspeed tags (see osmTrafficData.ts's fetchSpeedLimitNear) -- mirrors the web app's own
  // implementation (web/src/App.tsx). Refetched after moving ~50m (a live GPS track shouldn't
  // hammer the Overpass API every tick) OR the instant the active turn-by-turn step changes --
  // a step change means the driver just turned onto a different road, the single most reliable
  // "the speed limit may have just changed" signal already available, and waiting on the
  // distance threshold alone could leave the old road's number showing for a few seconds right
  // after a turn. fetchSpeedLimitNear also gets the driver's live heading now, so it can prefer
  // the road that's actually being driven on over a merely-closer crossing street right at an
  // intersection (see its own comment). Skipped entirely while a fetch is already in flight.
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);
  // The road the driver is currently on -- from the exact same lookup as speedLimitKmh (see
  // fetchSpeedLimitNear's own SpeedLimitResult.roadName), just previously discarded. Shown on
  // the nav card as its own "current road" row, distinct from the next-turn instruction text.
  const [currentRoadName, setCurrentRoadName] = useState<string | null>(null);
  const lastSpeedLimitFetchRef = useRef<LatLng | null>(null);
  const lastSpeedLimitStepIndexRef = useRef<number | null>(null);
  const speedLimitFetchInFlightRef = useRef(false);
  useEffect(() => {
    if (!route || !currentLatLng) return;
    const stepChanged = lastSpeedLimitStepIndexRef.current !== activeStepIndex;
    const last = lastSpeedLimitFetchRef.current;
    const movedFar =
      !last || distanceKm(last.latitude, last.longitude, currentLatLng.latitude, currentLatLng.longitude) >= 0.05;
    if (!stepChanged && !movedFar) return;
    if (speedLimitFetchInFlightRef.current) return;

    lastSpeedLimitFetchRef.current = currentLatLng;
    lastSpeedLimitStepIndexRef.current = activeStepIndex;
    speedLimitFetchInFlightRef.current = true;
    fetchSpeedLimitNear(currentLatLng.latitude, currentLatLng.longitude, heading)
      .then((result) => {
        setSpeedLimitKmh(result?.kmh ?? null);
        setCurrentRoadName(result?.roadName ?? null);
      })
      .catch(() => {
        setSpeedLimitKmh(null);
        setCurrentRoadName(null);
      })
      .finally(() => {
        speedLimitFetchInFlightRef.current = false;
      });
  }, [route, currentLatLng, activeStepIndex, heading]);
  useEffect(() => {
    if (!route) {
      setSpeedLimitKmh(null);
      setCurrentRoadName(null);
      lastSpeedLimitFetchRef.current = null;
    }
  }, [route]);

  // Live device compass heading -- deliberately separate from `heading` above, which is the
  // direction of TRAVEL (GPS course/derived bearing) and is what the puck arrow + chase-cam
  // stay locked to. This is which way the PHONE ITSELF is physically pointing right now
  // (magnetometer), which can easily differ -- held at an angle, mounted sideways, spun around
  // in a cupholder -- without that meaning the car actually turned. Rendered as a separate
  // highlight cone on the puck (below) so the route-facing arrow never wobbles with the phone,
  // while the cone gives a live, real "which way is my phone facing" signal on top of it.
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!route) {
      setDeviceHeading(null);
      return;
    }
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((headingData) => {
      // trueHeading is -1 when the OS can't derive it yet (no location fix for magnetic
      // declination) -- magHeading is still a real, live compass reading in that case, just
      // relative to magnetic north instead of true north, close enough for a visual cone.
      const value = headingData.trueHeading >= 0 ? headingData.trueHeading : headingData.magHeading;
      if (!cancelled && value >= 0) setDeviceHeading(value);
    }).then((sub) => {
      if (cancelled) sub.remove();
      else subscription = sub;
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [route]);

  // Guards the very first tick after a route starts so the fitToCoordinates overview (below,
  // in onDestinationSelected) gets a moment on screen before the camera snaps into the tilted
  // close-follow -- same "show the whole route, then follow" beat Apple Maps uses.
  const navStartedAtRef = useRef(0);
  // Set once shareEta actually starts a live share for the current trip; cleared on
  // exitNavigation. Kept as a ref (not state) since only the periodic-update interval and
  // exitNavigation read it, and neither needs a re-render when it changes.
  const liveShareIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Also skips while vehicle detection is open -- see detectionOpen's own effect-gating
    // comment further below for why: the MapView is fully covered by that modal and this
    // native camera animation has zero visible effect while hidden, but still costs real,
    // continuous native work stacked directly on top of vehicle detection's own tfjs
    // inference + camera capture loop, a genuine, confirmed contributor to detection
    // crashing/black-screening when opened mid-navigation.
    // Also skips while placing an alert -- this real, root-caused bug: without this guard,
    // this effect kept re-centering the camera on the driver's own live position on every GPS
    // tick throughout an entire placement session (every ~2s/5m while actually driving),
    // fighting the user's manual pan of the fixed-center pin and, via onRegionChangeComplete,
    // silently overwriting alertPlacementLatLng back toward wherever the driver currently is --
    // not wherever they'd actually panned the pin to. That's the confirmed cause of "Set"
    // saving a different spot than the one the pin visually showed.
    if (!route || !followTilt || !currentLatLng || detectionOpen || placingAlert) return;
    if (Date.now() - navStartedAtRef.current < 1200) return;
    // Deliberately omits pitch/zoom here (animateCamera only touches the fields it's given,
    // leaving the rest alone) -- GPS updates land every ~2s or every 5m travelled, which while
    // actually driving can be several times a second. Including a fixed pitch/zoom on every one
    // of those ticks was re-snapping the camera back and fighting a user's manual two-finger
    // tilt/pinch almost as soon as they started it, making that real, native gesture feel
    // broken even though it works fine on its own. Pitch/zoom are only ever set once, when
    // follow-tilt is first entered (toggleFollowTilt/enterOverviewMode below) -- after that, only
    // center/heading keep tracking live position/direction of travel.
    mapRef.current?.animateCamera({ center: currentLatLng, heading }, { duration: 600 });
  }, [route, followTilt, currentLatLng, heading, detectionOpen, placingAlert]);

  // Actually applies the "tilted, zoomed in" chase cam the comment above promises -- followTilt
  // defaulting to true was previously the *only* thing that happened on nav start; the per-tick
  // effect above deliberately never sets pitch/zoom (by design, so it doesn't fight a manual
  // tilt gesture), and no other code path ever applied one either. Tracks whether it's already
  // been applied for the *current* follow-tilt session via a ref flag, reset whenever
  // route/followTilt changes (below) -- rather than the previous one-shot setTimeout, which
  // fired exactly once at a fixed moment and, if no GPS fix existed yet at that exact instant
  // (a real, confirmed race, not hypothetical), silently gave up for the rest of that navigation
  // session with no retry. This version instead just checks "already applied?" on every GPS
  // tick and, if not, tries again -- so it's naturally
  // retried on the very next real position fix instead of only ever getting one shot.
  const chaseCamAppliedRef = useRef(false);
  useEffect(() => {
    // Don't clobber enterOverviewMode's own "already handled, don't reapply the default chase
    // cam" flag -- it sets chaseCamAppliedRef itself right before this effect would otherwise
    // run on the same followTilt-becomes-true transition and immediately undo it.
    if (Date.now() - lineTapAtRef.current < 300) return;
    chaseCamAppliedRef.current = false;
  }, [route, followTilt]);

  useEffect(() => {
    // See the per-tick effect above for why detectionOpen also skips this -- the map is fully
    // hidden behind the vehicle-detection modal in that state, so there's nothing to gain from
    // animating its camera, only real native work stacked on top of an already CPU/memory-heavy
    // screen. Also skips while placing an alert, same reasoning as the per-tick effect above --
    // this one only fires once per follow-tilt session in practice (chaseCamAppliedRef), but if
    // that ref were ever reset while a placement was in progress this would otherwise yank the
    // camera hard away from the pin the driver is mid-pan on.
    if (!route || !followTilt || detectionOpen || placingAlert) return;
    if (chaseCamAppliedRef.current) return;
    if (!currentLatLng) return;
    // enterOverviewMode (tap the route line) sets chaseCamAppliedRef itself and applies its own
    // pulled-back camera -- this only ever needs to handle the "just started/resumed following"
    // case, not the "user tapped the line" one.
    if (Date.now() - navStartedAtRef.current < 1200) return;
    chaseCamAppliedRef.current = true;
    // overviewMode defaults false -- see its own comment -- so a fresh nav session lands on the
    // tight, tilted front-view pose by default; the pulled-back pose only applies here if the
    // driver had already switched to it (tapping the locate button while already following)
    // before this fires, e.g. resuming follow after a manual pan while already pulled back.
    mapRef.current?.animateCamera(
      overviewMode
        ? { center: currentLatLng, heading, pitch: 45, zoom: 15 }
        : { center: currentLatLng, heading, pitch: 60, zoom: 18 },
      { duration: 700 }
    );
  }, [route, followTilt, detectionOpen, currentLatLng, heading, overviewMode, placingAlert]);

  const toggleFollowTilt = useCallback(() => {
    setFollowTilt((was) => {
      const next = !was;
      if (!next && currentLatLng) {
        // A bit closer than the old zoom 15 -- "keep it lower, not too high" -- 15 read as too
        // zoomed-out/distant for a normal driving view once the tilted close-follow (zoom 18)
        // was the point of comparison.
        mapRef.current?.animateCamera(
          { center: currentLatLng, heading: 0, pitch: 0, zoom: 17 },
          { duration: 500 }
        );
      }
      return next;
    });
  }, [currentLatLng]);

  // General-purpose "snap back to my location" -- unlike the nav-only Recenter pill above
  // (only ever rendered once route && !followTilt), this is meant to be on screen at all times,
  // browsing the map with no destination picked included, so panning/zooming away always has a
  // way back. While actively navigating it just resumes the existing chase-cam follow instead
  // of animating the camera itself, so it doesn't fight/duplicate that effect's own camera work.
  const onRecenter = useCallback(() => {
    if (!currentLatLng) return;
    if (route) {
      if (!followTilt) toggleFollowTilt();
      return;
    }
    mapRef.current?.animateCamera({ center: currentLatLng }, { duration: 500 });
  }, [currentLatLng, route, followTilt, toggleFollowTilt]);

  // Tapping the route line pulls the camera back into a wider, still-tilted "overview" --
  // Apple/Google Maps' own convention when you tap the route during nav: not the tight
  // chase-cam (that's what the small toggle button gives you), but a pulled-back 3D view that
  // shows the surrounding blocks/buildings around your position, not just the next turn. Sets
  // followTilt=true so the same exit ("X") control in topRightControls works to back out of it,
  // and overviewMode=true so the small circle toggle button (below) shows the right icon/state
  // too, even though this action was triggered by tapping the line rather than that button.
  const lineTapAtRef = useRef(0);
  const enterOverviewMode = useCallback(() => {
    lineTapAtRef.current = Date.now();
    // Marks the chase-cam as "already handled" for this follow-tilt session so the default
    // chase-cam effect doesn't try to reapply its own pitch/zoom over this pulled-back view on
    // the very next GPS tick -- this call sets the camera explicitly right below.
    chaseCamAppliedRef.current = true;
    setFollowTilt(true);
    setOverviewMode(true);
    if (currentLatLng) {
      mapRef.current?.animateCamera(
        { center: currentLatLng, heading, pitch: 45, zoom: 15 },
        { duration: 500 }
      );
    }
  }, [currentLatLng, heading]);

  // The actual camera-height swap between the pulled-back "overview" pose and the tight
  // "front view" pose -- used by the locate button below. Reuses the exact same two poses the
  // default-apply effect above and enterOverviewMode (tapping the route
  // line) already use, so every path into either height lands on the same camera position.
  const applyOverviewPose = useCallback(
    (nextOverview: boolean) => {
      if (!currentLatLng) return;
      chaseCamAppliedRef.current = true;
      setOverviewMode(nextOverview);
      mapRef.current?.animateCamera(
        nextOverview
          ? { center: currentLatLng, heading, pitch: 45, zoom: 15 }
          : { center: currentLatLng, heading, pitch: 60, zoom: 18 },
        { duration: 500 }
      );
    },
    [currentLatLng, heading]
  );

  // The locate/recenter button, per explicit request: while already following (the common
  // case once navigation has started -- default is now the tight front view), each press
  // toggles camera height, front <-> normal, back and forth, indefinitely. If the camera has
  // instead drifted from a manual pan (not following), a press brings it back first rather
  // than silently changing height while the driver is looking at a panned-away part of the
  // map -- matches onRecenter's own existing behavior for that case (and for the plain
  // browse-the-map, not-navigating case too).
  const onLocateButtonPress = useCallback(() => {
    if (route && followTilt) {
      applyOverviewPose(!overviewMode);
      return;
    }
    onRecenter();
  }, [route, followTilt, overviewMode, applyOverviewPose, onRecenter]);

  // Apple/Google Maps' own convention: a manual pan/tilt/rotate gesture drops the camera out of
  // auto-follow instead of being fought by it. Without this, the close-follow effect above
  // re-animates the camera back to its fixed pitch/zoom on every single GPS update (often under
  // a second apart) -- which stomps a two-finger tilt gesture almost as soon as the user starts
  // it, making manual 3D tilting feel broken even though the gesture itself works fine.
  const onMapPanDrag = useCallback(() => {
    if (followTilt) setFollowTilt(false);
  }, [followTilt]);

  // First-launch default: the moment a real GPS fix comes in, if the driver hasn't toggled on
  // any region yet, seed visibleRegions with whichever real Australian state/territory their
  // current location falls in -- so alerts "just work" out of the box without requiring a trip
  // to Settings first, while still letting them add/remove regions freely afterward. Only ever
  // fires once (guarded by visibleRegions.length === 0); intentionally does nothing further
  // once the driver has an explicit selection, even an empty one they cleared on purpose.
  const regionSeededRef = useRef(false);
  useEffect(() => {
    if (regionSeededRef.current || !currentLatLng || settings.visibleRegions.length > 0) return;
    regionSeededRef.current = true;
    updateSettings({ visibleRegions: [classifyAuRegion(currentLatLng.latitude, currentLatLng.longitude)] });
  }, [currentLatLng, settings.visibleRegions, updateSettings]);

  // Subscribe to alerts in every toggled-on region (Phase 3 + Phase 5), real Australian state/
  // territory selection instead of a distance radius. Fully off (and cleared) when the user has
  // disabled alerts altogether -- "if toggled off user who is active doesn't receive no alerts".
  useEffect(() => {
    if (!user || !settings.alertsEnabled) {
      setNearbyAlerts([]);
      return;
    }
    return subscribeVisibleAlerts(settings.visibleRegions, user.uid, setNearbyAlerts);
  }, [user?.uid, settings.alertsEnabled, settings.visibleRegions]);

  // Per-type visibility filter, applied on top of the radius subscription above -- lets a
  // driver e.g. only care about police + hazards without changing what's actually fetched.
  const visibleAlerts = useMemo(
    () => nearbyAlerts.filter((alert) => settings.visibleAlertTypes.includes(alert.type)),
    [nearbyAlerts, settings.visibleAlertTypes]
  );

  // Turn-by-turn voice guidance (Phase 2): advance the active step as GPS crosses trigger radius.
  useEffect(() => {
    if (!route || !currentLatLng) return;
    const { stepToSpeak, activeStepIndex: nextIndex } = evaluateGuidance(
      guidanceRef.current,
      route.steps,
      currentLatLng.latitude,
      currentLatLng.longitude
    );
    if (nextIndex !== activeStepIndex) setActiveStepIndex(nextIndex);
    if (stepToSpeak && voiceEnabled) {
      speak(stepToSpeak.instruction, voiceVolumeRef.current);
    }
  }, [currentLatLng, route, voiceEnabled, activeStepIndex]);

  // Real, automatic reroute -- previously guidance (above) only ever advanced *forward* through
  // the existing route's own steps; if a turn/exit was missed entirely, the current step's end
  // point never got close (and the skip-ahead check inside evaluateGuidance only covers jumps
  // still roughly *along* the route), so guidance just sat frozen on the same stale instruction
  // forever with no recovery -- a real, confirmed dead end reported directly ("I've missed my
  // exit/street and it didn't reroute"). This instead measures live distance from the *route
  // line itself* (not just the next step's endpoint), which catches a genuinely wrong-direction
  // miss that forward-only step advancement can never detect.
  const OFF_ROUTE_METERS = 60;
  // Requires the drift to still be true a couple of GPS ticks later, not just one, before
  // reacting -- a single noisy/bad fix (a tunnel, tall buildings) briefly reading "off route"
  // shouldn't kick off a real reroute on its own.
  const OFF_ROUTE_CONFIRM_TICKS = 2;
  // Once a reroute fires, this is the minimum gap before another one can -- otherwise a fresh
  // reroute that's *itself* briefly still off the eventual snapped route (GPS drift right after
  // a fetch) could immediately trigger a second one, and so on back-to-back.
  const REROUTE_COOLDOWN_MS = 15000;
  const offRouteStreakRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  useEffect(() => {
    if (!route || !currentLatLng || !destinationLatLng) {
      offRouteStreakRef.current = 0;
      return;
    }
    const distMeters = distanceToPolylineMeters(currentLatLng.latitude, currentLatLng.longitude, route.polyline);
    if (distMeters <= OFF_ROUTE_METERS) {
      offRouteStreakRef.current = 0;
      return;
    }
    offRouteStreakRef.current += 1;
    if (offRouteStreakRef.current < OFF_ROUTE_CONFIRM_TICKS) return;
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;

    offRouteStreakRef.current = 0;
    lastRerouteAtRef.current = Date.now();
    setRerouting(true);
    Sentry.logger.info("map: off-route detected, rerouting", { distMeters: Math.round(distMeters) });

    const reroutePromise =
      travelMode === "driving"
        ? getRouteOptions(currentLatLng, destinationLatLng).then((options) => options[selectedProfile])
        : getDirectionsForMode(currentLatLng, destinationLatLng, travelMode);

    reroutePromise
      .then((fresh) => {
        guidanceRef.current = createGuidanceState();
        setActiveStepIndex(0);
        setRoute(fresh);
        setAcceptedSuggestionOriginalRoute(null);
        mapRef.current?.fitToCoordinates(fresh.polyline, {
          edgePadding: { top: 120, right: 60, bottom: 120, left: 60 },
          animated: true,
        });
      })
      .catch((err) => {
        console.warn("[map] reroute failed", err);
        Sentry.logger.error("map: reroute failed", { error: String(err) });
      })
      .finally(() => setRerouting(false));
  }, [currentLatLng, route, destinationLatLng, travelMode, selectedProfile]);

  // EV Radar (Phase 6): start/stop siren detection with the map screen lifecycle -- mount-once
  // (deps: []), NOT re-keyed on location. It used to also depend on currentLatLng/user/
  // autoShareDetections, which meant the entire on-device audio ML pipeline (mic permission,
  // model load, audio session, recorder) got torn down and rebuilt from scratch on every GPS
  // update -- several times a minute while driving. Reads to those values only ever happen
  // inside the onDetection callback, which is why refs (updated every render, not causing a
  // re-run) are enough here -- there's no need for the effect itself to see fresh values.
  const currentLatLngRef = useRef(currentLatLng);
  currentLatLngRef.current = currentLatLng;
  const userRef = useRef(user);
  userRef.current = user;
  const autoShareDetectionsRef = useRef(settings.autoShareDetections);
  autoShareDetectionsRef.current = settings.autoShareDetections;
  const alertExpiryMsRef = useRef(settings.alertExpiryMs);
  alertExpiryMsRef.current = settings.alertExpiryMs;

  useEffect(() => {
    sirenDetection.start();

    const unsubscribe = sirenDetection.onDetection(async ({ label }) => {
      setBannerMessage("Emergency vehicle detected nearby");
      setBannerVisible(true);

      const latLng = currentLatLngRef.current;
      const currentUser = userRef.current;
      if (autoShareDetectionsRef.current && latLng && currentUser) {
        try {
          await reportAlert("emergency_vehicle", latLng, currentUser.uid, alertExpiryMsRef.current);
        } catch (err) {
          console.warn("[siren] auto-share detection failed", err);
        }
      }
    });

    return () => {
      unsubscribe();
      sirenDetection.stop();
    };
  }, []);

  // Sensitivity is the one siren setting that genuinely should apply immediately without a
  // full restart -- kept as its own small effect, separate from the mount-once one above.
  useEffect(() => {
    sirenDetection.setSensitivity(settings.sirenSensitivity);
  }, [settings.sirenSensitivity]);

  // `mode` is always passed explicitly by every call site (never defaulted/read off the
  // `travelMode` closure) -- onSelectTravelMode below needs to fetch for the *new* mode the
  // instant it's picked, before the setTravelMode state update has actually landed, so passing
  // it as a plain argument sidesteps any stale-closure risk entirely.
  // `origin` is likewise always passed explicitly (routeOriginLatLng at the call site) rather
  // than read off currentLatLng here directly -- real support for a custom "From" place per the
  // explicit request, instead of every route always starting from the driver's own live position.
  const fetchRouteOptions = useCallback(
    async (origin: LatLng, destination: LatLng, waypoint: LatLng | undefined, mode: TravelMode) => {
      setLoadingRouteOptions(true);
      setRouteOptionsError(null);
      try {
        if (mode === "driving") {
          const options = await getRouteOptions(origin, destination, waypoint);
          setRouteOptions(options);
          setModeRoute(null);
          setModeRouteOptions([]);
          setSelectedProfile("normal");
          mapRef.current?.fitToCoordinates(options.normal.polyline, {
            edgePadding: { top: 120, right: 60, bottom: routeCardHeight + spacing.md, left: 60 },
            animated: true,
          });
        } else {
          // Walking/bicycling/transit: every real alternative Google offers for that mode, not
          // a driving-route estimate scaled by some guessed speed factor -- genuine distance and
          // duration for how that mode actually gets there, transit included (Google's transit
          // directions factor in real published timetables, not just travel speed, and a real
          // transit trip commonly has several genuinely different services to choose between,
          // same as a real walk can have more than one genuinely different path).
          const results = await getModeRouteOptions(origin, destination, mode, waypoint);
          setModeRouteOptions(results);
          setSelectedModeRouteIndex(0);
          setModeRoute(results[0]);
          setRouteOptions(null);
          mapRef.current?.fitToCoordinates(results[0].polyline, {
            edgePadding: { top: 120, right: 60, bottom: routeCardHeight + spacing.md, left: 60 },
            animated: true,
          });
        }
      } catch (err) {
        Sentry.logger.error("map: failed to fetch route options", { error: String(err), mode });
        console.warn("[map] failed to fetch route options", err);
        // Same underlying cause as the destination search billing check below -- the
        // Directions API call hits the exact same Google Cloud project/key, so it fails the
        // same way whenever billing isn't enabled there.
        setRouteOptionsError(
          err instanceof DirectionsApiError
            ? /billing/i.test(err.message)
              ? "Routing unavailable -- billing isn't enabled on this app's Google Cloud project"
              : `Couldn't find a route (${err.status})`
            : "Couldn't find a route -- check your connection"
        );
      } finally {
        setLoadingRouteOptions(false);
      }
    },
    [routeCardHeight]
  );

  // Rough degrees-of-latitude span for a given real km distance (111km per degree of
  // latitude) -- good enough for sizing an Overpass bounding box, not meant for precise
  // long-distance navigation math the way distanceKm's real haversine calculation is.
  const kmToLatDelta = (km: number) => (km * 2) / 111;

  // Min zoom before the OSM layer *re-fetches* -- a zoomed-out view spans too wide an area for
  // a reasonable Overpass request/response size. Scales with the driver's own configured
  // radius (settings.osmLayerRadiusKm, 1-200km, see Settings' "Traffic light & speed camera
  // radius" slider) instead of a flat hardcoded value -- a wide radius setting (driving across
  // a region, wanting cameras spotted well ahead) previously got silently capped at whatever
  // the old constant allowed regardless of what was actually configured. Zooming out past this
  // only skips asking for *new* data -- it must NOT clear osmData, or a toggled-on layer
  // visibly disappears the moment you zoom out, which is exactly the bug reported ("zooming out
  // the traffic lights or speed cameras... disappears"). Whatever was already fetched for the
  // last in-range view stays on screen; it only gets replaced once the user zooms back in and
  // pans to a new area.
  const OSM_LAYER_MAX_DELTA = Math.max(0.03, kmToLatDelta(settings.osmLayerRadiusKm));

  // Loads traffic-light/speed-camera markers around the user's own position the moment a GPS
  // fix exists and either layer is toggled on -- independent of the map ever panning or
  // zooming. Previously the *only* trigger for a fetch was onRegionChangeComplete below, which
  // needs both an actual region-change event AND a region already narrower than
  // OSM_LAYER_MAX_DELTA to fire -- but the map's own initialRegion starts at a 0.05 delta,
  // wider than that threshold, so a fresh app launch (or a toggle flipped on mid-session) left
  // both layers invisible until the user manually zoomed in, even with the setting already on.
  // Reset to false whenever both layers are off, so turning either back on fires this again.
  const osmInitialLoadRef = useRef(false);
  // Also re-fires the initial load below whenever the radius setting itself changes (not just
  // the on/off toggles) -- without this, dragging the radius slider after the layer had already
  // loaded once silently did nothing until the driver also flipped a toggle off and back on.
  const lastOsmRadiusRef = useRef(settings.osmLayerRadiusKm);
  useEffect(() => {
    if (lastOsmRadiusRef.current === settings.osmLayerRadiusKm) return;
    lastOsmRadiusRef.current = settings.osmLayerRadiusKm;
    osmInitialLoadRef.current = false;
  }, [settings.osmLayerRadiusKm]);
  useEffect(() => {
    if (!settings.showTrafficLights && !settings.showSpeedCameras) {
      osmInitialLoadRef.current = false;
      return;
    }
    if (osmInitialLoadRef.current || !currentLatLng) return;
    osmInitialLoadRef.current = true;
    const delta = kmToLatDelta(settings.osmLayerRadiusKm);
    const bounds = {
      sw: {
        latitude: currentLatLng.latitude - delta / 2,
        longitude: currentLatLng.longitude - delta / 2,
      },
      ne: {
        latitude: currentLatLng.latitude + delta / 2,
        longitude: currentLatLng.longitude + delta / 2,
      },
    };
    setOsmLoading(true);
    fetchOsmTrafficData(bounds, {
      wantTrafficLights: settings.showTrafficLights,
      wantSpeedCameras: settings.showSpeedCameras,
    })
      .then(setOsmData)
      .catch((err) => console.warn("[map] initial OSM traffic layer fetch failed", err))
      .finally(() => setOsmLoading(false));
  }, [currentLatLng, settings.showTrafficLights, settings.showSpeedCameras, settings.osmLayerRadiusKm]);

  const onRegionChangeComplete = useCallback(
    (region: Region, details?: { isGesture?: boolean }) => {
      // onPanDrag (see onMapPanDrag above) only fires for an actual translating drag -- a pure
      // two-finger twist-to-rotate or two-finger tilt, held in place with no panning, never
      // triggers it, so followTilt stayed true and the next GPS tick's chase-cam update
      // silently snapped heading back to GPS course almost immediately, making a manual rotate
      // feel like it "didn't take" or needed to be held to fight the snap-back. Google Maps'
      // native layer reports isGesture: true for *any* user-touch-driven camera change
      // (pan, pinch, rotate, tilt alike) as opposed to this app's own animateCamera calls, so
      // this catches the rotate-only case onPanDrag misses.
      if (details?.isGesture && followTilt) setFollowTilt(false);

      setOsmZoomDelta(region.latitudeDelta);

      // Manual alert placement uses a fixed pin at the center of the screen and moves the map
      // underneath it instead of a draggable Marker (see onAlertTypeSelected above) -- so the
      // "drag" is really just keeping alertPlacementLatLng in sync with wherever the map
      // settles after every pan/pinch-zoom gesture.
      if (placingAlert) {
        setAlertPlacementLatLng({ latitude: region.latitude, longitude: region.longitude });
      }

      if (osmDebounceRef.current) clearTimeout(osmDebounceRef.current);
      if (!settings.showTrafficLights && !settings.showSpeedCameras) {
        setOsmData(null);
        setOsmLoading(false);
        return;
      }
      if (region.latitudeDelta > OSM_LAYER_MAX_DELTA) {
        setOsmLoading(false);
        return;
      }
      osmDebounceRef.current = setTimeout(() => {
        const bounds = {
          sw: {
            latitude: region.latitude - region.latitudeDelta / 2,
            longitude: region.longitude - region.longitudeDelta / 2,
          },
          ne: {
            latitude: region.latitude + region.latitudeDelta / 2,
            longitude: region.longitude + region.longitudeDelta / 2,
          },
        };
        setOsmLoading(true);
        fetchOsmTrafficData(bounds, {
          wantTrafficLights: settings.showTrafficLights,
          wantSpeedCameras: settings.showSpeedCameras,
        })
          .then(setOsmData)
          .catch((err) => console.warn("[map] OSM traffic layer fetch failed", err))
          .finally(() => setOsmLoading(false));
      }, 1200);
    },
    [placingAlert, settings.showTrafficLights, settings.showSpeedCameras, settings.osmLayerRadiusKm, followTilt]
  );

  // Traffic-light nodes cluster into a single badge wherever they're too dense to render as
  // individual pins without lagging the map -- a real intersection cluster (several nodes,
  // one per approach/crossing) can put 10-20+ within a couple hundred meters, and a whole
  // suburb's worth within the radius setting can be several hundred.
  // Cell size scales with the current zoom (osmZoomDelta) so clusters split apart into their
  // real individual pins as the driver zooms in, floored so it never over-clusters at max zoom.
  const trafficLightClusters = useMemo(() => {
    const points = osmData?.trafficLights ?? [];
    if (points.length === 0) return [];
    const cellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);
    return clusterPoints(points, cellSizeDegrees);
  }, [osmData?.trafficLights, osmZoomDelta]);

  const onTrafficLightClusterPress = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: osmZoomDelta / 4, longitudeDelta: osmZoomDelta / 4 },
      350
    );
  }, [osmZoomDelta]);

  // Speed cameras used to render one native <Marker> per point unconditionally, on the
  // assumption they're "genuinely sparse (a handful per suburb at most)". Real confirmed
  // report from a wide "Traffic light & speed camera radius" setting (up to 200km, see
  // Settings): zoomed out over a whole region, that's a handful per suburb TIMES dozens of
  // suburbs in view at once -- hundreds of individual native marker views is exactly the kind
  // of render-count map lag the traffic-light clustering above already exists to prevent, so
  // speed cameras get the same treatment now instead of being the one layer still exempt from
  // it once a wide radius makes them dense too.
  const speedCameraClusters = useMemo(() => {
    const points = osmData?.speedCameras ?? [];
    if (points.length === 0) return [];
    const cellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);
    return clusterPoints(points, cellSizeDegrees);
  }, [osmData?.speedCameras, osmZoomDelta]);

  const onSpeedCameraClusterPress = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: osmZoomDelta / 4, longitudeDelta: osmZoomDelta / 4 },
      350
    );
  }, [osmZoomDelta]);

  const onMapPress = useCallback(
    (e: MapPressEvent) => {
      // Don't hijack a tap that's meant for something else already in progress -- placing an
      // alert pin, or a sheet already open and eating input.
      if (placingAlert || anySheetOpen) return;
      // react-native-maps fires the map's own onPress *in addition to* a tapped polyline's
      // onPress on the same tap (confirmed in the native iOS handler), not instead of it -- so
      // tapping the route line would otherwise also kick off a Places lookup for whatever's
      // directly under that point at the same time as entering overview mode. Short-lived guard
      // so a just-handled line tap doesn't double-fire this.
      if (Date.now() - lineTapAtRef.current < 150) return;
      const coordinate = e.nativeEvent.coordinate;
      setPlaceInfoLoading(true);
      findNearestPlace(coordinate)
        .then((nearest) => {
          if (!nearest) return null;
          return getPlaceInfo(nearest.placeId);
        })
        .then((info) => {
          if (!info) return;
          // rankby=distance (see findNearestPlace) can still legitimately return a real
          // business that's genuinely far from an empty tap (e.g. tapping open water or a
          // park with no nearby POIs at all) -- Nearby Search has no radius bound in that
          // mode. A sanity distance check here means a tap with nothing actually close by
          // shows no sheet at all instead of confidently attaching an unrelated business to
          // wherever was tapped.
          const distMeters = distanceKm(
            coordinate.latitude,
            coordinate.longitude,
            info.location.latitude,
            info.location.longitude
          ) * 1000;
          if (distMeters > MAX_POI_TAP_DISTANCE_METERS) return;
          setPlaceInfo(info);
          placeInfoSheetRef.current?.expand();
        })
        .catch((err) => {
          console.warn("[map] place info lookup failed", err);
          Sentry.logger.error("map: place info lookup failed", { error: String(err) });
        })
        .finally(() => setPlaceInfoLoading(false));
    },
    [placingAlert, anySheetOpen]
  );

  const onDestinationSelected = useCallback(
    (place: PlaceDetails) => {
      if (!routeOriginLatLng) return;
      setPendingDestination(place);
      setStopLocation(null);
      // A fresh destination pick always starts from Drive -- predictable default, matches how
      // the picker looked before travel modes existed.
      setTravelMode("driving");
      fetchRouteOptions(routeOriginLatLng, place.location, undefined, "driving");
    },
    [routeOriginLatLng, fetchRouteOptions]
  );

  // "Find nearest station" quick action -- skips typing a destination entirely and routes
  // straight to whatever real bus/train stop Google's Places data says is genuinely closest to
  // the current route origin (a custom "From" if one's picked, otherwise live GPS -- see
  // routeOriginLatLng), as a walking trip (getting to a station is a walk, not a drive). Reuses
  // the exact same pendingDestination/fetchRouteOptions path onDestinationSelected does, so
  // Start/Add-stop/the route preview line all work identically once there.
  const [findingNearestStation, setFindingNearestStation] = useState(false);
  const onFindNearestStation = useCallback(async () => {
    if (!routeOriginLatLng) return;
    setFindingNearestStation(true);
    try {
      const station = await findNearestTransitStation(routeOriginLatLng);
      if (!station) {
        setRouteOptionsError("No nearby train or bus station found.");
        return;
      }
      setPendingDestination(station);
      setStopLocation(null);
      setTravelMode("walking");
      fetchRouteOptions(routeOriginLatLng, station.location, undefined, "walking");
    } catch (err) {
      console.warn("[map] find nearest station failed", err);
      Sentry.logger.error("map: find nearest station failed", { error: String(err) });
    } finally {
      setFindingNearestStation(false);
    }
  }, [routeOriginLatLng, fetchRouteOptions]);

  const onStopSelected = useCallback(
    (place: PlaceDetails) => {
      if (!pendingDestination || !routeOriginLatLng) return;
      setStopLocation(place.location);
      setPickingStop(false);
      fetchRouteOptions(routeOriginLatLng, pendingDestination.location, place.location, travelMode);
    },
    [pendingDestination, routeOriginLatLng, fetchRouteOptions, travelMode]
  );

  // Real mid-trip "add a stop" -- previously the only Add Stop control was on the pre-Start
  // route picker (RouteOptionsCard); once Start was actually tapped there was no way to insert
  // a stop at all, and searching mid-drive just showed the destination search bar floating over
  // a bare map with no route/puck/turn card in sight (both DestinationSearchBar and
  // NavigationInstructionCard are rendered here, so this only ever hid one behind the other --
  // never an actual "select a place" state with nothing else drawn). This overlays the same
  // search bar on top of the still-live nav view (route line, puck, turn card all stay mounted
  // underneath, see the addingStopDuringNav-gated render below) and, on a real pick, recomputes
  // the route through that stop the same way the off-route auto-reroute effect above does,
  // without leaving/re-entering navigation.
  const [addingStopDuringNav, setAddingStopDuringNav] = useState(false);
  // Real preview step, per explicit request -- picking a place no longer applies the reroute
  // immediately; it computes the route through that stop and holds it here so it can be drawn
  // green (see the Polyline render below) alongside the still-live blue route, with a
  // back/confirm bar to either commit it (confirmStopPreview) or cancel back to plain live
  // navigation (cancelStopPreview) with nothing changed.
  const [stopPreviewRoute, setStopPreviewRoute] = useState<Route | null>(null);
  const [stopPreviewPlace, setStopPreviewPlace] = useState<PlaceDetails | null>(null);
  // Real traffic-jam reroute suggestion -- a genuinely faster, avoid-highways (side streets)
  // alternative found while a real, meaningful traffic delay exists on the remaining route (see
  // the periodic check effect below). Held separately from `route` itself, same
  // preview-then-confirm shape as stopPreviewRoute above, so it can draw green alongside the
  // still-live blue route until the driver actually accepts it.
  const [trafficSuggestionRoute, setTrafficSuggestionRoute] = useState<Route | null>(null);
  const [trafficSuggestionSavedSeconds, setTrafficSuggestionSavedSeconds] = useState(0);
  // The route that was live right before a traffic suggestion was accepted -- kept around only
  // while driving the accepted suggestion, so "End suggested route" can put the driver straight
  // back on the exact route they started with, not just re-fetch a fresh one from scratch.
  const [acceptedSuggestionOriginalRoute, setAcceptedSuggestionOriginalRoute] = useState<Route | null>(null);
  const onStopSelectedDuringNav = useCallback(
    async (place: PlaceDetails) => {
      setAddingStopDuringNav(false);
      if (!currentLatLng || !destinationLatLng) return;
      setRerouting(true);
      try {
        const preview =
          travelMode === "driving"
            ? (await getRouteOptions(currentLatLng, destinationLatLng, place.location))[selectedProfile]
            : await getDirectionsForMode(currentLatLng, destinationLatLng, travelMode, place.location);
        setStopPreviewPlace(place);
        setStopPreviewRoute(preview);
        mapRef.current?.fitToCoordinates(preview.polyline, {
          edgePadding: { top: 120, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      } catch (err) {
        console.warn("[map] add stop preview failed", err);
        Sentry.logger.error("map: add stop preview failed", { error: String(err) });
      } finally {
        setRerouting(false);
      }
    },
    [currentLatLng, destinationLatLng, travelMode, selectedProfile]
  );

  const confirmStopPreview = useCallback(() => {
    if (!stopPreviewRoute || !stopPreviewPlace) return;
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setStopLocation(stopPreviewPlace.location);
    setRoute(stopPreviewRoute);
    setAcceptedSuggestionOriginalRoute(null);
    setStopPreviewRoute(null);
    setStopPreviewPlace(null);
  }, [stopPreviewRoute, stopPreviewPlace]);

  // The "back" button, per explicit request -- discards the preview and returns to using
  // navigation exactly as it was, live route/puck/turn card untouched throughout.
  const cancelStopPreview = useCallback(() => {
    setStopPreviewRoute(null);
    setStopPreviewPlace(null);
  }, []);

  // Periodic real traffic check while navigating -- every 90s. The actual trigger is scoped
  // tightly to the next NEAR_TERM_TRAFFIC_CHECK_METERS (1km) of the route ahead of the driver's
  // live position (pointAheadOnPolylineMeters walks the route's own polyline forward from
  // wherever the driver actually is), not a whole-trip average -- a real, meaningful live-
  // traffic delay (hasTrafficDelay's existing 10%+60s-floor definition) has to exist in that
  // near-term window specifically. Only once that's confirmed does it fetch the actual
  // full-route alternative (the side-streets/avoid-highways route that would actually be
  // switched to) and re-check it's genuinely at least MIN_SAVED_SECONDS_TO_SUGGEST faster --
  // never a guessed/simulated "there's a jam ahead", always Google's own real-time traffic
  // model (which is itself built from real aggregated device-location data across Google's
  // whole user base -- this app's own install base isn't remotely large enough to build an
  // independent version of that from its own users' phone signals the way Waze does).
  //
  // Deliberately keyed only on [route, destinationLatLng] (not currentLatLng, which changes on
  // every GPS tick and would otherwise tear down/recreate this interval before it ever reached
  // 90s) -- position, stop, and "is a suggestion already showing" are all read fresh from refs
  // inside the interval callback instead.
  const trafficSuggestionRouteRef = useRef<Route | null>(null);
  trafficSuggestionRouteRef.current = trafficSuggestionRoute;
  const stopLocationRef = useRef<LatLng | null>(null);
  stopLocationRef.current = stopLocation;
  // Also skips while any of these other route-editing flows are up -- a second green line
  // (this suggestion's) appearing on top of the add-stop preview's own green line, or while
  // actively placing an alert pin, would just be confusing overlap, not a helpful suggestion.
  const otherFlowActiveRef = useRef(false);
  otherFlowActiveRef.current = !!stopPreviewRoute || addingStopDuringNav || placingAlert;
  const trafficCheckInFlightRef = useRef(false);
  const trafficSuggestionDismissedAtRef = useRef(0);

  useEffect(() => {
    if (!route || !destinationLatLng) return;
    const interval = setInterval(async () => {
      if (trafficSuggestionRouteRef.current || trafficCheckInFlightRef.current) return;
      if (otherFlowActiveRef.current) return;
      if (Date.now() - trafficSuggestionDismissedAtRef.current < TRAFFIC_SUGGESTION_COOLDOWN_MS) return;
      const latLng = currentLatLngRef.current;
      if (!latLng) return;
      const remainingMeters =
        distanceKm(latLng.latitude, latLng.longitude, destinationLatLng.latitude, destinationLatLng.longitude) *
        1000;
      if (remainingMeters < MIN_REMAINING_METERS_TO_CHECK) return;
      trafficCheckInFlightRef.current = true;
      try {
        // Step 1: the actual trigger -- is there a real, live-traffic delay in just the next
        // 1km of the route ahead of the driver right now. aheadPoint is a real point on the
        // route's own polyline (falls back to the destination itself if the remaining route is
        // already shorter than the window, which MIN_REMAINING_METERS_TO_CHECK above already
        // guards against in practice).
        const aheadPoint =
          pointAheadOnPolylineMeters(latLng.latitude, latLng.longitude, route.polyline, NEAR_TERM_TRAFFIC_CHECK_METERS) ??
          destinationLatLng;
        const nearTerm = await getDirections(latLng, aheadPoint, { useTraffic: true });
        if (!nearTerm.hasTrafficDelay) return;

        // Step 2: only once a real, near-term jam is confirmed does this fetch the actual
        // full-route side-streets alternative (what's offered/switched to if accepted) and
        // re-check the whole trip is still genuinely worth the interruption.
        const waypoint = stopLocationRef.current ?? undefined;
        const [liveCurrent, sideStreets] = await Promise.all([
          getDirections(latLng, destinationLatLng, { waypoint, useTraffic: true }),
          getDirections(latLng, destinationLatLng, { waypoint, useTraffic: true, avoidHighways: true }),
        ]);
        const currentSeconds = liveCurrent.durationInTrafficSeconds ?? liveCurrent.durationSeconds;
        const altSeconds = sideStreets.durationInTrafficSeconds ?? sideStreets.durationSeconds;
        const savedSeconds = currentSeconds - altSeconds;
        if (savedSeconds >= MIN_SAVED_SECONDS_TO_SUGGEST) {
          setTrafficSuggestionRoute(sideStreets);
          setTrafficSuggestionSavedSeconds(savedSeconds);
        }
      } catch (err) {
        Sentry.logger.error("map: traffic reroute check failed", { error: String(err) });
      } finally {
        trafficCheckInFlightRef.current = false;
      }
    }, TRAFFIC_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [route, destinationLatLng]);

  // Clears any stale suggestion the moment the underlying route is replaced for any other
  // reason (a real reroute, an add-stop confirm, exiting navigation) -- a suggestion computed
  // against the old route's remaining path would no longer mean anything once route changes.
  useEffect(() => {
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
  }, [route]);

  // "Displays for 10 seconds" per explicit request -- an unattended banner auto-dismisses
  // itself (same cooldown as a manual No/X) instead of sitting over the map indefinitely.
  // Cleared/restarted whenever a new suggestion appears; a real Yes/No/X tap in the meantime
  // already clears trafficSuggestionRoute itself, which tears this effect down too.
  useEffect(() => {
    if (!trafficSuggestionRoute) return;
    const timer = setTimeout(() => {
      setTrafficSuggestionRoute(null);
      setTrafficSuggestionSavedSeconds(0);
      trafficSuggestionDismissedAtRef.current = Date.now();
    }, TRAFFIC_SUGGESTION_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [trafficSuggestionRoute]);

  const acceptTrafficSuggestion = useCallback(() => {
    if (!trafficSuggestionRoute) return;
    // Remember exactly what was live before switching, so "End suggested route" can put the
    // driver straight back on it rather than recomputing something merely similar.
    setAcceptedSuggestionOriginalRoute(route);
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setRoute(trafficSuggestionRoute);
  }, [trafficSuggestionRoute, route]);

  // "Cancel route 2" -- covers both the No button and the X -- dismisses the suggestion (route
  // 1 was never actually replaced, so there's nothing else to undo) and starts the cooldown so
  // the same jam doesn't immediately re-suggest itself again next check.
  const dismissTrafficSuggestion = useCallback(() => {
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
    trafficSuggestionDismissedAtRef.current = Date.now();
  }, []);

  // "End suggested route" -- only ever available while actually driving an accepted
  // suggestion (see acceptedSuggestionOriginalRoute). Restores the exact route the driver was
  // on before they said yes, same guidance-reset shape as every other route swap here.
  const endSuggestedRoute = useCallback(() => {
    if (!acceptedSuggestionOriginalRoute) return;
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setRoute(acceptedSuggestionOriginalRoute);
    setAcceptedSuggestionOriginalRoute(null);
  }, [acceptedSuggestionOriginalRoute]);

  // Real removal of a mid-trip stop -- clears stopLocation and recomputes the route straight
  // to the original destination, the same real fetch this screen already does for adding one,
  // just without the waypoint.
  const removeStopDuringNav = useCallback(async () => {
    if (!currentLatLng || !destinationLatLng) return;
    setStopLocation(null);
    setRerouting(true);
    try {
      const fresh =
        travelMode === "driving"
          ? (await getRouteOptions(currentLatLng, destinationLatLng))[selectedProfile]
          : await getDirectionsForMode(currentLatLng, destinationLatLng, travelMode);
      guidanceRef.current = createGuidanceState();
      setActiveStepIndex(0);
      setRoute(fresh);
      setAcceptedSuggestionOriginalRoute(null);
      mapRef.current?.fitToCoordinates(fresh.polyline, {
        edgePadding: { top: 120, right: 60, bottom: 120, left: 60 },
        animated: true,
      });
    } catch (err) {
      console.warn("[map] remove stop during nav failed", err);
      Sentry.logger.error("map: remove stop during nav failed", { error: String(err) });
    } finally {
      setRerouting(false);
    }
  }, [currentLatLng, destinationLatLng, travelMode, selectedProfile]);

  const onSelectTravelMode = useCallback(
    (mode: TravelMode) => {
      setTravelMode(mode);
      if (pendingDestination && routeOriginLatLng) {
        fetchRouteOptions(routeOriginLatLng, pendingDestination.location, stopLocation ?? undefined, mode);
      }
    },
    [pendingDestination, stopLocation, routeOriginLatLng, fetchRouteOptions]
  );

  const onSelectProfile = useCallback(
    (key: RouteProfileKey) => {
      // Switching to a *different* route just swaps which polyline is drawn, at whatever
      // zoom/position the driver is already looking at -- previously this re-fit the camera to
      // the newly-picked route's own bounds every time, which yanked a manually zoomed-in view
      // back out on every tap. Re-picking the route that's ALREADY selected is the deliberate
      // "reset the view" gesture instead: that one still re-fits to the full route overview.
      const reselectingSame = key === selectedProfile;
      setSelectedProfile(key);
      if (!reselectingSame) return;
      const previewRoute = routeOptions?.[key];
      if (previewRoute) {
        mapRef.current?.fitToCoordinates(previewRoute.polyline, {
          edgePadding: { top: 120, right: 60, bottom: routeCardHeight + spacing.md, left: 60 },
          animated: true,
        });
      }
    },
    [routeOptions, routeCardHeight, selectedProfile]
  );

  // Same "reselecting the highlighted one re-fits the camera" gesture as onSelectProfile above,
  // applied to the real Google alternatives list for walking/bicycling/transit.
  const onSelectModeRoute = useCallback(
    (index: number) => {
      const reselectingSame = index === selectedModeRouteIndex;
      setSelectedModeRouteIndex(index);
      const picked = modeRouteOptions[index];
      if (picked) setModeRoute(picked);
      if (!reselectingSame || !picked) return;
      mapRef.current?.fitToCoordinates(picked.polyline, {
        edgePadding: { top: 120, right: 60, bottom: routeCardHeight + spacing.md, left: 60 },
        animated: true,
      });
    },
    [modeRouteOptions, routeCardHeight, selectedModeRouteIndex]
  );

  const confirmRoute = useCallback(() => {
    const chosen = travelMode === "driving" ? routeOptions?.[selectedProfile] : modeRoute;
    if (!chosen || !pendingDestination) return;
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setRoute(chosen);
    setAcceptedSuggestionOriginalRoute(null);
    setDestinationLatLng(pendingDestination.location);
    navStartedAtRef.current = Date.now();
    setFollowTilt(true);
    mapRef.current?.fitToCoordinates(chosen.polyline, {
      edgePadding: { top: 120, right: 60, bottom: 120, left: 60 },
      animated: true,
    });
    setRouteOptions(null);
    setModeRoute(null);
    setModeRouteOptions([]);
    setPendingDestination(null);
    // Live navigation always tracks real GPS from here on (see routeOriginLatLng's own comment)
    // -- clears any custom "From" so it doesn't silently carry over into the next, unrelated
    // destination search once this trip ends.
    setOriginOverride(null);
  }, [routeOptions, modeRoute, travelMode, selectedProfile, pendingDestination]);

  const cancelRouteOptions = useCallback(() => {
    setRouteOptions(null);
    setModeRoute(null);
    setModeRouteOptions([]);
    setPendingDestination(null);
    setStopLocation(null);
    setPickingStop(false);
    setRouteOptionsError(null);
    setTravelMode("driving");
    setOriginOverride(null);
  }, []);

  // "From" row tap on the initial search panel -- opens a second DestinationSearchBar configured
  // for picking a custom origin (with the "My Location" quick row as the reset-to-live-GPS path,
  // see MY_LOCATION_PLACE_ID). If a destination/route preview is already up when the origin
  // changes, re-fetches it immediately against the new origin so the shown route/times stay
  // accurate to what's actually selected, same "real routes and times" the destination pick
  // itself always fetches.
  const onOriginSelected = useCallback(
    (place: PlaceDetails) => {
      const next = place.placeId === MY_LOCATION_PLACE_ID ? null : place;
      setOriginOverride(next);
      setPickingOrigin(false);
      if (pendingDestination) {
        const origin = next?.location ?? currentLatLng;
        if (origin) fetchRouteOptions(origin, pendingDestination.location, stopLocation ?? undefined, travelMode);
      }
    },
    [pendingDestination, stopLocation, travelMode, currentLatLng, fetchRouteOptions]
  );

  const exitNavigation = useCallback(() => {
    stopSpeaking();
    setRoute(null);
    setActiveStepIndex(0);
    setFollowTilt(true);
    setStopLocation(null);
    setDestinationLatLng(null);
    setAcceptedSuggestionOriginalRoute(null);
    // Per explicit user answer ("Until navigation ends"), a share started this trip stops
    // updating right here -- fire-and-forget since there's nothing useful to block exit on.
    if (liveShareIdRef.current) {
      const shareId = liveShareIdRef.current;
      liveShareIdRef.current = null;
      endLiveShare(shareId).catch((err) => {
        Sentry.logger.error("map: end live share failed", { error: String(err) });
      });
    }
  }, []);

  // Flow (per spec: select the type first, then drag to place, then Set/Save):
  // 1. FAB -> openAlertTypePicker: opens AlertReportSheet, nothing else happens yet.
  // 2. onAlertTypeSelected: sheet closes, placement mode starts (type remembered in a ref for
  //    the eventual save).
  // 3. confirmAlertPlacement ("Set"): actually writes the alert at wherever the pin ended up.
  // 4. cancelAlertPlacement ("Cancel"): aborts, no write.
  //
  // The pin itself is NOT a draggable Marker -- react-native-maps' per-marker drag gesture
  // recognizer on iOS reliably loses to (or gets left in a broken state by) the map's own
  // pinch-zoom recognizer: real user report was "doesn't allow to drag the pin for any alert
  // ... with zoom out with fingers and re-drag". Instead this uses the same fixed
  // center-of-screen pin + drag-the-map-underneath-it pattern Uber/Google Maps' own "choose a
  // location" flows use -- panning/zooming the map is the map's native, always-reliable
  // gesture, so there's no competing recognizer to lose to. alertPlacementLatLng is just kept
  // in sync with the map's own region center (see onRegionChangeComplete below) while
  // placingAlert is true; the pin view itself never moves, the map moves under it.
  const pendingAlertTypeRef = useRef<AlertType | null>(null);

  // Real, confirmed complaint: an alert set while driving was landing exactly on the reporter's
  // own live GPS fix -- which, by the time the type-picker tap and the sheet-close animation
  // above have both happened, is already a couple of seconds (and, at highway speed, dozens of
  // meters) behind where the actual hazard/camera/police car is relative to the direction of
  // travel. Nudged forward along the driver's own current heading before the fixed center pin
  // ever appears, so "Set" without touching the map at all lands the alert genuinely ahead on
  // the road, not behind -- the real fix for "the set alert doesn't set in its direction placed".
  // Only ever offsets using a real, current GPS-reported heading (location.coords.heading, not
  // the derived-from-movement fallback `heading` used for the nav arrow elsewhere) -- that
  // fallback defaults to 0/north the moment the driver hasn't moved yet, and offsetting toward a
  // fabricated "north" would be worse than not offsetting at all. No real GPS heading yet (just
  // opened the app, stationary, or no fix) -- falls back to the exact live coordinate, same as
  // before this existed.
  const ALERT_AHEAD_OFFSET_METERS = 25;
  const initialAlertPlacement = useCallback(
    (fallback: LatLng): LatLng => {
      const gpsHeading = location?.coords.heading;
      if (gpsHeading == null || gpsHeading < 0) return fallback;
      return offsetLatLngByHeading(fallback.latitude, fallback.longitude, gpsHeading, ALERT_AHEAD_OFFSET_METERS);
    },
    [location]
  );

  const openAlertTypePicker = useCallback(() => {
    reportSheetRef.current?.expand();
  }, []);

  // The new "..." options sheet's own rows (see NavOptionsSheet) -- each just closes that
  // sheet first, then hands off to the exact same handler the old actions row used, no new
  // underlying logic.
  const onNavOptionsReportAlert = useCallback(() => {
    navOptionsSheetRef.current?.close();
    openAlertTypePicker();
  }, [openAlertTypePicker]);
  const onNavOptionsOpenDetection = useCallback(() => {
    navOptionsSheetRef.current?.close();
    Sentry.logger.info("map: opening vehicle detection screen");
    setDetectionOpen(true);
  }, []);

  const onAlertTypeSelected = useCallback(
    (type: AlertType) => {
      if (!currentLatLng) return;
      pendingAlertTypeRef.current = type;
      reportSheetRef.current?.close();
      setAlertPlacementLatLng(initialAlertPlacement(currentLatLng));
      setPlacingAlert(true);
      // Snap the map to center on the current location so the fixed center pin starts exactly
      // where alertPlacementLatLng says it is, even if the user had panned away beforehand.
      mapRef.current?.animateToRegion(
        { ...currentLatLng, latitudeDelta: 0.006, longitudeDelta: 0.006 },
        300
      );
    },
    [currentLatLng, initialAlertPlacement]
  );

  // Optional `overrideLocation` -- the "Set at my location" button below passes the driver's
  // own live GPS fix directly, skipping the fixed-center pin's current alertPlacementLatLng
  // entirely, so it reports at the real current position in one tap instead of requiring the
  // map to already be panned there. Deliberately typed as a real LatLng (never the Pressable's
  // own event object) -- every call site below passes either nothing or an explicit LatLng, no
  // call site passes onPress={confirmAlertPlacement} directly, which would otherwise hand the
  // GestureResponderEvent to this parameter instead.
  const confirmAlertPlacement = useCallback(async (overrideLocation?: LatLng) => {
    if (submittingAlertRef.current) return;
    // Real enforcement, not just a disabled-looking button -- blocks the actual Firestore write
    // whenever the typed comment contains a not-allowed word (see commentFilter.ts), same check
    // reportAlert itself repeats server-side-equivalent (belt and braces, not relying on either
    // check alone).
    if (containsBlockedLanguage(alertComment)) return;
    const type = pendingAlertTypeRef.current;
    const location = overrideLocation ?? alertPlacementLatLng;
    // Previously bailed here with zero feedback -- tapping Set just silently did nothing (no
    // banner, no error, placement bar stayed exactly as-is), which is indistinguishable from the
    // write itself failing. !user specifically means the anonymous/real sign-in Firebase sets up
    // on launch hasn't resolved yet, a real (if rare) race, not something the driver caused.
    if (!type || !location) return;
    if (!user) {
      setBannerMessage("Still signing you in -- try Set again in a moment.");
      setBannerVisible(true);
      return;
    }
    submittingAlertRef.current = true;
    setSubmittingAlert(true);
    try {
      await reportAlert(type, location, user.uid, settings.alertExpiryMs, alertComment);
      pendingAlertTypeRef.current = null;
      setPlacingAlert(false);
      setAlertPlacementLatLng(null);
      setAlertComment("");
    } catch (err) {
      // Same "log it, don't just swallow it" pattern as the rest of this screen (see reroute/
      // place-lookup catches above) -- but this write is important enough that the driver also
      // needs to actually see it failed, since nothing else here would ever tell them the alert
      // they just tried to set never made it to Firestore.
      console.warn("[map] reportAlert failed", err);
      Sentry.logger.error("map: reportAlert failed", { error: String(err) });
      setBannerMessage("Couldn't set that alert -- check your connection and try again.");
      setBannerVisible(true);
    } finally {
      submittingAlertRef.current = false;
      setSubmittingAlert(false);
    }
  }, [alertPlacementLatLng, user, settings.alertExpiryMs, alertComment]);

  // "Set at my location" -- per explicit request, a one-tap shortcut beside Cancel/Set that
  // places AND immediately confirms the alert at the driver's own real live GPS position
  // (nudged ahead along their real current heading -- see initialAlertPlacement's own comment,
  // same reasoning applies here since this also skips the fixed-center pin entirely), without
  // needing the fixed-center pin to already be panned there first. The normal "pan the map to
  // place it anywhere" flow is untouched -- this is an addition, not a replacement.
  const confirmAlertPlacementAtMyLocation = useCallback(() => {
    if (!currentLatLng) return;
    confirmAlertPlacement(initialAlertPlacement(currentLatLng));
  }, [currentLatLng, confirmAlertPlacement, initialAlertPlacement]);

  const cancelAlertPlacement = useCallback(() => {
    pendingAlertTypeRef.current = null;
    setPlacingAlert(false);
    setAlertPlacementLatLng(null);
    setAlertComment("");
  }, []);

  // Tilts (or flattens) the camera for the "2 views" alert-placement switcher -- deliberately
  // omits `center` from animateCamera (only pitch/heading are given) so the fixed-center pin's
  // actual target location, wherever the user has panned the map to, never moves. Re-centering
  // here would silently discard a careful manual pan back onto a spot the driver just passed,
  // which is the exact case this switch-view button exists to make easier.
  const togglePlacementFrontView = useCallback(() => {
    setPlacementFrontView((was) => {
      const next = !was;
      mapRef.current?.animateCamera(
        next ? { pitch: 60, heading } : { pitch: 0, heading: 0 },
        { duration: 400 }
      );
      return next;
    });
  }, [heading]);

  // Restores the proper nav camera pose (based on overviewMode) once placement ends -- without
  // this, canceling/confirming an alert reported from the front-view switch would leave the
  // camera stuck tilted at pitch 60 with no heading tracking, since the per-tick follow effect
  // deliberately never touches pitch (see its own comment) and nothing else would ever put it
  // back. Only actually animates if the switcher was used -- the common case of never touching
  // it shouldn't cost an extra camera jog against an already-correct chase-cam pose.
  useEffect(() => {
    if (placingAlert) return;
    if (placementFrontView && route && followTilt && currentLatLng) {
      mapRef.current?.animateCamera(
        overviewMode
          ? { center: currentLatLng, heading, pitch: 45, zoom: 15 }
          : { center: currentLatLng, heading, pitch: 60, zoom: 18 },
        { duration: 400 }
      );
    }
    setPlacementFrontView(false);
    // Deliberately scoped to only the placingAlert transition -- route/followTilt/currentLatLng
    // /overviewMode/heading are read for their value at that moment, not meant to re-trigger
    // this restore every time any of them changes independently while still placing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingAlert]);

  const onMarkerPress = useCallback((alert: AlertDoc) => {
    setSelectedAlert(alert);
    detailSheetRef.current?.expand();
  }, []);

  const onDeleteAlert = useCallback(async (alert: AlertDoc) => {
    await deleteAlert(alert.id);
    detailSheetRef.current?.close();
  }, []);

  const onHideAlert = useCallback(async (alert: AlertDoc) => {
    if (!user) return;
    await hideAlertForUser(alert.id, user.uid);
    detailSheetRef.current?.close();
  }, [user]);

  const onConfirmStillHere = useCallback(async (alert: AlertDoc) => {
    await confirmAlert(alert.id);
  }, []);

  // The right-edge FAB stack's base offset -- during navigation this leaves real room below it
  // for the new bottom trip bar (NavBottomBar), using its actual measured height instead of a
  // guessed constant (same reasoning as instructionCardHeight/routeCardHeight above).
  const navFabBaseBottom = insets.bottom + 24 + (route ? bottomBarHeight + spacing.sm : 0);
  // Single source of truth for the right-edge secondary FAB stack's vertical spacing (AI
  // Detection, 3D, satellite, locate) -- each button's `bottom` used to be its own independently
  // hand-typed `navFabBaseBottom + <magic number>` literal, which is exactly how the AI
  // Detection button ended up pinned to the top of the screen earlier this session (one of those
  // four literals got edited on its own and silently drifted out of sync with the rest). Deriving
  // every button's position from this one step value instead means they're structurally
  // guaranteed to stay evenly spaced and never collide, no matter how many more of these buttons
  // get added or reordered later -- fabSecondaryBottom(0) is the button closest to the bottom
  // edge (AI Detection), incrementing outward from there. The `route ? 0 : 1` offset preserves
  // the same slot the Report "+" FAB (which has its own fixed, independent position) occupies
  // only while not navigating.
  // Per explicit request: smaller buttons AND a wider relative gap between them, not just a
  // scaled-down version of the same tight spacing -- 44px/34px buttons (down from 52px/40px)
  // with a 20px/14px gap between them (up from 18px/14px) so any two adjacent buttons read as
  // clearly, unmistakably separate even at a glance, not just technically non-overlapping.
  const fabSecondaryStep = route ? 48 : 64;
  const fabSecondaryBottom = (indexFromBottom: number) =>
    navFabBaseBottom + (indexFromBottom + (route ? 0 : 1)) * fabSecondaryStep;

  const activeStep = route?.steps[activeStepIndex] ?? null;
  // Real "you've arrived at the stop" detection for a transit trip -- scoped to the FIRST
  // boarding stop of the whole journey (route.transitSummary.legs[0], see services/
  // directions.ts), which is the concrete case actually asked for: walk to the stop, then get
  // told the real departure time once there instead of generic turn-by-turn that doesn't know
  // the walk is done. Doesn't attempt to detect arrival at a *later* transfer stop mid-trip --
  // that would need per-step transit metadata this app doesn't parse yet. 40m matches the
  // OFF_ROUTE_METERS-style tolerance used elsewhere for "close enough" on foot with normal GPS
  // drift.
  const firstBoardingStop = route?.transitSummary?.legs[0];
  const atTransitBoardingStop =
    !!firstBoardingStop &&
    !!currentLatLng &&
    distanceKm(
      currentLatLng.latitude,
      currentLatLng.longitude,
      firstBoardingStop.departureLocation.latitude,
      firstBoardingStop.departureLocation.longitude
    ) *
      1000 <=
      40;
  // The drawn route line, trimmed to only what's actually still ahead -- previously this was
  // always the full original route.polyline, so the whole already-driven portion stayed drawn
  // behind the puck for the entire trip. Each RouteStep carries its own polyline segment, so
  // "remaining" is every step from activeStepIndex onward, with the *current* step further
  // trimmed to the closest point to the live GPS fix (not just whole completed steps) -- a
  // shorter polyline is also real, measurable less work for the native map to redraw on every
  // pan/zoom frame, which is part of what reads as drag lag on a long route.
  const remainingPolyline = useMemo(() => {
    if (!route) return [];
    const stepsAhead = route.steps.slice(activeStepIndex);
    if (stepsAhead.length === 0) return [];
    const [currentStep, ...restSteps] = stepsAhead;
    let currentStepPolyline = currentStep.polyline;
    if (currentLatLng && currentStepPolyline.length > 1) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < currentStepPolyline.length; i++) {
        const pt = currentStepPolyline[i];
        const d = distanceKm(currentLatLng.latitude, currentLatLng.longitude, pt.latitude, pt.longitude);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      currentStepPolyline = currentStepPolyline.slice(nearestIdx);
    }
    return [...currentStepPolyline, ...restSteps.flatMap((s) => s.polyline)];
  }, [route, activeStepIndex, currentLatLng?.latitude, currentLatLng?.longitude]);
  const remainingDistanceMeters = useMemo(
    () => (route ? route.steps.slice(activeStepIndex).reduce((sum, s) => sum + s.distanceMeters, 0) : 0),
    [route, activeStepIndex]
  );
  const remainingDurationSeconds = useMemo(
    () => (route ? route.steps.slice(activeStepIndex).reduce((sum, s) => sum + s.durationSeconds, 0) : 0),
    [route, activeStepIndex]
  );
  const arrivalClockText = useMemo(
    () => (route ? formatArrivalClock(Date.now() + remainingDurationSeconds * 1000) : ""),
    [route, remainingDurationSeconds]
  );

  // Real live-tracking link: the first tap creates a liveShares Firestore doc and a periodic
  // effect (below) keeps it updated with position/ETA every REFRESH_MS while navigating; a
  // second tap mid-trip reuses the same doc/link rather than creating a new one, so re-sharing
  // doesn't fragment the trip across multiple stale links. The doc stops updating (and the
  // recipient's page shows "trip ended") the moment exitNavigation fires, per explicit answer.
  const shareEta = useCallback(async () => {
    if (!route || !currentLatLng || !user) return;
    let shareId = liveShareIdRef.current;
    try {
      if (!shareId) {
        shareId = await createLiveShare(user.uid, {
          lat: currentLatLng.latitude,
          lng: currentLatLng.longitude,
          heading,
          etaText: route.etaText,
          arrivalClockText,
        });
        liveShareIdRef.current = shareId;
      }
    } catch (err) {
      Sentry.logger.error("map: create live share failed", { error: String(err) });
      console.warn("[map] create live share failed", err);
    }
    const liveLink = shareId
      ? `https://tracklinemaps.com/live/${shareId}`
      : `https://www.google.com/maps?q=${currentLatLng.latitude},${currentLatLng.longitude}`;
    const message =
      `I'm on my way -- ETA ${route.etaText}, arriving around ${arrivalClockText}. ` +
      `Follow my live location: ${liveLink}`;
    try {
      await Share.share({ message });
    } catch (err) {
      Sentry.logger.error("map: share ETA failed", { error: String(err) });
      console.warn("[map] share ETA failed", err);
    }
  }, [route, currentLatLng, arrivalClockText, heading, user]);

  const onNavOptionsShareEta = useCallback(() => {
    navOptionsSheetRef.current?.close();
    shareEta();
  }, [shareEta]);
  const onNavOptionsEndNavigation = useCallback(() => {
    navOptionsSheetRef.current?.close();
    exitNavigation();
  }, [exitNavigation]);

  // Keeps the live share doc (if one was ever started for this trip) fresh while navigating --
  // 12s matches the cadence other live-position writes in this app use as a reasonable
  // balance between "recipient sees real movement" and Firestore write volume. Stops the
  // instant route becomes null (interval cleanup) or liveShareIdRef is empty (nothing to
  // update, most trips never call shareEta at all).
  useEffect(() => {
    if (!route) return;
    const interval = setInterval(() => {
      const shareId = liveShareIdRef.current;
      const latLng = currentLatLngRef.current;
      if (!shareId || !latLng) return;
      updateLiveShare(shareId, {
        lat: latLng.latitude,
        lng: latLng.longitude,
        heading,
        etaText: route.etaText,
        arrivalClockText,
      }).catch((err) => {
        Sentry.logger.error("map: update live share failed", { error: String(err) });
      });
    }, 12000);
    return () => clearInterval(interval);
  }, [route, heading, arrivalClockText]);

  return (
    <View style={styles.container}>
      {/* Everything map-related lives in its own flex:1 area so the banner ad below gets a
          real reserved row of its own instead of floating over the map -- it can never
          overlap the route, turn instructions, or FAB buttons this way. */}
      <View style={styles.mapArea}>
      {/* DIAGNOSTIC BUILD -- native MapView swapped for a plain placeholder View. Sentry
          native, the entire ad SDK, AsyncStorage, and now expo-location's watch (see
          LocationContext.tsx's DIAGNOSTIC_DISABLE_LOCATION_WATCH) are all off in this same
          build. MapView is the one remaining unconditional-on-launch native surface that's
          never been isolated -- it mounts on every cold launch with zero gating, same as the
          subsystems already ruled out. If the crash disappears with this out too, MapView (or
          its provider config/customMapStyle) is confirmed; if it persists, every native
          surface examined so far is ruled out and the search moves to something not yet
          identified, with real evidence either way. */}
      {DIAGNOSTIC_DISABLE_MAPVIEW ? (
        <View style={[StyleSheet.absoluteFill, styles.mapPlaceholder]} />
      ) : (
      // Google provider on every platform, iOS included. iOS defaulting to Apple's native
      // MapKit (provider left unset) used to be deliberate here, reasoned as "Google needs a
      // custom dev client on iOS, unavailable in Expo Go" -- true for Expo Go, but this app is
      // never run in Expo Go; it's always a real EAS-built binary, so that caveat never actually
      // applied to it. The real, confirmed cost of leaving iOS on Apple Maps: customMapStyle
      // (the map color theme picker in Settings) is a silent no-op on Apple's native renderer --
      // it has no equivalent JSON styling mechanism at all, so every theme *looked* identical
      // (Apple's own fixed light/dark palette) regardless of which one was selected. The
      // react-native-maps Google config plugin + a real GOOGLE_MAPS_IOS_API_KEY (confirmed set
      // in EAS's production env) are already wired in app.config.js, so this is switching on
      // infrastructure that was already fully built, not adding new native surface from
      // scratch.
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        // The custom theme style only ever applies to the "standard" map type -- satellite/
        // hybrid imagery has no styleable roads/land polygons to restyle, so Google/Apple just
        // ignore it there. Safe to always pass. Theme picked in Settings (see mapStyle.ts).
        customMapStyle={MAP_THEME_STYLES[settings.mapTheme]}
        style={StyleSheet.absoluteFill}
        // Always false -- the native blue dot is fully replaced by custom markers below (the
        // car puck while navigating, the person marker otherwise), not just swapped in during
        // navigation. A plain dot doesn't communicate which way you're facing either, which
        // matters once the camera itself is also rotating to match heading.
        showsUserLocation={false}
        showsMyLocationButton={false}
        // Explicit rather than relying on the library default -- two-finger twist-to-rotate
        // and two-finger drag-to-tilt are both genuinely native MapView gestures, not something
        // this app has to implement by hand.
        rotateEnabled
        pitchEnabled
        // `initialRegion` is a mount-time-only prop -- react-native-maps never re-reads it once
        // the map has rendered once. A real GPS fix normally takes a second or two after
        // launch/permission-grant to arrive, so this coordinate (San Francisco -- an arbitrary
        // engineering placeholder, not meant to mean anything) briefly shows before the very
        // next effect below corrects it to the real position the instant one exists. This used
        // to have no such correction at all -- if the first fix hadn't landed yet at the exact
        // moment this mounted, the map just silently stayed on this placeholder forever, which
        // is exactly the confirmed "why is it showing San Francisco, I'm in Sydney" bug.
        initialRegion={{
          latitude: currentLatLng?.latitude ?? 37.7749,
          longitude: currentLatLng?.longitude ?? -122.4194,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={onMapPress}
        onPanDrag={onMapPanDrag}
        onMapReady={() => setMapReady(true)}
      >
        {/* Upgraded route line style, per explicit request -- a wider white "casing" line drawn
            first (underneath), then the real colored route on top slightly narrower, the same
            layered-outline look Google/Apple Maps use so the route reads as a single bold,
            polished band against any map style/theme instead of a flat single-color stroke.
            zIndex keeps the casing strictly below the colored line even though both are drawn
            back-to-back here. */}
        {route && remainingPolyline.length > 1 && (
          <>
            <Polyline coordinates={remainingPolyline} strokeWidth={14} strokeColor="#FFFFFF" zIndex={1} />
            <Polyline
              coordinates={remainingPolyline}
              strokeWidth={9}
              strokeColor="#2563EB"
              tappable
              onPress={enterOverviewMode}
              zIndex={2}
            />
          </>
        )}
        {/* Real mid-trip add-a-stop preview, per explicit request: the route through the new
            stop draws in green, right alongside the still-live blue route above -- a genuine
            side-by-side comparison, not a replacement, until confirmStopPreview actually
            commits it (see the confirm/back bar below). */}
        {stopPreviewRoute && (
          <Polyline coordinates={stopPreviewRoute.polyline} strokeWidth={7} strokeColor="#22C55E" />
        )}
        {/* Real traffic-jam reroute suggestion -- same green-alongside-blue treatment as the
            add-stop preview above, drawn only once a genuinely faster side-streets alternative
            has actually been found (see the periodic check effect). Route 1 (blue, above) never
            stops being drawn while this is up. */}
        {trafficSuggestionRoute && !stopPreviewRoute && (
          <Polyline coordinates={trafficSuggestionRoute.polyline} strokeWidth={7} strokeColor="#22C55E" />
        )}
        {/* Live device-compass "flashlight" cone -- separate from the route arrow below and
            rotated by deviceHeading (magnetometer), not travel heading, so it visually shows
            which way the PHONE is physically pointing right now without ever moving the
            route-facing arrow itself. Rendered first so it paints underneath the puck. Anchored
            at its narrow tip (y: 1) so it fans outward from the puck's exact position instead
            of rotating around its own center. */}
        {route && currentLatLng && deviceHeading != null && (
          <Marker
            coordinate={currentLatLng}
            anchor={{ x: 0.5, y: 1 }}
            flat
            rotation={deviceHeading}
            tracksViewChanges={false}
          >
            <View style={styles.compassConeGlyph} />
          </Marker>
        )}
        {/* Real navigation arrow, replacing the default blue dot while actively navigating/
            driving -- flat+rotation is react-native-maps' own built-in support for a marker
            that rotates with heading instead of always facing the camera, so it turns a full
            live 360° with every heading update. CarNavArrow is a plain-View/SVG component (see
            components/LocationMarkers.tsx), deliberately not a raster <Image> -- react-native-
            maps has several open iOS issues where flat+rotation on a custom *Image* marker
            child stops reflecting live rotation updates once tracksViewChanges is false (the
            exact bug an earlier photo-based version of this marker hit); a plain View doesn't
            have that problem, so tracksViewChanges can safely stay false here, matching every
            other static marker in this app. */}
        {route && currentLatLng && (
          <Marker coordinate={currentLatLng} anchor={{ x: 0.5, y: 0.5 }} flat rotation={heading} tracksViewChanges={false}>
            <CarNavArrow />
          </Marker>
        )}
        {/* Real person/location marker for the normal (not navigating) map view -- replacing
            the default blue dot there too. Deliberately not rotated: a walking/browsing
            position doesn't have the same "facing direction" a moving vehicle does, so this
            just tracks live position with a pulsing halo, the same convention Waze/Google Maps
            use for a plain "you are here" marker versus their own directional vehicle pucks. */}
        {!route && currentLatLng && (
          <Marker coordinate={currentLatLng} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <PersonLocationDot />
          </Marker>
        )}
        {/* Preview of whichever route profile is highlighted in the picker below, before
            the user commits to it with Start -- "click a route, see its line" like Apple/
            Google Maps' own route picker. Red and thick (not the same blue as the committed
            route below, or the destination halo) so it stays visible against every map theme --
            the old blue preview was the exact same shade as several themes' own road color
            (e.g. Blue & Grey), making it functionally invisible on top of a same-colored
            street. Dashed on top of that so it's still visually distinct from the solid
            committed-route line (the two are mutually exclusive: `route` is only ever set once
            routeOptions has been cleared by confirmRoute). */}
        {/* All three route options drawn at once, per explicit request (like Apple/Google
            Maps' own route picker) instead of only ever showing the currently-selected one --
            the selected route highlighted (thicker, red, on top so it's never covered by the
            other two -- see zIndex), the other two muted gray and thinner so they still read as
            real, tappable alternatives rather than clutter. Tapping any of the three (line or
            ETA pill below) selects it, same as tapping its row in the RouteOptionsCard sheet. */}
        {routeOptions &&
          ROUTE_PROFILE_ORDER.map((key) => {
            const isSelected = key === selectedProfile;
            return (
              <React.Fragment key={key}>
                {/* Same white-casing treatment as the committed route above, only for the
                    currently-selected preview -- keeps the unselected two clearly secondary
                    (thin, flat gray, no casing) while the highlighted one reads as the same bold,
                    polished band the app now uses everywhere else a route is drawn. */}
                {isSelected && (
                  <Polyline coordinates={routeOptions[key].polyline} strokeWidth={12} strokeColor="#FFFFFF" zIndex={1} />
                )}
                <Polyline
                  coordinates={routeOptions[key].polyline}
                  strokeWidth={isSelected ? 8 : 5}
                  strokeColor={isSelected ? "#DC2626" : "rgba(107, 114, 128, 0.55)"}
                  lineDashPattern={isSelected ? [10, 7] : undefined}
                  tappable
                  onPress={() => setSelectedProfile(key)}
                  zIndex={isSelected ? 2 : 1}
                />
              </React.Fragment>
            );
          })}
        {/* Small floating ETA pill per route, per explicit request -- "clear enough to see,
            not overlaying the map." Positioned at a different fraction along each route's own
            polyline (not all at the literal midpoint) so three pills sitting on largely
            overlapping road sections don't all land in exactly the same spot. Never a static
            label -- etaInTrafficText/etaText are the same real, live Google Directions figures
            RouteOptionsCard's own rows already show. */}
        {routeOptions &&
          ROUTE_PROFILE_ORDER.map((key, i) => {
            const r = routeOptions[key];
            const labelPoint = pointAtPolylineFraction(r.polyline, ROUTE_ETA_PILL_FRACTIONS[i]);
            if (!labelPoint) return null;
            const isSelected = key === selectedProfile;
            return (
              <Marker
                key={`${key}-eta`}
                coordinate={labelPoint}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => setSelectedProfile(key)}
                tracksViewChanges={false}
                zIndex={isSelected ? 4 : 3}
              >
                <View style={[styles.routeEtaPill, isSelected && styles.routeEtaPillSelected]}>
                  <Text style={[styles.routeEtaPillText, isSelected && styles.routeEtaPillTextSelected]}>
                    {r.etaInTrafficText ?? r.etaText}
                  </Text>
                </View>
              </Marker>
            );
          })}
        {/* Same preview treatment for walking/bicycling/transit -- these modes only ever have
            one `modeRoute` (see RouteOptionsCard) instead of the 3-way `routeOptions` picker
            above, but that meant this preview line's condition never matched for them at all,
            so picking Bike/Walk/Transit showed just the bare map with no line until Start was
            actually pressed. */}
        {modeRoute && !routeOptions && (
          <>
            <Polyline coordinates={modeRoute.polyline} strokeWidth={12} strokeColor="#FFFFFF" zIndex={1} />
            <Polyline
              coordinates={modeRoute.polyline}
              strokeWidth={8}
              strokeColor="#DC2626"
              lineDashPattern={[10, 7]}
              zIndex={2}
            />
          </>
        )}
        {/* Highlighted arrival spot -- the exact picked destination (not wherever the
            polyline decoder's last point happens to land), so it's obvious exactly which
            building/driveway is the actual arrival point rather than "somewhere on this
            block". A soft green halo ring plus a matching green pin on top, both anchored to
            the same coordinate -- green specifically (not the app's usual blue accent) so the
            arrival point reads distinctly as "destination reached here", the same convention
            the app's own original navigation design used. */}
        {destinationLatLng && (
          <>
            <Circle
              center={destinationLatLng}
              radius={40}
              strokeWidth={2}
              strokeColor="rgba(34, 197, 94, 0.9)"
              fillColor="rgba(34, 197, 94, 0.18)"
            />
            <Marker coordinate={destinationLatLng} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
              <View style={styles.destinationPinWrap}>
                <Ionicons name="location" size={40} color="#22C55E" />
              </View>
            </Marker>
          </>
        )}
        {visibleAlerts.map((alert) => (
          <AlertMarker
            key={alert.id}
            alert={alert}
            onPress={onMarkerPress}
            isSelected={selectedAlert?.id === alert.id}
          />
        ))}
        {settings.showTrafficLights &&
          trafficLightClusters.map((c) =>
            c.count === 1 ? (
              <Marker
                key={`tl-${c.points[0].id}`}
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={(e) => {
                  e.stopPropagation();
                  onOsmMarkerPress("traffic_light", { latitude: c.lat, longitude: c.lng });
                }}
              >
                <View style={styles.osmIconBadgeTrafficLight}>
                  <MaterialCommunityIcons name={TRAFFIC_LIGHT_MARKER.icon} size={TRAFFIC_LIGHT_MARKER.glyphSize} color="#FFFFFF" />
                </View>
              </Marker>
            ) : (
              <Marker
                key={`tlc-${c.key}`}
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={(e) => {
                  e.stopPropagation();
                  onTrafficLightClusterPress(c.lat, c.lng);
                }}
              >
                <View style={styles.osmClusterBadge}>
                  {/* Per explicit request: how-many-lights-are-here shown as that many small
                      light glyphs instead of a bare number, so the badge communicates the real
                      count at a glance the same way the marker itself does. Capped at
                      MAX_CLUSTER_ICONS -- a real intersection cluster can run into the teens,
                      and a badge that just keeps growing wider stops being a compact marker;
                      the remainder folds into a "+N" suffix instead. */}
                  {Array.from({ length: Math.min(c.count, MAX_CLUSTER_ICONS) }).map((_, i) => (
                    <MaterialCommunityIcons
                      key={i}
                      name={TRAFFIC_LIGHT_MARKER.icon}
                      size={TRAFFIC_LIGHT_MARKER.glyphSize}
                      color="#FFFFFF"
                    />
                  ))}
                  {c.count > MAX_CLUSTER_ICONS && (
                    <Text style={styles.osmClusterBadgeText}>+{c.count - MAX_CLUSTER_ICONS}</Text>
                  )}
                </View>
              </Marker>
            )
          )}
        {settings.showSpeedCameras &&
          speedCameraClusters.map((c) =>
            c.count === 1 ? (
              <Marker
                key={`sc-${c.points[0].id}`}
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={(e) => {
                  e.stopPropagation();
                  onOsmMarkerPress("speed_camera", { latitude: c.lat, longitude: c.lng });
                }}
              >
                <View style={styles.osmIconBadgeSpeedCamera}>
                  <MaterialCommunityIcons name={SPEED_CAMERA_MARKER.icon} size={SPEED_CAMERA_MARKER.glyphSize} color="#FFFFFF" />
                </View>
              </Marker>
            ) : (
              <Marker
                key={`scc-${c.key}`}
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={(e) => {
                  e.stopPropagation();
                  onSpeedCameraClusterPress(c.lat, c.lng);
                }}
              >
                <View style={styles.osmClusterBadgeSpeedCamera}>
                  {/* Same "show what's actually there" fix as the traffic-light cluster badge
                      above -- capped lower (MAX_SPEED_CAMERA_CLUSTER_ICONS, not the traffic
                      light MAX_CLUSTER_ICONS) since this glyph is drawn much bigger
                      (SPEED_CAMERA_MARKER.glyphSize=18 vs traffic lights' 9), and a compact
                      badge stops being compact once several of those are packed in a row. */}
                  {Array.from({ length: Math.min(c.count, MAX_SPEED_CAMERA_CLUSTER_ICONS) }).map((_, i) => (
                    <MaterialCommunityIcons
                      key={i}
                      name={SPEED_CAMERA_MARKER.icon}
                      size={SPEED_CAMERA_MARKER.glyphSize}
                      color="#FFFFFF"
                    />
                  ))}
                  {c.count > MAX_SPEED_CAMERA_CLUSTER_ICONS && (
                    <Text style={styles.osmClusterBadgeText}>+{c.count - MAX_SPEED_CAMERA_CLUSTER_ICONS}</Text>
                  )}
                </View>
              </Marker>
            )
          )}
        {settings.showLiveCameras &&
          liveCameras.map((camera) => (
            <Marker
              key={`lc-${camera.id}`}
              coordinate={{ latitude: camera.lat, longitude: camera.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={(e) => {
                e.stopPropagation();
                onLiveCameraPress(camera);
              }}
            >
              <View style={styles.osmIconBadgeLiveCamera}>
                <Ionicons name="videocam" size={16} color="#FFFFFF" />
              </View>
            </Marker>
          ))}
      </MapView>
      )}

      {/* Fixed center-of-screen pin for manual alert placement -- see the comment on
          onAlertTypeSelected/onRegionChangeComplete above for why this replaced a draggable
          Marker. Never moves itself; the map pans/zooms underneath it instead. */}
      {placingAlert && (
        <View style={styles.placementPinOverlay} pointerEvents="none">
          <Ionicons name="location" size={44} color={colors.danger} />
        </View>
      )}

      {show3D && isMap3DSupported && currentLatLng && (
        <>
          <Map3DView
            ref={map3DRef}
            style={StyleSheet.absoluteFill}
            center={currentLatLng}
            markerPosition={currentLatLng}
            routeCoordinates={route?.polyline}
          />
          <Pressable
            style={({ pressed }) => [
              styles.frontViewButton,
              { top: insets.top + spacing.md },
              frontView && styles.fabActive,
              pressed && { opacity: pressedOpacity },
            ]}
            onPress={toggleFrontView}
            accessibilityLabel={frontView ? "Switch to top-down 3D view" : "Switch to front view"}
          >
            <Ionicons name={frontView ? "layers" : "eye"} size={18} color="#FFFFFF" />
            <Text style={styles.frontViewButtonText}>{frontView ? "Top-down" : "Front view"}</Text>
          </Pressable>
        </>
      )}

      {/* Custom "From" picker -- reachable either from the idle search panel's own From row
          (no destination picked yet) or from the route-options card's From row once one has
          been (see onOriginSelected re-fetching against pendingDestination when that's the
          case). Gated only on !pendingDestination||pickingOrigin isn't needed since pickingOrigin
          itself is the switch; it just needs to win over whichever of the two other panels would
          otherwise show for the current pendingDestination state. */}
      {!route && !placingAlert && pickingOrigin && (
        <DestinationSearchBar
          biasLocation={currentLatLng ?? undefined}
          onDestinationSelected={onOriginSelected}
          placeholder="Choose starting point"
          onCancel={() => setPickingOrigin(false)}
          showMyLocation
          myLocationAddress={liveAddress ?? undefined}
        />
      )}

      {!route && !pendingDestination && !placingAlert && !pickingOrigin && (
        <DestinationSearchBar
          biasLocation={routeOriginLatLng ?? undefined}
          onDestinationSelected={onDestinationSelected}
          onFindNearestStation={onFindNearestStation}
          findingNearestStation={findingNearestStation}
          onFindRestaurants={() => restaurantsSheetRef.current?.expand()}
          onFindHotels={() => hotelsSheetRef.current?.expand()}
          originLabel={routeOriginLabel}
          onPressOrigin={() => setPickingOrigin(true)}
        />
      )}

      {!route && pendingDestination && pickingStop && !pickingOrigin && (
        <DestinationSearchBar
          biasLocation={currentLatLng ?? undefined}
          onDestinationSelected={onStopSelected}
          placeholder="Add a stop on the way"
          onCancel={() => setPickingStop(false)}
        />
      )}

      {!route && pendingDestination && !pickingStop && !pickingOrigin && (
        <RouteOptionsCard
          options={routeOptions}
          modeRoute={modeRoute}
          modeRouteOptions={modeRouteOptions}
          selectedModeRouteIndex={selectedModeRouteIndex}
          onSelectModeRoute={onSelectModeRoute}
          travelMode={travelMode}
          onSelectTravelMode={onSelectTravelMode}
          loading={loadingRouteOptions}
          errorText={routeOptionsError}
          selected={selectedProfile}
          onSelect={onSelectProfile}
          onStart={confirmRoute}
          onCancel={cancelRouteOptions}
          onAddStop={() => setPickingStop(true)}
          hasStop={!!stopLocation}
          onHeightChange={setRouteCardHeight}
          originLabel={routeOriginLabel}
          onChangeOrigin={() => setPickingOrigin(true)}
        />
      )}

      {route && (
        <NavigationInstructionCard
          step={activeStep}
          roadName={currentRoadName}
          speedLimitKmh={speedLimitKmh}
          themeKey={settings.navCardTheme}
          onExit={exitNavigation}
          onExpandDirections={() => directionsSheetRef.current?.expand()}
          onHeightChange={setInstructionCardHeight}
        />
      )}

      {/* Waze/Google-Maps-style bottom trip bar -- ETA/arrival/distance + road name, Add Stop,
          and the "..." options menu (Report/Share ETA/AI Detection/End -- see NavOptionsSheet).
          Hidden while the add-stop search or its green preview is up (both render their own
          bottom bar/confirm bar in this same screen region) to avoid stacking two bars. */}
      {route && !addingStopDuringNav && !stopPreviewRoute && (
        <NavBottomBar
          etaText={route.etaText}
          arrivalClockText={arrivalClockText}
          distanceRemainingText={`${(remainingDistanceMeters / 1000).toFixed(1)} km`}
          roadName={currentRoadName}
          themeKey={settings.navCardTheme}
          hasStop={!!stopLocation}
          onAddStop={() => setAddingStopDuringNav(true)}
          onRemoveStop={removeStopDuringNav}
          onOptions={() => navOptionsSheetRef.current?.expand()}
          onHeightChange={setBottomBarHeight}
        />
      )}

      {/* Real mid-trip add-a-stop search -- overlays the turn card at the same top position
          (same as the pre-Start search bar) but deliberately does NOT touch `route`, so the
          route line, puck, and live GPS tracking underneath keep running the whole time this is
          open instead of the screen dropping back to a bare map with no navigation context. */}
      {route && addingStopDuringNav && (
        <DestinationSearchBar
          biasLocation={currentLatLng ?? undefined}
          onDestinationSelected={onStopSelectedDuringNav}
          placeholder="Add a stop on the way"
          onCancel={() => setAddingStopDuringNav(false)}
        />
      )}

      {/* Confirm/back bar for the green add-stop preview above -- Back discards it and returns
          to live navigation exactly as it was; Add Stop actually commits the reroute. */}
      {stopPreviewRoute && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>Add this stop to your route?</Text>
          <View style={styles.placementBarButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.placementButton,
                styles.placementButtonRemove,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={cancelStopPreview}
              accessibilityLabel="Back -- cancel adding this stop"
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.placementButton,
                styles.placementButtonSet,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={confirmStopPreview}
              accessibilityLabel="Confirm add stop"
            >
              <Ionicons name="checkmark" size={20} color="#FFFFFF" />
              <Text style={styles.placementButtonSetText}>Add Stop</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Real traffic-jam reroute suggestion -- only ever shown once the periodic check above
          has actually found a genuinely faster side-streets alternative during a real traffic
          delay. Semi-transparent "island" tab per explicit request (not opaque, not so
          transparent it's hard to read), auto-dismisses after TRAFFIC_SUGGESTION_DISPLAY_MS if
          left untouched, and gives three distinct real controls: Yes (accept), No (decline),
          and a separate X close -- all three just call through to accept/dismiss, kept as
          separate elements because that's what was explicitly asked for. */}
      {route && trafficSuggestionRoute && !stopPreviewRoute && !addingStopDuringNav && !placingAlert && (
        <View
          style={[
            styles.trafficSuggestionBanner,
            { top: insets.top + spacing.md + instructionCardHeight + spacing.md },
          ]}
        >
          <View style={styles.trafficSuggestionTopRow}>
            <View style={styles.trafficSuggestionIconWrap}>
              <Ionicons name="flash" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.trafficSuggestionTitle}>Heavy traffic ahead</Text>
              <Text style={styles.trafficSuggestionBody}>
                Faster via side streets -- save {Math.max(1, Math.round(trafficSuggestionSavedSeconds / 60))} min
              </Text>
            </View>
            <Pressable
              onPress={dismissTrafficSuggestion}
              hitSlop={10}
              style={({ pressed }) => [styles.trafficSuggestionClose, pressed && { opacity: pressedOpacity }]}
              accessibilityLabel="Close -- not wanted, keep current route"
            >
              <Ionicons name="close" size={16} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.trafficSuggestionActionRow}>
            <Pressable
              style={({ pressed }) => [
                styles.trafficSuggestionActionButton,
                styles.trafficSuggestionNoButton,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={dismissTrafficSuggestion}
              accessibilityLabel="No -- keep current route"
            >
              <Text style={styles.trafficSuggestionNoText}>No</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.trafficSuggestionActionButton,
                styles.trafficSuggestionYesButton,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={acceptTrafficSuggestion}
              accessibilityLabel={`Yes -- switch to the faster route, save about ${Math.max(1, Math.round(trafficSuggestionSavedSeconds / 60))} minutes`}
            >
              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              <Text style={styles.trafficSuggestionYesText}>Yes</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* "End suggested route" -- only shown while actually driving an accepted suggestion (see
          acceptedSuggestionOriginalRoute), per explicit request. Restores the exact route the
          driver was on before they accepted. */}
      {route && acceptedSuggestionOriginalRoute && !stopPreviewRoute && !addingStopDuringNav && !placingAlert && (
        <View style={[styles.endSuggestedRouteWrap, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]}>
          <Pressable
            style={({ pressed }) => [styles.endSuggestedRouteButton, pressed && { opacity: pressedOpacity }]}
            onPress={endSuggestedRoute}
            accessibilityLabel="End suggested route -- return to your original route"
          >
            <Ionicons name="return-up-back" size={16} color="#FFFFFF" />
            <Text style={styles.endSuggestedRouteText}>End suggested route</Text>
          </Pressable>
        </View>
      )}

      {/* Off-route auto-reroute is silent otherwise -- a fresh route fetch (a real network
          call) can take a moment, and with zero feedback that gap could easily read as the app
          having frozen or missed the miss entirely, right when trust in the nav matters most. */}
      {rerouting && (
        <View
          style={[styles.reroutingBadge, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]}
          accessibilityLabel="Rerouting"
        >
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.reroutingBadgeText}>Rerouting…</Text>
        </View>
      )}

      {/* Real "you've arrived at the stop" state for a transit trip -- see
          atTransitBoardingStop's own comment above for scope (first boarding stop only). Shows
          the actual departure time already fetched with the route (same Google transit data
          the picker itself showed), not a live GPS-tracked bus position -- honest about being
          a schedule-based estimate, matching how the rest of this app already labels its own
          Directions-derived ETAs. */}
      {atTransitBoardingStop && firstBoardingStop && (
        <View
          style={[styles.transitWaitBadge, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]}
          accessibilityLabel="Waiting at boarding stop"
        >
          <Ionicons name="bus" size={18} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.transitWaitTitle}>
              You've arrived at {firstBoardingStop.departureStop || "the stop"}
            </Text>
            <Text style={styles.transitWaitSubtitle}>
              {firstBoardingStop.lineName ? `${firstBoardingStop.lineName} ` : ""}
              {firstBoardingStop.departureText
                ? `departs ${firstBoardingStop.departureText}`
                : "Real-time Google Directions estimate"}
            </Text>
          </View>
        </View>
      )}

      {/* Pushed below the instruction card while navigating (instead of sharing its top
          offset) so it never overlaps the turn text -- it used to sit at the same `top` as
          the full-width card and render on top of its right edge. This used to be a fixed
          "+96" guess, but the card's real height varies with how many lines the instruction/
          meta text wrap to (a long instruction like "At the roundabout, take the 1st exit onto
          Noble Ave..." wraps taller than a short one) -- a guess that undershot the real height
          meant this whole button column, mute included, could end up partly behind the card,
          which is exactly what made the volume button intermittently miss taps depending on
          which instruction happened to be showing. instructionCardHeight (measured via the
          card's own onLayout) replaces the guess with the real number; 96 only remains as the
          fallback for the one frame before the very first measurement lands. */}
      <View
        style={[
          styles.topRightControls,
          {
            top: insets.top + spacing.md + (route ? instructionCardHeight + spacing.md : 0),
            // Hugs the true edge a little tighter while navigating specifically -- this column
            // sits directly over the live route line/road labels then, and every extra pixel
            // out toward the edge is a pixel of map the driver can actually see underneath it.
            right: route ? spacing.xs : spacing.sm,
          },
        ]}
      >
        {/* Small, muted "out of place, come back" indicator -- only appears once a manual pan
            has dropped out of following. Deliberately understated (icon-only, no bright fill/
            label) per explicit request: a driving app's screen shouldn't have a big, bright
            button competing for attention; this only needs to be noticeable enough to find,
            not loud. Camera-height switching (front view <-> overview) lives on the always-
            present locate FAB instead of a separate button here. */}
        {route && !followTilt && (
          <Pressable
            style={({ pressed }) => [styles.recenterPill, pressed && { opacity: pressedOpacity }]}
            onPress={toggleFollowTilt}
            hitSlop={8}
            accessibilityLabel="Recenter on my location"
          >
            <Ionicons name="navigate" size={16} color={colors.textMuted} />
          </Pressable>
        )}
        {route && followTilt && (
          <Pressable
            style={({ pressed }) => [styles.settingsButton, pressed && { opacity: pressedOpacity }]}
            onPress={toggleFollowTilt}
            hitSlop={8}
            accessibilityLabel="Exit close-follow view"
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        )}
        {/* Voice guidance only ever speaks during active turn-by-turn navigation, so mute
            only means anything then -- previously always rendered here, which put it at the
            exact same top offset as the destination search bar (both start at
            insets.top + spacing.md) and painted on top of the search bar's right edge
            whenever not navigating, looking like a broken "voice search" button glued to the
            search input instead of a separate control. */}
        {route && <MuteButton />}
        {/* Overpass (OSM) traffic-light/speed-camera lookups can genuinely take a few
            seconds -- a visible spinner while one is in flight replaces what used to look
            like the layer being permanently stuck with no feedback at all. */}
        {osmLoading && (settings.showTrafficLights || settings.showSpeedCameras) && (
          <View style={styles.osmLoadingBadge} accessibilityLabel="Loading traffic light and speed camera data">
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.settingsButton, pressed && { opacity: pressedOpacity }]}
          onPress={() => navigation.navigate("Settings")}
          hitSlop={8}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Hidden while a bottom sheet is open, an alert is being placed, or the route/stop
          picker card is up (pendingDestination) -- previously these stayed rendered at their
          normal position underneath whichever card was showing, and the FAB right above that
          card's top edge visibly collided with it (the satellite/camera buttons overlapping
          "Fastest"/"Safest" rows) instead of being cleanly covered or cleanly visible. Shrunk
          while actively navigating specifically -- this whole stack sits directly over the live
          route/map then, and every button here already has a same-purpose control in the nav
          card or topRightControls too, so smaller (not gone) is enough to give the road back
          without losing the controls entirely. Full size on the plain home map, where nothing
          else competes for that space. */}
      {!anySheetOpen && !placingAlert && !pendingDestination && (
        <>
      {/* Hidden during navigation -- Report now lives in the bottom trip bar's "..." options
          menu (see NavOptionsSheet), so this would just be a second, redundant entry point to
          the same flow while also being the button that most needs the space back for the new
          bottom bar. Still the only way to report an alert while just browsing the map. */}
      {!route && (
        <Pressable
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 24 }, pressed && { opacity: pressedOpacity }]}
          onPress={openAlertTypePicker}
          accessibilityLabel="Report an alert"
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.fabSecondary,
          route && styles.fabSecondaryCompact,
          { bottom: fabSecondaryBottom(0), zIndex: 1 },
          pressed && { opacity: pressedOpacity },
        ]}
        onPress={() => {
          Sentry.logger.info("map: opening vehicle detection screen");
          setDetectionOpen(true);
        }}
        accessibilityLabel={
          detectionBatteryLow
            ? "Live vehicle detection -- battery below 50%, still works but may run slower"
            : "Live vehicle detection"
        }
      >
        <Ionicons name="videocam" size={route ? 15 : 20} color="#FFFFFF" />
        {/* Advisory only -- see detectionBatteryLow's own comment above. Never disables this
            Pressable, just flags it before the driver taps in. */}
        {detectionBatteryLow && (
          <View style={styles.fabBatteryBadge} pointerEvents="none">
            <Ionicons name="battery-dead-outline" size={11} color="#FFFFFF" />
          </View>
        )}
      </Pressable>

      {/* Real 3D buildings toggle -- Android mounts the custom Map3DView module (Google's
          separate, richer "Maps 3D SDK"); iOS instead tilts the existing stable map camera
          (see the effect above) rather than touching that same SDK's still-experimental,
          pre-GA iOS build. Always rendered now on both platforms -- this used to be Android-
          only (isMap3DSupported-gated) while iOS had no 3D buildings option at all. */}
      <Pressable
        style={({ pressed }) => [
          styles.fabSecondary,
          route && styles.fabSecondaryCompact,
          { bottom: fabSecondaryBottom(1), zIndex: 2 },
          show3D && styles.fabActive,
          pressed && { opacity: pressedOpacity },
        ]}
        onPress={() =>
          setShow3D((v) => {
            Sentry.logger.info("map: toggling 3D view", { next: !v });
            return !v;
          })
        }
        accessibilityLabel={show3D ? "Switch to standard map" : "Switch to 3D buildings view"}
      >
        <Ionicons name="business-outline" size={route ? 14 : 18} color="#FFFFFF" />
      </Pressable>

      {/* Permanent recenter button -- always in this stack, on top of the satellite and "+"
          buttons below it, regardless of whether navigation is active. Previously the only
          recenter control was the nav-only pill up top (only ever rendered once
          route && !followTilt is true), so there was no way back to your own location at all
          while just browsing the map before picking a destination. */}
      <Pressable
        style={({ pressed }) => [
          styles.fabSecondary,
          route && styles.fabSecondaryCompact,
          { bottom: fabSecondaryBottom(3), zIndex: 3 },
          pressed && { opacity: pressedOpacity },
        ]}
        onPress={onLocateButtonPress}
        accessibilityLabel="Recenter on my location, or switch camera height if already centered."
      >
        <Ionicons name="locate" size={route ? 14 : 18} color="#FFFFFF" />
      </Pressable>
        </>
      )}

      {/* Real satellite selection, available while placing an alert -- previously this button
          lived inside the FAB cluster above, entirely hidden the moment placingAlert became
          true (see that cluster's own comment), so there was no way to switch to satellite
          imagery to place a pin accurately against real ground features (a driveway, a specific
          building) per explicit request. Pulled out to its own conditional, still rendered here
          -- BEFORE mapArea's own closing </View> below -- so it stays inside the exact same
          coordinate frame as the AI Detection/3D/locate cluster above it.
          REAL, CONFIRMED ROOT CAUSE of this button drifting out of alignment with (and
          overlapping) the rest of the stack: this block used to sit AFTER mapArea's closing
          </View> instead of before it -- a sibling of mapArea and BannerAdBar inside the outer
          screen container, not a child of mapArea like every other FAB here. mapArea and
          BannerAdBar share one flex column (see BannerAdBar.tsx's own comment), so mapArea's
          own bottom edge sits ABOVE the ad bar, not at the true screen bottom -- every other FAB
          in this stack has its `bottom` offset measured from THAT edge. This button, rendered
          outside mapArea, had its own identical-looking `bottom` offset measured from the outer
          container's edge instead (BELOW the ad bar), a different, lower reference point --
          so the same numeric offset placed it a whole ad-bar-height off from where its siblings
          landed, close enough to the 3D/AI Detection buttons' own step spacing to visibly
          collide with them. Moving the JSX itself (not just the numbers) is what actually fixes
          it, since the two blocks were never in the same coordinate space to begin with. Still
          hidden behind an open bottom sheet or the destination/route pickers, same as before. */}
      {!anySheetOpen && !pendingDestination && (
        <Pressable
          style={({ pressed }) => [
            styles.fabSecondary,
            route && styles.fabSecondaryCompact,
            // zIndex 0 (lowest of the FAB cluster) -- this button is rendered after the AI
            // Detection/3D/locate cluster above, so without an explicit zIndex it would paint
            // over them during any transient frame where their bottom offsets briefly coincide.
            { bottom: fabSecondaryBottom(2), zIndex: 0 },
            mapType === "hybrid" && styles.fabActive,
            pressed && { opacity: pressedOpacity },
          ]}
          onPress={() => setMapType((v) => (v === "standard" ? "hybrid" : "standard"))}
          accessibilityLabel={mapType === "hybrid" ? "Switch to standard map" : "Switch to satellite map"}
        >
          <Ionicons name="map-outline" size={route ? 14 : 18} color="#FFFFFF" />
        </Pressable>
      )}
      </View>

      {/* Never shown while navigating -- a driving app shouldn't have anything competing for
          attention with the road/turn instructions, safety concern first and foremost. Also
          hidden while the route picker (RouteOptionsCard) is up: that card's own Start/Add-a-
          stop buttons sit at the very bottom of the screen too, and the banner (a real native
          view outside this flex layout's height calculation at mount time) was landing right on
          top of them, making Start unreachable. */}
      {/* DIAGNOSTIC: disabled -- see App.tsx's DIAGNOSTIC_DISABLE_APP_OPEN_AD. BannerAd's own
          native `load` command (Commands.load in GoogleMobileAdsBannerViewNativeComponent.ts)
          is *also* a void-returning TurboModule call, the same crash-signature match as
          appOpenLoad, and it fires unconditionally the moment this mounts (every launch, since
          !route is true until navigation starts) -- this was never actually excluded by the
          build 24 AppOpenAdManager-only test, so that test wasn't a clean isolation of ads as
          a whole. Disabling this too for a real one. */}
      {!route && !pendingDestination && (
        <AdsErrorBoundary>
          <BannerAdBar />
        </AdsErrorBoundary>
      )}

      {placingAlert && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>Move the map to place the pin</Text>
          {/* Optional "up to 7 words" comment, per explicit request -- clamped live to that
              word cap on every keystroke (onChangeAlertComment) so it's never possible to type
              past it, and re-checked for blocked language here (inline error, blocks Set) as
              well as again inside reportAlert itself before the write. Shown under the alert
              itself once posted -- see AlertMarker's own comment bubble and AlertDetailSheet. */}
          <TextInput
            value={alertComment}
            onChangeText={onChangeAlertComment}
            placeholder="Add a short comment (optional)"
            placeholderTextColor={colors.textFaint}
            editable={!submittingAlert}
            style={[styles.placementCommentInput, alertCommentBlocked && styles.placementCommentInputError]}
            maxLength={120}
          />
          <View style={styles.placementCommentFooter}>
            {alertCommentBlocked ? (
              <Text style={styles.placementCommentError}>That wording isn't allowed -- please rephrase.</Text>
            ) : (
              <View />
            )}
            <Text style={styles.placementCommentCount}>
              {alertComment.trim() ? alertComment.trim().split(/\s+/).length : 0}/{MAX_ALERT_COMMENT_WORDS} words
            </Text>
          </View>
          <View style={styles.placementBarButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.placementButton,
                styles.placementButtonRemove,
                pressed && { opacity: pressedOpacity },
              ]}
              onPress={cancelAlertPlacement}
              disabled={submittingAlert}
              accessibilityLabel="Cancel placing alert"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
            {/* "Set incidents from 2 views" -- only offered while reporting during active
                navigation, since that's the real scenario this exists for: spotting something
                just passed and wanting the clearer, driver's-eye front view to place it
                precisely, an option that doesn't apply when just browsing the map. */}
            {route && (
              <Pressable
                style={({ pressed }) => [
                  styles.placementButton,
                  styles.placementButtonRemove,
                  pressed && { opacity: pressedOpacity },
                ]}
                onPress={togglePlacementFrontView}
                disabled={submittingAlert}
                accessibilityLabel={placementFrontView ? "Switch to normal height view" : "Switch to front driving view"}
              >
                <Ionicons name={placementFrontView ? "eye-off-outline" : "eye-outline"} size={20} color={colors.text} />
              </Pressable>
            )}
            {/* One-tap "place it exactly where I am right now" -- per explicit request, beside
                Cancel/Set. Sets AND immediately confirms in the same tap using the driver's own
                live GPS fix, rather than requiring the fixed-center pin to already be panned
                there. The normal pan-anywhere flow (Set button) is untouched. */}
            <Pressable
              style={({ pressed }) => [
                styles.placementButton,
                styles.placementButtonRemove,
                pressed && !submittingAlert && !!currentLatLng && { opacity: pressedOpacity },
              ]}
              onPress={confirmAlertPlacementAtMyLocation}
              disabled={submittingAlert || !currentLatLng}
              accessibilityLabel="Set alert at my current location"
            >
              <Ionicons name="locate" size={20} color={colors.text} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.placementButton,
                styles.placementButtonSet,
                (submittingAlert || alertCommentBlocked) && styles.placementButtonSetDisabled,
                pressed && !submittingAlert && !alertCommentBlocked && { opacity: pressedOpacity },
              ]}
              onPress={() => confirmAlertPlacement()}
              disabled={submittingAlert || alertCommentBlocked}
              accessibilityLabel="Set alert location"
            >
              {submittingAlert ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                  <Text style={styles.placementButtonSetText}>Set</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {/* Modal's own `visible` prop only controls whether the native modal is *presented* --
          it does NOT unmount its children when set to false. Rendering VehicleDetectionScreen
          unconditionally here meant tapping Close just hid the modal while the camera session,
          the capture interval, and every state update it drives kept running invisibly in the
          background -- which is exactly why Close looked like it "didn't work" and is a strong
          candidate for the reported crashes (a hidden/backgrounded camera continuing to fire
          native capture calls, especially colliding with a facing switch). Gating the child on
          `detectionOpen` too means Close now genuinely unmounts it -- camera session torn down,
          interval cleared, no work left running once the modal is gone. */}
      <Modal
        visible={detectionOpen}
        animationType="slide"
        onRequestClose={() => setDetectionOpen(false)}
        // iOS-only, defaults to just ["portrait"] when omitted -- real, confirmed gotcha: without
        // this, the Modal itself would refuse to rotate no matter what VehicleDetectionScreen's
        // own expo-screen-orientation unlock does, since the Modal's own native presentation
        // controller is what ultimately decides what orientations it'll actually allow while
        // visible. Landscape add-on only -- every other screen's Modal usage is untouched.
        supportedOrientations={["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]}
      >
        {detectionOpen && (
          <VehicleDetectionErrorBoundary onClose={() => setDetectionOpen(false)}>
            <VehicleDetectionScreen onClose={() => setDetectionOpen(false)} isNavigating={!!route} />
          </VehicleDetectionErrorBoundary>
        )}
      </Modal>

      <AlertReportSheet
        ref={reportSheetRef}
        onTypeSelected={onAlertTypeSelected}
        onClose={() => reportSheetRef.current?.close()}
        onSheetChange={(index) => setReportSheetOpen(index >= 0)}
      />
      <AlertDetailSheet
        ref={detailSheetRef}
        alert={selectedAlert}
        currentUid={user?.uid ?? null}
        onDelete={onDeleteAlert}
        onHide={onHideAlert}
        onConfirmStillHere={onConfirmStillHere}
        onClose={() => detailSheetRef.current?.close()}
        onSheetChange={(index) => {
          setDetailSheetOpen(index >= 0);
          // Real "swipe away hides it" per explicit request -- this fires for BOTH the pan-
          // down-to-close gesture and the explicit X (onClose above just calls .close(), which
          // triggers this same callback), so either dismiss path clears the selection and, via
          // AlertMarker's own isSelected prop, hides that alert's comment caption back on the
          // map. Tapping the marker again re-selects it and the caption reappears.
          if (index < 0) setSelectedAlert(null);
        }}
      />
      <PlaceInfoSheet
        ref={placeInfoSheetRef}
        place={placeInfo}
        onClose={() => placeInfoSheetRef.current?.close()}
        onSheetChange={(index) => setPlaceInfoSheetOpen(index >= 0)}
      />
      <OsmMarkerSheet
        ref={osmMarkerSheetRef}
        kind={osmMarkerKind}
        location={osmMarkerLocation}
        onClose={() => osmMarkerSheetRef.current?.close()}
        onSheetChange={(index) => setOsmMarkerSheetOpen(index >= 0)}
      />
      <LiveCameraSheet
        ref={liveCameraSheetRef}
        camera={selectedLiveCamera}
        onClose={() => liveCameraSheetRef.current?.close()}
        onSheetChange={(index) => setLiveCameraSheetOpen(index >= 0)}
      />
      <RestaurantsSheet
        ref={restaurantsSheetRef}
        location={currentLatLng}
        onSelect={(place) => {
          restaurantsSheetRef.current?.close();
          onDestinationSelected(place);
        }}
        onSheetChange={(index) => setRestaurantsSheetOpen(index >= 0)}
      />
      <HotelsSheet
        ref={hotelsSheetRef}
        location={currentLatLng}
        onSelect={(place) => {
          hotelsSheetRef.current?.close();
          onDestinationSelected(place);
        }}
        onSheetChange={(index) => setHotelsSheetOpen(index >= 0)}
      />
      <RouteDirectionsSheet
        ref={directionsSheetRef}
        route={route}
        activeStepIndex={activeStepIndex}
        onClose={() => directionsSheetRef.current?.close()}
        onSheetChange={(index) => setDirectionsSheetOpen(index >= 0)}
      />
      <NavOptionsSheet
        ref={navOptionsSheetRef}
        onReportAlert={onNavOptionsReportAlert}
        onShareEta={onNavOptionsShareEta}
        onOpenDetection={onNavOptionsOpenDetection}
        onEndNavigation={onNavOptionsEndNavigation}
        onClose={() => navOptionsSheetRef.current?.close()}
        onSheetChange={(index) => setNavOptionsSheetOpen(index >= 0)}
        detectionBatteryLow={detectionBatteryLow}
      />

      {placeInfoLoading && (
        <View style={styles.placeInfoLoadingBadge} pointerEvents="none">
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      )}

      {/* Rendered last so it always paints on top of the search bar/nav card below it,
          instead of being silently covered by them when both occupy the same top area. */}
      <AlertBanner
        visible={bannerVisible}
        message={bannerMessage}
        onDismiss={() => setBannerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapArea: { flex: 1 },
  mapPlaceholder: { backgroundColor: colors.surfaceMuted },
  destinationPinWrap: {
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
  // Small, clear pointed pill for each route option's live ETA -- deliberately compact (not a
  // full card) so it reads at a glance without covering meaningful map area, per explicit
  // request. Unselected pills stay light/neutral so the selected one's red is what actually
  // draws the eye, matching the selected route line's own highlight color.
  routeEtaPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: "rgba(107, 114, 128, 0.55)",
    ...shadow.low,
  },
  routeEtaPillSelected: {
    backgroundColor: "#DC2626",
    borderColor: "#DC2626",
  },
  routeEtaPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.text,
  },
  routeEtaPillTextSelected: {
    color: "#FFFFFF",
  },
  // Wide, soft, translucent "flashlight" cone -- apex (the narrow point) sits at the puck's
  // exact coordinate (see the Marker's anchor: {y: 1} above) and fans out in whichever
  // direction deviceHeading currently points.
  compassConeGlyph: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 26,
    borderRightWidth: 26,
    borderTopWidth: 46,
    borderBottomWidth: 0,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(37, 99, 235, 0.3)",
  },
  placementPinOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    // Icon is 44x44; offset so the pin's point (bottom-center of the glyph) lands exactly on
    // the map's screen-center coordinate, not the icon's own center.
    marginLeft: -22,
    marginTop: -44,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.high,
  },
  placementBar: {
    // Column, not row -- previously this bar only ever held one line of text and a row of
    // buttons side by side (space-between). Now stacks: label text, the optional comment field,
    // its word-count/error footer, then the buttons row, each full-width.
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.high,
  },
  placementBarText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  placementCommentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  placementCommentInputError: {
    borderColor: colors.danger,
  },
  placementCommentFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  placementCommentError: {
    flex: 1,
    fontSize: 11,
    color: colors.danger,
    fontWeight: "600",
  },
  placementCommentCount: {
    fontSize: 11,
    color: colors.textFaint,
  },
  placementBarButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  placementButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    height: 40,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  placementButtonRemove: {
    width: 40,
    paddingHorizontal: 0,
    backgroundColor: colors.surfaceMuted,
  },
  placementButtonSet: {
    backgroundColor: colors.accent,
    minWidth: 64,
  },
  placementButtonSetDisabled: {
    backgroundColor: colors.textFaint,
  },
  placementButtonSetText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  frontViewButton: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.dark,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadow.medium,
  },
  frontViewButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },
  osmIconBadgeTrafficLight: {
    width: TRAFFIC_LIGHT_MARKER.badgeSize,
    height: TRAFFIC_LIGHT_MARKER.badgeSize,
    borderRadius: TRAFFIC_LIGHT_MARKER.badgeSize / 2,
    backgroundColor: TRAFFIC_LIGHT_MARKER.color,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  osmIconBadgeSpeedCamera: {
    width: SPEED_CAMERA_MARKER.badgeSize,
    height: SPEED_CAMERA_MARKER.badgeSize,
    borderRadius: SPEED_CAMERA_MARKER.badgeSize / 2,
    backgroundColor: SPEED_CAMERA_MARKER.color,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  // Deliberately a different color from both OSM markers above (blue, not purple/teal) -- this
  // is a real live NSW government camera feed, an entirely separate dataset from the mapped
  // OSM traffic-light/speed-camera layer, and shouldn't visually read as a third variant of it.
  osmIconBadgeLiveCamera: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  osmClusterBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: TRAFFIC_LIGHT_MARKER.color,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  osmClusterBadgeSpeedCamera: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 6,
    backgroundColor: SPEED_CAMERA_MARKER.color,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  osmClusterBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  topRightControls: {
    position: "absolute",
    // Hugs the true right edge (rather than floating inward) so this reads as a compact,
    // edge-anchored toolbar the way Apple/Google Maps' own side controls do, instead of a
    // column of buttons sitting out over the middle of the route/map.
    right: spacing.sm,
    gap: spacing.xs + 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  // Small and muted on purpose -- explicit request: not a big, bright button, just enough to
  // notice and tap when the camera has drifted from the driver's own position.
  recenterPill: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  osmLoadingBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  reroutingBadge: {
    position: "absolute",
    left: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.dark,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadow.medium,
  },
  trafficSuggestionBanner: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    // "Clear but transparent but not too transparent" per explicit request -- a translucent
    // dark glass tab rather than the fully opaque colors.surface it used to be, so the map
    // stays visible through it while the text stays readable.
    backgroundColor: "rgba(17, 24, 39, 0.82)",
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 2,
    gap: spacing.sm,
    ...shadow.high,
  },
  trafficSuggestionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  trafficSuggestionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  trafficSuggestionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  trafficSuggestionBody: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.75)",
    marginTop: 1,
  },
  trafficSuggestionClose: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  trafficSuggestionActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  trafficSuggestionActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  trafficSuggestionNoButton: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  trafficSuggestionNoText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  trafficSuggestionYesButton: {
    backgroundColor: colors.accent,
  },
  trafficSuggestionYesText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  endSuggestedRouteWrap: {
    position: "absolute",
    left: spacing.md,
    alignItems: "flex-start",
  },
  endSuggestedRouteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(17, 24, 39, 0.82)",
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    ...shadow.high,
  },
  endSuggestedRouteText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  reroutingBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  transitWaitBadge: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    ...shadow.medium,
  },
  transitWaitTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  transitWaitSubtitle: {
    color: "#FFFFFF",
    fontSize: 12,
    marginTop: 1,
    opacity: 0.9,
  },
  placeInfoLoadingBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "48%",
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  fab: {
    position: "absolute",
    right: spacing.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
  // Smaller footprint for the same button while actively navigating -- see the render call
  // site's own comment for why (every one of these already has a same-purpose control
  // elsewhere on screen during navigation, so shrinking is enough).
  fabCompact: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  fabSecondary: {
    position: "absolute",
    right: spacing.xl,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.dark,
    alignItems: "center",
    justifyContent: "center",
    // Subtle light ring, not a color change -- per explicit request, a refined look rather than
    // a brighter one. A flat dark circle with nothing but a drop shadow reads as a plain hole
    // cut in the map at a glance; a faint edge gives it real, deliberate definition against
    // both light and dark map themes without competing for attention the way a bright accent
    // color would.
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    ...shadow.medium,
  },
  fabSecondaryCompact: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  fabActive: {
    backgroundColor: colors.accent,
    borderColor: "rgba(255,255,255,0.35)",
  },
  // Small advisory badge on the AI Detection FAB when battery is under 50% -- see
  // detectionBatteryLow's own comment. Purely visual, the Pressable underneath stays fully
  // tappable either way.
  fabBatteryBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.warning,
    borderWidth: 1.5,
    borderColor: colors.dark,
    alignItems: "center",
    justifyContent: "center",
  },
});
