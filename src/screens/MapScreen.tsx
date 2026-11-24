import { useFeature } from "@/remote/useAppConfig";
import { remoteGated } from "@/remote/appConfig";
import { recordTripEnd } from "@/guest/savePrompt";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useLatest } from "@/hooks/useLatest";
import { compassAllowed, initialHeadingState, shortestDelta, stepCompass, stepHeading, type HeadingState } from "@/nav/headingFilter";
import { MapSurface } from "@/components/ui/Surface";
import { showLaneStrip } from "@/nav/lanes";
import {
  APPROACH_CAMERA,
  CHIP_MS,
  INITIAL_APPROACH,
  approachCenter,
  kindOfStep,
  manoeuvreHighlight,
  reduceApproach,
  type ApproachEvent,
  type ApproachState,
} from "@/nav/approach";
import { calloutLabel } from "@/nav/manoeuvre";
import { ManoeuvreChip, type ChipTone } from "@/components/nav/ManoeuvreChip";
import { JunctionViewCard } from "@/components/nav/JunctionViewCard";
import { mapboxReroute, mapboxRouteAround, mapboxRouteForChoice, mapboxRoutingAvailable } from "@/services/navRouting";
import { prepareNavigationAudio } from "@/services/audioSession";
import { calendarFor, tileKey as schoolTileKey, zonesAround } from "@/schoolZones/zoneStore";
import { INITIAL_SCHOOL_ZONE_TRACKER, trackSchoolZone, type SchoolZoneNow } from "@/schoolZones/schoolZoneTracker";
import { zoneStatus } from "@/schoolZones/zoneStatus";
import { parseMaxspeedConditional } from "@/schoolZones/openingHours";
import { deviceRegion, regionAt } from "@/schoolZones/regions";
import type { ZoneShape } from "@/schoolZones/zoneMatch";
import { communityZoneAt, type CommunityFeature } from "@/schoolZones/communityZones";
import { communityFeaturesAround } from "@/services/roadFeatureReports";
import { RoadReportSheet } from "@/components/RoadReportSheet";
import { speedZoomFor } from "@/map/speedZoom";
import { MODE_NAVIGATES_AS, MODE_ORDER, asModeId, ferryBadge, ferryModeAvailable, ferryOptions, routeHasFerry, type ModeId } from "@/travel/modes";
import * as Haptics from "expo-haptics";
import { ModeRouteCache, fastestSeconds, fetchRoutesForMode, type ModeRoutes } from "@/travel/modeRouting";
import type { SchoolCalendar } from "@/schoolZones/calendar";
import { resolveSpeedLimit, routeLimitAt, signStyleFor, signUnitFor, signValue } from "@/speedLimits/resolveLimit";
import { buildRouteGeometry, createMatchState, deadReckon, matchFix, routeBearingAt, type MatchResult } from "@/nav/routeMatcher";
import { approachTick } from "@/nav/navPipeline";
import { INITIAL_REROUTE_TRIGGER, rerouteTrigger } from "@/nav/rerouteTrigger";
import { useAudioPlayer } from "expo-audio";
import { env } from "@/config/env";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Chip, FloatingButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  View,
  StyleSheet,
  Pressable,
  Share,
  ActivityIndicator,
  Keyboard,
  AppState,
  ActionSheetIOS,
  useWindowDimensions,
  Linking,
  Alert,
} from "react-native";
import { Text, TextInput } from "@/components/AppText";
import { MapErrorBanner, TrackLineMap, type MapHandle } from "@/map-v2/TrackLineMap";
import { CameraController, shouldAutoRecentre, type CameraMode } from "@/map-v2/cameraController";
import { AlertCard } from "@/components/AlertCard";
import { MapSpotlight } from "@/components/MapSpotlight";
import { cardForOfficial, cardForReport, distanceLine, roadAndSuburb, spotlightCentre, type AlertCardModel } from "@/map/alertCard";
import { MapboxLayers } from "@/map-v2/MapboxLayers";
import { isMapboxUsable, mapboxUnavailableReason } from "@/map-v2/mapbox";
import { usableMapboxToken } from "@/config/mapboxToken";
import { isConnectionFailure, routeErrorText } from "@/services/routingErrors";
import type { CameraLike, Region } from "@/map-v2/geo";
import type { MapPin } from "@/map-v2/pins";
import { startSimulatedDrive, stopSimulatedDrive } from "@/dev/simulateDrive";
import { onTestDriveRequested, testDrive } from "@/dev/testDrives";
import { isGpsReplayActive, subscribeGpsReplayActiveChange } from "@/dev/gpsReplay";
import { incidentStyle } from "@/services/trafficNswModel";
import * as Location from "expo-location";
import { usePowerState } from "expo-battery";
import { loadBoxedTFLiteModel } from "@/services/tfliteVehicleModel";
import BottomSheet from "@gorhom/bottom-sheet";
import { useNavigation, useIsFocused, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing, pressedOpacity, scaleFor } from "@/theme/tokens";
import { clusterPoints } from "@/utils/markerCluster";

import { useLocation } from "@/context/LocationContext";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { DestinationSearchBar, MY_LOCATION_PLACE_ID } from "@/components/DestinationSearchBar";
import { NavigationInstructionCard } from "@/components/NavigationInstructionCard";
import { NavBottomBar } from "@/components/NavBottomBar";
import { NavOptionsSheet } from "@/screens/NavOptionsSheet";
import { NavMapControls } from "@/components/NavMapControls";
import { ArrivedCard } from "@/components/ArrivedCard";
import { addSearchHistoryEntry } from "@/services/searchHistory";
import { MapToolsSheet } from "@/screens/MapToolsSheet";
import { SoundSheet } from "@/screens/SoundSheet";
import { VisibilitySheet } from "@/screens/VisibilitySheet";
import { GhostModeExplainerModal, hasSeenGhostModeExplainer, markGhostModeExplainerSeen } from "@/components/GhostModeExplainerModal";
import { useAutoGhostMode, autoGhostOnArrival } from "@/hooks/useAutoGhostMode";
import { RouteDirectionsSheet } from "@/screens/RouteDirectionsSheet";
import {
  AvoidSheet,
  RouteSelectionSheet,
  RouteSelectionTopCard,
  TravelModeSheet,
  transitRouteTitle,
  type ModeSummary,
  type RouteChoiceRow,
} from "@/components/RouteSelection";
import { AlertStillHereCard } from "@/components/AlertStillHereCard";
import { ExitLaneGuidance } from "@/components/ExitLaneGuidance";
import { AlertBanner } from "@/components/AlertBanner";
import { NearbyAlertToast, type NearbyAlertNotification } from "@/components/NearbyAlertToast";
import { BannerAdBar, BANNER_HEIGHT, shouldShowBanner } from "@/components/BannerAdBar";
import { AdsErrorBoundary } from "@/components/AdsErrorBoundary";
import { AlertReportSheet, itemLabel } from "@/screens/AlertReportSheet";
import { AlertDetailSheet } from "@/screens/AlertDetailSheet";
import { PlaceInfoSheet } from "@/screens/PlaceInfoSheet";
import { OsmMarkerSheet, type OsmMarkerKind } from "@/screens/OsmMarkerSheet";
import { LiveCameraSheet } from "@/screens/LiveCameraSheet";
import { RestaurantsSheet } from "@/screens/RestaurantsSheet";
import { HotelsSheet } from "@/screens/HotelsSheet";
import { FuelStationsSheet, type FuelStationPin } from "@/screens/FuelStationsSheet";
import { ParkingSheet } from "@/screens/ParkingSheet";
import { NearbyPlacesSheet, type NearbyPin } from "@/components/places/NearbyPlacesSheet";
import { WhereToSheet, whereToSnapFractions, type WhereToSheetRef } from "@/screens/WhereToSheet";
import { PlacePage, PLACE_PAGE_SHEET_FRACTION } from "@/screens/PlacePage";
import { threeSnapHeights } from "@/components/ThreeSnapBottomSheet";
import { useLiveSpeed } from "@/hooks/useLiveSpeed";
import { LiveSpeedometer } from "@/components/LiveSpeedometer";
import { showLimitSign, thresholdKmhFor } from "@/settings/speedometer";
import { itemOfAlert, alertsWhileDriving, isShown, osmFetchWanted, routeItemFor, type ReportItemId } from "@/settings/reportCatalog";
import { osmFeaturePins, reportPinIcon, visibleCommunityAlerts, visibleIncidents } from "@/map/reportPins";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { recordArrival } from "@/services/poiPopularity";
import { popularityKey } from "@/map/poiRanking";
import { crashHistorySpots, laneEndingFeatures, trackySlowdownAhead } from "@/alerts/derivedFeatures";
import { fetchCrashRecordsNear, type CrashRecord } from "@/services/crashRecords";
import { nextApproachAlert, type ApproachMemory } from "@/alerts/approachAlerts";
import { INITIAL_LIMIT_CHANGE, stepLimitChange, type LimitChangeState } from "@/alerts/speedLimitChange";
import { ReportItemIcon } from "@/components/settings/ReportItemIcon";
import { useTrackyAppearance } from "@/hooks/useTrackyAppearance";
import { PresenceCard } from "@/screens/PresenceCard";
import {
  subscribeViewportPresence,
  viewportPresenceCells,
  callUpdatePresence,
  callClearPresence,
  callSendWave,
  getBlockedUids,
  type PresenceDoc,
} from "@/services/presence";
import type { SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { fetchLiveTrafficCameras, type LiveTrafficCamera } from "@/services/liveTrafficCameras";
import {
  getDirections,
  getRouteChoices,
  getRouteThrough,
  getDirectionsForMode,
  getModeRouteOptions,
  getHeadingAwareReroute,
  detailedRoutePolyline,
  TRAVEL_MODE_LABELS,
  waypointList,
  type Route,
  type TravelMode,
  type Waypoints,
} from "@/services/directions";
import {
  avoidPillLabel,
  avoidCount,
  avoidRouteOptions,
  screenBubbleAnchors,
  distinctRoutes,
  formatRouteDuration,
  routeHasUturn,
  routeSeconds,
  routeSummaryLine,
  routeTags,
  trafficLevel,
  routeSummaryParts,
  type RouteSummaryParts,
  trafficStretches,
  viaRoadLabel,
  withoutUturns,
  type RouteAvoidKey,
  type RouteAvoidPrefs,
} from "@/map/routeChoices";
import {
  findNearestTransitStation,
  getPlaceInfo,
  searchPlaces,
  getStreetViewUrl,
  getStreetViewEmbedUrl,
  reverseGeocode,
  haversineMeters,
  type PlaceDetails,
  type PlaceInfo,
  type NearbyPlace,
} from "@/services/places";
import { isOsmPlaceId, getOsmPlaceInfo, fetchOsmPlacesInBounds, searchNearbyOsmPlaces } from "@/services/osmPlaces";
import {
  distanceKm,
  encodeGeohash,
  bearingDegrees,
  offsetLatLngByHeading,
  distanceToPolylineMeters,
} from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";
import { createGuidanceState, evaluateGuidance, remainingStepMeters } from "@/services/navigationGuidance";
import { buildDriveLink, parseDriveLink } from "@/services/driveLink";
import Reanimated, { useSharedValue } from "react-native-reanimated";
import { AheadBanner } from "@/components/AheadBanner";
import { AheadBannerController } from "@/nav/ahead/bannerController";
import { aheadOf, projectFeed, trafficSources, type AheadAlert } from "@/nav/ahead/aheadFeed";
import { aheadSourcesFrom } from "@/nav/ahead/aheadSources";
import { aheadClipKey, roadAtAlong } from "@/nav/ahead/aheadText";
import type { AheadRow, ParkingSection } from "@/screens/NavOptionsSheet";
import { spokenLine } from "@/nav/ahead/aheadKinds";
import { MAP_ICONS_AHEAD_M, MAX_MAP_ICONS, warnDistanceM } from "@/nav/ahead/aheadTiming";
import { useEffectiveMapTheme, useMapScheme } from "@/components/ui/uiScheme";
import { routeColoursFor } from "@/map-v2/styles/mapAppearance";
import { noteNightPosition } from "@/map/nightClock";
import { CompassFilter, HeadingTurret, targetHeading } from "@/nav/headingTurret";
import { loadLastLocation, saveLastLocation } from "@/map/lastLocation";
import { viaText } from "@/map/viaText";
import { VehiclePickerScreen } from "@/components/VehiclePicker";
import { type VehicleType, shouldShowVehiclePicker, vehicleForMode, vehicleMode, vehicleOption, vehiclePatch, vehicleRouteNote } from "@/services/vehicle";
import { overlaysFor } from "@/map/previewOverlays";
import { fetchTrackysAround, HEARTBEAT_MS, noteActive, shouldGreet, trackysPillText } from "@/services/trackysAround";
import { done, enqueue, PILL_SHOW_MS, reportsPillText, type PillMessage } from "@/map/homePill";
import { HomeInfoPill } from "@/components/HomeInfoPill";
import { HomeMapControls } from "@/components/HomeMapControls";
import {
  HOME_FOLLOW_ZOOM,
  RoadLookupTracker,
  alertPinSize,
  countReportsAround,
  homeMapPadding,
  homeArrowTargetY,
  roadFromRouteSteps,
  zoomFromLatitudeDelta,
  STATIONARY_AFTER_MS,
} from "@/map/homeMapLogic";
import { openMusicApp } from "@/services/musicApp";
import { subscribeNswTraffic } from "@/services/trafficNsw";
import { incidentsNear, type NearbyIncident, type TrafficIncident } from "@/services/trafficNswModel";
import { departureSlots, eventsAlongRoute, predictLeaveTimes, type RoutePoint } from "@/travel/etaSheet";
import { rememberRoutes, savedAgo, savedRoutesFor } from "@/nav/routeCache";
import { downloadRouteArea } from "@/map-v2/offlineArea";
import { bubbleSize, previewEdgePadding, previewFitCoordinates } from "@/nav/previewCamera";
import { routeAheadOf } from "@/map-v2/geo";
import { NAV_START_MS, navCameraBearing, navFollowPadding, navFollowPose, navStartBearing, showManoeuvreCallout } from "@/nav/navCamera";
import { AHEAD_BANNER_HEIGHT, REPORT_SIZE, SIDE_MARGIN, SPEEDOMETER_SIZE, aheadRoom as aheadRoomFor, controlsBottom, navControlFrames } from "@/nav/navControlsLayout";
import { chipRemainingM, featureChipText, shouldSpeakFeature } from "@/nav/roadFeatureAlerts";
import { ARRIVAL_CARD_MS, HOME_RESET_MS, homeCameraAfterDrive, type ArrivalInfo, type EndReason } from "@/nav/endDrive";
import { parseNavVoiceCommand } from "@/nav/voiceCommand";
import { parseVoiceReport, type VoiceReport } from "@/nav/voiceReport";
import { startWakeListener, type WakeIntent } from "@/services/wakePhrase";
import { RECOGNITION_LOCALES } from "@/services/voiceSearch";
import { startVoiceSearch, VOICE_SEARCH_MESSAGES, type VoiceSearchSession } from "@/services/voiceSearch";
import { pickShortcut, shortcutText, slowTrafficAhead, throughPointsAhead, withSideStreets, type ShortcutKind } from "@/nav/shortcuts";
import { ReportIcon } from "@/components/icons/MapControlIcons";
import { SearchAlongRouteSheet } from "@/components/SearchAlongRouteSheet";
import { altDeltaLabel, pickAlternatives } from "@/nav/navAlternatives";
import { presencesToShow } from "@/map/presenceFilter";
import { rememberOwnUid } from "@/services/ownUids";
import { TrafficIncidentCard } from "@/screens/TrafficIncidentCard";
import { homeRoadSigns, roadFeatureReportIcon, signIcon, signKind, type SignPoint } from "@/map/roadSignVisibility";
import { speakPlan, speakNavPhrase, stopNavSpeech, prefetchUpcomingSpeech, isNavSpeaking } from "@/services/navSpeech";
import {
  earlyAnnouncementThresholds,
  planStepAnnouncement,
  shouldSpeakStep,
  type NavPhrase,
} from "@/services/navSpeechPlan";
import { formatArrivalClock, formatDurationText, formatDistance } from "@/utils/navFormat";
import {
  subscribeVisibleAlerts,
  submitReport,
  undoReport,
  ReportRefused,
  type ReportResult,
  deleteAlert,
  hideAlertForUser,
  confirmAlert,
  denyAlert,
  getInboxLastViewedAt,
  hasThankedAlert,
  thankAlert,
} from "@/services/alerts";
import { classifyAuRegion } from "@/utils/auStates";
import { sirenDetection } from "@/services/sirenDetection";
import { SIREN_SPOKEN } from "@/nav/ahead/sirenAhead";
import { shouldListen } from "@/services/sirenTracker";
import {
  PASSING_TTL_MS,
  PositionTrail,
  RADAR_SPOKEN,
  isDriving,
  noteMoving,
  questionExpired,
  quickPin,
  shouldAsk,
  showRadarBanner,
  sirenReport,
  titleProblem,
  vehicleFromType,
  yesNo,
  type PendingQuestion,
  type RadarBanner,
  type SirenDraft,
} from "@/nav/sirenRadar";
import { EmergencyVehicleBanner } from "@/components/EmergencyVehicleBanner";
import { LiveRoadView } from "@/components/LiveRoadView";
import { TripRecorder, saveTrip } from "@/trips/tripLog";
import { LiveCameraSlot } from "@/components/LiveCameraSlot";
import { liveViewHeight, liveViewShown, routeAhead, sceneFromTracks, type CameraTrack, type LiveStatus, type SceneVehicle } from "@/nav/liveScene";
import { SirenQuestionCard } from "@/components/SirenQuestionCard";
import { SirenReportPicker, type QuickPinSpot } from "@/components/SirenReportPicker";
import { containsBlockedLanguage, clampToWordLimit, MAX_ALERT_COMMENT_WORDS } from "@/utils/commentFilter";
import { fetchOsmTrafficData, fetchSpeedLimitNear, type OsmFeatureKind, type OsmTrafficData } from "@/services/osmTrafficData";
import { createLiveShare, updateLiveShare, endLiveShare } from "@/services/liveShare";
import { setNavigationActive } from "@/services/navState";
import { startLiveActivity, updateLiveActivity, endLiveActivity, maneuverToSfSymbol } from "live-activity";
import { endNavNotification, startNavNotification, updateNavNotification } from "@/services/navNotification";
import { recordDriveToday } from "@/services/trackyMood";
import { ALERT_LABELS, type AlertDoc, type AlertType } from "@/types/alert";
import { UNDO_MS } from "@/types/alertPolicy";
import { stillThereCandidate } from "@/alerts/stillThere";
import { ReportUndoBar } from "@/components/ReportUndoBar";
import { TripDetailsSheet } from "@/components/TripDetailsSheet";
import { fetchTransitRealtime } from "@/services/transitRealtime";
import { rideStatus } from "@/travel/rideProgress";
import type { Realtime } from "@/travel/transitTimeline";
import { baseTypeOf, needsComment } from "@/settings/reportGrid";
import { TrackyBubble } from "@/components/TrackyBubble";
import { SavedPlacePopup, type SavedPinPlace } from "@/components/SavedPlacePopup";
import { savedPinIcon, savedPinPlaces } from "@/map/savedPins";
import { getSavedPlaces, pushSavedPlacesToProfile, removeCustomPlace, removeHomeOrWork, addCustomPlace, subscribeSavedPlaces, type SavedPlaces } from "@/services/savedPlaces";
import { clearParkingSpot, getParkingSpot, setParkingSpot, subscribeParkingSpot, type ParkingSpot } from "@/services/parkingSpot";
import { onDriveEnd, onFixAfterDrive, type ParkingWatch } from "@/nav/autoParking";
import { projectOnPolyline } from "@/alerts/approachAlerts";
import { closedStretch, closureForReport, shouldRouteAround, DEFAULT_CLOSURE, type ClosureDetails } from "@/nav/closures";
import { ClosureDetailsPicker } from "@/components/ClosureDetailsPicker";
import { layoutPins, midPinIcon } from "@/map/zoomStates";
import { addStop, markStop, moveStop, nextStopEvent, removeStop, stopPoints, stopRows, MAX_STOPS, type TripStop } from "@/nav/multiStop";
import { rankParking, shouldOfferParking, walkLeft, PARKING_NEAR_M, type ParkingOffer } from "@/nav/arrivalFlow";
import { withTimeout } from "@/utils/withTimeout";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { Sentry } from "@/services/sentry";
/** The route preview's start field while it follows the live GPS (Waze-match §1). */
const YOUR_LOCATION_LABEL = "Your location";

const DIAGNOSTIC_DISABLE_MAPVIEW = false;

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
/** Ahead alerts: live traffic on your road re-read this often while driving. */
const AHEAD_TRAFFIC_REFRESH_MS = 30_000;
/** The camera eases to a tapped pin, and back, over this long. */
const ALERT_CARD_CAMERA_MS = 600;
// Permanent fix §6: the map is never tilted past 45° -- the home map, 3D on, and placing a report.
const DEFAULT_IDLE_PITCH = 45;
const HOME_3D_PITCH = 45;
const PLACEMENT_PITCH = 45;
/** The alert card that's up: a community report or an official Live Traffic NSW incident. */
type OpenAlertCard = { model: AlertCardModel; alert: AlertDoc | null; incident: NearbyIncident | null };
const TRAFFIC_SUGGESTION_COOLDOWN_MS = 8 * 60_000;
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

// At most this many route lines on the route-selection map (transit can offer many more
// itineraries in the list; the selected one is always drawn).
const MAX_DRAWN_ROUTES = 3;

// Index-based (not distance-based) point along a polyline -- good enough for placing a small
// floating label roughly along a route's own path without needing real cumulative-distance
// walking the way pointAheadOnPolylineMeters (used for live driving position) does.
function pointAtPolylineFraction(polyline: LatLng[], fraction: number): LatLng | null {
  if (polyline.length === 0) return null;
  const idx = Math.min(polyline.length - 1, Math.max(0, Math.floor(polyline.length * fraction)));
  return polyline[idx];
}

// What tapping a pin on the Mapbox map does (see onMapboxPinPress).
type PinTarget =
  | { kind: "zoomTo"; lat: number; lng: number }
  | { kind: "alert"; alert: AlertDoc }
  | { kind: "osm"; osm: OsmMarkerKind; at: LatLng }
  | { kind: "trafficLightCluster"; lat: number; lng: number }
  | { kind: "speedCameraCluster"; lat: number; lng: number }
  | { kind: "venue"; placeId: string }
  | { kind: "fuelPin"; pin: FuelStationPin }
  | { kind: "incident"; incident: NearbyIncident }
  | { kind: "liveCamera"; camera: LiveTrafficCamera }
  | { kind: "origin" }
  | { kind: "saved"; place: SavedPinPlace };

export function MapScreen() {
  const { location, permissionGranted, permissionDenied, canAskAgain, requestPermission: requestLocationPermission } = useLocation();
  const { user } = useAuth();
  const { settings: rawSettings, loaded: settingsLoaded, updateSettings, voiceEnabled, voiceVolume, voiceIdentifier, navLanguage } =
    useSettings();
  // Owner dashboard > App control can switch a feature off for everyone (or a % / country).
  const trackysOn = useFeature("trackys");
  const schoolZonesOn = useFeature("schoolZones");
  const liveTrafficOn = useFeature("liveTraffic");
  const laneGuidanceOn = useFeature("laneGuidance");
  const brandBadgesOn = useFeature("brandBadges");
  const travelModesOn = useFeature("travelModes");
  const settings = useMemo(
    () => remoteGated(rawSettings, { trackys: trackysOn, schoolZones: schoolZonesOn, liveTraffic: liveTrafficOn }),
    [rawSettings, trackysOn, schoolZonesOn, liveTrafficOn]
  );
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const navRoute = useRoute<RouteProp<RootStackParamList, "Map">>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Shared with the home map's floating buttons, which run on the UI thread:
  //   mapBearing         -- the map's current bearing, for the compass needle
  //   sheetVisibleHeight -- how much of the "Where to?" sheet is showing, written by the sheet
  const mapBearing = useSharedValue(0);
  // Which snap point the "Where to?" sheet is at: 0 peek, 1 half, 2 full.
  const [whereToSheetIndex, setWhereToSheetIndex] = useState<0 | 1 | 2>(0);

  // The map's camera handle. Both maps offer the same calls (see map-v2/TrackLineMap.tsx).
  const mapRef = useRef<MapHandle>(null);
  // Whether this build can draw the map at all (Mapbox native SDK linked + token set).
  const [mapboxUsable] = useState(() => isMapboxUsable());
  // Development builds: "Simulate drive" plays the active route as GPS (dev/simulateDrive.ts).
  const [simulatingDrive, setSimulatingDrive] = useState(() => __DEV__ && isGpsReplayActive());
  useEffect(() => (__DEV__ ? subscribeGpsReplayActiveChange(setSimulatingDrive) : undefined), []);
  // The map's own real, currently-rendered center -- ground truth from onRegionChangeComplete's
  // own `region` (gesture or programmatic alike), not inferred from JS state.
  const lastRegionCenterRef = useRef<LatLng | null>(null);
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
  const restaurantsSheetRef = useRef<SimpleBottomSheetRef>(null);
  const hotelsSheetRef = useRef<SimpleBottomSheetRef>(null);
  const fuelStationsSheetRef = useRef<SimpleBottomSheetRef>(null);
  const parkingSheetRef = useRef<SimpleBottomSheetRef>(null);
  // The OpenStreetMap parking list with its free / covered / accessible / EV filters, opened
  // from the Google parking list's "More filters".
  const parkingFiltersSheetRef = useRef<SimpleBottomSheetRef>(null);
  const whereToSheetRef = useRef<WhereToSheetRef>(null);
  const directionsSheetRef = useRef<BottomSheet>(null);
  const navOptionsSheetRef = useRef<BottomSheet>(null);
  const toolsSheetRef = useRef<BottomSheet>(null);
  const soundSheetRef = useRef<BottomSheet>(null);
  const visibilitySheetRef = useRef<BottomSheet>(null);

  const [route, setRoute] = useState<Route | null>(null);
  const [acceptedSuggestionOriginalRoute, setAcceptedSuggestionOriginalRoute] = useState<Route | null>(null);
  const routeRef = useRef<Route | null>(null);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  // Real, explicit request: the headline ETA/arrival-time must keep syncing with LIVE traffic
  // for as long as a trip is active, not just reflect whatever Google returned once at route
  // selection -- see the live-ETA refresh effect below for what actually keeps this current.
  // null until the first live read lands for the CURRENT route; the duration this holds is
  // always a genuine Google Directions traffic-aware figure for the driver's real current
  // position, never estimated/interpolated locally.
  const [liveEtaSeconds, setLiveEtaSeconds] = useState<number | null>(null);

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
  const voiceVolumeRef = useLatest(voiceVolume);
  // Same ref pattern as voiceVolumeRef immediately above, for the same reason -- picking a
  // different navigation voice in Settings must not make the guidance-advancement effect
  // re-run (and re-touch guidanceRef's shared state) just because this changed.
  const voiceIdentifierRef = useLatest(voiceIdentifier);
  // The sound settings the non-turn call-outs need (setting off, re-routing, arriving, a report
  // nearby). Those are fired from callbacks that are deliberately kept referentially stable, so
  // they read the live values from here rather than closing over them.
  const navVoiceRef = useRef({ enabled: voiceEnabled, mode: settings.spokenDirections, language: navLanguage });
  useEffect(() => {
    navVoiceRef.current = { enabled: voiceEnabled, mode: settings.spokenDirections, language: navLanguage };
  });
  const announcePhrase = useCallback((phrase: NavPhrase) => {
    speakNavPhrase(phrase, {
      voiceIdentifier: voiceIdentifierRef.current,
      volume: voiceVolumeRef.current,
      enabled: navVoiceRef.current.enabled,
      mode: navVoiceRef.current.mode,
      language: navVoiceRef.current.language,
    }).catch(() => {});
  }, [voiceIdentifierRef, voiceVolumeRef]);
  // True only while a fresh route is actively being fetched after drifting off the current one
  // -- drives the small "Rerouting..." banner below.
  const [rerouting, setRerouting] = useState(false);
  // Real, explicit request -- "Show 'Faster route found — saves X min'" when a reroute's own
  // alternates search turns up a genuinely quicker real option (see the off-route effect below).
  // Null means no banner; cleared the moment a new reroute starts so a stale message from a
  // previous reroute never lingers through the next one.
  const [fasterRouteBanner, setFasterRouteBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!fasterRouteBanner) return;
    const timer = setTimeout(() => setFasterRouteBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [fasterRouteBanner]);
  // Exact arrival coordinate for the highlighted destination marker below -- kept separate
  // from route.polyline's last point so it's the real picked place, not whatever pixel the
  // polyline decoder happened to end on.
  const [destinationLatLng, setDestinationLatLng] = useState<LatLng | null>(null);
  // "hybrid" = satellite imagery + road/place labels, not bare "satellite" -- an unlabeled
  // satellite view is close to unusable while actually navigating, and this is what most map
  // apps' own "Satellite" button actually switches to.
  const [mapType, setMapType] = useState<"standard" | "hybrid">("standard");
  // Real, explicit request -- applies the driver's saved default map view (Settings ->
  // defaultMapViewStyle) the instant settings finish loading, before the very first render a
  // user could see, so there's no flash of the wrong style. Guarded to fire exactly once --
  // after that, the existing satellite FAB (setMapType) is the live, manual override, same as
  // every other "saved default, live toggle still works" setting in this app. "tilted3d" needs
  // no correction at all here (mapType's own useState default above is already "standard").
  // Follows Settings > Map view > Satellite both ways, every time it changes -- that switch
  // is where the satellite toggle lives now that the Map tools panel is gone from the home
  // map. (Adjusted while rendering when the setting changes; the satellite button still
  // toggles it in between.)
  const appliedMapViewStyle = settingsLoaded ? settings.defaultMapViewStyle : null;
  const [seenMapViewStyle, setSeenMapViewStyle] = useState<string | null>(null);
  if (appliedMapViewStyle !== null && appliedMapViewStyle !== seenMapViewStyle) {
    setSeenMapViewStyle(appliedMapViewStyle);
    setMapType(appliedMapViewStyle === "satellite3d" ? "hybrid" : "standard");
  }

  // Route-choice flow: destination picked -> fetch all 3 profiles -> user picks one (with a
  // live preview of that profile's line on the map) -> Start commits it into `route` above.
  const [pendingDestination, setPendingDestination] = useState<PlaceDetails | null>(null);
  // The place being driven to (kept after Start clears pendingDestination), for Share arrivals.
  const lastDestinationPlaceRef = useRef<PlaceDetails | null>(null);
  useEffect(() => {
    if (pendingDestination) lastDestinationPlaceRef.current = pendingDestination;
  }, [pendingDestination]);
  // The same place as state, for the ETA sheet's "To" line (a ref can't be read while drawing).
  const [navDestinationPlace, setNavDestinationPlace] = useState<PlaceDetails | null>(null);
  if (pendingDestination && pendingDestination !== navDestinationPlace) setNavDestinationPlace(pendingDestination);
  const navDestinationPlaceRef = useLatest(navDestinationPlace);
  const shareArrivalsRef = useLatest(settings.shareArrivals);
  // The place page (UI pass 2, section 4): a search result being looked at before any route is
  // fetched. The map is centred on it in the top 40%, under the page's own sheet.
  const [placePage, setPlacePage] = useState<PlaceDetails | null>(null);
  // Where the parking list is centred: the place page's "See more parking" opens it around the
  // place rather than around the driver. Null = around the driver, as before.
  const [parkingCenter, setParkingCenter] = useState<LatLng | null>(null);
  // Real, explicit request: candidate route(s) must stand out clearly from the surrounding
  // street network while picking one, not blend into it -- dims every other road (see
  // getMapStyle's own ROUTE_PICKING_DIM_STYLERS) for exactly the window a destination is picked
  // but Start hasn't been pressed yet. Never dims during active navigation/the pre-destination
  // idle map -- both have a real reason to show the full, undimmed road network (reading cross
  // streets while driving; general map browsing before picking anywhere).
  const isPickingRoute = !!pendingDestination && !route;
  // Color theme + road-thickness preset are independent Settings picks (see mapStyle.ts) --
  // memoized so a re-render that doesn't touch either (or the route-picking dim state) doesn't
  // rebuild this array (and every styler object inside it) from scratch on every frame.
  // Real, confirmed request -- show a driver what the live traffic layer's own colors actually
  // mean, but only briefly and only the moment it actually turns on (route picking/following
  // starts), not a permanent fixture competing with the map for attention.
  // Settings > Map shortcuts > Traffic flow: on the home map too, not just once a route is picked.
  const showsTrafficLayer = settings.showTrafficFlow;
  // The trip's stops, in order (nav/multiStop.ts). Every route request goes through the ones
  // not reached yet (stopWaypoints), so a reroute never drops a stop or sends you back to one.
  const [stops, setStops] = useState<TripStop[]>([]);
  const stopWaypoints = useMemo(() => {
    const pts = stopPoints(stops);
    return pts.length ? pts : null;
  }, [stops]);
  const stopWaypointsLiveRef = useLatest(stopWaypoints);
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
  // Real, explicit request: "choose starting point" now defaults to a real draggable/zoomable
  // pin-drop picker (same proven fixed-center-pin + pan-the-map-underneath pattern already used
  // for manual alert placement below -- see its own comment for why a real draggable Marker is
  // unreliable on iOS) instead of only ever being a text search box. "search" is the fallback
  // reached via the pin view's own (X) button, per explicit request.
  const [originPickerView, setOriginPickerView] = useState<"pin" | "search">("pin");
  const [originPinLatLng, setOriginPinLatLng] = useState<LatLng | null>(null);
  const [originPinAddress, setOriginPinAddress] = useState<string | null>(null);
  const [originPinAddressLoading, setOriginPinAddressLoading] = useState(false);
  // The auto-advance step after a start point is confirmed with no destination picked yet --
  // same pin-drop-first/search-fallback pattern as origin above, just for the destination side.
  // Real, explicit request: setting a start point should move straight on to picking where to,
  // not leave the driver back at a bare map wondering what to do next.
  const [pickingDestinationPoint, setPickingDestinationPoint] = useState(false);
  const [destinationPickerView, setDestinationPickerView] = useState<"pin" | "search">("pin");
  const [destinationPinLatLng, setDestinationPinLatLng] = useState<LatLng | null>(null);
  const [destinationPinAddress, setDestinationPinAddress] = useState<string | null>(null);
  const [destinationPinAddressLoading, setDestinationPinAddressLoading] = useState(false);
  // Driving: up to three genuinely different routes, best first (see map/routeChoices.ts's
  // distinctRoutes). Every other travel mode uses modeRoute/modeRouteOptions below.
  const [routeChoices, setRouteChoices] = useState<Route[] | null>(null);
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState(0);
  // "Every route here has a U-turn" -- set when the U-turns avoid option couldn't be honoured.
  const [routeAvoidNote, setRouteAvoidNote] = useState<string | null>(null);
  // No internet: the routes shown are a saved set for this trip (see nav/routeCache.ts).
  const [routeOfflineNote, setRouteOfflineNote] = useState<string | null>(null);
  const [avoidSheetOpen, setAvoidSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  // Measured edges of the route-selection top card and bottom sheet, so the routes are fitted
  // into the map between them. Seeded with typical sizes until the first layout.
  const [routeTopCardBottom, setRouteTopCardBottom] = useState(insets.top + 180);
  const [routeSheetHeight, setRouteSheetHeight] = useState(insets.bottom + 220);
  // Go now's ten-second fill. Starts once per destination when its driving routes arrive; any
  // touch on the screen stops it for good (see the container's onTouchStart).
  const [autoGoRunning, setAutoGoRunning] = useState(false);
  // With Reduce Motion on there's no Go now fill and no countdown: the driver taps Go now.
  const reduceMotion = useReduceMotion();
  const autoGoArmedRef = useRef(false);
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

  const [nearbyAlerts, setNearbyAlerts] = useState<AlertDoc[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertDoc | null>(null);
  // Automatic proximity "Still here? / Not here" prompt (AlertStillHereCard) -- real, explicit
  // request, distinct from the manual "Still here" button already in AlertDetailSheet (only
  // shown when a driver taps a marker themselves). See the eligibility effect below (near
  // visibleAlerts) for exactly when this gets set. promptedAlertIdsRef is this-session-only (not
  // persisted) -- once a driver has been asked about a given alert, it's never asked again this
  // session even if they linger in its 300m radius, but a fresh app open can ask again.
  const [stillHerePrompt, setStillHerePrompt] = useState<AlertDoc | null>(null);
  const promptedAlertIdsRef = useRef<Set<string>>(new Set());

  // Static OSM traffic-light/speed-camera layer -- fetched per visible map region (debounced
  // on region-change-complete, gated behind a min-zoom so a zoomed-out view doesn't fire an
  // Overpass query over a huge area), independent of the live community AlertType markers.
  const [osmData, setOsmData] = useState<OsmTrafficData | null>(null);
  const [, setOsmLoading] = useState(false);
  // Current zoom level (region.latitudeDelta), tracked purely to size the traffic-light
  // clustering grid below -- bigger delta (zoomed out) means bigger cluster cells, so a huge
  // real-world cluster of signals stays a handful of markers until you actually zoom in on it.
  const [osmZoomDelta, setOsmZoomDelta] = useState(0.05);
  // The map's centre, for the road signs drawn in view (map/roadSignVisibility.ts).
  const [viewCentre, setViewCentre] = useState<LatLng | null>(null);
  const osmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same debounce pattern as osmDebounceRef, for the fuel/restaurant/hotel viewport pin layer
  // below -- kept separate so panning while only one kind of layer is on doesn't cancel/reset
  // the other's in-flight timer.
  const placesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bannerVisible, setBannerVisible] = useState(false);
  const [placingAlert, setPlacingAlert] = useState(false);
  // Real "set incidents from 2 views" toggle -- pitches the camera to a front/driving
  // perspective at whatever spot the user has already panned to (see togglePlacementFrontView
  // below), for a clear view of where they're actually placing it. Real, confirmed bug this
  // default fixes: this used to default to false (flat/overhead) the instant placement opened,
  // with the tilted driving view only reachable by manually tapping the eye icon -- backwards
  // from the explicit ask that placement should default to the normal driving-style angle, only
  // dropping to overhead once genuinely zoomed out (see the auto-switch in
  // onRegionChangeComplete). Defaulting true here, paired with onAlertTypeSelected now opening
  // placement already tilted (see its own comment), makes this the actual default view instead
  // of requiring a manual switch for the view every single report already defaulted to needing.
  const [placementFrontView, setPlacementFrontView] = useState(true);
  // Real, explicit request -- placement stays in the normal driving-style angle for a clear view
  // of what's being placed, and only switches to overhead once the driver genuinely zooms out
  // past this distance (region.latitudeDelta is this screen's existing real zoom proxy -- see
  // OSM_LAYER_MAX_DELTA/PLACES_LAYER_MAX_DELTA for the same pattern). Tracks whether the CURRENT
  // overhead view came from this auto-switch (vs. a deliberate manual eye-icon tap) so zooming
  // back in only restores the tilt it auto-removed, never fighting a driver who manually chose
  // overhead themselves at a normal zoom.
  const ALERT_PLACEMENT_OVERHEAD_DELTA = 0.02;
  const autoOverheadPlacementRef = useRef(false);
  // Tracks whether either alert sheet is actually open (not just mounted -- both are always
  // mounted, controlled via ref) so the FAB column below can hide itself while a sheet
  // covers most of the screen -- previously the FABs stayed rendered at their normal
  // position underneath, and whichever one happened to sit just above the sheet's top edge
  // showed as an oddly clipped sliver peeking out from behind it.
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const detailSheetOpenRef = useLatest(detailSheetOpen);
  const [placeInfoSheetOpen, setPlaceInfoSheetOpen] = useState(false);
  const [directionsSheetOpen, setDirectionsSheetOpen] = useState(false);
  const [osmMarkerSheetOpen, setOsmMarkerSheetOpen] = useState(false);
  const [liveCameraSheetOpen, setLiveCameraSheetOpen] = useState(false);
  const [navOptionsSheetOpen, setNavOptionsSheetOpen] = useState(false);
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [restaurantsSheetOpen, setRestaurantsSheetOpen] = useState(false);
  const [hotelsSheetOpen, setHotelsSheetOpen] = useState(false);
  const [fuelStationsSheetOpen, setFuelStationsSheetOpen] = useState(false);
  const [parkingSheetOpen, setParkingSheetOpen] = useState(false);
  const [parkingFiltersOpen, setParkingFiltersOpen] = useState(false);
  // Pins for the open nearby list (food / hotels / parking; petrol uses fuelStationPins).
  const [nearbyPins, setNearbyPins] = useState<{ food: NearbyPin[]; hotel: NearbyPin[]; parking: NearbyPin[] }>({ food: [], hotel: [], parking: [] });
  const setFoodPins = useCallback((pins: NearbyPin[]) => setNearbyPins((p) => ({ ...p, food: pins })), []);
  const setHotelPins = useCallback((pins: NearbyPin[]) => setNearbyPins((p) => ({ ...p, hotel: pins })), []);
  const setParkingPins = useCallback((pins: NearbyPin[]) => setNearbyPins((p) => ({ ...p, parking: pins })), []);
  // Real, explicit request -- petrol stations visible ON THE MAP, not just in FuelStationsSheet's
  // own list. Reported up by that sheet (see its own FuelStationPin comment) as ready-to-render
  // pins, own onPress included -- MapScreen just renders whatever it's given (see the Marker
  // loop near the traffic-light/speed-camera markers below), no live/fallback-mode awareness
  // needed here at all.
  const [fuelStationPins, setFuelStationPins] = useState<FuelStationPin[]>([]);
  // Real, explicit request -- "zoom out...display all that's available" for petrol stations,
  // restaurants (incl. fast-food chains like KFC/McDonald's -- a real OSM amenity=fast_food tag,
  // see osmPlaces.ts's own CATEGORY_TAGS comment), and hotels, not just the fixed GPS-anchored
  // nearest-N set each sheet already reports above. Fetched directly from the map's own current
  // viewport bounds (see fetchViewportPlaces/onRegionChangeComplete below) whenever the matching
  // sheet is open, refetching as the driver pans/zooms the same way the traffic-light/speed-
  // camera layer already does. fuelStationPins above stays as-is (it's also used to open the
  // right detail sheet on tap and seeds the pins before the first viewport fetch resolves);
  // these are the additional places that fetch turns up once the driver zooms out past the GPS-
  // anchored set's own radius.
  const [fuelViewportPlaces, setFuelViewportPlaces] = useState<NearbyPlace[]>([]);
  const [restaurantViewportPlaces, setRestaurantViewportPlaces] = useState<NearbyPlace[]>([]);
  const [hotelViewportPlaces, setHotelViewportPlaces] = useState<NearbyPlace[]>([]);
  const anySheetOpen =
    reportSheetOpen ||
    detailSheetOpen ||
    placeInfoSheetOpen ||
    osmMarkerSheetOpen ||
    liveCameraSheetOpen ||
    directionsSheetOpen ||
    navOptionsSheetOpen ||
    toolsSheetOpen ||
    soundSheetOpen ||
    restaurantsSheetOpen ||
    hotelsSheetOpen ||
    fuelStationsSheetOpen ||
    parkingSheetOpen;
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
  // The item being placed (for item-specific questions: a closure's details, nav/closures.ts).
  const [placingItem, setPlacingItem] = useState<ReportItemId | null>(null);
  const [closureDraft, setClosureDraft] = useState<ClosureDetails>(DEFAULT_CLOSURE);
  const alertCommentBlocked = containsBlockedLanguage(alertComment);
  const onChangeAlertComment = useCallback((text: string) => {
    setAlertComment(clampToWordLimit(text));
  }, []);

  // Real "tap a shop, see its info" -- iOS's native MapKit provider here has no onPoiClick
  // event (react-native-maps only fires that on Google Maps/Android), so instead any map tap
  // looks up whatever business is closest to that point via Places Nearby Search + Details.
  const [placeInfo, setPlaceInfo] = useState<PlaceInfo | null>(null);
  const [, setPlaceInfoLoading] = useState(false);
  // Real quick drive-time check -- like Apple Maps' own "19 min." pill on a place card, a
  // lightweight traffic-aware Directions call from the real current trip origin, fired only
  // once a place card is actually open (not for every map tap/search result) and cleared the
  // instant the sheet shows a different place so a stale ETA from the last place never lingers
  // on screen while the new one's own real figure is still loading.
  // Each answer is kept with the place it's for, so a different place never shows it.
  const [placeInfoEta, setPlaceInfoEta] = useState<{ placeId: string; text: string } | null>(null);
  const placeInfoEtaText = placeInfo && placeInfoEta?.placeId === placeInfo.placeId ? placeInfoEta.text : null;
  // Real Street View Static thumbnail for whatever place PlaceInfoSheet is showing -- see
  // getStreetViewUrl's own comment for why this can genuinely come back null (no real coverage)
  // rather than ever showing a fabricated placeholder image.
  const [placeInfoStreetView, setPlaceInfoStreetView] = useState<{ placeId: string; url: string | null } | null>(null);
  const placeInfoStreetViewUrl = placeInfo && placeInfoStreetView?.placeId === placeInfo.placeId ? placeInfoStreetView.url : null;
  // Real interactive Street View embed URL -- only ever derived once the metadata-checked
  // static URL above has confirmed real coverage for this exact place, so it's never built for
  // a location Google has no panorama for. Recomputed from the same place+url pair, not stored
  // separately, so it can never drift out of sync with placeInfoStreetViewUrl.
  const placeInfoStreetViewEmbedUrl = useMemo(() => {
    if (!placeInfoStreetViewUrl || !placeInfo) return null;
    return getStreetViewEmbedUrl(placeInfo.location);
  }, [placeInfoStreetViewUrl, placeInfo]);

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
  // Live Traffic NSW (services/trafficNsw.ts): current incidents from the shared snapshot the
  // server refreshes every five minutes. Only listened to while the layer is switched on.
  const [trafficIncidents, setTrafficIncidents] = useState<TrafficIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<NearbyIncident | null>(null);
  const [selectedIncidentAt, setSelectedIncidentAt] = useState(0);
  const onSelectIncident = useCallback((incident: NearbyIncident) => {
    setSelectedIncidentAt(Date.now());
    setSelectedIncident(incident);
  }, []);
  const trafficUid = user?.uid ?? null;
  useEffect(() => {
    if (!settings.showLiveTraffic || !trafficUid) return;
    const unsubscribe = subscribeNswTraffic((snapshot) => setTrafficIncidents(snapshot.incidents));
    return () => {
      unsubscribe();
      setTrafficIncidents([]);
    };
  }, [settings.showLiveTraffic, trafficUid]);

  const onLiveCameraPress = useCallback((camera: LiveTrafficCamera) => {
    setSelectedLiveCamera(camera);
    liveCameraSheetRef.current?.expand();
  }, []);
  const [bannerMessage, setBannerMessage] = useState("");
  // Real, confirmed bug: AI Vehicle Detection is now a genuine navigator route (see
  // RootNavigator.tsx's own comment for why -- rotation never actually worked while it was a
  // plain Modal floating over this screen), so "is detection open" is no longer local state this
  // screen owns -- it's exactly the same thing as "is Map not currently focused", true the
  // moment navigation pushes VehicleDetection (or any other screen) on top. detectionOpen keeps
  // its original name/meaning for every read site below (pausing camera-follow while it's up);
  // only how it's derived changed.
  const isFocused = useIsFocused();
  const detectionOpen = !isFocused;
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
  // Settings > Map view > 3D buildings (it was a row in the old Map tools panel, held only in
  // memory; as a setting it's remembered).
  const show3D = settings.show3DBuildings;
  // Tilted, near-horizontal "front view" of the 3D tiles/buildings on top of the default
  // top-down 3D angle -- the module's own `tilt(deltaDeg)` is relative, not absolute, but
  // since Map3DView is only ever mounted while show3D is true (unmounts fully when it's
  // toggled off), each mount starts from the same default camera, so a fixed +60/-60 delta
  // pair is a safe, always-correct toggle rather than needing to track absolute angle.

  // Apple-Maps-style close-follow camera: tilted, zoomed in, rotates to match the direction
  // of travel. Uses react-native-maps' own `camera`/`animateCamera` API (pitch/heading/zoom),
  // NOT the custom Map3DView module above -- a standard MapView camera call, zero native-module
  // risk, which matters given the iOS crash history around the custom 3D module. Defaults on
  // whenever navigation starts, and the user can drop back to a flat top-down view without
  // exiting navigation entirely.
  // Permanent fix §2: the ONE camera owner (map-v2/cameraController.ts). Every camera move below
  // goes through it with a source; the state decides. followTilt is now just "driving and
  // following" (NAV_FOLLOW), and the home map's "you moved it" is FREE.
  const camera = useMemo(() => new CameraController(mapRef), []);
  // Map styles add-on: the style drawn right now (Map theme, or Dark when the map dark mode applies).
  const mapTheme = useEffectiveMapTheme();
  const routeColours = useMemo(() => routeColoursFor(mapTheme, mapType === "hybrid"), [mapTheme, mapType]);
  const [cameraMode, setCameraMode] = useState<CameraMode>(camera.state);
  useEffect(() => camera.onChange(setCameraMode), [camera]);
  const followTilt = cameraMode === "NAV_FOLLOW";

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
  // Exiting follow entirely (manual pan, or the X button) always resets this back to the
  // default front-view pose for next time -- resuming follow (Recenter) shouldn't silently
  // land back in the pulled-back overview from a previous session. (Adjusted while rendering.)
  if (!followTilt && overviewMode) setOverviewMode(false);

  const currentLatLng = useMemo(
    () =>
      location
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null,
    [location]
  );

  // Real, explicit request -- a Waze-style accuracy circle around the live position marker,
  // straight off expo-location's own real reported horizontal accuracy (meters) for this fix,
  // never a guessed/fixed radius. Null on a fix that genuinely didn't report one (handled by the
  // render site below, which just skips drawing the circle rather than fabricating a number).
  const currentAccuracyMeters = location?.coords.accuracy ?? null;
  // "Only at night" dark map: night by the real sun at the driver's last position; and the
  // last position cached for the next launch (startup §1).
  useEffect(() => {
    if (!currentLatLng) return;
    noteNightPosition(currentLatLng.latitude, currentLatLng.longitude);
    void saveLastLocation(currentLatLng.latitude, currentLatLng.longitude);
  }, [currentLatLng]);
  // Startup §1: open on the last known place (no live fix yet), then the follow camera eases to the
  // live fix when it lands (a 500 ms move, not a snap).
  const startPlaceRef = useRef(false);
  const liveFixRef = useLatest(currentLatLng);
  useEffect(() => {
    if (!mapReady || startPlaceRef.current) return;
    startPlaceRef.current = true;
    let cancelled = false;
    void loadLastLocation().then((cached) => {
      if (cancelled || !cached || liveFixRef.current) return;
      camera.move("follow", { center: { latitude: cached.latitude, longitude: cached.longitude }, zoom: HOME_FOLLOW_ZOOM }, { duration: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, camera, liveFixRef]);

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

  // Live reverse-geocoded address under the fixed center pin while picking a start point by pin
  // -- debounced so it re-resolves a moment after the map settles from a pan/zoom, not on every
  // single frame of the gesture (see onRegionChangeComplete, which keeps originPinLatLng itself
  // live every frame regardless -- only this address lookup is debounced).
  useEffect(() => {
    if (!pickingOrigin || originPickerView !== "pin" || !originPinLatLng) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setOriginPinAddressLoading(true);
      reverseGeocode(originPinLatLng)
        .then((address) => {
          if (!cancelled) setOriginPinAddress(address);
        })
        .catch(() => {
          if (!cancelled) setOriginPinAddress(null);
        })
        .finally(() => {
          if (!cancelled) setOriginPinAddressLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pickingOrigin, originPickerView, originPinLatLng]);

  // Same pattern as the origin pin address effect above, for the destination pin step.
  useEffect(() => {
    if (!pickingDestinationPoint || destinationPickerView !== "pin" || !destinationPinLatLng) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setDestinationPinAddressLoading(true);
      reverseGeocode(destinationPinLatLng)
        .then((address) => {
          if (!cancelled) setDestinationPinAddress(address);
        })
        .catch(() => {
          if (!cancelled) setDestinationPinAddress(null);
        })
        .finally(() => {
          if (!cancelled) setDestinationPinAddressLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pickingDestinationPoint, destinationPickerView, destinationPinLatLng]);

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
  // Permanent fix §2: this used to run on EVERY GPS fix while 3D was on and snap the camera to
  // pitch 65 / zoom 18.5 -- the root cause of "I pinch out and it zooms straight back in". Now it
  // runs only when 3D is switched on, only while following, and only tilts (pitch <= 45, §6).
  useEffect(() => {
    if (!show3D || route) return;
    camera.move("follow", { pitch: HOME_3D_PITCH }, { duration: 600 });
  }, [show3D, route, camera]);

  // `initialRegion` above is a mount-time-only prop, so it never moves the map once the very
  // first real GPS fix actually lands -- this is that correction (skipped while navigating since
  // confirmRoute/the chase-cam effects already own the camera then). Without this, a location
  // permission grant + first fix landing even a moment after the map's first render left the map
  // stuck on the placeholder coordinate for the rest of the session -- the real, confirmed "why
  // is it showing San Francisco" bug, not a rare edge case.
  //
  // Also gated on mapReady, not just currentLatLng -- a real, confirmed second cause of the exact
  // same symptom: on a fast GPS fix (already-granted permission from a previous session),
  // currentLatLng can resolve before the native MapView has actually attached mapRef, so
  // mapRef.current?.animateCamera silently no-op'd through the `?.`.
  //
  // Real, confirmed THIRD cause, still reported after both fixes above: this used to fire only
  // ONCE EVER (a one-shot ref guard), consuming its only chance the instant mapReady+currentLatLng
  // both happened to be true -- if that first currentLatLng value was itself still an early/
  // rough fix (or any other reason animateCamera didn't visibly land), the map lost its chance to
  // correct for the rest of the session even once later fixes (the same ones the address banner
  // below independently keeps re-resolving from) confirmed the real position.
  //
  // Real, confirmed FOURTH cause, still reported after all three fixes above (screenshot
  // evidence: map genuinely stuck on the San Francisco placeholder with the real fix apparently
  // never landing): the fix above only kept recentering for a bounded window (8s) after the map
  // first became ready, then gave up permanently -- fine for a quick GPS fix, but a real cold
  // GPS start (indoors, weak signal, first launch after a permission grant) can easily take
  // longer than that, and once the window closed there was no second chance for the rest of the
  // session even though currentLatLng eventually DID resolve (the address banner elsewhere on
  // this screen, fed by the exact same location watcher, kept updating fine the whole time --
  // this camera-recenter effect was the only thing that had stopped listening). No time bound at
  // all now: keeps following the driver's own live position for as long as the camera controller
  // is in FOLLOW -- the instant they touch the map it is FREE and this stops until Recentre.
  // While following on the home map the camera is heading-up at street zoom: the road ahead
  // runs up the screen, the way it will once a trip starts. `headingRef` rather than `heading`
  // itself in the dependency list -- heading is recomputed on every fix anyway, and listing it
  // would only make this run twice per fix.
  const followHeadingRef = useRef(0);
  // North-up (the compass button): stays exactly north-up while following until the compass is
  // tapped again. It used to snap north for one animation, then the next GPS fix turned the map
  // heading-up again.
  const [northUp, setNorthUp] = useState(false);
  const northUpRef = useLatest(northUp);
  // While driving, the compass (or Map view > North up) holds the map north-up; the arrow still
  // turns with the car. Off again at the end of every drive.
  const [navNorthUp, setNavNorthUp] = useState(false);
  // The "You've arrived" card (nav/endDrive.ts); the drive ends when it goes.
  const [arrival, setArrival] = useState<ArrivalInfo | null>(null);
  // Trip history: set when this trip reaches its destination (read when the trip is saved).
  const tripArrivedRef = useRef(false);
  // Arrival flow (nav/arrivalFlow.ts): car parks near the destination from 1 km out, and the
  // place you were going to after you chose to park at one (for "Walk 180 m" on arrival).
  const [arrivalParking, setArrivalParking] = useState<
    { key: string; near: string; nearLocation: LatLng; state: "loading" } | { key: string; near: string; nearLocation: LatLng; state: "error"; message: string } | { key: string; near: string; nearLocation: LatLng; state: "ready"; offers: ParkingOffer[] } | null
  >(null);
  const [walkAfterParking, setWalkAfterParking] = useState<{ name: string; address: string | null; location: LatLng } | null>(null);
  // Avoid switches while driving (the ETA sheet's Avoid row).
  const [navAvoidOpen, setNavAvoidOpen] = useState(false);
  useEffect(() => {
    // Not while a place page is up (the camera is showing the place), and not while choosing a
    // route: every GPS fix used to pull the camera back onto the driver at street zoom, undoing
    // the fit that shows all the routes.
    // FREE (you moved the map) is refused by the controller: nothing follows until Recentre.
    if (!currentLatLng || route || !mapReady || placePage || pendingDestination) return;
    const bearing = northUpRef.current ? 0 : followHeadingRef.current;
    if (camera.move("follow", { center: currentLatLng, heading: bearing, zoom: HOME_FOLLOW_ZOOM }, { duration: 500 })) mapBearing.set(bearing);
  }, [currentLatLng, route, mapReady, mapBearing, placePage, northUpRef, pendingDestination, camera]);

  // Real, explicit request -- a bottom-left Re-centre FAB on the idle (not-navigating) home map
  // that only appears once the driver has actually panned away, mirroring Waze's own behaviour:
  // the camera controller's FREE state off a drive.
  const pannedAwayIdle = !route && cameraMode === "FREE";

  const routeActiveRef = useRef(false);
  useEffect(() => {
    routeActiveRef.current = !!route;
  }, [route]);
  // (Coming back to the app no longer un-does a pan: permanent fix §2 -- only Recentre does. The
  // "opens on San Francisco" case it guarded is covered by FOLLOW being the starting state: the
  // follow effect above moves to every fix until the driver touches the map.)

  // Permanent fix §2: the 100 km "sanity recentre" that lived here is gone -- it overrode a pan,
  // so looking at another city got yanked back. FOLLOW (the starting state) covers the case it
  // was for: until the driver touches the map, every fix moves the camera to them.

  // Real, confirmed request -- the idle (not-navigating) map used to open flat, top-down
  // (pitch 0) until the driver manually two-finger-tilted it or started a route (the chase-cam
  // effects further down apply their own pitch once navigating). Applies a default 3D angle a
  // single time, right after the map is first ready. One-shot (idlePitchAppliedRef); a "follow"
  // move, so the controller refuses it once the driver has touched the map (FREE).
  const idlePitchAppliedRef = useRef(false);
  useEffect(() => {
    if (!mapReady || route || idlePitchAppliedRef.current) return;
    idlePitchAppliedRef.current = true;
    camera.move("follow", { pitch: DEFAULT_IDLE_PITCH }, { duration: 600 });
  }, [mapReady, route, camera]);

  // ---- Where on the route the car is (nav/routeMatcher.ts) ----
  // Progress along the route, matched by distance-along-route AND direction of travel, so a
  // U-shaped car-park exit, a roundabout, a cloverleaf or a parallel road can't snap to the wrong
  // part of the route; one bad fix can't jump it ahead; poor-accuracy fixes don't count as
  // off-route; in a tunnel it carries on at the last speed for up to 30 s.
  const navGeo = useMemo(() => (route ? buildRouteGeometry(route.steps, route.polyline) : null), [route]);
  const matchStateRef = useRef(createMatchState());
  const [navMatch, setNavMatch] = useState<MatchResult | null>(null);
  const [matchedGeo, setMatchedGeo] = useState(navGeo);
  if (matchedGeo !== navGeo) {
    setMatchedGeo(navGeo);
    setNavMatch(null);
  }

  // Live device compass heading -- deliberately separate from `heading` below, which is the
  // direction of TRAVEL (GPS course/derived bearing) and is what the puck arrow + chase-cam
  // stay locked to. This is which way the PHONE ITSELF is physically pointing right now
  // (magnetometer), which can easily differ -- held at an angle, mounted sideways, spun around
  // in a cupholder -- without that meaning the car actually turned. Rendered as a separate
  // highlight cone on the puck (below) so the route-facing arrow never wobbles with the phone,
  // while the cone gives a live, real "which way is my phone facing" signal on top of it.
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  // The same reading with its accuracy and time, for the heading filter. expo-location's
  // calibration level: 3 = under 20° on iOS, 2 = under 35°, 1 = under 50°.
  const [compassReading, setCompassReading] = useState<{ heading: number; accuracyDeg: number | null; timeMs: number } | null>(null);
  if (!route && deviceHeading !== null) setDeviceHeading(null);
  // Startup §4: the heading turret -- compass when still, GPS course when moving, blended between,
  // at most 90°/s. Fed straight from the compass callback (no re-render per reading); the arrow's
  // own frame loop and the heading-up map ticker below read it.
  const turret = useMemo(() => new HeadingTurret(), []);
  const compassFilterRef = useRef(new CompassFilter());
  const turretInputsRef = useRef<{ speedKmh: number | null; gps: number | null }>({ speedKmh: null, gps: null });
  const navigatingRef = useLatest(!!route);
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((headingData) => {
      // trueHeading is -1 when the OS can't derive it yet (no location fix for magnetic
      // declination) -- magHeading is still a real, live compass reading in that case, just
      // relative to magnetic north instead of true north.
      const value = headingData.trueHeading >= 0 ? headingData.trueHeading : headingData.magHeading;
      if (cancelled || value < 0) return;
      const accuracyDeg = headingData.accuracy === 3 ? 20 : headingData.accuracy === 2 ? 35 : headingData.accuracy === 1 ? 50 : null;
      const now = Date.now();
      const good = compassFilterRef.current.push({ timeMs: now, heading: value, accuracyDeg });
      turret.setTarget(targetHeading({ ...turretInputsRef.current, compass: good }));
      if (navigatingRef.current) {
        setDeviceHeading(value);
        setCompassReading({ heading: value, accuracyDeg, timeMs: now });
      }
    }).then((sub) => {
      if (cancelled) sub.remove();
      else subscription = sub;
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [turret, navigatingRef]);

  // GPS "course" heading (location.coords.heading) is a real device/OS-reported value, but a
  // genuinely unreliable one -- iOS commonly reports it as -1 ("invalid") at low speed, right
  // after a stop, or for a few fixes after starting to move again, which is exactly when a
  // driver is most likely to be turning onto a new street. Defaulting straight to 0 in that
  // case (the old behavior) meant the map silently snapped to "facing north" and stayed there
  // instead of rotating with an actual turn -- a real, confirmed bug, not just a rare edge case.
  // The fallback below derives a real heading from the bearing between the last two GPS fixes
  // instead of giving up -- genuine, live movement direction, just computed from position deltas
  // rather than read off the GPS chip's own course field.
  // Kept as state, updated while rendering when a new fix arrives (React's "adjust state when an
  // input changes" pattern), so the heading used in this render is from THIS fix -- it used to
  // be computed in an effect after render and read from a ref, always one fix behind.
  // The heading itself goes through nav/headingFilter.ts: GPS course only above 10 km/h, a blend
  // at 3-10, frozen below 3 (no spinning at the lights), the compass only before the first
  // movement or when walking (never a magnet-mounted phone while driving), the route's own road
  // direction while navigating on the route, no 90°+ jumps without 3 agreeing fixes over 5 s /
  // 30 m (a real U-turn), and smoothed the shortest way round.
  const [headingTrack, setHeadingTrack] = useState<{ at: LatLng | null; timeMs: number | null; filter: HeadingState; compassAt: number | null }>(() => ({
    at: null,
    timeMs: null,
    filter: initialHeadingState(),
    compassAt: null,
  }));
  const fixTimeMs = location ? location.timestamp : null;
  if (currentLatLng && fixTimeMs !== null && fixTimeMs !== headingTrack.timeMs) {
    const prev = headingTrack.at;
    const movedMeters = prev ? distanceKm(prev.latitude, prev.longitude, currentLatLng.latitude, currentLatLng.longitude) * 1000 : 0;
    const c = location!.coords;
    const speedKmh = c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null;
    const roadBearing = route && navGeo && navMatch?.onRoute ? routeBearingAt(navGeo, navMatch.along) : null;
    const filter = stepHeading(headingTrack.filter, {
      timeMs: fixTimeMs,
      speedKmh,
      gpsCourse: c.heading != null && c.heading >= 0 ? c.heading : null,
      // Skip tiny movement (GPS jitter while stopped): a bearing from metres of noise would spin.
      movementBearing: prev && movedMeters >= 3 ? bearingDegrees(prev.latitude, prev.longitude, currentLatLng.latitude, currentLatLng.longitude) : null,
      movedMeters,
      roadBearing,
      walking: travelMode === "walking",
    });
    setHeadingTrack({ at: currentLatLng, timeMs: fixTimeMs, filter, compassAt: headingTrack.compassAt });
  }
  // A new compass reading only marks the compass trusted or not (accuracy, magnet jumps); it
  // steers nothing unless the filter allows the compass (walking / not yet moved).
  if (compassReading && compassReading.timeMs !== headingTrack.compassAt) {
    setHeadingTrack({
      ...headingTrack,
      compassAt: compassReading.timeMs,
      filter: stepCompass(headingTrack.filter, compassReading),
    });
  }

  const heading = headingTrack.filter.shown ?? 0;
  // Permanent fix §4: which way the driving camera faces -- the route segment at the matched
  // position (before the first match: the segment you're nearest, so it faces the road before you
  // move); off the route, the filtered heading. North-up only if the driver asked for it.
  const navRoadBearing =
    route && navGeo ? (navMatch ? (navMatch.onRoute ? routeBearingAt(navGeo, navMatch.along) : null) : navStartBearing(route.polyline, currentLatLng)) : null;
  const navBearing = navCameraBearing({ keepNorthUp: settings.keepNorthUp, navNorthUp, roadBearing: navRoadBearing, heading });
  const navBearingRef = useLatest(navBearing);
  // The phone-direction cone on the arrow only while the compass is allowed to mean something.
  const compassConeAllowed = compassAllowed(headingTrack.filter, {
    speedKmh: location?.coords.speed != null && location.coords.speed >= 0 ? location.coords.speed * 3.6 : null,
    walking: travelMode === "walking",
  });

  // Real Waze/Google Maps nav convention -- the car sits low on screen (roughly the lower third)
  // with most of the view showing the road ahead, not dead-center. Google Maps SDK's own
  // `padding`/mapPadding shrinks the "visible" region the camera treats as the viewport for
  // centering purposes; padding the TOP pushes that visible region's center, and so the rendered
  // camera target (the car), further down the real screen -- the opposite of what padding the
  // bottom would do. Expressed as a fraction of real screen height (not a fixed px/meters value)
  // so it stays visually correct across every pitch/zoom this screen uses (normal chase, overview,
  // exit-zoom), rather than a geographic offset that would only look right at one specific zoom.
  // Only applied during the actual tilted chase-cam drive (not overview mode, which wants an even,
  // pulled-back view, and not the flat/overhead view-style, which has no "road ahead" perspective
  // to bias toward).
  const isNavChaseView =
    !!route && followTilt && !overviewMode && settings.defaultMapViewStyle !== "flat";
  // The plain home map: nothing picked, nothing being placed. This is the state the "Where to?"
  // sheet, the floating buttons and the street pill all belong to.
  const isHomeIdle =
    !route && !pendingDestination && !placingAlert && !pickingOrigin && !pickingDestinationPoint && !placePage;
  // The route-selection screen: a destination picked, routes on show, nothing else in front.
  const inRouteSelection = !route && !!pendingDestination && !pickingStop && !pickingOrigin;
  // The ad banner is laid out UNDER the map (not over it) whenever it's showing, together with
  // the bottom safe area -- so the map view is that much shorter than the screen.
  // Hidden on the route-selection screen and during navigation (as asked), and on the place
  // page, whose own sheet and "View routes" button take the whole bottom of the screen.
  const bannerShown = shouldShowBanner({ navigating: !!route, choosingRoute: !!pendingDestination, placePageOpen: !!placePage });
  const bannerAreaHeight = bannerShown ? BANNER_HEIGHT + insets.bottom : 0;
  const mapAreaHeight = windowHeight - bannerAreaHeight;
  const whereToHeights = threeSnapHeights(windowHeight, insets.top, bannerAreaHeight, whereToSnapFractions(windowHeight, insets.top, bannerAreaHeight));
  // Startup §1: starts at the sheet's peek height (where the sheet opens), not 0 -- so Report,
  // Re-centre and the street pill are in their final places on the very first frame instead of
  // jumping up once the sheet reports its height.
  const sheetVisibleHeight = useSharedValue(whereToHeights.peek);
  // Home: the sheet's peek height is padded off the bottom (keeping the arrow and the Google
  // logo clear of it) and the arrow sits at 62% of the screen -- see homeMapPadding.
  // The arrow sits directly above the street pill, which rides the sheet's peek edge.
  const homePadding = homeMapPadding(mapAreaHeight, whereToHeights.peek, windowHeight, homeArrowTargetY(mapAreaHeight, whereToHeights.peek, scaleFor(windowWidth)));
  // Live road view (nav/liveScene.ts): a panel above the ETA bar while navigating, toggle in
  // Settings › Vehicle & AI tools. The map's arrow moves up so it stays above the panel.
  const liveViewOn = liveViewShown(settings.liveRoadView, !!route, travelMode === "driving") && !detectionOpen;
  const liveViewH = liveViewHeight(windowHeight);
  const liveViewReserved = liveViewOn ? liveViewH + 8 + bottomBarHeight + insets.bottom : 0;
  const mapPadding = isNavChaseView
    ? navFollowPadding(windowHeight, liveViewReserved)
    : placePage
      ? // The place sits in the middle of the 40% above the place page's sheet.
        { top: insets.top, right: 0, bottom: windowHeight * PLACE_PAGE_SHEET_FRACTION, left: 0 }
      : inRouteSelection
        ? previewEdgePadding(routeTopCardBottom, routeSheetHeight)
        : isHomeIdle
          ? homePadding
          : { top: 0, right: 0, bottom: 0, left: 0 };

  // Real live GPS speed for the nav card's speed dial (see CurrentSpeedDial) -- expo-location's
  // coords.speed is m/s, converted here once rather than in the display component so every
  // caller gets the same real km/h number. null whenever there's no current fix or the OS hasn't
  // resolved a speed yet (a real "unknown", never coerced to 0 and shown as if the car were
  // stopped).
  const currentSpeedKmh =
    location?.coords.speed != null && location.coords.speed >= 0 ? location.coords.speed * 3.6 : null;
  const currentSpeedKmhRef = useLatest(currentSpeedKmh);

  // Real, explicit request -- live speed + speed limit on the Home map view, not just during
  // navigation. Dedicated 1Hz GPS watch, EMA-smoothed, with a real haversine fallback and a
  // "stays at 0 once genuinely stationary for 3s" rule -- see useLiveSpeed.ts's own header for
  // why this is a second, purpose-built watch rather than reusing currentSpeedKmh above (that
  // one is the older, unsmoothed value other existing features already depend on; left alone to
  // avoid changing their behavior).
  const liveSpeed = useLiveSpeed(true);
  // Real, explicit spec -- "Only show the speedometer while moving above 3 km/h or during
  // navigation; fade it out after 10s stationary." Always visible during active navigation
  // regardless of speed (a stopped-at-lights moment shouldn't hide it); otherwise visible
  // continuously while moving and for 10 real seconds after the last moment it was, so a brief
  // stop at an intersection doesn't flicker it away and immediately back.
  // Visible while navigating or moving; after stopping it stays 10 s, then fades. The state is
  // only set from the timer (and adjusted while rendering when movement resumes).
  const speedometerMoving = !!route || liveSpeed.speedKmh > 3;
  const [speedometerTimedOut, setSpeedometerTimedOut] = useState(true);
  if (speedometerMoving && speedometerTimedOut) setSpeedometerTimedOut(false);
  useEffect(() => {
    if (speedometerMoving) return;
    const timer = setTimeout(() => setSpeedometerTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [speedometerMoving]);
  const speedometerVisible = speedometerMoving || !speedometerTimedOut;

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
  // No longer gated on `route` existing -- real, explicit request for this to work on the Home
  // map view too, not just during active navigation.
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);
  const [speedLimitEstimated, setSpeedLimitEstimated] = useState(false);
  // The road the driver is currently on -- from the exact same lookup as speedLimitKmh (see
  // fetchSpeedLimitNear's own SpeedLimitResult.roadName), just previously discarded. Shown on
  // the nav card as its own "current road" row, distinct from the next-turn instruction text.
  const [currentRoadName, setCurrentRoadName] = useState<string | null>(null);
  // One lookup answers both "what's the speed limit here" and "what street is this", so one
  // tracker decides when that lookup is worth making (map/homeMapLogic.ts): only after moving
  // more than 25m or turning more than 30 degrees since the last one, never while one is
  // already in flight, and never for a stretch of road that's been answered before. In between
  // -- and it is re-read every second -- everything comes from memory.
  const roadTrackerRef = useRef(new RoadLookupTracker<{ roadName: string | null; kmh: number | null; estimated: boolean; conditional: string | null }>());
  const [speedLimitConditional, setSpeedLimitConditional] = useState<string | null>(null);
  const roadFixRef = useRef<{ latitude: number; longitude: number; heading: number; speedKmh: number | null } | null>(null);
  // When the driver last actually moved -- the street pill swaps to "N reports around you"
  // after ten seconds without.
  const lastMovedAtRef = useRef(0);
  const [stationary, setStationary] = useState(false);
  useEffect(() => {
    roadFixRef.current = currentLatLng
      ? { latitude: currentLatLng.latitude, longitude: currentLatLng.longitude, heading, speedKmh: currentSpeedKmh }
      : null;
    // Off a drive the map faces where the turret points (compass when still, course when moving).
    followHeadingRef.current = !route && turret.heading !== null ? turret.heading : heading;
  });
  // The GPS side of the turret's target: each fix's course (after the no-flip filter) and speed.
  useEffect(() => {
    turretInputsRef.current = { speedKmh: currentSpeedKmh, gps: headingTrack.filter.target };
    turret.setTarget(targetHeading({ speedKmh: currentSpeedKmh, gps: headingTrack.filter.target, compass: compassFilterRef.current.good }));
  }, [turret, currentSpeedKmh, headingTrack.filter.target]);
  // Heading-up home map: while following (and not north-up), the map turns with the turret, so
  // the arrow keeps pointing up the screen as you turn on the spot. 10 times a second at most,
  // only when it changed by a degree; nothing while you've moved the map (FREE) or are driving.
  useEffect(() => {
    if (route || northUp) return;
    let lastSent: number | null = null;
    const t = setInterval(() => {
      const h = turret.heading;
      if (h === null || (lastSent !== null && Math.abs(shortestDelta(lastSent, h)) < 1)) return;
      if (camera.move("follow", { heading: h }, { duration: 100 })) {
        lastSent = h;
        mapBearing.set(h);
      }
    }, 100);
    return () => clearInterval(t);
  }, [route, northUp, turret, camera, mapBearing]);
  const evaluateRoad = useCallback(() => {
    const fix = roadFixRef.current;
    if (!fix) return;
    const tracker = roadTrackerRef.current;
    const apply = () => {
      const road = tracker.value;
      setSpeedLimitKmh(road?.kmh ?? null);
      setSpeedLimitEstimated(road?.estimated ?? false);
      setSpeedLimitConditional(road?.conditional ?? null);
      setCurrentRoadName(road?.roadName ?? null);
    };
    if (tracker.update(fix)) {
      fetchSpeedLimitNear(fix.latitude, fix.longitude, fix.heading)
        .then((result) => {
          tracker.resolve(
            fix,
            result
              ? { roadName: result.roadName ?? null, kmh: result.kmh ?? null, estimated: result.estimated ?? false, conditional: result.conditional ?? null }
              : null
          );
          apply();
        })
        .catch(() => tracker.fail());
    }
    apply();

    // Moving at walking pace or faster counts as moving; GPS speed is noisy below that.
    const now = Date.now();
    if (lastMovedAtRef.current === 0 || (fix.speedKmh ?? 0) >= 3) lastMovedAtRef.current = now;
    setStationary(now - lastMovedAtRef.current >= STATIONARY_AFTER_MS);
  }, []);
  // Re-read on every new position, and at least once a second regardless -- so the pill keeps
  // up even when fixes arrive slowly, without a network request per tick.
  useEffect(() => {
    evaluateRoad();
  }, [currentLatLng, evaluateRoad]);
  useEffect(() => {
    const timer = setInterval(evaluateRoad, 1000);
    return () => clearInterval(timer);
  }, [evaluateRoad]);
  // No position: no limit or road name (adjusted while rendering; the lookup tracker is reset
  // in an effect because it's a ref).
  if (!currentLatLng && (speedLimitKmh !== null || speedLimitEstimated || currentRoadName !== null)) {
    setSpeedLimitKmh(null);
    setSpeedLimitEstimated(false);
    setCurrentRoadName(null);
  }
  useEffect(() => {
    if (!currentLatLng) roadTrackerRef.current.reset();
  }, [currentLatLng]);


  // Set once shareEta actually starts a live share for the current trip; cleared on
  // exitNavigation. Kept as a ref (not state) since only the periodic-update interval and
  // exitNavigation read it, and neither needs a re-render when it changes.
  const liveShareIdRef = useRef<string | null>(null);

  // Declared before the effects that read them (they used to be declared further down).
  const approachRef = useRef<ApproachState>(INITIAL_APPROACH);
  const lineTapAtRef = useRef(0);
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
    // Deliberately omits pitch/zoom here (animateCamera only touches the fields it's given,
    // leaving the rest alone) -- GPS updates land every ~2s or every 5m travelled, which while
    // actually driving can be several times a second. Including a fixed pitch/zoom on every one
    // of those ticks was re-snapping the camera back and fighting a user's manual two-finger
    // tilt/pinch almost as soon as they started it, making that real, native gesture feel
    // broken even though it works fine on its own. Pitch/zoom are only ever set once, when
    // follow-tilt is first entered (toggleFollowTilt/enterOverviewMode below) -- after that, only
    // center/heading keep tracking live position/direction of travel.
    // During the approach view the camera sits a little ahead, so the split and the lanes show.
    const approaching = approachRef.current.phase === "approach" && approachRef.current.zoomed && approachRef.current.stepIndex !== null;
    const split = approaching ? route.steps[approachRef.current.stepIndex!]?.endLocation : null;
    const bearing = navBearingRef.current;
    if (camera.move("navFollow", { center: split ? approachCenter(currentLatLng, split) : currentLatLng, heading: bearing }, { duration: 600 })) mapBearing.set(bearing);
  }, [route, followTilt, currentLatLng, heading, detectionOpen, placingAlert, navNorthUp, mapBearing, camera, navBearingRef]);

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
    chaseCamAppliedRef.current = true;
    // overviewMode defaults false -- see its own comment -- so a fresh nav session lands on the
    // tight, tilted front-view pose by default; the pulled-back pose only applies here if the
    // driver had already switched to it (tapping the locate button while already following)
    // before this fires, e.g. resuming follow after a manual pan while already pulled back.
    // Real, explicit request -- "flat"/"Overhead" default view style replaces the usual tilted
    // chase-cam pitch with a true top-down pose the instant navigation starts; "tilted3d" and
    // "satellite3d" both keep the exact original 60/45 pitch values (mapType is what
    // distinguishes satellite3d, set separately -- see mapViewStyleAppliedRef above).
    // Zoom nudged up (18 -> 18.5) for the tilted (non-flat, non-overview) driving pose per
    // explicit request for bigger, more prominent 3D buildings -- Google's native 3D-buildings
    // layer scales with zoom/pitch, not a separate stylable property, so this is the real lever.
    // Pitch itself stays at 60 (not pushed higher) since a steeper angle on real adjacent
    // buildings is what produced the squashed/hatched look already root-caused and fixed in the
    // MapLibre prototype's own 3D buildings -- same underlying geometry risk here. Mirrored at
    // every other site that shares this exact driving pose (exit-zoom revert, the locate-button
    // front/overview toggle, confirmRoute's own immediate snap, the alert-placement restore) so
    // the camera never lands on two different zooms depending on which path set it.
    const isFlatViewStyle = settings.defaultMapViewStyle === "flat";
    const bearing = navBearingRef.current;
    camera.move(
      "navFollow",
      overviewMode
        ? { center: currentLatLng, heading: bearing, pitch: isFlatViewStyle ? 0 : 45, zoom: isFlatViewStyle ? 17 : 15 }
        : navFollowPose(currentLatLng, bearing, currentSpeedKmhRef.current, isFlatViewStyle),
      { duration: 700 }
    );
  }, [route, followTilt, detectionOpen, currentLatLng, heading, overviewMode, placingAlert, settings.defaultMapViewStyle, currentSpeedKmhRef, camera, navBearingRef]);

  // The approach view around exits, merges, splits, roundabouts, lane changes and complex turns
  // (nav/approach.ts): zoom in 200 m out (400 m above 90 km/h), confirm the manoeuvre with a
  // green chip and ease back out, or catch a miss and reroute. The state machine decides; this
  // only carries out its effects on the camera, the chip and the reroute.
  const [approach, setApproach] = useState<ApproachState>(INITIAL_APPROACH);
  const [manoeuvreChip, setManoeuvreChip] = useState<{ text: string; tone: ChipTone } | null>(null);
  const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the approach machine sees a missed manoeuvre; the reroute effect below acts on it.
  const missedManoeuvreRef = useRef(false);
  const chimePlayer = useAudioPlayer(require("../../assets/sounds/speed_warning_chime.wav"));
  // What the effects need from this render (read inside callbacks, never stale).
  const approachCameraRef = useRef({ followTilt, overviewMode, flat: settings.defaultMapViewStyle === "flat", currentLatLng, heading, voiceEnabled });
  useEffect(() => {
    approachCameraRef.current = { followTilt, overviewMode, flat: settings.defaultMapViewStyle === "flat", currentLatLng, heading, voiceEnabled };
  });

  const showManoeuvreChip = useCallback((text: string, tone: ChipTone, ms: number | null) => {
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    setManoeuvreChip({ text, tone });
    chipTimerRef.current = ms === null ? null : setTimeout(() => setManoeuvreChip(null), ms);
  }, []);

  // Settings > Reports > Complex intersection / Multi-lane merge: "Alert while driving" is the
  // close-up camera before one, "Show on map" is its label at the turn.
  const routeItemSettingsRef = useLatest(settings);
  const approachStepsRef = useLatest(route?.steps ?? null);
  const dispatchApproach = useCallback(
    (event: ApproachEvent) => {
      const before = approachRef.current;
      const { state, effects } = reduceApproach(before, event);
      approachRef.current = state;
      if (state.phase !== before.phase || state.stepIndex !== before.stepIndex || state.zoomed !== before.zoomed) setApproach(state);
      const cam = approachCameraRef.current;
      for (const effect of effects) {
        if (effect.kind === "zoomIn") {
          const routeItem = routeItemFor(approachStepsRef.current?.[effect.stepIndex]?.maneuverKind);
          const zoomAllowed = !routeItem || alertsWhileDriving(routeItemSettingsRef.current, routeItem);
          if (cam.followTilt && zoomAllowed) {
            camera.move(
              "navFollow",
              { center: effect.center, heading: effect.heading, pitch: APPROACH_CAMERA.pitch, zoom: APPROACH_CAMERA.zoom },
              { duration: APPROACH_CAMERA.durationMs }
            );
          }
        } else if (effect.kind === "restore") {
          // Back to the normal follow pose (the same one the chase cam uses), unless the driver
          // is looking around the map themselves.
          if (cam.followTilt && cam.currentLatLng) {
            camera.move(
              "navFollow",
              cam.flat
                ? { center: cam.currentLatLng, heading: cam.heading, pitch: 0, zoom: 17 }
                : cam.overviewMode
                  ? { center: cam.currentLatLng, heading: cam.heading, pitch: 45, zoom: 15 }
                  : navFollowPose(cam.currentLatLng, cam.heading, currentSpeedKmhRef.current),
              { duration: effect.durationMs }
            );
          }
          if (event.type !== "tick" && event.type !== "rerouted") setManoeuvreChip(null);
        } else if (effect.kind === "confirmed") {
          showManoeuvreChip(effect.text, "good", CHIP_MS);
          if (cam.voiceEnabled) {
            try {
              chimePlayer.seekTo(0);
              chimePlayer.play();
            } catch {
              // No sound is fine; the chip says it.
            }
          }
        } else if (effect.kind === "missed") {
          missedManoeuvreRef.current = true;
          showManoeuvreChip("Rerouting…", "neutral", null);
        }
      }
    },
    [chimePlayer, showManoeuvreChip, approachStepsRef, routeItemSettingsRef, currentSpeedKmhRef, camera]
  );
  const dispatchApproachRef = useRef(dispatchApproach);
  useEffect(() => {
    dispatchApproachRef.current = dispatchApproach;
  }, [dispatchApproach]);

  useEffect(() => {
    matchStateRef.current = createMatchState();
  }, [navGeo]);
  useEffect(() => {
    if (!navGeo || !location) return;
    const c = location.coords;
    const { state, result } = matchFix(navGeo, matchStateRef.current, {
      latitude: c.latitude,
      longitude: c.longitude,
      timeMs: location.timestamp || Date.now(),
      speedMps: c.speed != null && c.speed >= 0 ? c.speed : null,
      headingDeg: c.heading != null && c.heading >= 0 ? c.heading : null,
      accuracyM: c.accuracy ?? null,
    });
    matchStateRef.current = state;
    setNavMatch(result);
  }, [location, navGeo]);
  useEffect(() => {
    if (!navGeo) return;
    const id = setInterval(() => {
      const dr = deadReckon(navGeo, matchStateRef.current, Date.now());
      if (dr) {
        matchStateRef.current = dr.state;
        setNavMatch(dr.result);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [navGeo]);

  // ---- School zones (official data) and which speed limit the sign shows ----
  // Zones for the tiles around the car load when it moves into a new tile; the zone it's in, and
  // whether that zone is in force (school day + its own hours, its own timezone), is worked out
  // on every fix and again at the exact minute a zone switches on or off.
  const [schoolShapes, setSchoolShapes] = useState<ZoneShape[]>([]);
  const [schoolCalendars, setSchoolCalendars] = useState<Record<string, SchoolCalendar | null>>({});
  const [communityZones, setCommunityZones] = useState<CommunityFeature[]>([]);
  const schoolTileRef = useRef<string | null>(null);
  const schoolLoadSeqRef = useRef(0);
  useEffect(() => {
    if (!currentLatLng) return;
    const k = schoolTileKey(currentLatLng.latitude, currentLatLng.longitude);
    if (schoolTileRef.current === k) return;
    schoolTileRef.current = k;
    const seq = ++schoolLoadSeqRef.current;
    const here = regionAt(currentLatLng.latitude, currentLatLng.longitude);
    zonesAround(currentLatLng.latitude, currentLatLng.longitude)
      .then(async (shapes) => {
        const regions = [...new Set([...shapes.map((sz) => sz.zone.region), ...(here.region ? [here.region] : [])])];
        const [cals, community] = await Promise.all([
          Promise.all(regions.map(async (r) => [r, await calendarFor(r).catch(() => null)] as const)).then(Object.fromEntries),
          communityFeaturesAround(currentLatLng.latitude, currentLatLng.longitude),
        ]);
        if (seq !== schoolLoadSeqRef.current) return;
        setSchoolShapes(shapes);
        setSchoolCalendars(cals);
        setCommunityZones(community);
      })
      .catch(() => {
        // Retried on the next fix.
        if (seq === schoolLoadSeqRef.current) schoolTileRef.current = null;
      });
  }, [currentLatLng]);

  const signUnit = signUnitFor(null, settings.distanceUnit === "miles" ? "miles" : "km");
  const signStyle = useMemo(() => signStyleFor(deviceRegion()), []);
  // The clock school zones are judged by: ticks at every wall-clock minute (zone hours are whole
  // minutes), so a zone -- the one you're in, and every one drawn on the map -- switches on or off
  // at the exact minute, even when parked.
  const [schoolNowMs, setSchoolNowMs] = useState(() => Date.now());
  const hasSchoolShapes = schoolShapes.length > 0 || communityZones.length > 0;
  useEffect(() => {
    if (!hasSchoolShapes) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = Date.now();
      timer = setTimeout(() => {
        setSchoolNowMs(Date.now());
        schedule();
      }, 60_000 - (now % 60_000) + 200);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [hasSchoolShapes]);
  const moving = (currentSpeedKmh ?? 0) >= 5;
  const schoolZoneNow = useMemo<SchoolZoneNow | null>(
    () =>
      currentLatLng && hasSchoolShapes
        ? trackSchoolZone(INITIAL_SCHOOL_ZONE_TRACKER, {
            position: currentLatLng,
            heading: moving ? heading : null,
            shapes: schoolShapes,
            calendars: schoolCalendars,
            nowMs: schoolNowMs,
          }).now
        : null,
    [currentLatLng, hasSchoolShapes, moving, heading, schoolShapes, schoolCalendars, schoolNowMs]
  );
  // "School zone, 40" once on entering a zone in force (or it switching on while you're in it).
  const lastActiveSchoolZoneRef = useRef<string | null>(null);
  useEffect(() => {
    const id = schoolZoneNow?.status.active ? schoolZoneNow.shape.zone.id : null;
    if (id && id !== lastActiveSchoolZoneRef.current && settings.schoolZonesAlert && schoolZoneNow) {
      announcePhrase({ kind: "schoolZone", limit: signValue(schoolZoneNow.status.limitKmh, signUnit) });
    }
    lastActiveSchoolZoneRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolZoneNow]);

  // An OpenStreetMap conditional limit on the matched road (where there's no official zone),
  // judged against the same official calendar. Outside a known calendar an SH/PH condition is
  // unknown -- not shown.
  const osmSchoolZone = (() => {
    if (!speedLimitConditional || !currentLatLng) return null;
    const rules = parseMaxspeedConditional(speedLimitConditional);
    if (!rules?.length) return null;
    const here = regionAt(currentLatLng.latitude, currentLatLng.longitude);
    for (const rule of rules) {
      const st = zoneStatus(
        { id: "osm", source: "OSM", region: here.region ?? "", timezone: here.timezone, limit: rule.display, conditional: rule.condition },
        here.region ? schoolCalendars[here.region] ?? null : null,
        schoolNowMs
      );
      if (st.active) return { kmh: rule.kmh, display: rule.display, untilLabel: st.untilLabel };
    }
    return null;
  })();

  // Lowest-priority zone source: a driver-reported zone that has gone live (3 confirmations or
  // owner approval), on the road it was reported on, judged on the same calendar.
  const communitySchoolZone = (() => {
    if (!currentLatLng || communityZones.length === 0) return null;
    const here = regionAt(currentLatLng.latitude, currentLatLng.longitude);
    const zone = communityZoneAt(currentLatLng, moving ? heading : null, communityZones, here);
    if (!zone) return null;
    const st = zoneStatus(zone, here.region ? schoolCalendars[here.region] ?? null : null, schoolNowMs);
    return st.active ? { zone, status: st } : null;
  })();

  const [roadReportOpen, setRoadReportOpen] = useState(false);
  const resolvedLimit = resolveSpeedLimit({
    // The sign always shows the limit in force; "Alert while driving" only controls the call-out.
    schoolZone: schoolZoneNow?.status.active
        ? { active: true, kmh: schoolZoneNow.status.limitKmh, display: schoolZoneNow.shape.zone.limit, untilLabel: schoolZoneNow.status.untilLabel, name: schoolZoneNow.shape.zone.name }
        : osmSchoolZone
          ? { active: true, kmh: osmSchoolZone.kmh, display: osmSchoolZone.display, untilLabel: osmSchoolZone.untilLabel }
          : communitySchoolZone
            ? { active: true, kmh: communitySchoolZone.status.limitKmh, display: communitySchoolZone.zone.limit, untilLabel: communitySchoolZone.status.untilLabel, name: communitySchoolZone.zone.name }
            : null,
    route: route && navMatch ? routeLimitAt(route.polyline, route.maxSpeedsKmh, navMatch.along) : null,
    osm: speedLimitKmh != null ? { kmh: speedLimitKmh, estimated: speedLimitEstimated } : null,
  });
  // Settings > Reports > Speed limit changes. A change into a school zone is already announced
  // as "School zone, 40", so it isn't said twice.
  const limitChangeRef = useRef<LimitChangeState>(INITIAL_LIMIT_CHANGE);
  const resolvedKmh = resolvedLimit?.kmh ?? null;
  const resolvedIsSchoolZone = !!resolvedLimit?.schoolZone;
  useEffect(() => {
    const { state, announce } = stepLimitChange(limitChangeRef.current, resolvedKmh, location?.timestamp ?? 0, currentSpeedKmh);
    limitChangeRef.current = state;
    if (announce != null && !resolvedIsSchoolZone && travelMode === "driving" && alertsWhileDriving(settings, "speedLimitChanges")) {
      announcePhrase({ kind: "speedLimit", limit: signValue(announce, signUnit) });
    }
    // A new fix or a new limit runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKmh, location?.timestamp]);
  const schoolZoneDrawings = useMemo(
    () =>
      settings.schoolZonesShowOnMap
        ? schoolShapes.map((sz) => ({
            id: sz.zone.id,
            rings: sz.rings,
            active: zoneStatus(sz.zone, schoolCalendars[sz.zone.region] ?? null, schoolNowMs).active,
          }))
        : [],
    [schoolShapes, schoolCalendars, schoolNowMs, settings.schoolZonesShowOnMap]
  );

  // A new route (or none) ends any approach in progress.
  useEffect(() => {
    dispatchApproachRef.current({ type: "routeChanged" });
  }, [route]);
  // iOS: the voice, recorded clips and chimes play on silent and with the screen locked.
  const navigating = !!route;
  useEffect(() => {
    if (navigating) void prepareNavigationAudio();
  }, [navigating]);
  // Looking around the map (follow off), the dog-cam or placing a report ends it too.
  useEffect(() => {
    if (!followTilt || detectionOpen || placingAlert) dispatchApproachRef.current({ type: "panned" });
  }, [followTilt, detectionOpen, placingAlert]);

  // Coming back to the app: the camera starts from the normal view (following carries on).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") dispatchApproachRef.current({ type: "resumed" });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!route || !navGeo || !navMatch || !followTilt || detectionOpen || placingAlert || !currentLatLng || travelMode !== "driving") return;
    dispatchApproach(approachTick(route, navGeo, navMatch, activeStepIndex, Date.now(), currentSpeedKmh, currentLatLng));
    // Ticks on each matched fix (and each dead-reckoned second), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMatch]);

  useEffect(
    () => () => {
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    },
    []
  );

  const approachStep =
    approach.phase === "approach" && approach.zoomed && approach.stepIndex !== null ? route?.steps[approach.stepIndex] ?? null : null;
  const approachKind = approachStep ? kindOfStep(approachStep) : undefined;
  // The green "keep left / right" exit banner stays for exits with no lane data.
  const exitZoomActive = approach.phase === "approach" && approach.zoomed;
  const exitZoomDirection: "left" | "right" | null =
    approachStep && (approachKind === "exit" || approachKind === "fork")
      ? approachStep.maneuverSide ?? ((approachStep.maneuver ?? "").includes("left") ? "left" : "right")
      : null;
  // On the map during the approach: the road through the split, the road taken, the label.
  // Non-essential pins (venues, other drivers) are hidden meanwhile; reports stay.
  const approachDrawing = useMemo(() => {
    if (!route || approach.phase !== "approach" || !approach.zoomed || approach.stepIndex === null) return null;
    const highlight = manoeuvreHighlight(route.steps, approach.stepIndex);
    if (!highlight) return null;
    const step = route.steps[approach.stepIndex];
    const routeItem = routeItemFor(step.maneuverKind);
    const text = routeItem && !isShown(settings, routeItem) ? null : calloutLabel(step);
    return { ...highlight, callout: text ? { coordinate: step.endLocation, text } : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, approach, settings.reportPrefs]);

  // Real, explicit request -- Waze/Google-Maps-style auto-zoom that pulls the camera OUT as
  // real driving speed increases (more road ahead visible at highway speed) and back IN at low
  // speed (turns/intersections stay legible up close), off the same live currentSpeedKmh value
  // LiveSpeedometer/exit-zoom/etc. already use. Three real speed bands, applied only to the base
  // tilted chase pose -- the flat/overview/exit-zoom poses above each already have their own
  // deliberate fixed framing and are explicitly excluded here so this never fights any of them.
  // Only re-applies zoom on an actual band CROSSING (appliedSpeedZoomRef), never every GPS tick
  // -- same "don't fight a manual gesture" reasoning the per-tick center/heading effect above
  // already follows for pan/tilt: the instant a real pinch starts, onRegionChangeComplete's own
  // isGesture handling drops followTilt to false (see that handler's comment), which gates this
  // off immediately too, so a manual pinch is never overridden mid-gesture.
  const speedZoom = speedZoomFor(currentSpeedKmh);
  const appliedSpeedZoomRef = useRef<number | null>(null);
  useEffect(() => {
    const isFlatViewStyle = settings.defaultMapViewStyle === "flat";
    if (
      !route ||
      !followTilt ||
      !currentLatLng ||
      !chaseCamAppliedRef.current ||
      detectionOpen ||
      placingAlert ||
      exitZoomActive ||
      overviewMode ||
      isFlatViewStyle
    ) {
      appliedSpeedZoomRef.current = null;
      return;
    }
    if (appliedSpeedZoomRef.current === speedZoom) return;
    appliedSpeedZoomRef.current = speedZoom;
    camera.move("navFollow", { zoom: speedZoom }, { duration: 700 });
  }, [
    route,
    followTilt,
    currentLatLng,
    detectionOpen,
    placingAlert,
    exitZoomActive,
    overviewMode,
    settings.defaultMapViewStyle,
    speedZoom,
    camera,
  ]);

  // General-purpose "snap back to my location" -- unlike the nav-only Recenter pill above
  // (only ever rendered once route && !followTilt), this is meant to be on screen at all times,
  // browsing the map with no destination picked included, so panning/zooming away always has a
  // way back. While actively navigating it just resumes the existing chase-cam follow instead
  // of animating the camera itself, so it doesn't fight/duplicate that effect's own camera work.
  const onRecenter = useCallback(() => {
    if (!currentLatLng) return;
    // Recentre: the one way out of FREE (and out of the route overview while driving).
    camera.recentre();
    // Driving: NAV_FOLLOW re-applies the chase pose (chaseCamAppliedRef resets on the change).
    if (route) return;
    // Flies back to follow mode -- position, heading-up, street zoom and the default tilt --
    // over 600ms; the re-centre button fades out as the state leaves FREE.
    const bearing = northUpRef.current ? 0 : followHeadingRef.current;
    camera.move("recentre", { center: currentLatLng, heading: bearing, zoom: HOME_FOLLOW_ZOOM, pitch: DEFAULT_IDLE_PITCH }, { duration: 600 });
    mapBearing.set(bearing);
  }, [currentLatLng, route, mapBearing, camera, northUpRef]);

  // Tapping the route line pulls the camera back into a wider, still-tilted "overview" --
  // Apple/Google Maps' own convention when you tap the route during nav: not the tight
  // chase-cam (that's what the small toggle button gives you), but a pulled-back 3D view that
  // shows the surrounding blocks/buildings around your position, not just the next turn. Sets
  // followTilt=true so the same exit ("X") control in topRightControls works to back out of it,
  // and overviewMode=true so the small circle toggle button (below) shows the right icon/state
  // too, even though this action was triggered by tapping the line rather than that button.
  const enterOverviewMode = useCallback(() => {
    lineTapAtRef.current = Date.now();
    // Marks the chase-cam as "already handled" for this follow-tilt session so the default
    // chase-cam effect doesn't try to reapply its own pitch/zoom over this pulled-back view on
    // the very next GPS tick -- this call sets the camera explicitly right below.
    chaseCamAppliedRef.current = true;
    camera.setMode("NAV_FOLLOW", true);
    setOverviewMode(true);
    if (currentLatLng) camera.move("navFollow", { center: currentLatLng, heading: navBearingRef.current, pitch: 45, zoom: 15 }, { duration: 500 });
  }, [currentLatLng, camera, navBearingRef]);

  // The actual camera-height swap between the pulled-back "overview" pose and the tight
  // "front view" pose -- used by the locate button below. Reuses the exact same two poses the
  // default-apply effect above and enterOverviewMode (tapping the route
  // line) already use, so every path into either height lands on the same camera position.
  const applyOverviewPose = useCallback(
    (nextOverview: boolean) => {
      if (!currentLatLng) return;
      chaseCamAppliedRef.current = true;
      setOverviewMode(nextOverview);
      const bearing = navBearingRef.current;
      camera.move(
        "navFollow",
        nextOverview ? { center: currentLatLng, heading: bearing, pitch: 45, zoom: 15 } : navFollowPose(currentLatLng, bearing, currentSpeedKmhRef.current),
        { duration: 500 }
      );
    },
    [currentLatLng, currentSpeedKmhRef, camera, navBearingRef]
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
  // Any gesture -> FREE, immediately (permanent fix §2).
  const onMapPanDrag = useCallback(() => {
    camera.gesture();
  }, [camera]);

  // Real, explicit request -- Waze's own "resume following automatically after a short while"
  // behaviour: once a manual gesture has dropped the camera out of auto-follow DURING an active
  // trip (followTilt false, route active -- the exact state NavBottomBar's own Re-centre view
  // above already reflects), a real 10-second idle timer brings it back on its own rather than
  // leaving the driver stuck off-follow until they tap Re-centre themselves. Re-armed every time
  // this transitions from following to not-following again (a fresh manual pan after an earlier
  // auto-recentre), and cleared outright the moment following resumes (manual tap or the earlier
  // one firing) or the trip ends.
  // Permanent fix §2: 15 s untouched (not 10), only while moving over 10 km/h, only while driving,
  // only with Settings > Recentre automatically on (default on). Never on the home map.
  useEffect(() => {
    if (!route || cameraMode !== "FREE" || !settings.navAutoRecentre) return;
    const timer = setInterval(() => {
      if (shouldAutoRecentre({ mode: camera.state, navigating: camera.isNavigating, settingOn: true, speedKmh: currentSpeedKmhRef.current, idleMs: camera.idleMs() })) onRecenter();
    }, 1000);
    return () => clearInterval(timer);
  }, [route, cameraMode, settings.navAutoRecentre, camera, currentSpeedKmhRef, onRecenter]);

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

  // Real, explicit request -- "Default for new users: GHOST MODE ... first-launch explainer."
  // settings.visibility already defaults to "ghost" (see services/settings.ts) for every
  // install, so this is purely informational and shown once ever -- see
  // GhostModeExplainerModal.tsx's own comment for the exact gating.
  const [ghostExplainerVisible, setGhostExplainerVisible] = useState(false);
  useEffect(() => {
    hasSeenGhostModeExplainer().then((seen) => {
      if (!seen) setGhostExplainerVisible(true);
    });
  }, []);
  const dismissGhostExplainer = useCallback(() => {
    setGhostExplainerVisible(false);
    markGhostModeExplainerSeen();
  }, []);

  // Real, explicit request -- "Auto-ghost after >30min background or on arrival." The
  // background half lives entirely in this hook (its own AppState listener); the arrival half
  // is a direct call from exitNavigation below, the one real place a trip ends.
  useAutoGhostMode();

  // Kept fresh via refs (same convention as routeActiveRef above) rather than listed as
  // exitNavigation's own deps -- that useCallback intentionally stays referentially stable
  // (deps `[]`) since several other callbacks/effects below close over it, so reading
  // settings.visibility/updateSettings directly off of closure would go stale the moment either
  // changes after mount.
  const visibilityRef = useRef(settings.visibility);
  useEffect(() => {
    visibilityRef.current = settings.visibility;
  }, [settings.visibility]);
  const updateSettingsRef = useRef(updateSettings);
  useEffect(() => {
    updateSettingsRef.current = updateSettings;
  }, [updateSettings]);

  // Real, explicit request (Ghost mode + visibility control, Part 3 client) -- other visible+
  // driving drivers' presence, subscribed only while this device wants to see them
  // (settings.showTrackysOnMap) and is itself signed in (presence/{uid} reads require
  // isSignedIn() -- see firestore.rules). See presence.ts's own subscribeNearbyPresence for why
  // this is a broad, recency-ordered fetch rather than a geo-bounded one.
  const [presenceList, setPresenceList] = useState<PresenceDoc[]>([]);
  // Startup §3: the Trackys in the map view (geohash cells around it), re-queried as you drive
  // or move the map -- no fixed radius. While driving the view is where you are.
  const presenceView = route ? currentLatLng : (viewCentre ?? currentLatLng);
  const presenceCellsKey = presenceView
    ? viewportPresenceCells({ latitude: presenceView.latitude, longitude: presenceView.longitude, latitudeDelta: osmZoomDelta }).join(",")
    : "";
  useEffect(() => {
    // No synchronous reset here -- visiblePresences below already gates on
    // settings.showTrackysOnMap, so a stale presenceList from before it was toggled off (or
    // before a real sign-in existed) simply never renders anything.
    if (!user || !settings.showTrackysOnMap || !presenceCellsKey) return;
    return subscribeViewportPresence(user.uid, presenceCellsKey.split(","), setPresenceList);
  }, [user, settings.showTrackysOnMap, presenceCellsKey]);

  // Real, explicit request -- "Block/report from card." Loaded once per real sign-in change
  // (blockUser/unblockUser in presence.ts write the same doc this reads) and kept in a Set for
  // O(1) filtering of the presence list below; updated immediately (not re-fetched) the instant
  // this device blocks someone, so the blocked Tracky disappears without waiting on a second
  // real-time listener for something this device itself just wrote.
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    getBlockedUids(user.uid).then((uids) => setBlockedUids(new Set(uids)));
  }, [user]);

  const [selectedPresence, setSelectedPresence] = useState<PresenceDoc | null>(null);
  // Tap a Tracky: the small bubble first; "More" opens the full card.
  const [bubblePresence, setBubblePresence] = useState<PresenceDoc | null>(null);
  const [bubbleAtMs, setBubbleAtMs] = useState(0);
  const onSelectPresenceBubble = useCallback((p: PresenceDoc) => {
    setBubbleAtMs(Date.now());
    setBubblePresence(p);
  }, []);
  const onWaveFromBubble = useCallback(async (): Promise<string> => {
    if (!bubblePresence) return "";
    const r = await callSendWave(bubblePresence.uid);
    return r.outcome === "success" ? "Waved!" : r.outcome === "rate_limited" ? "You waved recently — try again later." : "Couldn't wave right now.";
  }, [bubblePresence]);

  // Home, Work, saved places and the parking spot on the map (SavedPlacePopup).
  const [savedPlaces, setSavedPlacesState] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  const [parkingSpot, setParkingSpotState] = useState<ParkingSpot | null>(null);
  const [selectedSaved, setSelectedSaved] = useState<SavedPinPlace | null>(null);
  useEffect(() => {
    getSavedPlaces().then(setSavedPlacesState);
    getParkingSpot().then(setParkingSpotState);
    const a = subscribeSavedPlaces(setSavedPlacesState);
    const b = subscribeParkingSpot(setParkingSpotState);
    return () => {
      a();
      b();
    };
  }, []);

  // Real, explicit request -- "Map shows max 50 Trackys, clustered." Closest-to-driver-first
  // cap (not an arbitrary slice of whatever subscribeNearbyPresence happened to return). The
  // clustering itself now happens inside PresenceLayer, on each Tracky's ANIMATED position
  // rather than its last published one (ADD-ON Part B).
  const MAX_VISIBLE_TRACKYS = 50;
  // Every account id this phone has used (services/ownUids.ts): none of them is drawn.
  const [ownUidList, setOwnUidList] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    rememberOwnUid(user?.uid).then((list) => !cancelled && setOwnUidList(list));
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);
  const ownUidSet = useMemo(() => new Set(ownUidList), [ownUidList]);
  const visiblePresences = useMemo(() => {
    if (!settings.showTrackysOnMap || !currentLatLng) return [];
    // Never the driver's own Tracky / ghost: the server's list includes their own entry, and it
    // used to be drawn on top of their arrow. Their own visibility shows only in the Menu.
    // Nearest the middle of the view first (it's the view's Trackys), never on top of your arrow.
    const centre = presenceView ?? currentLatLng;
    return presencesToShow(presenceList, { ownUid: user?.uid ?? null, ownUids: ownUidSet, blocked: blockedUids, here: centre, me: currentLatLng, max: MAX_VISIBLE_TRACKYS });
  }, [presenceList, blockedUids, currentLatLng, presenceView, settings.showTrackysOnMap, user?.uid, ownUidSet]);
  const presenceCellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);

  const ownAppearance = useTrackyAppearance(settings.visibility === "ghost");

  // Everything the two timers below need to read AT THE MOMENT THEY FIRE. Real bug this fixes:
  // the first version of this read speed/heading/mood straight from the effect's own closure,
  // which is created once when a route starts -- i.e. while the car is still stationary -- so
  // the 15km/h gate was comparing against a frozen ~0 forever and would never have sent.
  const presenceInputsRef = useRef({
    latLng: currentLatLng,
    speedKmh: 0,
    mood: ownAppearance.displayMood,
    look: undefined as typeof ownAppearance.customization | undefined,
    allowName: settings.showNameOnReports,
    source: originOverride?.location ?? null,
    dest: destinationLatLng,
  });
  useEffect(() => {
    presenceInputsRef.current = {
      latLng: currentLatLng,
      speedKmh: liveSpeed.speedKmh ?? currentSpeedKmh ?? 0,
      mood: ownAppearance.displayMood,
      look: ownAppearance.mode === "custom" ? ownAppearance.customization : undefined,
      allowName: settings.showNameOnReports,
      source: originOverride?.location ?? null,
      dest: destinationLatLng,
    };
  });

  // Real, explicit request (ADD-ON Part B) -- "15s samples", sent "every 60s while driving".
  // Each sample keeps the local time it was taken so it can be sent as an AGE (see
  // PresenceSample) -- the server turns that into its own clock's time and holds every point
  // back behind its 60s privacy delay (updatePresence in firebase/functions/index.js).
  //
  // Keyed on plain booleans/ids, not the `route`/`user` OBJECTS: a reroute replaces the route
  // object, and restarting these timers every time that happened would keep resetting the
  // once-a-minute send clock -- on a trip with frequent reroutes an update might never go out.
  const presenceUid = user?.uid ?? null;
  const presenceRouteActive = !!route;
  useEffect(() => {
    if (!presenceUid || !presenceRouteActive) return;
    if (settings.visibility === "ghost") return;
    let samples: { lat: number; lng: number; at: number }[] = [];
    // "Never within 500m of... trip start" -- for an ordinary trip (no custom starting point
    // picked) the start is simply wherever the driver was when this began, which nothing else
    // would otherwise tell the server.
    let tripStart: LatLng | null = null;
    // Real, explicit request -- "driving (speed>15km/h in last 5min)". The gate is "has been
    // above 15km/h at some point in the last five minutes", not "is above 15km/h at the exact
    // second the once-a-minute update fires" -- otherwise a red light at the wrong moment
    // withdraws a driver's Tracky, and behind the privacy delay it takes ~2 minutes to return.
    const DRIVING_WINDOW_MS = 5 * 60 * 1000;
    let recentSpeeds: { at: number; kmh: number }[] = [];

    const takeSample = () => {
      const now = Date.now();
      const inputs = presenceInputsRef.current;
      if (inputs.latLng) {
        if (!tripStart) tripStart = inputs.latLng;
        samples.push({ lat: inputs.latLng.latitude, lng: inputs.latLng.longitude, at: now });
      }
      if (samples.length > 12) samples = samples.slice(samples.length - 12);
      recentSpeeds.push({ at: now, kmh: inputs.speedKmh });
      recentSpeeds = recentSpeeds.filter((entry) => now - entry.at <= DRIVING_WINDOW_MS);
    };
    const send = () => {
      if (samples.length < 2) return;
      const inputs = presenceInputsRef.current;
      const sentAt = Date.now();
      // The fastest this driver has gone in the window. If that's under 15km/h they've been
      // stopped for five minutes: still sent, so the server withdraws them right away rather
      // than leaving their last position to linger until it expires.
      const recentMaxKmh = recentSpeeds
        .filter((entry) => sentAt - entry.at <= DRIVING_WINDOW_MS)
        .reduce((max, entry) => Math.max(max, entry.kmh), inputs.speedKmh);
      const batch = samples.map((sample) => ({ lat: sample.lat, lng: sample.lng, ageMs: sentAt - sample.at }));
      // Keep the newest sample as the start of the next batch so consecutive map-matches join
      // up into one continuous road path instead of leaving a gap between minutes.
      samples = samples.slice(samples.length - 1);
      const source = inputs.source ?? tripStart;
      callUpdatePresence({
        samples: batch,
        speedKmh: recentMaxKmh,
        mood: inputs.mood,
        look: inputs.look,
        allowName: inputs.allowName,
        tripContext: {
          sourceLat: source?.latitude ?? undefined,
          sourceLng: source?.longitude ?? undefined,
          destLat: inputs.dest?.latitude ?? undefined,
          destLng: inputs.dest?.longitude ?? undefined,
        },
      }).catch((err) => Sentry.logger.warn("map: updatePresence failed", { error: String(err) }));
    };

    takeSample();
    const sampleInterval = setInterval(takeSample, 15000);
    const sendInterval = setInterval(send, 60000);
    return () => {
      clearInterval(sampleInterval);
      clearInterval(sendInterval);
    };
  }, [presenceUid, presenceRouteActive, settings.visibility]);

  // Real, explicit request -- "Auto-deletes... immediately on arrival/ghost mode." Reacts to
  // EVERY transition into ghost mode, whichever of the several real triggers caused it (a
  // manual Settings/VisibilitySheet toggle, useAutoGhostMode's own >30min-background timer, or
  // autoGhostOnArrival inside exitNavigation below) -- this is the one real place that covers
  // all of them, rather than duplicating a clearPresence call at each separate trigger site.
  useEffect(() => {
    if (settings.visibility === "ghost") callClearPresence();
  }, [settings.visibility]);

  // Subscribe to alerts in every toggled-on region (Phase 3 + Phase 5), real Australian state/
  // territory selection instead of a distance radius. Fully off (and cleared) when the user has
  // disabled alerts altogether -- "if toggled off user who is active doesn't receive no alerts".
  const alertsOn = !!user && settings.alertsEnabled;
  if (!alertsOn && nearbyAlerts.length > 0) setNearbyAlerts([]);
  const alertsUid = user?.uid ?? null;
  useEffect(() => {
    if (!alertsUid || !settings.alertsEnabled) return;
    return subscribeVisibleAlerts(settings.visibleRegions, alertsUid, setNearbyAlerts);
  }, [alertsUid, settings.alertsEnabled, settings.visibleRegions]);

  // Per-type visibility filter, applied on top of the radius subscription above -- lets a
  // driver e.g. only care about police + hazards without changing what's actually fetched.
  const visibleAlerts = useMemo(
    () => visibleCommunityAlerts(settings, nearbyAlerts, { incidents: settings.showLiveTraffic ? trafficIncidents : [], osm: osmData }),
    // Settings > Reports per-item "Show on map" (the older per-type list is its default).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nearbyAlerts, settings.reportPrefs, settings.visibleAlertTypes, settings.showTrafficLights, settings.showLiveTraffic, trafficIncidents, osmData]
  );

  // Real, explicit audit fix -- the top-left Menu button's own unread badge (MenuButton.tsx)
  // used to be permanently hardcoded unreadCount={0} with no real Inbox data model behind it at
  // all (flagged in AUDIT.md's own Phase 1 table). Now a real count off this same nearbyAlerts
  // subscription (the exact same real, region-scoped alert list InboxScreen.tsx itself reads --
  // not type-filtered the way visibleAlerts above is, matching Inbox's own "every alert in your
  // regions" scope) against the real local last-viewed timestamp. Re-read on every real focus
  // (isFocused), not just once on mount, since visiting Inbox and coming back doesn't remount
  // this screen -- without that, the badge would never clear after actually reading the Inbox.
  const [inboxLastViewedAt, setInboxLastViewedAt] = useState(0);
  useEffect(() => {
    if (isFocused) getInboxLastViewedAt().then(setInboxLastViewedAt);
  }, [isFocused]);
  const inboxUnreadCount = useMemo(
    () => nearbyAlerts.filter((a) => a.createdAt > inboxLastViewedAt).length,
    [nearbyAlerts, inboxLastViewedAt]
  );

  // Real, explicit request -- a small, dismissible notification when ANOTHER user reports an
  // alert within ~1km, queued one at a time (see NearbyAlertToast's own header for why it's its
  // own component rather than reusing AlertBanner's single-slot pattern). `seenAlertIdsRef` is
  // null until the very first subscription snapshot, which seeds it with every alert already
  // visible at that moment WITHOUT queuing a toast for any of them -- without this, opening the
  // app (or re-enabling alerts) would immediately flood the queue with every pre-existing nearby
  // alert as if they'd all just been reported. Only an id that appears in a LATER snapshot,
  // genuinely new since the last one, gets a toast. Never notifies about the user's own report
  // (createdBy === user.uid) -- this is "someone else nearby just reported," not an echo of your
  // own action.
  const seenAlertIdsRef = useRef<Set<string> | null>(null);
  const reportSettingsRef = useLatest(settings);
  const [alertToastQueue, setAlertToastQueue] = useState<NearbyAlertNotification[]>([]);
  const NEARBY_ALERT_TOAST_RADIUS_METERS = 1000;
  useEffect(() => {
    const seen = seenAlertIdsRef.current;
    if (seen === null) {
      seenAlertIdsRef.current = new Set(visibleAlerts.map((a) => a.id));
      return;
    }
    if (!currentLatLng) return;
    const freshlySeen = new Set(seen);
    const newToasts: NearbyAlertNotification[] = [];
    for (const alert of visibleAlerts) {
      if (seen.has(alert.id)) continue;
      freshlySeen.add(alert.id);
      if (alert.createdBy === user?.uid) continue;
      if (!alertsWhileDriving(reportSettingsRef.current, itemOfAlert(alert))) continue;
      if (alert.needsConfirmation) continue;
      const distanceM = distanceKm(currentLatLng.latitude, currentLatLng.longitude, alert.lat, alert.lng) * 1000;
      if (distanceM > NEARBY_ALERT_TOAST_RADIUS_METERS) continue;
      newToasts.push({ id: alert.id, type: alert.type, distanceM });
    }
    seenAlertIdsRef.current = freshlySeen;
    if (newToasts.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- queues alerts that just arrived from Firestore (external data) and speaks them
      setAlertToastQueue((q) => [...q, ...newToasts]);
      // Spoken as well as shown ("Police reported"), nearest first if several land at once.
      // It waits for any turn instruction in progress rather than talking over it, and is the
      // one kind of speech "Only alerts" mode still allows.
      const nearest = newToasts.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
      announcePhrase({ kind: "report", alertType: nearest.type });
    }
  }, [visibleAlerts, currentLatLng, user?.uid, announcePhrase, reportSettingsRef]);
  const dismissAlertToast = useCallback(() => setAlertToastQueue((q) => q.slice(1)), []);

  // Automatic proximity "Still here? / Not here" prompt -- picks at most one eligible alert per
  // tick (skips entirely while a prompt is already showing, so it never queues a second one
  // behind the driver's back) and never re-asks about the same alert twice this session (see
  // promptedAlertIdsRef's own comment). heading/currentSpeedKmh are the same live values the
  // rest of this screen's own nav logic already reads, not a separate GPS source.
  // Per-type windows, never the reporter, never over a turn (alerts/stillThere.ts).
  const stillThereNavBusy = !!manoeuvreChip || (approach.phase === "approach" && approach.zoomed);
  useEffect(() => {
    if (stillHerePrompt || !currentLatLng) return;
    const candidate = stillThereCandidate(visibleAlerts, {
      nowMs: location?.timestamp ?? 0,
      uid: user?.uid,
      position: currentLatLng,
      headingDeg: heading,
      speedKmh: currentSpeedKmh,
      navBusy: stillThereNavBusy,
      alreadyAsked: promptedAlertIdsRef.current,
    });
    if (candidate) setStillHerePrompt(candidate);
    // A new fix runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAlerts, currentLatLng, stillHerePrompt, stillThereNavBusy]);

  const onStillHereRespond = useCallback((alert: AlertDoc, isStillHere: boolean) => {
    promptedAlertIdsRef.current.add(alert.id);
    setStillHerePrompt(null);
    if (!user) return;
    // Once per user per alert (firestore.rules); a repeat is refused and ignored.
    const vote = isStillHere ? confirmAlert(alert.id, user.uid) : denyAlert(alert.id, user.uid);
    vote.catch((err) => console.warn("[map] alert vote failed", err));
  }, [user]);

  // Turn-by-turn voice guidance (Phase 2): advance the active step as GPS crosses trigger radius.
  // Runs on each matched fix (navMatch); the position is read from a ref so a raw fix that
  // arrives before its match doesn't run it twice.
  const guidanceLatLngRef = useLatest(currentLatLng);
  useEffect(() => {
    const currentLatLng = guidanceLatLngRef.current;
    if (!route || !currentLatLng) return;
    // "Spoken directions" (the Sound sheet) decides how much is said: only "Normal" gets the
    // advance warnings ("in 1 kilometre, ..."), and shouldSpeakStep trims the rest.
    const spokenMode = settings.spokenDirections;
    const { announcement, arrived, activeStepIndex: nextIndex } = evaluateGuidance(
      guidanceRef.current,
      route.steps,
      currentLatLng.latitude,
      currentLatLng.longitude,
      spokenMode === "normal" ? earlyAnnouncementThresholds(settings.distanceUnit) : [],
      // Progress along the route from the route matcher (heading-aware, continuous).
      navMatch
    );
    if (nextIndex !== activeStepIndex) setActiveStepIndex(nextIndex);
    if (arrived) {
      dispatchApproachRef.current({ type: "arrived", steps: route.steps });
      announcePhrase({ kind: "arrived" });
      const arrivedAt = navDestinationPlaceRef.current;
      setArrival((a) => a ?? { name: arrivedAt?.name ?? "Your destination", address: arrivedAt?.address ?? null, location: destinationLatLng, arrivedAtMs: Date.now() });
      recordTripEnd().catch(() => {});
      tripArrivedRef.current = true;
      // Settings > Privacy > Share arrivals (opt-in): an anonymous +1 for a named place.
      const place = lastDestinationPlaceRef.current;
      if (shareArrivalsRef.current && place && place.name) {
        recordArrival({ key: popularityKey(place.name, place.location.latitude, place.location.longitude), name: place.name, lat: place.location.latitude, lng: place.location.longitude });
      }
      lastDestinationPlaceRef.current = null;
    } else if (
      announcement &&
      voiceEnabled &&
      shouldSpeakStep(spokenMode, announcement.kind, announcement.step, announcement.isLastStep)
    ) {
      speakPlan(planStepAnnouncement(announcement, settings.distanceUnit, navLanguage), {
        voiceIdentifier: voiceIdentifierRef.current,
        volume: voiceVolumeRef.current,
      });
    }
  }, [
    navMatch,
    route,
    voiceEnabled,
    activeStepIndex,
    settings.spokenDirections,
    settings.distanceUnit,
    navLanguage,
    announcePhrase,
    destinationLatLng,
    navDestinationPlaceRef,
    guidanceLatLngRef,
    shareArrivalsRef,
    voiceIdentifierRef,
    voiceVolumeRef,
  ]);

  // A character voice is synthesized by the server one sentence at a time, which takes a moment
  // -- so the sentences for the next few turns are fetched as each step begins, and are already
  // on the phone when they're needed. Does nothing for any other kind of voice.
  useEffect(() => {
    if (!route || !voiceEnabled) return;
    prefetchUpcomingSpeech(route.steps, activeStepIndex, settings.distanceUnit, settings.spokenDirections, voiceIdentifier);
  }, [route, activeStepIndex, voiceEnabled, voiceIdentifier, settings.distanceUnit, settings.spokenDirections]);

  // Real, automatic reroute -- previously guidance (above) only ever advanced *forward* through
  // the existing route's own steps; if a turn/exit was missed entirely, the current step's end
  // point never got close (and the skip-ahead check inside evaluateGuidance only covers jumps
  // still roughly *along* the route), so guidance just sat frozen on the same stale instruction
  // forever with no recovery -- a real, confirmed dead end reported directly ("I've missed my
  // exit/street and it didn't reroute"). This instead measures live distance from the *route
  // line itself* (not just the next step's endpoint), which catches a genuinely wrong-direction
  // miss that forward-only step advancement can never detect.
  // Real, explicit spec value -- an alternate only replaces the primary reroute result (and
  // shows the "Faster route found" banner) if it's genuinely at least this much quicker, not
  // just noise between two very similar real options.
  const FASTER_ALTERNATE_THRESHOLD_SECONDS = 30;
  // Off-route detection lives in nav/rerouteTrigger.ts (unit- and drive-tested): 3 s / 50 m of
  // consistent evidence over 3+ fixes, poor-accuracy fixes ignored, wrong-way for 5 s, a missed
  // turn from the approach machine; debounced.
  const rerouteTriggerRef = useRef(INITIAL_REROUTE_TRIGGER);
  const lastRerouteAtRef = useRef(0);
  // Cancels a still-in-flight reroute request the instant a newer one fires -- per explicit
  // spec, so two off-route triggers close together (e.g. a missed turn immediately followed by
  // continuing to drift) can never have the OLDER request's response land after and overwrite
  // the newer, more-correct one.
  const rerouteAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!route || !navMatch || !currentLatLng || !destinationLatLng) {
      rerouteTriggerRef.current = { ...INITIAL_REROUTE_TRIGGER, lastRerouteMs: rerouteTriggerRef.current.lastRerouteMs };
      return;
    }
    const missedManoeuvre = missedManoeuvreRef.current;
    const t = rerouteTrigger(rerouteTriggerRef.current, {
      nowMs: Date.now(),
      match: navMatch,
      position: currentLatLng,
      missedManoeuvre,
      judging: approachRef.current.phase === "approach",
    });
    rerouteTriggerRef.current = t.state;
    const reason = t.reason;
    if (!reason) return;
    missedManoeuvreRef.current = false;
    const distMeters = navMatch.offRouteMeters ?? 0;
    lastRerouteAtRef.current = Date.now();
    rerouteAbortRef.current?.abort();
    const controller = new AbortController();
    rerouteAbortRef.current = controller;

    setRerouting(true);
    setFasterRouteBanner(null);
    announcePhrase({ kind: "rerouting" });
    const startedAt = Date.now();
    const oldEtaSeconds = route.durationInTrafficSeconds ?? route.durationSeconds;
    Sentry.logger.info("map: off-route detected, rerouting", { distMeters: Math.round(distMeters), reason });

    // Real, explicit request -- pass the driver's live heading to the routing engine so the
    // fresh route continues forward and loops around instead of an illegal U-turn (see
    // getHeadingAwareReroute's own header for exactly what Google's heading field does and
    // doesn't guarantee). Only the driving mode gets this treatment; walking/transit/bicycling
    // have no U-turn-legality concern worth the Routes API's extra cost, same as before.
    const rerouteStops = stopWaypointsLiveRef.current ?? [];
    const googleReroute = (): Promise<Route> => getHeadingAwareReroute(currentLatLng, destinationLatLng, heading, {
            ...avoidRouteOptions(settings.routeAvoid),
            waypoint: rerouteStops,
            signal: controller.signal,
          }).then(({ route: primary, alternates }) => {
            // Real, explicit request -- pick the genuinely lowest-ETA real alternative Google
            // offered (a real shortcut it found on its own, e.g. via a connector road), not just
            // the first result, and only surface the "found a faster route" banner when it's a
            // meaningfully real improvement (FASTER_ALTERNATE_THRESHOLD_SECONDS), not noise.
            let chosen = primary;
            let savedSeconds = 0;
            for (const alt of alternates) {
              const altEta = alt.durationInTrafficSeconds ?? alt.durationSeconds;
              const chosenEta = chosen.durationInTrafficSeconds ?? chosen.durationSeconds;
              if (altEta < chosenEta) {
                savedSeconds = chosenEta - altEta;
                chosen = alt;
              }
            }
            if (savedSeconds >= FASTER_ALTERNATE_THRESHOLD_SECONDS) {
              setFasterRouteBanner(`Faster route found — saves ${Math.round(savedSeconds / 60)} min`);
            }
            return chosen;
          });
    // Driving reroutes come from Mapbox (live traffic, Avoid settings, no U-turn where possible,
    // given up after ~2.5 s), with Google as the fallback.
    const fetchReroute = (): Promise<Route> =>
      travelMode !== "driving"
        ? getDirectionsForMode(currentLatLng, destinationLatLng, travelMode, rerouteStops)
        : mapboxRoutingAvailable()
          ? mapboxReroute(currentLatLng, destinationLatLng, heading, settings.routeAvoid, controller.signal, rerouteStops).catch((err) => {
              if (controller.signal.aborted) throw err;
              console.warn("[reroute] Mapbox failed, using Google", err);
              return googleReroute();
            })
          : googleReroute();
    // A dropped connection gets one more try a second later; the old route stays on screen and
    // keeps guiding meanwhile (it's only replaced when a new one arrives).
    const reroutePromise: Promise<Route> = fetchReroute().catch(
      (err) =>
        new Promise<Route>((resolve, reject) => {
          if (controller.signal.aborted) return reject(err);
          setTimeout(() => (controller.signal.aborted ? reject(err) : fetchReroute().then(resolve, reject)), 1000);
        })
    );

    reroutePromise
      .then((fresh) => {
        if (controller.signal.aborted) return;
        guidanceRef.current = createGuidanceState();
        setActiveStepIndex(0);
        dispatchApproachRef.current({ type: "rerouted" });
        setRoute(fresh);
        setAcceptedSuggestionOriginalRoute(null);
        setManoeuvreChip(null);
        // "Rerouting" was said when this started; now the new route's first instruction.
        const first = fresh.steps[0];
        if (first && navVoiceRef.current.enabled && navVoiceRef.current.mode !== "off") {
          speakPlan(
            planStepAnnouncement(
              { step: first, distanceMeters: remainingStepMeters(first, currentLatLng.latitude, currentLatLng.longitude), kind: "early" },
              settings.distanceUnit,
              navVoiceRef.current.language
            ),
            { voiceIdentifier: voiceIdentifierRef.current, volume: voiceVolumeRef.current },
            true
          );
        }
        // The driver is moving: stay in the follow view rather than jumping out to the whole route.
        // Real, explicit request -- logged every reroute (time, position, reason, old vs new
        // ETA) to the console in dev mode, never in a production build.
        if (__DEV__) {
          const elapsedMs = Date.now() - startedAt;
          console.log("[reroute]", {
            reason,
            elapsedMs,
            position: { latitude: currentLatLng.latitude, longitude: currentLatLng.longitude },
            oldEtaSeconds,
            newEtaSeconds: fresh.durationInTrafficSeconds ?? fresh.durationSeconds,
          });
          if (elapsedMs > 1500) {
            console.warn(`[reroute] took ${elapsedMs}ms, over the 1.5s target`);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        dispatchApproachRef.current({ type: "rerouteFailed" });
        // No connection (both tries failed to reach a server): say so, and keep the current route.
        const offline = /network|internet|offline|failed to fetch|timed? ?out|abort/i.test(String(err));
        if (offline) showManoeuvreChip("No connection — keep following the current road", "neutral", 6000);
        else setManoeuvreChip(null);
        console.warn("[map] reroute failed", err);
        Sentry.logger.error("map: reroute failed", { error: String(err) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRerouting(false);
      });
    // Runs on each matched fix; the trigger itself decides (and debounces).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMatch]);

  // EV Radar (Phase 6): start/stop siren detection with the map screen lifecycle -- mount-once
  // (deps: []), NOT re-keyed on location. It used to also depend on currentLatLng/user/
  // autoShareDetections, which meant the entire on-device audio ML pipeline (mic permission,
  // model load, audio session, recorder) got torn down and rebuilt from scratch on every GPS
  // update -- several times a minute while driving. Reads to those values only ever happen
  // inside the onDetection callback, which is why refs (updated every render, not causing a
  // re-run) are enough here -- there's no need for the effect itself to see fresh values.
  const currentLatLngRef = useLatest(currentLatLng);
  const userRef = useLatest(user);
  const autoShareDetectionsRef = useLatest(settings.autoShareDetections);
  // Trip history (trips/tripLog.ts, gap 17): a navigated trip is measured from the real GPS fixes
  // while it runs and saved on the phone when it ends (arrived or stopped). Off in Settings.
  const tripRecRef = useRef<TripRecorder | null>(null);
  const tripActive = !!route;
  const tripStartInfoRef = useLatest({ mode: travelMode as string, from: liveAddress, to: navDestinationPlace?.name ?? null, on: settings.tripHistory });
  useEffect(() => {
    if (tripActive && !tripRecRef.current) {
      const info = tripStartInfoRef.current;
      if (info.on) tripRecRef.current = new TripRecorder(Date.now(), { mode: info.mode, from: info.from, to: info.to });
    } else if (!tripActive && tripRecRef.current) {
      const trip = tripRecRef.current.finish(Date.now(), tripArrivedRef.current);
      tripRecRef.current = null;
      // Ready for the next trip.
      tripArrivedRef.current = false;
      if (trip) saveTrip(trip).catch((err) => console.warn("[trips] save failed", err));
    }
  }, [tripActive, tripStartInfoRef]);
  useEffect(() => {
    const rec = tripRecRef.current;
    if (!rec || !location) return;
    rec.onFix({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timeMs: location.timestamp,
      speedKmh: currentSpeedKmh,
      accuracyM: location.coords.accuracy ?? null,
      limitKmh: speedLimitKmh,
    });
    // One step per GPS fix; the other values are read for this fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.timestamp]);

  // Siren radar (nav/sirenRadar.ts): opt-in, listens only while driving (over 10 km/h, within
  // 2 min of it, or navigating). A heard siren gets its own banner at the top (one banner at a
  // time: the ahead banner waits) and the spoken line; once it's over and you've stopped, the
  // "Did you see an emergency vehicle or incident?" question.
  const [radarBanner, setRadarBanner] = useState<RadarBanner | null>(null);
  const [sirenQuestion, setSirenQuestion] = useState<PendingQuestion | null>(null);
  const [sirenAsking, setSirenAsking] = useState(false);
  const [sirenDraft, setSirenDraft] = useState<SirenDraft | null>(null);
  const [sirenLoudest, setSirenLoudest] = useState<LatLng | null>(null);
  const [radarBannerHeight, setRadarBannerHeight] = useState(0);
  const sirenTrailRef = useRef(new PositionTrail());
  const lastMovingAtRef = useRef<number | null>(null);
  const radarListeningRef = useRef(false);
  const announcePhraseRef = useLatest(announcePhrase);

  // Each fix: the trail (where was it loudest?) and whether we're still "driving".
  useEffect(() => {
    if (!currentLatLng) return;
    const now = location?.timestamp ?? Date.now();
    sirenTrailRef.current.push(now, currentLatLng);
    lastMovingAtRef.current = noteMoving(lastMovingAtRef.current, currentSpeedKmh, now);
    const listen = shouldListen({
      settingOn: settings.sirenRadar,
      speedKmh: currentSpeedKmh,
      navigating: isDriving(lastMovingAtRef.current, now, !!route && travelMode === "driving"),
      // iOS hands the microphone to a phone call, so nothing is heard during one.
      onCall: false,
      ownAudioLoud: false,
    });
    if (listen !== radarListeningRef.current) {
      radarListeningRef.current = listen;
      if (listen) sirenDetection.start();
      else sirenDetection.stop();
    }
    // Recomputed on each fix; the values above are read for this fix only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.timestamp, settings.sirenRadar, route, travelMode]);
  // Turned off in Settings: stop at once (there may be no new fix to notice it).
  useEffect(() => {
    if (settings.sirenRadar || !radarListeningRef.current) return;
    radarListeningRef.current = false;
    sirenDetection.stop();
  }, [settings.sirenRadar]);

  useEffect(() => {
    sirenDetection.setOwnAudioCheck(isNavSpeaking);
    const offEvents = sirenDetection.onEvent((ev) => {
      if (ev.kind === "start" || ev.kind === "update") {
        setRadarBanner({ type: ev.type, closeness: ev.closeness });
        if (ev.kind === "start") announcePhraseRef.current({ kind: "said", text: RADAR_SPOKEN });
      } else {
        setRadarBanner(null);
        setSirenQuestion({ endedAt: ev.at, type: ev.type, loudest: sirenTrailRef.current.at(ev.loudestAt) });
      }
    });
    // Auto-share (Settings, off by default) still files a report the moment a siren starts.
    const offDetect = sirenDetection.onDetection(async () => {
      const latLng = currentLatLngRef.current;
      const currentUser = userRef.current;
      if (autoShareDetectionsRef.current && latLng && currentUser) {
        try {
          await submitReport("emergency_vehicle", latLng, latLng, currentUser.uid, { customTtlMs: PASSING_TTL_MS, item: "emergencyVehicles" });
        } catch (err) {
          console.warn("[siren] auto-share detection failed", err);
        }
      }
    });
    return () => {
      offEvents();
      offDetect();
      radarListeningRef.current = false;
      sirenDetection.stop();
    };
  }, [announcePhraseRef, autoShareDetectionsRef, currentLatLngRef, userRef]);

  // The question: asked once you're under 10 km/h, within 10 min of the siren ending.
  useEffect(() => {
    if (!sirenQuestion || sirenAsking) return;
    const now = location?.timestamp ?? Date.now();
    if (questionExpired(sirenQuestion, now)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the question's 10 minutes ran out on this fix
      setSirenQuestion(null);
      return;
    }
    if (shouldAsk(sirenQuestion, now, currentSpeedKmh, false) && !placingAlert) setSirenAsking(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.timestamp, sirenQuestion, sirenAsking]);
  const onSirenNo = useCallback(() => {
    setSirenAsking(false);
    setSirenQuestion(null);
  }, []);

  // Live road view: what the camera is tracking right now, and your route ahead in the car's frame.
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("starting");
  const [liveVehicles, setLiveVehicles] = useState<SceneVehicle[]>([]);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const onLiveTracks = useCallback((tracks: CameraTrack[], frameWidth: number) => setLiveVehicles(sceneFromTracks(tracks, frameWidth)), []);
  const liveRoute = useMemo(
    () => (navGeo && navMatch && currentLatLng ? routeAhead(navGeo, navMatch.along, navMatch.snapped ?? currentLatLng, headingTrack.filter.shown ?? 0) : []),
    [navGeo, navMatch, currentLatLng, headingTrack.filter.shown]
  );

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
  // Fits every shown route into the map between the route-selection card and its sheet (the
  // map's padding is set to exactly that space while route selection is up), over 600ms.
  // Asks for the preview camera to fit these lines (all routes, or the one just picked) with the
  // start and destination. The fit itself happens in the effect further down, which also runs
  // again whenever the top card or the sheet changes size, so it always uses the real space.
  const [previewFit, setPreviewFit] = useState<{ lines: LatLng[][]; tick: number }>({ lines: [], tick: 0 });
  // An explicit fit (routes arrived, a route picked, mode or Avoid changed) re-enters ROUTE_PREVIEW
  // even after a pinch: you asked for it. Sheet / top-card size changes only refit while still in
  // ROUTE_PREVIEW, and location updates never do (permanent fix §3).
  const fitRoutesOnScreen = useCallback(
    (lines: LatLng[][]) => {
      camera.setMode("ROUTE_PREVIEW", false);
      setPreviewFit((f) => ({ lines, tick: f.tick + 1 }));
    },
    [camera]
  );

  const fetchRouteOptions = useCallback(
    // `avoidOverride`: an Avoid switch just flipped, so use the new choices without waiting for
    // the settings update to come back round. Otherwise the driver's saved Avoid choices.
    async (
      origin: LatLng,
      destination: LatLng,
      waypoint: Waypoints | undefined,
      mode: TravelMode,
      avoidOverride?: RouteAvoidPrefs
    ) => {
      // Belt-and-suspenders on top of DestinationSearchBar's own Keyboard.dismiss() in
      // selectPlace -- real, confirmed screenshot evidence of the "Choose a route" card coming
      // up with the keyboard still visible behind it. Every real caller of fetchRouteOptions is
      // about to show RouteOptionsCard (which has no text input of its own to want the keyboard
      // for), so dismissing here too costs nothing and closes the gap regardless of which exact
      // path a destination got picked through.
      Keyboard.dismiss();
      setLoadingRouteOptions(true);
      setRouteOptionsError(null);
      setRouteOfflineNote(null);
      try {
        if (mode === "driving") {
          const avoid = avoidOverride ?? settings.routeAvoid;
          // Side streets too (avoid highways), unless motorways are already avoided: Google's own
          // alternatives rarely include the back-street way round, so it was never on the list.
          const avoidOpts = avoidRouteOptions(avoid);
          const [all, side] = await Promise.all([
            getRouteChoices(origin, destination, { ...avoidOpts, waypoint }),
            avoidOpts.avoidHighways
              ? Promise.resolve<Route[]>([])
              : getRouteChoices(origin, destination, { ...avoidOpts, avoidHighways: true, waypoint }).catch(() => [] as Route[]),
          ]);
          if (!waypointList(waypoint).length) rememberRoutes(origin, destination, "", all).catch(() => {});
          const sideRoute: Route | null = side[0] ? { ...side[0], viaSideStreets: true } : null;
          const { routes: usable, allHaveUturns } = avoid.uturns ? withoutUturns(all) : { routes: all, allHaveUturns: false };
          const sideUsable = sideRoute && !(avoid.uturns && routeHasUturn(sideRoute)) ? sideRoute : null;
          const choices = withSideStreets(distinctRoutes(usable), sideUsable);
          setRouteChoices(choices);
          setSelectedChoiceIndex(0);
          setRouteAvoidNote(allHaveUturns ? "Every route here has a U-turn, so they're shown anyway." : null);
          setModeRoute(null);
          setModeRouteOptions([]);
          fitRoutesOnScreen(choices.map(detailedRoutePolyline));
          if (!autoGoArmedRef.current) {
            autoGoArmedRef.current = true;
            setAutoGoRunning(true);
          }
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
          setRouteChoices(null);
          setRouteAvoidNote(null);
          fitRoutesOnScreen(results.slice(0, 3).map(detailedRoutePolyline));
        }
      } catch (err) {
        Sentry.logger.error("map: failed to fetch route options", { error: String(err), mode });
        console.warn("[map] failed to fetch route options", err);
        // No connection: a route saved for this same trip still lets the drive start.
        const offline = mode === "driving" && !waypoint && isConnectionFailure(err);
        const saved = offline ? await savedRoutesFor(origin, destination).catch(() => null) : null;
        if (saved) {
          setRouteChoices(saved.routes);
          setSelectedChoiceIndex(0);
          setModeRoute(null);
          setModeRouteOptions([]);
          setRouteOfflineNote(`No internet. Using the route saved ${savedAgo(saved.savedAt)}; traffic isn't live.`);
          fitRoutesOnScreen(saved.routes.map(detailedRoutePolyline));
          return;
        }
        // Same underlying cause as the destination search billing check below -- the
        // Directions API call hits the exact same Google Cloud project/key, so it fails the
        // same way whenever billing isn't enabled there.
        setRouteOptionsError(
          offline ? "No internet, and no saved route to here from where you are. Routes you've looked at before work offline." : routeErrorText(err)
        );
      } finally {
        setLoadingRouteOptions(false);
      }
    },
    [fitRoutesOnScreen, settings.routeAvoid]
  );

  // ---- Travel modes (src/travel): Drive · Motorbike · Bike · Walk · Transit · Ferry ----
  // Drive and Transit keep the Google route choices above (traffic, tolls, timetables). Bike and
  // Walk come from Mapbox (Google if this build has no Mapbox token), Motorbike from Google's
  // TWO_WHEELER routing with a labelled car-road fallback, and Ferry is the real drive/transit
  // options that include a ferry leg. One cache per trip, 2 minutes.
  const [selectedMode, setSelectedMode] = useState<ModeId>("drive");
  const [modeSummaries, setModeSummaries] = useState<Partial<Record<ModeId, ModeSummary>>>({});
  const [modeResults, setModeResults] = useState<Partial<Record<ModeId, ModeRoutes>>>({});
  const [modeCache] = useState(
    () =>
      new ModeRouteCache((mode, req) =>
        fetchRoutesForMode(mode, req, {
          mapboxToken: usableMapboxToken(),
          googleKey: env.googleDirectionsApiKey,
          transit: (o, d) => getModeRouteOptions(o, d, "transit").catch(() => []),
          fallback: (mode, o, d) =>
            mode === "drive" ? getRouteChoices(o, d, {}).catch(() => []) : getModeRouteOptions(o, d, mode === "bike" ? "bicycling" : "walking").catch(() => []),
        })
      )
  );
  const routeTripRef = useRef(0);

  /** Routes for the chosen mode; remembers it as the last mode used. */
  const requestRoutes = useCallback(
    async (origin: LatLng, destination: LatLng, waypoint: Waypoints | undefined, requestedMode: ModeId, avoidOverride?: RouteAvoidPrefs, rememberMode = true) => {
      // Owner dashboard can switch the extra travel modes off: then it's Drive only.
      const mode: ModeId = travelModesOn ? requestedMode : ("drive" as ModeId);
      setSelectedMode(mode);
      // "Find my car" walks, but the next destination still starts in the mode you drive in.
      if (rememberMode && settings.lastTravelMode !== mode) updateSettings({ lastTravelMode: mode });
      const avoid = avoidOverride ?? settings.routeAvoid;
      const trip = ++routeTripRef.current;
      // Drive, Transit, and any trip with a stop: the Google flow (it handles waypoints).
      if (mode === "drive" || mode === "transit" || (waypointList(waypoint).length > 0 && mode !== "ferry")) {
        const navMode = MODE_NAVIGATES_AS[mode as Exclude<ModeId, "ferry">];
        setTravelMode(navMode);
        await fetchRouteOptions(origin, destination, waypoint, navMode, avoidOverride);
        return;
      }
      Keyboard.dismiss();
      setLoadingRouteOptions(true);
      setRouteOptionsError(null);
      try {
        const req = { origin, destination, avoid, region: deviceRegion() };
        const showModeRoutes = (routes: Route[], navMode: "walking" | "bicycling" | "transit") => {
          setTravelMode(navMode);
          setModeRouteOptions(routes);
          setSelectedModeRouteIndex(0);
          setModeRoute(routes[0]);
          setRouteChoices(null);
          setRouteAvoidNote(null);
          fitRoutesOnScreen(routes.slice(0, 3).map(detailedRoutePolyline));
        };
        const showDriveRoutes = (routes: Route[], note: string | null) => {
          setTravelMode("driving");
          const choices = distinctRoutes(routes);
          setRouteChoices(choices);
          setSelectedChoiceIndex(0);
          setRouteAvoidNote(note);
          setModeRoute(null);
          setModeRouteOptions([]);
          fitRoutesOnScreen(choices.map(detailedRoutePolyline));
        };
        if (mode === "ferry") {
          const [drive, transit] = await Promise.all([modeCache.get("drive", req), modeCache.get("transit", req)]);
          if (trip !== routeTripRef.current) return;
          const opts = ferryOptions({ drive: [...(routeChoices ?? []), ...drive.routes], transit: transit.routes });
          const byTransit = opts.filter((o) => o.mode === "transit").map((o) => o.route);
          const byDrive = opts.filter((o) => o.mode === "drive").map((o) => o.route);
          if (byTransit.length) showModeRoutes(byTransit, "transit");
          else if (byDrive.length) showDriveRoutes(byDrive, null);
          else setRouteOptionsError("No ferry on this trip");
          return;
        }
        const result = await modeCache.get(mode, req);
        if (trip !== routeTripRef.current) return;
        setModeResults((m) => ({ ...m, [mode]: result }));
        if (!result.routes.length) {
          setRouteOptionsError(result.unavailable ?? "No route for this mode");
          return;
        }
        if (mode === "motorbike") showDriveRoutes(result.routes, result.note);
        else showModeRoutes(result.routes, mode === "bike" ? "bicycling" : "walking");
      } finally {
        if (trip === routeTripRef.current) setLoadingRouteOptions(false);
      }
    },
    [fetchRouteOptions, fitRoutesOnScreen, settings.routeAvoid, settings.lastTravelMode, updateSettings, modeCache, routeChoices, travelModesOn]
  );

  // The icon row's times: the selected mode first, the others when the mode sheet opens.
  useEffect(() => {
    if (!modeSheetOpen || !pendingDestination || !routeOriginLatLng) return;
    let live = true;
    const req = { origin: routeOriginLatLng, destination: pendingDestination.location, avoid: settings.routeAvoid, region: deviceRegion() };
    const order = [selectedMode, ...MODE_ORDER.filter((m) => m !== selectedMode && m !== "ferry")].filter((m) => m !== "ferry");
    for (const m of order) {
      modeCache.get(m, req).then((r) => {
        if (!live) return;
        setModeResults((prev) => ({ ...prev, [m]: r }));
        setModeSummaries((prev) => ({ ...prev, [m]: { seconds: fastestSeconds(r), reason: r.unavailable } }));
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeSheetOpen, pendingDestination, routeOriginLatLng]);
  const ferryAvailable = ferryModeAvailable({
    drive: [...(routeChoices ?? []), ...(modeResults.drive?.routes ?? [])],
    transit: modeResults.transit?.routes ?? (travelMode === "transit" ? modeRouteOptions : []),
  });
  const ferrySummary: ModeSummary | undefined = ferryAvailable
    ? {
        seconds: Math.min(
          ...ferryOptions({ drive: [...(routeChoices ?? []), ...(modeResults.drive?.routes ?? [])], transit: modeResults.transit?.routes ?? [] }).map(
            (o) => o.route.durationInTrafficSeconds ?? o.route.durationSeconds
          )
        ),
        reason: null,
      }
    : undefined;

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
  // What Settings > Reports wants from OpenStreetMap (shown on the map or alerting). Keyed so
  // the fetches re-run only when that set changes, and a newly switched-on item is fetched.
  const osmWant = osmFetchWanted(settings);
  const osmWantKey = `${osmWant.trafficLights ? "t" : ""}${osmWant.speedCameras ? "s" : ""}|${osmWant.features.join(",")}`;
  const osmWantAny = osmWant.trafficLights || osmWant.speedCameras || osmWant.features.length > 0;
  const osmFetchOptions = useMemo(
    () => ({ wantTrafficLights: osmWant.trafficLights, wantSpeedCameras: osmWant.speedCameras, wantFeatures: osmWant.features }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [osmWantKey]
  );
  const lastOsmWantKeyRef = useRef(osmWantKey);
  useEffect(() => {
    if (lastOsmWantKeyRef.current === osmWantKey) return;
    lastOsmWantKeyRef.current = osmWantKey;
    osmInitialLoadRef.current = false;
  }, [osmWantKey]);
  useEffect(() => {
    if (lastOsmRadiusRef.current === settings.osmLayerRadiusKm) return;
    lastOsmRadiusRef.current = settings.osmLayerRadiusKm;
    osmInitialLoadRef.current = false;
  }, [settings.osmLayerRadiusKm]);
  useEffect(() => {
    if (!osmWantAny) {
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
    fetchOsmTrafficData(bounds, osmFetchOptions)
      .then(setOsmData)
      .catch((err) => console.warn("[map] initial OSM traffic layer fetch failed", err))
      .finally(() => setOsmLoading(false));
    // osmFetchOptions is keyed by osmWantKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLatLng, osmWantKey, settings.osmLayerRadiusKm]);

  // Min zoom before the fuel/restaurant/hotel viewport pin layer fetches at all -- same real
  // reasoning as OSM_LAYER_MAX_DELTA above (a zoomed-out view spans too wide an area for a
  // reasonable Overpass request), but a fixed value since there's no matching radius setting for
  // places the way there is for traffic lights/speed cameras. ~0.8 degrees of latitude is roughly
  // an entire metro region (~90km) -- wide enough to genuinely "zoom out and see everything
  // available" across a whole city, without the request ballooning to state/country scale.
  const PLACES_LAYER_MAX_DELTA = 0.8;

  // Real, narrower subset of OsmPoiCategory -- only the categories with their own dedicated
  // viewport pin-overlay state/clustering (see setFuelViewportPlaces et al below). "parking" is
  // a real, searchable OsmPoiCategory (ParkingSheet's own list), but doesn't have on-map pin
  // overlay wiring yet -- see NOTES.md's Phase 2 section for why that's honestly deferred rather
  // than faked. Kept distinct from OsmPoiCategory itself so adding a future search-only category
  // there never silently requires (or breaks) Record literals here.
  type ViewportPinCategory = "fuel" | "restaurant" | "hotel";

  type PlacesSetter = (places: NearbyPlace[]) => void;
  const placesCategorySetters = useMemo<Record<ViewportPinCategory, PlacesSetter>>(
    () => ({
      fuel: setFuelViewportPlaces,
      restaurant: setRestaurantViewportPlaces,
      hotel: setHotelViewportPlaces,
    }),
    []
  );
  // The petrol / food / hotel lists now come from Google Places with their own pins (the open
  // list's results, with price or brand under each). The OpenStreetMap viewport layer that used
  // to fill the map around them is no longer asked for, so the map doesn't show two sources.
  const openPlaceCategories = useMemo<ViewportPinCategory[]>(() => [], []);

  // Real, explicit request -- tapping a category chip (Fuel/Food/Hotels) should zoom the map out
  // to actually show the real nearby results it just fetched, Waze/Google-style, rather than
  // leaving the camera wherever it happened to already be and only showing pins that fall inside
  // that unrelated view by luck. fitCategories lists which of this call's categories just opened
  // for the first time (see the initial-load effect below, the only caller that passes it) --
  // the ambient pan-triggered re-fetch (onRegionChangeComplete) always omits it, so panning
  // around with a sheet already open never yanks the camera back out from under the driver.
  const fetchViewportPlaces = useCallback(
    (bounds: { sw: LatLng; ne: LatLng }, categories: ViewportPinCategory[], fitCategories: ViewportPinCategory[] = []) => {
      for (const category of categories) {
        fetchOsmPlacesInBounds(bounds, category)
          .then((places) => {
            placesCategorySetters[category](places);
            if (fitCategories.includes(category) && places.length > 0) {
              camera.fit("autoFocus", places.map((p) => p.location), {
                edgePadding: { top: 100, right: 60, bottom: 380, left: 60 },
                animated: true,
              });
            }
          })
          .catch((err) => console.warn(`[map] ${category} viewport fetch failed`, err));
      }
    },
    [placesCategorySetters, camera]
  );

  // Same real "initial load, independent of ever panning" fix as osmInitialLoadRef above --
  // without this, opening a places sheet for the first time (which starts at whatever delta the
  // map's initialRegion/last camera position happens to already be at) shows nothing on the map
  // until the driver manually pans or zooms even a pixel, since onRegionChangeComplete below only
  // fires on an actual region-change event. Tracked per category so opening, say, just the fuel
  // sheet doesn't also mark restaurant/hotel as "already loaded" the moment either of those
  // sheets is opened later.
  const placesInitialLoadRef = useRef<Record<ViewportPinCategory, boolean>>({
    fuel: false,
    restaurant: false,
    hotel: false,
  });
  useEffect(() => {
    if (!currentLatLng) return;
    const toFetch = openPlaceCategories.filter((category) => {
      if (placesInitialLoadRef.current[category]) return false;
      placesInitialLoadRef.current[category] = true;
      return true;
    });
    for (const category of (["fuel", "restaurant", "hotel"] as ViewportPinCategory[])) {
      if (!openPlaceCategories.includes(category)) placesInitialLoadRef.current[category] = false;
    }
    if (toFetch.length === 0) return;
    const delta = PLACES_LAYER_MAX_DELTA / 2;
    const bounds = {
      sw: { latitude: currentLatLng.latitude - delta / 2, longitude: currentLatLng.longitude - delta / 2 },
      ne: { latitude: currentLatLng.latitude + delta / 2, longitude: currentLatLng.longitude + delta / 2 },
    };
    fetchViewportPlaces(bounds, toFetch, toFetch);
  }, [currentLatLng, openPlaceCategories, fetchViewportPlaces]);

  const onRegionChangeComplete = useCallback(
    (region: Region, details?: { isGesture?: boolean }) => {
      lastRegionCenterRef.current = { latitude: region.latitude, longitude: region.longitude };
      // onPanDrag (see onMapPanDrag above) only fires for an actual translating drag -- a pure
      // two-finger twist-to-rotate or two-finger tilt, held in place with no panning, never
      // triggers it, so followTilt stayed true and the next GPS tick's chase-cam update
      // silently snapped heading back to GPS course almost immediately, making a manual rotate
      // feel like it "didn't take" or needed to be held to fight the snap-back. Google Maps'
      // native layer reports isGesture: true for *any* user-touch-driven camera change
      // (pan, pinch, rotate, tilt alike) as opposed to this app's own animateCamera calls, so
      // this catches the rotate-only case onPanDrag misses.
      // A pinch, twist or tilt is a gesture just as a drag is (onPanDrag only hears drags): FREE.
      if (details?.isGesture) camera.gesture();
      // The compass needle follows the map's real bearing, read back from the map itself.
      mapRef.current
        ?.getCamera()
        .then((camera) => mapBearing.set(camera.heading ?? 0))
        .catch(() => {});

      setOsmZoomDelta(region.latitudeDelta);
      // Only off a drive (the signs in view are a home-map thing); no extra renders while driving.
      if (!route) setViewCentre({ latitude: region.latitude, longitude: region.longitude });

      // Manual alert placement uses a fixed pin at the center of the screen and moves the map
      // underneath it instead of a draggable Marker (see onAlertTypeSelected above) -- so the
      // "drag" is really just keeping alertPlacementLatLng in sync with wherever the map
      // settles after every pan/pinch-zoom gesture.
      if (placingAlert) {
        setAlertPlacementLatLng({ latitude: region.latitude, longitude: region.longitude });
        // Real, explicit request -- auto-switch to overhead only once genuinely zoomed out past
        // ALERT_PLACEMENT_OVERHEAD_DELTA, and only restore the tilt on the way back in when THIS
        // auto-switch (not a manual eye-icon tap at a normal zoom) was what dropped it, so a
        // driver who deliberately chose overhead at a close zoom never gets fought back into the
        // tilted view just because they panned a little.
        const isZoomedOutPastThreshold = region.latitudeDelta > ALERT_PLACEMENT_OVERHEAD_DELTA;
        if (isZoomedOutPastThreshold && placementFrontView) {
          autoOverheadPlacementRef.current = true;
          setPlacementFrontView(false);
          camera.move("transition", { pitch: 0, heading: 0 }, { duration: 300 });
        } else if (!isZoomedOutPastThreshold && !placementFrontView && autoOverheadPlacementRef.current) {
          autoOverheadPlacementRef.current = false;
          setPlacementFrontView(true);
          camera.move("transition", { pitch: PLACEMENT_PITCH, heading }, { duration: 300 });
        }
      }

      // Same fixed-center-pin pattern as manual alert placement above, for the "choose starting
      // point" / "choose destination" pin pickers -- the pin view never moves, the map pans
      // underneath it, and this keeps the picked coordinate in sync every frame.
      if (pickingOrigin && originPickerView === "pin") {
        setOriginPinLatLng({ latitude: region.latitude, longitude: region.longitude });
      }
      if (pickingDestinationPoint && destinationPickerView === "pin") {
        setDestinationPinLatLng({ latitude: region.latitude, longitude: region.longitude });
      }

      // Real, explicit request -- "zoom out...display all that's available" for whichever of
      // fuel/restaurant/hotel sheets are currently open. Kept as its own independent block (not
      // nested under the traffic-light/speed-camera early-returns right below) so this still
      // runs regardless of whether that unrelated layer is toggled on.
      if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current);
      if (openPlaceCategories.length > 0 && region.latitudeDelta <= PLACES_LAYER_MAX_DELTA) {
        placesDebounceRef.current = setTimeout(() => {
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
          fetchViewportPlaces(bounds, openPlaceCategories);
        }, 600);
      }

      if (osmDebounceRef.current) clearTimeout(osmDebounceRef.current);
      if (!osmWantAny) {
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
        fetchOsmTrafficData(bounds, osmFetchOptions)
          .then(setOsmData)
          .catch((err) => console.warn("[map] OSM traffic layer fetch failed", err))
          .finally(() => setOsmLoading(false));
      }, 1200);
    },
    [
      OSM_LAYER_MAX_DELTA,
      placingAlert,
      pickingOrigin,
      originPickerView,
      pickingDestinationPoint,
      destinationPickerView,
      osmWantAny,
      osmFetchOptions,
      openPlaceCategories,
      fetchViewportPlaces,
      placementFrontView,
      heading,
      route,
      mapBearing,
      camera,
    ]
  );

  // De-duped against fuelStationPins (the sheet's own GPS-anchored nearest-N list, already
  // rendered below) by placeId -- the viewport fetch above covers the exact same real area plus
  // whatever's further out, so without this every station inside the GPS-anchored radius would
  // render twice (once from each source).
  const fuelViewportOnlyPins = useMemo(() => {
    const seen = new Set(fuelStationPins.map((p) => p.id));
    return fuelViewportPlaces.filter((p) => !seen.has(p.placeId));
  }, [fuelViewportPlaces, fuelStationPins]);

  // Same real lag fix as the traffic-light/speed-camera clustering below, applied to the
  // viewport place layers -- a dense area (a CBD food court block, a hotel strip) can put
  // 50-100+ pins on screen at once zoomed out, which is exactly the render-count problem
  // clustering already solves for OSM layers. NearbyPlace has nested location.lat/lng rather
  // than flat lat/lng, so each layer gets a small adapter into ClusterablePoint shape before
  // clustering, carrying the original place through so the single-pin render path still has
  // everything it needs (placeId, icon choice, onPress target).
  const fuelViewportClusters = useMemo(() => {
    if (fuelViewportOnlyPins.length === 0) return [];
    const points = fuelViewportOnlyPins.map((p) => ({
      id: p.placeId,
      lat: p.location.latitude,
      lng: p.location.longitude,
      place: p,
    }));
    const cellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);
    return clusterPoints(points, cellSizeDegrees);
  }, [fuelViewportOnlyPins, osmZoomDelta]);

  const restaurantViewportClusters = useMemo(() => {
    if (restaurantViewportPlaces.length === 0) return [];
    const points = restaurantViewportPlaces.map((p) => ({
      id: p.placeId,
      lat: p.location.latitude,
      lng: p.location.longitude,
      place: p,
    }));
    const cellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);
    return clusterPoints(points, cellSizeDegrees);
  }, [restaurantViewportPlaces, osmZoomDelta]);

  const hotelViewportClusters = useMemo(() => {
    if (hotelViewportPlaces.length === 0) return [];
    const points = hotelViewportPlaces.map((p) => ({
      id: p.placeId,
      lat: p.location.latitude,
      lng: p.location.longitude,
      place: p,
    }));
    const cellSizeDegrees = Math.max(osmZoomDelta / 30, 0.0012);
    return clusterPoints(points, cellSizeDegrees);
  }, [hotelViewportPlaces, osmZoomDelta]);

  const onPlaceClusterPress = useCallback((lat: number, lng: number) => {
    camera.region("focus", { latitude: lat, longitude: lng, latitudeDelta: osmZoomDelta / 4, longitudeDelta: osmZoomDelta / 4 }, 350);
  }, [osmZoomDelta, camera]);

  // Traffic-light nodes cluster into a single badge wherever they're too dense to render as
  // individual pins without lagging the map -- a real intersection cluster (several nodes,
  // one per approach/crossing) can put 10-20+ within a couple hundred meters, and a whole
  // suburb's worth within the radius setting can be several hundred.
  // Cell size scales with the current zoom (osmZoomDelta) so clusters split apart into their
  // real individual pins as the driver zooms in, floored so it never over-clusters at max zoom.

  const onTrafficLightClusterPress = useCallback((lat: number, lng: number) => {
    camera.region("focus", { latitude: lat, longitude: lng, latitudeDelta: osmZoomDelta / 4, longitudeDelta: osmZoomDelta / 4 }, 350);
  }, [osmZoomDelta, camera]);

  // Speed cameras used to render one native <Marker> per point unconditionally, on the
  // assumption they're "genuinely sparse (a handful per suburb at most)". Real confirmed
  // report from a wide "Traffic light & speed camera radius" setting (up to 200km, see
  // Settings): zoomed out over a whole region, that's a handful per suburb TIMES dozens of
  // suburbs in view at once -- hundreds of individual native marker views is exactly the kind
  // of render-count map lag the traffic-light clustering above already exists to prevent, so
  // speed cameras get the same treatment now instead of being the one layer still exempt from
  // it once a wide radius makes them dense too.

  const onSpeedCameraClusterPress = useCallback((lat: number, lng: number) => {
    camera.region("focus", { latitude: lat, longitude: lng, latitudeDelta: osmZoomDelta / 4, longitudeDelta: osmZoomDelta / 4 }, 350);
  }, [osmZoomDelta, camera]);

  // Real, confirmed bug this fixes: this used to run a Google Places "Nearby Search, ranked by
  // distance" lookup on EVERY raw map tap -- including a tap on an empty road, since Nearby
  // Search has no radius bound in rankby=distance mode and the old 120m sanity check is smaller
  // than the distance from most points on a city street to SOME real business. That's "tap a
  // road, get the nearest unrelated business's card," not "tap a business, see its info."
  // A plain map tap (road, empty land, water) now does nothing disruptive at all -- see
  // onPoiClick below for the real fix: react-native-maps' own onPoiClick event (available on
  // both platforms now that this screen explicitly uses PROVIDER_GOOGLE everywhere -- it
  // predates that switch, from when iOS used Apple's MapKit, which has no such event) fires only
  // for an actual tap on a real Google-rendered POI icon/footprint, carrying that business's own
  // real placeId directly -- no distance-guessing needed at all.

  // Real drive-time quick-check for whatever place PlaceInfoSheet is currently showing -- see
  // placeInfoEtaText's own comment. Keyed on the place's real placeId (not the whole object,
  // which is a fresh reference every fetch) so this doesn't re-fire on an unrelated re-render,
  // and guarded with a cancelled flag so a slow request for a place the driver already closed
  // can't overwrite the pill with a stale answer for a place no longer on screen.
  const placeInfoRef = useLatest(placeInfo);
  const placeInfoId = placeInfo?.placeId ?? null;
  useEffect(() => {
    const placeInfo = placeInfoRef.current;
    if (!placeInfo || !routeOriginLatLng) return;
    let cancelled = false;
    const placeId = placeInfo.placeId;
    getDirections(routeOriginLatLng, placeInfo.location, { useTraffic: true })
      .then((route) => {
        if (cancelled) return;
        setPlaceInfoEta({ placeId, text: route.etaInTrafficText ?? route.etaText });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[map] place ETA lookup failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [placeInfoId, routeOriginLatLng, placeInfoRef]);

  // Real Street View lookup, same cancellation-guarded pattern as the ETA effect above, kept as
  // its own independent request so a slow/failed Street View lookup never blocks or delays the
  // ETA pill or the rest of the place card.
  useEffect(() => {
    const placeInfo = placeInfoRef.current;
    if (!placeInfo) return;
    let cancelled = false;
    const placeId = placeInfo.placeId;
    getStreetViewUrl(placeInfo.location)
      .then((url) => {
        if (!cancelled) setPlaceInfoStreetView({ placeId, url });
      })
      .catch((err) => {
        if (!cancelled) console.warn("[map] street view lookup failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [placeInfoId, placeInfoRef]);

  // Real, confirmed bug this fixes: picking a destination (typing one in, or "find nearest
  // station") never closed the Restaurants/Hotels/Fuel sheets -- if any of those had been
  // opened via MapTopPillRow earlier in the same session, they stayed open and visible
  // underneath the new "Choose a route" flow (confirmed via real screenshot evidence: Hotels
  // AND Petrol stations both still rendered, stacked, behind the route-options card). Shared
  // here so every real "a destination/route flow is starting now" entry point closes all three
  // the same way onViewVenueDetails below already did for its own, narrower case.
  const closeAllPlaceSheets = useCallback(() => {
    restaurantsSheetRef.current?.close();
    hotelsSheetRef.current?.close();
    fuelStationsSheetRef.current?.close();
    parkingSheetRef.current?.close();
    parkingFiltersSheetRef.current?.close();
  }, []);

  // A new set of nearby results: zoom out smoothly to show them all (with you), Waze-style. Not
  // while driving a route, where the camera keeps following the car.
  const openListPins = fuelStationsSheetOpen ? fuelStationPins : restaurantsSheetOpen ? nearbyPins.food : hotelsSheetOpen ? nearbyPins.hotel : parkingSheetOpen ? nearbyPins.parking : null;
  const openListKey = openListPins && openListPins.length ? openListPins.map((p) => p.id).join("|") : "";
  const lastFitKeyRef = useRef("");
  useEffect(() => {
    if (!openListKey || route || openListKey === lastFitKeyRef.current || !openListPins) return;
    lastFitKeyRef.current = openListKey;
    const coords = openListPins.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (currentLatLng) coords.push(currentLatLng);
    camera.fit("autoFocus", coords, { edgePadding: { top: 120, right: 60, bottom: 420, left: 60 }, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the result ids only
  }, [openListKey, route]);

  // Real, shared category-chip handlers -- used by both MapToolsSheet's own rows (the "..."
  // menu) and the new Phase 2 "Where to?" sheet's Fuel/Food/Parking category chips, so there's
  // one real place each opens from rather than duplicated inline closures that could drift.
  // toolsSheetRef.current?.close() is a harmless no-op when that sheet isn't the caller.
  const onFindRestaurants = useCallback(() => {
    toolsSheetRef.current?.close();
    whereToSheetRef.current?.collapse();
    hotelsSheetRef.current?.close();
    fuelStationsSheetRef.current?.close();
    parkingSheetRef.current?.close();
    restaurantsSheetRef.current?.snapToIndex(0);
  }, []);
  const onFindHotels = useCallback(() => {
    toolsSheetRef.current?.close();
    whereToSheetRef.current?.collapse();
    restaurantsSheetRef.current?.close();
    fuelStationsSheetRef.current?.close();
    parkingSheetRef.current?.close();
    hotelsSheetRef.current?.snapToIndex(0);
  }, []);
  const onFindPetrol = useCallback(() => {
    toolsSheetRef.current?.close();
    whereToSheetRef.current?.collapse();
    restaurantsSheetRef.current?.close();
    hotelsSheetRef.current?.close();
    parkingSheetRef.current?.close();
    fuelStationsSheetRef.current?.snapToIndex(0);
  }, []);
  const onFindParking = useCallback(() => {
    toolsSheetRef.current?.close();
    whereToSheetRef.current?.collapse();
    restaurantsSheetRef.current?.close();
    hotelsSheetRef.current?.close();
    fuelStationsSheetRef.current?.close();
    parkingSheetRef.current?.snapToIndex(0);
  }, []);

  // Real, permanent belt-and-suspenders on top of every individual call site above (also on
  // onDestinationSelected/onFindNearestStation/onGetDirections/HotelsSheet+FuelStationsSheet's
  // own onSelect) already calling closeAllPlaceSheets -- rather than trust every CURRENT and
  // FUTURE way pendingDestination/route can become truthy to individually remember this, this
  // watches both directly and force-closes all three the instant either is set, no matter which
  // code path caused it. Redundant with the individual call sites on most paths (closing an
  // already-closed sheet is a harmless no-op), but it's the one guarantee that actually can't be
  // bypassed by a path this file doesn't know about yet.
  useEffect(() => {
    if (pendingDestination || route) closeAllPlaceSheets();
  }, [pendingDestination, route, closeAllPlaceSheets]);

  // Shared by RestaurantsSheet/HotelsSheet's own row taps -- opens the exact same real detail
  // sheet a map POI tap does (photos/rating/hours/phone/website/reviews, see PlaceInfoSheet),
  // straight off the placeId those lists already have (no distance-sanity-check needed here
  // the way onMapPress's own nearest-place guess needs one -- this placeId came directly from a
  // real Nearby Search result, not an inferred "closest thing to this coordinate").
  const onViewVenueDetails = useCallback((placeId: string) => {
    // Real, confirmed bug: fuel stations opened via FuelStationsSheet's own fallback rows landed
    // here too (same handler), but this never closed that sheet -- PlaceInfoSheet opened on top
    // of it still visible underneath, requiring a drag down to see the newly opened detail.
    closeAllPlaceSheets();
    setPlaceInfoLoading(true);
    // FuelStationsSheet/RestaurantsSheet/HotelsSheet now source from OpenStreetMap (see
    // osmPlaces.ts) -- an "osm:type:id" placeId isn't a real Google place_id, so Google's own
    // getPlaceInfo would just fail on it. Routed to the real OSM-backed equivalent instead.
    (isOsmPlaceId(placeId) ? getOsmPlaceInfo(placeId) : getPlaceInfo(placeId))
      .then((info) => {
        setPlaceInfo(info);
        placeInfoSheetRef.current?.expand();
      })
      .catch((err) => {
        console.warn("[map] venue detail lookup failed", err);
        Sentry.logger.error("map: venue detail lookup failed", { error: String(err) });
      })
      .finally(() => setPlaceInfoLoading(false));
  }, [closeAllPlaceSheets]);

  // A search result: show its place page, with the map moved onto it.
  const onPlaceChosen = useCallback(
    (place: PlaceDetails) => {
      closeAllPlaceSheets();
      whereToSheetRef.current?.collapse();
      setPlacePage(place);
      // The camera stops following the driver while the place is shown (the follow effect checks
      // placePage), and comes back to them when the page closes.
      camera.move("focus", { center: place.location, zoom: 16, heading: 0, pitch: 0 }, { duration: 500 });
      mapBearing.set(0);
    },
    [closeAllPlaceSheets, mapBearing, camera]
  );
  const closePlacePage = useCallback(() => {
    setPlacePage(null);
    // Closing the place page is Recentre: back to following you.
    camera.recentre();
    if (currentLatLng) {
      camera.move("recentre", { center: currentLatLng, heading: followHeadingRef.current, zoom: HOME_FOLLOW_ZOOM, pitch: DEFAULT_IDLE_PITCH }, { duration: 600 });
    }
  }, [currentLatLng, camera]);

  const onDestinationSelected = useCallback(
    (place: PlaceDetails) => {
      if (!routeOriginLatLng) return;
      closeAllPlaceSheets();
      setPendingDestination(place);
      setStops([]);
      // A fresh destination starts in the mode used last (Drive the first time). Ferry depends
      // on the trip, so it starts from Drive.
      const last = asModeId(settings.lastTravelMode);
      setModeSummaries({});
      setModeResults({});
      // Waze-match §3: driving opens as your vehicle (a motorcycle opens in Motorbike).
      const start = last === "ferry" || last === "drive" || last === "motorbike" ? vehicleMode(settings.vehicleType) : last;
      requestRoutes(routeOriginLatLng, place.location, undefined, start);
    },
    [routeOriginLatLng, requestRoutes, closeAllPlaceSheets, settings.lastTravelMode, settings.vehicleType]
  );

  // "Find my car": a walking route back to the parking spot (Walk mode, not remembered as the
  // mode for the next drive).
  const walkTo = useCallback(
    (place: PlaceDetails) => {
      if (!routeOriginLatLng) return;
      closeAllPlaceSheets();
      setPendingDestination(place);
      setStops([]);
      setModeSummaries({});
      setModeResults({});
      requestRoutes(routeOriginLatLng, place.location, undefined, travelModesOn ? "walk" : "drive", undefined, false);
    },
    [routeOriginLatLng, requestRoutes, closeAllPlaceSheets, travelModesOn]
  );
  const findMyCar = useCallback(
    (spot: ParkingSpot) => walkTo({ placeId: "parking", name: "Your car", address: spot.label, location: { latitude: spot.latitude, longitude: spot.longitude } }),
    [walkTo]
  );

  // Real, explicit request -- the Plan a Drive screen's own "Start" hand-off (see
  // PlanADriveScreen.tsx and RootNavigator.tsx's own comment on the Map screen's params). That
  // screen's search-to-destination picking is separate from this one's own internal state, so it
  // navigates back here with the picked place and this effect feeds it into the exact same real
  // onDestinationSelected flow a driver searching from the home map's own "Where to?" sheet
  // would hit -- never a separate/duplicated route-starting path. Cleared via setParams right
  // after so simply returning to Map normally afterward (closing the route picker, finishing the
  // trip) never re-triggers the same hand-off again.
  // The route preview opened from Plan a drive offers "Edit drive" instead of "Leave later".
  const [planDriveFor, setPlanDriveFor] = useState<PlaceDetails | null>(null);
  const fromPlanADrive = !!pendingDestination && planDriveFor === pendingDestination;

  useEffect(() => {
    const place = navRoute.params?.planADriveDestination;
    if (!place) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-off hand-off from another screen (navigation params), cleared straight after
    onDestinationSelected(place);
    setPlanDriveFor(place);
    navigation.setParams({ planADriveDestination: undefined });
  }, [navRoute.params?.planADriveDestination, onDestinationSelected, navigation]);

  // "Share drive" links (services/driveLink.ts): someone taps a shared link to a destination and
  // the app opens on it. Handled both when the link launches the app and when it arrives while
  // the app is already open. It goes through the very same hand-off as Plan a drive above --
  // navigate to this screen with the place as a param -- so it lands on the ordinary route
  // preview from wherever in the app the driver happened to be, and nothing starts by itself:
  // the driver still chooses a route and taps Start.
  useEffect(() => {
    const open = (url: string | null) => {
      const target = parseDriveLink(url);
      if (!target) return;
      navigation.navigate("Map", {
        planADriveDestination: {
          placeId: `shared:${target.latitude.toFixed(6)},${target.longitude.toFixed(6)}`,
          name: target.name,
          address: target.address,
          location: { latitude: target.latitude, longitude: target.longitude },
        },
      });
    };
    Linking.getInitialURL()
      .then(open)
      .catch(() => {});
    const subscription = Linking.addEventListener("url", (event) => open(event.url));
    return () => subscription.remove();
  }, [navigation]);

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
      closeAllPlaceSheets();
      setPendingDestination(station);
      setStops([]);
      requestRoutes(routeOriginLatLng, station.location, undefined, "walk");
    } catch (err) {
      console.warn("[map] find nearest station failed", err);
      Sentry.logger.error("map: find nearest station failed", { error: String(err) });
    } finally {
      setFindingNearestStation(false);
    }
  }, [routeOriginLatLng, requestRoutes, closeAllPlaceSheets]);

  const onStopSelected = useCallback(
    (place: PlaceDetails) => {
      if (!pendingDestination || !routeOriginLatLng) return;
      const next = addStop(stops, place);
      setStops(next);
      setPickingStop(false);
      requestRoutes(routeOriginLatLng, pendingDestination.location, stopPoints(next), selectedMode);
    },
    [pendingDestination, routeOriginLatLng, requestRoutes, selectedMode, stops]
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
  // Search along route (the bar's Search button) and the Routes button's alternatives.
  const [searchAlongOpen, setSearchAlongOpen] = useState(false);
  const [navAlternatives, setNavAlternatives] = useState<Route[] | null>(null);
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
  const [trafficSuggestionInfo, setTrafficSuggestionInfo] = useState<{ kind: ShortcutKind; road: string | null; slowAhead: boolean; arriveAtMs: number }>({
    kind: "alternative",
    road: null,
    slowAhead: false,
    arriveAtMs: 0,
  });
  // The route that was live right before a traffic suggestion was accepted -- kept around only
  // while driving the accepted suggestion, so "End suggested route" can put the driver straight
  // back on the exact route they started with, not just re-fetch a fresh one from scratch.
  const onStopSelectedDuringNav = useCallback(
    async (place: PlaceDetails) => {
      setAddingStopDuringNav(false);
      if (!currentLatLng || !destinationLatLng) return;
      setRerouting(true);
      try {
        const preview =
          travelMode === "driving"
            ? (
                await getRouteChoices(currentLatLng, destinationLatLng, {
                  ...avoidRouteOptions(settings.routeAvoid),
                  waypoint: [...(stopWaypointsLiveRef.current ?? []), place.location],
                })
              )[0]
            : await getDirectionsForMode(currentLatLng, destinationLatLng, travelMode, [...(stopWaypointsLiveRef.current ?? []), place.location]);
        setStopPreviewPlace(place);
        setStopPreviewRoute(preview);
        camera.fit("focus", preview.polyline, {
          edgePadding: { top: 120, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      } catch (err) {
        console.warn("[map] add stop preview failed", err);
        Sentry.logger.error("map: add stop preview failed", { error: String(err) });
        // It used to fail silently, which read as the search being stuck.
        showManoeuvreChip(`Couldn't add that stop: ${routeErrorText(err)}`, "neutral", 5000);
      } finally {
        setRerouting(false);
      }
    },
    [currentLatLng, destinationLatLng, travelMode, settings.routeAvoid, showManoeuvreChip, stopWaypointsLiveRef, camera]
  );

  const confirmStopPreview = useCallback(() => {
    if (!stopPreviewRoute || !stopPreviewPlace) return;
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setStops((prev) => addStop(prev, stopPreviewPlace));
    setRoute(stopPreviewRoute);
    setAcceptedSuggestionOriginalRoute(null);
    setStopPreviewRoute(null);
    setStopPreviewPlace(null);
    // Back to the drive: following again (the preview fit had left the camera FREE).
    camera.recentre();
  }, [stopPreviewRoute, stopPreviewPlace, camera]);

  // The "back" button, per explicit request -- discards the preview and returns to using
  // navigation exactly as it was, live route/puck/turn card untouched throughout.
  const cancelStopPreview = useCallback(() => {
    setStopPreviewRoute(null);
    setStopPreviewPlace(null);
    camera.recentre();
  }, [camera]);

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
  const stopWaypointsRef = useRef<LatLng[] | null>(null);
  // Also skips while any of these other route-editing flows are up -- a second green line
  // (this suggestion's) appearing on top of the add-stop preview's own green line, or while
  // actively placing an alert pin, would just be confusing overlap, not a helpful suggestion.
  const otherFlowActiveRef = useRef(false);
  // Kept in step after each render (the interval only reads them later).
  useEffect(() => {
    trafficSuggestionRouteRef.current = trafficSuggestionRoute;
    stopWaypointsRef.current = stopWaypoints;
    otherFlowActiveRef.current = !!stopPreviewRoute || addingStopDuringNav || placingAlert;
  }, [trafficSuggestionRoute, stopWaypoints, stopPreviewRoute, addingStopDuringNav, placingAlert]);
  const trafficCheckInFlightRef = useRef(false);
  const slowdownAheadRef = useRef(false);
  const trafficSuggestionDismissedAtRef = useRef(0);

  // Shortcuts (nav/shortcuts.ts has the root causes this fixes): every check, with no "is there a
  // jam in the next 1 km" gate, asks Google for (1) the live time of YOUR road, forced along it
  // with pass-through points, (2) Google's alternative routes and (3) the side-streets route,
  // then offers the one that leaves your road and saves the most, if it saves at least
  // minSavingFor(what's left). Slow traffic just ahead is read off your road's own live speeds.
  const routeAvoidRef = useLatest(settings.routeAvoid);
  const yourRoadEtaAtRef = useRef(0);
  useEffect(() => {
    if (!route || !destinationLatLng || travelMode !== "driving") return;
    const line = detailedRoutePolyline(route);
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
        const stop = stopWaypointsRef.current;
        const avoidOpts = avoidRouteOptions(routeAvoidRef.current);
        const ahead = routeAheadOf(line, latLng);
        const [yours, alts, side] = await Promise.all([
          getRouteThrough(latLng, destinationLatLng, throughPointsAhead(line, latLng, stop)),
          getRouteChoices(latLng, destinationLatLng, { ...avoidOpts, waypoint: stop ?? undefined }).catch(() => [] as Route[]),
          avoidOpts.avoidHighways
            ? Promise.resolve<Route[]>([])
            : getRouteChoices(latLng, destinationLatLng, { ...avoidOpts, avoidHighways: true, waypoint: stop ?? undefined }).catch(() => [] as Route[]),
        ]);
        const currentSeconds = routeSeconds(yours);
        setLiveEtaSeconds(currentSeconds);
        yourRoadEtaAtRef.current = Date.now();

        // Settings > Reports > Sudden slowdown: said once as slow traffic appears just ahead.
        const slowAhead = slowTrafficAhead(yours.polyline, yours.speedIntervals, NEAR_TERM_TRAFFIC_CHECK_METERS);
        const jamStarted = slowAhead && !slowdownAheadRef.current;
        slowdownAheadRef.current = slowAhead;
        if (jamStarted && alertsWhileDriving(reportSettingsRef.current, "suddenSlowdown")) announcePhrase({ kind: "slowdown" });

        const shortcut = pickShortcut({
          currentSeconds,
          currentAhead: ahead,
          candidates: [...alts, ...side.map((r) => ({ ...r, viaSideStreets: true }))],
        });
        if (shortcut) {
          setTrafficSuggestionRoute(shortcut.route);
          setTrafficSuggestionSavedSeconds(shortcut.savedSeconds);
          setTrafficSuggestionInfo({ kind: shortcut.kind, road: shortcut.road, slowAhead, arriveAtMs: Date.now() + routeSeconds(shortcut.route) * 1000 });
          if (slowAhead) announcePhrase({ kind: "heavyTraffic" });
        }
      } catch (err) {
        Sentry.logger.error("map: shortcut check failed", { error: String(err) });
      } finally {
        trafficCheckInFlightRef.current = false;
      }
    }, TRAFFIC_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [route, destinationLatLng, travelMode, announcePhrase, currentLatLngRef, reportSettingsRef, routeAvoidRef]);

  // Ahead alerts' live traffic (nav/ahead): your own road re-timed every 30 s (one request), so
  // "Heavy traffic ahead" follows conditions; the speeds come from that fresh route, projected onto
  // the route being driven. Also keeps the live ETA fresh.
  const [aheadLiveTraffic, setAheadLiveTraffic] = useState<{ forRoute: Route; polyline: LatLng[]; intervals: Route["speedIntervals"] } | null>(null);
  useEffect(() => {
    if (!route || !destinationLatLng || travelMode !== "driving") return;
    const line = detailedRoutePolyline(route);
    let cancelled = false;
    const refresh = async () => {
      const latLng = currentLatLngRef.current;
      if (!latLng || trafficCheckInFlightRef.current) return;
      try {
        const yours = await getRouteThrough(latLng, destinationLatLng, throughPointsAhead(line, latLng, stopWaypointsRef.current));
        if (cancelled) return;
        setAheadLiveTraffic({ forRoute: route, polyline: yours.polyline, intervals: yours.speedIntervals });
        setLiveEtaSeconds(routeSeconds(yours));
        yourRoadEtaAtRef.current = Date.now();
      } catch (err) {
        // The route's own traffic stays in use; nothing is guessed.
        Sentry.logger.warn("ahead: live traffic refresh failed", { error: String(err) });
      }
    };
    const interval = setInterval(refresh, AHEAD_TRAFFIC_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [route, destinationLatLng, travelMode, currentLatLngRef]);

  // Clears any stale suggestion the moment the underlying route is replaced for any other
  // reason (a real reroute, an add-stop confirm, exiting navigation) -- a suggestion computed
  // against the old route's remaining path would no longer mean anything once route changes.
  const [suggestionForRoute, setSuggestionForRoute] = useState(route);
  if (suggestionForRoute !== route) {
    setSuggestionForRoute(route);
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
  }

  // Real, explicit request: the headline ETA/arrival-time keeps re-syncing with live traffic
  // for the WHOLE trip, not just the figure Google returned once at route selection -- if
  // congestion ahead clears up, this is what makes the displayed minutes actually drop on its
  // own, instead of just counting down the original plan's per-step durations (which only ever
  // reflects progress through steps already passed, never a change in conditions on the road
  // still ahead). Separate from the traffic-reroute-suggestion effect above: that one asks "is
  // there a genuinely faster DIFFERENT path," this one only ever refreshes the live duration
  // for the SAME route the driver is already on. Reuses the same TRAFFIC_CHECK_INTERVAL_MS
  // cadence -- real traffic conditions don't meaningfully shift faster than that, and it's
  // already the proven cost/freshness tradeoff this screen uses for the sibling feature above.
  // Only meaningful for live-traffic-aware driving directions -- transit runs on its own
  // published schedule, and walking/biking have no real "traffic" signal to re-sync with.
  const liveEtaKey = `${travelMode}|${destinationLatLng?.latitude},${destinationLatLng?.longitude}`;
  const [liveEtaFor, setLiveEtaFor] = useState<{ route: Route | null; key: string }>({ route, key: liveEtaKey });
  if (liveEtaFor.route !== route || liveEtaFor.key !== liveEtaKey) {
    setLiveEtaFor({ route, key: liveEtaKey });
    setLiveEtaSeconds(null);
  }
  useEffect(() => {
    if (!route || !destinationLatLng || travelMode !== "driving") return;

    // Best-effort match to the path being driven: the same avoid options the route was chosen
    // with. A plain traffic-aware A->B request is a reasonable proxy for conditions along it.
    const profileOptions = avoidRouteOptions(settings.routeAvoid);

    let cancelled = false;
    const refresh = async () => {
      const latLng = currentLatLngRef.current;
      if (!latLng) return;
      // The shortcut check just timed your actual road: that's the better number, keep it.
      if (Date.now() - yourRoadEtaAtRef.current < TRAFFIC_CHECK_INTERVAL_MS / 2) return;
      try {
        const fresh = await getDirections(latLng, destinationLatLng, { ...profileOptions, useTraffic: true });
        if (!cancelled) setLiveEtaSeconds(fresh.durationInTrafficSeconds ?? fresh.durationSeconds);
      } catch (err) {
        // Best-effort -- a failed refresh just leaves the previous live reading (or the
        // original route's own static figure, if no live read has landed yet) on screen
        // rather than ever showing a broken/blank ETA.
        Sentry.logger.error("map: live ETA refresh failed", { error: String(err) });
      }
    };

    refresh();
    const interval = setInterval(refresh, TRAFFIC_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [route, destinationLatLng, travelMode, settings.routeAvoid, currentLatLngRef]);

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

  const shortcutTitle = useMemo(
    () =>
      shortcutText(
        { kind: trafficSuggestionInfo.kind, road: trafficSuggestionInfo.road, savedSeconds: trafficSuggestionSavedSeconds },
        formatArrivalClock(trafficSuggestionInfo.arriveAtMs)
      ),
    [trafficSuggestionInfo, trafficSuggestionSavedSeconds]
  );

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

  // Real removal of a mid-trip stop -- clears stopWaypoints and recomputes the route straight
  // to the original destination, the same real fetch this screen already does for adding one,
  // just without the waypoint.
  // Any change to the stops while driving (remove, reorder): a fresh route through the ones left.
  const applyStopsDuringNav = useCallback(async (next: TripStop[]) => {
    if (!currentLatLng || !destinationLatLng) return;
    setStops(next);
    const through = stopPoints(next);
    setRerouting(true);
    try {
      const fresh =
        travelMode === "driving"
          ? (await getRouteChoices(currentLatLng, destinationLatLng, { ...avoidRouteOptions(settings.routeAvoid), waypoint: through }))[0]
          : await getDirectionsForMode(currentLatLng, destinationLatLng, travelMode, through);
      guidanceRef.current = createGuidanceState();
      setActiveStepIndex(0);
      setRoute(fresh);
      setAcceptedSuggestionOriginalRoute(null);
      camera.fit("focus", fresh.polyline, {
        edgePadding: { top: 120, right: 60, bottom: 120, left: 60 },
        animated: true,
      });
    } catch (err) {
      console.warn("[map] changing stops during nav failed", err);
      Sentry.logger.error("map: changing stops during nav failed", { error: String(err) });
      showManoeuvreChip(`Couldn't change the stops: ${routeErrorText(err)}`, "neutral", 5000);
    } finally {
      setRerouting(false);
    }
  }, [currentLatLng, destinationLatLng, travelMode, settings.routeAvoid, showManoeuvreChip, camera]);
  // The bar's ✕: drops the next stop.
  const removeStopDuringNav = useCallback(() => {
    const next = stops.find((x) => !x.reached);
    if (next) applyStopsDuringNav(removeStop(stops, next.id));
  }, [stops, applyStopsDuringNav]);

  /** The vehicle pill / Getting there sheet: switch vehicle and re-request the routes. */
  const onSelectVehicle = useCallback(
    (v: VehicleType) => {
      void updateSettings(vehiclePatch(settings, v));
      const mode = vehicleMode(v);
      if (pendingDestination && routeOriginLatLng) requestRoutes(routeOriginLatLng, pendingDestination.location, stopWaypoints ?? undefined, mode);
      else setSelectedMode(mode);
    },
    [settings, updateSettings, pendingDestination, routeOriginLatLng, stopWaypoints, requestRoutes]
  );

  const onSelectTravelMode = useCallback(
    (mode: ModeId) => {
      // Picking Motorbike / Drive here is picking your vehicle too (Waze-match §3).
      const v = vehicleForMode(mode, settings.vehicleType);
      if (v && v !== settings.vehicleType) void updateSettings(vehiclePatch(settings, v));
      // From/To and the stop stay as they are; only the mode changes.
      if (pendingDestination && routeOriginLatLng) {
        requestRoutes(routeOriginLatLng, pendingDestination.location, stopWaypoints ?? undefined, mode);
      } else setSelectedMode(mode);
    },
    [pendingDestination, stopWaypoints, routeOriginLatLng, requestRoutes, settings, updateSettings]
  );

  // Tapping a route (its line, its bubble, or its row) selects it; tapping the selected one
  // again fits every route back on screen.
  const onSelectChoice = useCallback(
    (index: number) => {
      if (!routeChoices) return;
      // The picked route is fitted (the others stay drawn, faded); picking it again shows them all.
      if (index === selectedChoiceIndex) fitRoutesOnScreen(routeChoices.map(detailedRoutePolyline));
      else if (routeChoices[index]) fitRoutesOnScreen([detailedRoutePolyline(routeChoices[index])]);
      setSelectedChoiceIndex(index);
    },
    [routeChoices, selectedChoiceIndex, fitRoutesOnScreen]
  );

  // Same "reselecting the highlighted one re-fits the camera" gesture as onSelectChoice above,
  // applied to the real Google alternatives list for walking/bicycling/transit.
  const onSelectModeRoute = useCallback(
    (index: number) => {
      const reselectingSame = index === selectedModeRouteIndex;
      setSelectedModeRouteIndex(index);
      const picked = modeRouteOptions[index];
      if (picked) setModeRoute(picked);
      if (!reselectingSame || !picked) return;
      fitRoutesOnScreen(modeRouteOptions.slice(0, 3).map(detailedRoutePolyline));
    },
    [modeRouteOptions, selectedModeRouteIndex, fitRoutesOnScreen]
  );

  // Real, shared commit logic -- extracted from confirmRoute (the RouteOptionsCard "Start"
  // button) so a second real entry point (onQuickStartFromPlace below, the place card's own
  // "Start" quick action) can start navigation on an explicit, already-resolved route/
  // destination pair without needing routeOptions/selectedProfile/pendingDestination state to
  // have gone through the full picker flow first -- it takes both as real parameters instead of
  // reading them off state, so there's no race with whatever just resolved them.
  const startRoute = useCallback(
    (chosen: Route, destination: PlaceDetails) => {
      guidanceRef.current = createGuidanceState();
      setActiveStepIndex(0);
      setRoute(chosen);
      announcePhrase({ kind: "start" });
      // Real Tracky auto-mood driving-streak tracker -- the one real "a trip actually started
      // today" signal (see trackyMood.ts's own header). Fire-and-forget: never blocks/affects
      // the real navigation start below.
      recordDriveToday().catch(() => {});
      setAcceptedSuggestionOriginalRoute(null);
      setDestinationLatLng(destination.location);
      // Keep this exact route for an offline start next time, and fetch the map tiles along it
      // so the map still draws if the signal drops on the way.
      if (currentLatLng) rememberRoutes(currentLatLng, destination.location, destination.name, [chosen]).catch(() => {});
      downloadRouteArea(chosen.polyline).catch(() => {});
      // Real native Live Activity (see modules/liveActivity) -- starts the moment a trip
      // actually begins, per explicit request to keep navigating visible on the Lock Screen/
      // Dynamic Island once the driver leaves the app. iOS-only and a safe no-op everywhere else
      // (Android, an unsupported OS version, or the user has Live Activities off in Settings) --
      // see the module's own isSupported()/try-catch guards. The first real content follows a
      // moment later from the guidance effect below, once activeStep/etaText are actually
      // available for this fresh route; this call only needs a destination name and a
      // placeholder first line.
      // Android: the same, as an ongoing notification (services/navNotification.ts).
      startNavNotification(destination.name, {
        instruction: chosen.steps[0]?.instruction ?? "Starting navigation",
        distanceText: chosen.distanceText,
        etaText: chosen.etaInTrafficText ?? chosen.etaText,
        roadName: "",
      });
      startLiveActivity(destination.name, {
        instruction: chosen.steps[0]?.instruction ?? "Starting navigation",
        maneuverSymbol: maneuverToSfSymbol(chosen.steps[0]?.maneuver),
        distanceText: chosen.distanceText,
        etaText: chosen.etaInTrafficText ?? chosen.etaText,
        roadName: "",
        currentSpeedKmh: null,
        speedLimitKmh: null,
      });
      // Permanent fix §2/§4: starting navigation is one of the two ways into following -- and it
      // starts facing the road: the route segment you're on, not the parked GPS course/compass.
      camera.setMode("NAV_FOLLOW", true);
      // Real, explicit request -- go DIRECTLY into the Waze-style tilted close-follow view the
      // instant Start is tapped, no flat/overhead "see the whole route" flash first. Previously
      // this called fitToCoordinates (an un-tilted whole-route-bounds fit) and the real chase-
      // cam pose was deliberately held off for another 1200ms+700ms (see chaseCamAppliedRef's
      // effect below, now ungated) -- a confirmed ~1-2s window where the camera didn't look like
      // nav mode at all. Mirrors the exact same pitch/zoom the chase-cam effect below applies
      // for a fresh session, so there's no visible pose change once that effect's own (now
      // immediate) re-application runs.
      if (currentLatLng) {
        const isFlatViewStyle = settings.defaultMapViewStyle === "flat";
        const startBearing = navCameraBearing({
          keepNorthUp: settings.keepNorthUp,
          navNorthUp: false,
          roadBearing: navStartBearing(chosen.polyline, currentLatLng),
          heading,
        });
        camera.move("transition", navFollowPose(currentLatLng, startBearing, currentSpeedKmhRef.current, isFlatViewStyle), { duration: NAV_START_MS });
        mapBearing.set(startBearing);
      }
      setRouteChoices(null);
      setAutoGoRunning(false);
      autoGoArmedRef.current = false;
      setModeRoute(null);
      setModeRouteOptions([]);
      setPendingDestination(null);
      // Live navigation always tracks real GPS from here on (see routeOriginLatLng's own
      // comment) -- clears any custom "From" so it doesn't silently carry over into the next,
      // unrelated destination search once this trip ends.
      setOriginOverride(null);
      // Navigate on Mapbox's version of the picked route, so the lanes, exits and junction views
      // match the line drawn. The drive starts at once on the picked route and switches over as
      // soon as Mapbox answers (normally well before the first manoeuvre); if it can't, the
      // picked route simply carries on.
      if (travelMode === "driving" && chosen.source !== "mapbox" && currentLatLng && mapboxRoutingAvailable()) {
        mapboxRouteForChoice(chosen, currentLatLng, destination.location, settings.routeAvoid, heading, stopWaypointsLiveRef.current ?? [])
          .then((navRoute) => {
            if (!navRoute || routeRef.current !== chosen) return; // ended or changed meanwhile
            guidanceRef.current = createGuidanceState();
            setActiveStepIndex(0);
            setRoute(navRoute);
          })
          .catch((err) => console.warn("[nav] Mapbox route unavailable, staying on the picked route", err));
      }
    },
    [currentLatLng, heading, travelMode, settings.defaultMapViewStyle, settings.keepNorthUp, settings.routeAvoid, announcePhrase, currentSpeedKmhRef, stopWaypointsLiveRef, camera, mapBearing]
  );

  // Development builds: Settings › Developer › test drives start a recorded motorway drive here
  // (navigation on the recorded route, the simulated car on its own track).
  useEffect(() => {
    if (!__DEV__) return;
    return onTestDriveRequested((kind) => {
      const drive = testDrive(kind);
      stopSimulatedDrive();
      startRoute(drive.route, { placeId: `test-drive:${kind}`, name: drive.destination.name, address: "", location: drive.destination.location });
      startSimulatedDrive(drive.track, drive.speedKmh);
    });
  }, [startRoute]);

  const confirmRoute = useCallback(() => {
    const chosen = travelMode === "driving" ? routeChoices?.[selectedChoiceIndex] : modeRoute;
    if (!chosen || !pendingDestination) return;
    startRoute(chosen, pendingDestination);
  }, [routeChoices, modeRoute, travelMode, selectedChoiceIndex, pendingDestination, startRoute]);

  // Real, explicit request -- a one-tap "Start" quick action directly on the place card
  // (PlaceInfoSheet), matching Apple/Google Maps' own place-card "Start" button: fetches the
  // real recommended driving route from the current origin and begins navigating immediately,
  // skipping the full "Choose a route" picker for a driver who just wants to go. "Directions"
  // on that same card still goes through the real picker (routeOptions/alternatives/tolls) --
  // this is a second, faster real entry point, not a replacement.
  const onQuickStartFromPlace = useCallback(
    async (place: PlaceInfo) => {
      const origin = routeOriginLatLng;
      if (!origin) return;
      placeInfoSheetRef.current?.close();
      try {
        const choices = await getRouteChoices(origin, place.location, {
          ...avoidRouteOptions(settings.routeAvoid),
          waypoint: stopWaypoints ?? undefined,
        });
        startRoute(choices[0], place);
      } catch (err) {
        console.warn("[map] quick-start route fetch failed", err);
        Sentry.logger.error("map: quick-start route fetch failed", { error: String(err) });
        setBannerMessage(`Couldn't start navigation: ${routeErrorText(err)}`);
        setBannerVisible(true);
      }
    },
    [routeOriginLatLng, stopWaypoints, startRoute, settings.routeAvoid]
  );

  const cancelRouteOptions = useCallback(() => {
    setRouteChoices(null);
    setRouteAvoidNote(null);
    setAutoGoRunning(false);
    autoGoArmedRef.current = false;
    setAvoidSheetOpen(false);
    setModeSheetOpen(false);
    setModeRoute(null);
    setModeRouteOptions([]);
    setPendingDestination(null);
    setStops([]);
    setPickingStop(false);
    setRouteOptionsError(null);
    setTravelMode("driving");
    setOriginOverride(null);
  }, []);

  // ---- Route selection: what the list, the map lines and the time bubbles show ----
  const selectionRoutes = useMemo<Route[]>(
    () => (travelMode === "driving" ? routeChoices ?? [] : modeRouteOptions),
    [travelMode, routeChoices, modeRouteOptions]
  );
  const selectionIndex = travelMode === "driving" ? selectedChoiceIndex : selectedModeRouteIndex;
  const selectionTags = useMemo<(string | null)[]>(
    () => (travelMode === "driving" ? routeTags(selectionRoutes) : selectionRoutes.map((_, i) => (i === 0 ? "Best" : null))),
    [travelMode, selectionRoutes]
  );
  const selectionRows = useMemo<RouteChoiceRow[]>(
    () =>
      selectionRoutes.map((r, i) => {
        const tag = selectionTags[i] ?? null;
        let subtitle: string;
        let subtitleParts: RouteSummaryParts | undefined;
        if (travelMode === "driving") {
          const hasToll = r.tollEstimate?.hasToll === true;
          const price = hasToll ? r.tollEstimate?.priceText : null;
          const routeTag = tag as Parameters<typeof routeSummaryLine>[0];
          const ferry = ferryBadge(r);
          subtitle = routeSummaryLine(routeTag, trafficLevel(r), hasToll) + (price ? ` ${price}` : "") + (ferry ? ` · ${ferry}` : "");
          const parts = routeSummaryParts(routeTag, trafficLevel(r), hasToll);
          subtitleParts = { ...parts, tail: parts.tail + (price ? ` ${price}` : "") + (ferry ? ` · ${ferry}` : "") };
        } else if (travelMode === "transit") {
          const firstLeg = r.transitSummary?.legs[0];
          const transfers = r.transitSummary?.transfers ?? 0;
          subtitle =
            (firstLeg?.departureText ? `Departs ${firstLeg.departureText}` : "Timetabled") +
            (transfers > 0 ? ` · ${transfers} transfer${transfers > 1 ? "s" : ""}` : "");
        } else {
          subtitle = i === 0 ? "Best route" : "Alternative route";
        }
        return {
          key: `${travelMode}-${i}-${r.distanceMeters}-${Math.round(routeSeconds(r))}`,
          timeText: formatRouteDuration(routeSeconds(r)),
          distanceText: formatDistance(r.distanceMeters, settings.distanceUnit),
          title: travelMode === "transit" ? transitRouteTitle(r) : (viaText(r.steps, r.source) ?? viaRoadLabel(r.summary)),
          subtitle,
          subtitleParts,
        };
      }),
    [selectionRoutes, selectionTags, travelMode, settings.distanceUnit]
  );
  // Trip details (transit timeline, fare / Opal, ferry details) with live/late from TfNSW.
  const [tripDetails, setTripDetails] = useState<{ open: boolean; realtime: (Realtime | null)[]; note: string | null }>({ open: false, realtime: [], note: null });
  const openTripDetails = useCallback(() => {
    const r = selectionRoutes[selectionIndex];
    setTripDetails({ open: true, realtime: [], note: null });
    if (!r?.transitSummary) return;
    fetchTransitRealtime(r).then(({ configured, realtime }) =>
      setTripDetails((t) => ({ ...t, realtime, note: configured ? null : "Times are the timetable: live times need the Transport for NSW key on the server." }))
    );
  }, [selectionRoutes, selectionIndex]);

  // The lines drawn: the first few routes plus the selected one, each with its index in the list.
  const drawnSelection = useMemo(() => {
    const indices = selectionRoutes.map((_, i) => i).filter((i) => i < MAX_DRAWN_ROUTES || i === selectionIndex);
    return indices.map((index) => ({ index, line: detailedRoutePolyline(selectionRoutes[index]) }));
  }, [selectionRoutes, selectionIndex]);
  // Placed on screen, not just on the ground: inside the area the camera fits the routes into
  // (the top card and the sheet's current height left out) and never on top of each other.
  const selectionBubbleAnchors = useMemo(() => {
    const lines = drawnSelection.map((d) => d.line);
    const selectedPos = Math.max(0, drawnSelection.findIndex((d) => d.index === selectionIndex));
    const fitLines = previewFit.lines.length ? previewFit.lines : lines;
    return screenBubbleAnchors(
      lines,
      selectedPos,
      previewFitCoordinates(fitLines, routeOriginLatLng, pendingDestination?.location ?? null),
      { width: windowWidth, height: windowHeight },
      previewEdgePadding(routeTopCardBottom, routeSheetHeight),
      undefined,
      undefined,
      // Each bubble's real size: its own time text, and the selected one is taller (its tag line).
      drawnSelection.map((d) => bubbleSize(selectionRows[d.index]?.timeText ?? "", d.index === selectionIndex))
    );
  }, [drawnSelection, selectionIndex, selectionRows, previewFit, routeOriginLatLng, pendingDestination, windowWidth, windowHeight, routeTopCardBottom, routeSheetHeight]);
  const selectedSelectionLine = drawnSelection.find((d) => d.index === selectionIndex)?.line ?? null;
  const selectedTrafficStretches = useMemo(() => {
    const r = selectionRoutes[selectionIndex];
    return r ? trafficStretches(r.polyline, r.speedIntervals) : [];
  }, [selectionRoutes, selectionIndex]);

  const onSelectRouteRow = useCallback(
    (index: number) => {
      if (travelMode === "driving") onSelectChoice(index);
      else onSelectModeRoute(index);
    },
    [travelMode, onSelectChoice, onSelectModeRoute]
  );

  const stopAutoGo = useCallback(() => setAutoGoRunning(false), []);

  const goNowFromRouteSelection = useCallback(() => {
    setAutoGoRunning(false);
    confirmRoute();
  }, [confirmRoute]);

  // Leave later: Plan a drive, with this destination already filled in.
  const leaveLaterFromRouteSelection = useCallback(() => {
    if (!pendingDestination) return;
    setAutoGoRunning(false);
    navigation.navigate("PlanADrive", { initialDestination: pendingDestination });
  }, [pendingDestination, navigation]);

  // The destination row goes back to the full search. The search lives in the "Where to?"
  // sheet, which mounts again once route selection closes -- so it's opened just after.
  const editDestinationFromRouteSelection = useCallback(() => {
    cancelRouteOptions();
    setTimeout(() => whereToSheetRef.current?.openSearch(), 250);
  }, [cancelRouteOptions]);

  // An Avoid switch: remembered, and the routes are asked for again straight away.
  const onToggleAvoid = useCallback(
    (key: RouteAvoidKey, value: boolean) => {
      const next = { ...settings.routeAvoid, [key]: value };
      updateSettings({ routeAvoid: next });
      if (travelMode === "driving" && pendingDestination && routeOriginLatLng) {
        requestRoutes(routeOriginLatLng, pendingDestination.location, stopWaypoints ?? undefined, selectedMode, next);
      }
    },
    [settings.routeAvoid, updateSettings, travelMode, pendingDestination, routeOriginLatLng, stopWaypoints, requestRoutes, selectedMode]
  );

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
        if (origin) requestRoutes(origin, pendingDestination.location, stopWaypoints ?? undefined, selectedMode);
      }
    },
    [pendingDestination, stopWaypoints, selectedMode, currentLatLng, requestRoutes]
  );

  // Real, explicit request -- a real swap button (like Apple/Google Maps) that flips the
  // current origin and destination in place, re-fetching routes for the flipped trip instead of
  // requiring the driver to re-search either end by hand. The old destination becomes the real
  // new origin override directly (it's already a full PlaceDetails). The old origin has no
  // PlaceDetails object of its own when it's just live GPS (originOverride is null in that
  // case) -- synthesized here the same way confirmOriginPin already synthesizes one for a
  // dropped pin, using the real current coordinate and liveAddress reverse-geocoded label.
  const onSwapOriginDestination = useCallback(() => {
    if (!pendingDestination || !routeOriginLatLng) return;
    const currentOriginPlace: PlaceDetails =
      originOverride ?? {
        placeId: `live:${routeOriginLatLng.latitude.toFixed(6)},${routeOriginLatLng.longitude.toFixed(6)}`,
        name: liveAddress ?? "My Location",
        address: liveAddress ?? "My Location",
        location: routeOriginLatLng,
      };
    const newOrigin = pendingDestination;
    const newDestination = currentOriginPlace;
    setOriginOverride(newOrigin);
    setPendingDestination(newDestination);
    requestRoutes(newOrigin.location, newDestination.location, stopWaypoints ?? undefined, selectedMode);
  }, [pendingDestination, routeOriginLatLng, originOverride, liveAddress, stopWaypoints, selectedMode, requestRoutes]);

  // Real, explicit request: "choose starting point" opens straight into the pin-drop picker
  // (below), seeded from wherever the current origin already is (a previously custom-picked
  // point, or live GPS) so the fixed pin starts exactly where the driver would expect their
  // current starting point to be, not somewhere unrelated. Both real entry points (the idle
  // panel's own "From" row, and the route-options card's "From" row once a destination is
  // already picked) now go through this single opener instead of setting pickingOrigin directly.
  const openOriginPicker = useCallback(() => {
    const seed = originOverride?.location ?? currentLatLng ?? null;
    setOriginPinLatLng(seed);
    setOriginPinAddress(originOverride?.name ?? liveAddress ?? null);
    setOriginPickerView("pin");
    setPickingOrigin(true);
    if (seed) {
      camera.region("focus", { ...seed, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
    }
  }, [originOverride, currentLatLng, liveAddress, camera]);

  // Search icon on the pin picker -- exits pin-dragging in favor of typing an address instead,
  // without closing the whole "choose starting point" flow outright.
  const switchOriginToSearch = useCallback(() => {
    setOriginPickerView("search");
  }, []);

  // Real, explicit request: picking a result from search should drop the pin there and let the
  // driver keep fine-tuning it (drag the map, then confirm with Set) -- the same real "search a
  // place, then nudge the pin" flow Apple/Google Maps both use -- rather than immediately
  // committing the moment a search result is tapped (what this used to do, by going straight
  // through onOriginSelected -- the exact same function Set itself calls). Switches back to the
  // pin view with the picked place's own real coordinate/address already filled in, so Set is
  // now just confirming whatever's actually on screen, exactly like a manually-dragged pin.
  const onOriginSearchPickedForPin = useCallback(
    (place: PlaceDetails) => {
      // "My Location" has no real fine-tuning to do -- it IS the live position, and committing
      // it immediately also preserves its real "go back to following live GPS" meaning (see
      // onOriginSelected's own MY_LOCATION_PLACE_ID check), which routing it through the pin
      // flow first would otherwise lose (confirmOriginPin always builds a fresh "dropped pin"
      // PlaceDetails from whatever coordinate is on screen, with no way back to that sentinel).
      if (place.placeId === MY_LOCATION_PLACE_ID) {
        onOriginSelected(place);
        return;
      }
      setOriginPinLatLng(place.location);
      setOriginPinAddress(place.address);
      setOriginPickerView("pin");
      camera.region("focus", { ...place.location, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
    },
    [onOriginSelected, camera]
  );

  // A true, full exit of the "choose starting point" flow -- reached from the search view's own
  // (X), which fully backs out rather than switching views again.
  const cancelOriginPicker = useCallback(() => {
    setPickingOrigin(false);
    setOriginPinLatLng(null);
    setOriginPinAddress(null);
  }, []);

  // "Set" on the pin picker -- commits the pinned point as the real starting point via the exact
  // same onOriginSelected path the search flow already used (so a route already in progress
  // re-fetches against it identically), then, per explicit request, automatically moves on to
  // picking a destination when none is chosen yet instead of just dropping back to a bare map.
  const confirmOriginPin = useCallback(() => {
    if (!originPinLatLng) return;
    const place: PlaceDetails = {
      placeId: `pin:${originPinLatLng.latitude.toFixed(6)},${originPinLatLng.longitude.toFixed(6)}`,
      name: originPinAddress ?? "Dropped pin",
      address: originPinAddress ?? "Dropped pin",
      location: originPinLatLng,
    };
    const hadDestination = !!pendingDestination;
    onOriginSelected(place);
    if (!hadDestination) {
      setDestinationPinLatLng(originPinLatLng);
      setDestinationPinAddress(null);
      setDestinationPickerView("pin");
      setPickingDestinationPoint(true);
    }
  }, [originPinLatLng, originPinAddress, pendingDestination, onOriginSelected]);

  // Same three helpers again, for the destination pin step that follows a fresh start-point pick.
  const switchDestinationToSearch = useCallback(() => {
    setDestinationPickerView("search");
  }, []);

  // Same real fine-tune-after-search fix as onOriginSearchPickedForPin above.
  const onDestinationSearchPickedForPin = useCallback((place: PlaceDetails) => {
    setDestinationPinLatLng(place.location);
    setDestinationPinAddress(place.address);
    setDestinationPickerView("pin");
    camera.region("focus", { ...place.location, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
  }, [camera]);

  const cancelDestinationPicker = useCallback(() => {
    setPickingDestinationPoint(false);
    setDestinationPinLatLng(null);
    setDestinationPinAddress(null);
  }, []);

  const confirmDestinationPin = useCallback(() => {
    if (!destinationPinLatLng) return;
    const place: PlaceDetails = {
      placeId: `pin:${destinationPinLatLng.latitude.toFixed(6)},${destinationPinLatLng.longitude.toFixed(6)}`,
      name: destinationPinAddress ?? "Dropped pin",
      address: destinationPinAddress ?? "Dropped pin",
      location: destinationPinLatLng,
    };
    setPickingDestinationPoint(false);
    onDestinationSelected(place);
  }, [destinationPinLatLng, destinationPinAddress, onDestinationSelected]);

  // Real, explicit request: a way to change the just-set starting point from the destination
  // step itself, not just before it was set -- backs out of picking a destination and reopens
  // the origin picker seeded at the point that was actually just confirmed (openOriginPicker
  // always seeds from the current originOverride), so the driver lands exactly back where they
  // were, not a blank picker.
  const onChangeStartingPointFromDestinationStep = useCallback(() => {
    setPickingDestinationPoint(false);
    setDestinationPinLatLng(null);
    setDestinationPinAddress(null);
    openOriginPicker();
  }, [openOriginPicker]);

  // "Exit" from the origin pin's own tap menu (see onOriginMarkerPress below) -- clears the
  // custom start point entirely and reverts to live GPS, same as picking "My Location" in the
  // search flow. Re-fetches an already-showing route preview against the reverted origin so the
  // shown ETA/distance never goes stale.
  const clearOriginOverride = useCallback(() => {
    setOriginOverride(null);
    if (pendingDestination && currentLatLng) {
      requestRoutes(currentLatLng, pendingDestination.location, stopWaypoints ?? undefined, selectedMode);
    }
  }, [pendingDestination, currentLatLng, stopWaypoints, selectedMode, requestRoutes]);

  // Real, explicit request: the confirmed starting-point pin now stays visible on the map (see
  // its own Marker below) specifically so it's there to tap -- a real options menu instead of a
  // decorative pin that does nothing. "Continue to choose destination" only offered when there
  // genuinely isn't one chosen yet (mid-route-planning it wouldn't make sense -- Cancel/Start on
  // the route card itself is that flow's own real "continue").
  const onOriginMarkerPress = useCallback(() => {
    const canContinueToDestination = !pendingDestination && !pickingDestinationPoint;
    const options = ["Change pin", ...(canContinueToDestination ? ["Continue to choose destination"] : []), "Exit", "Cancel"];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = options.length - 2;
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex, destructiveButtonIndex, title: originOverride?.name ?? "Starting point" },
      (index) => {
        if (options[index] === "Change pin") {
          openOriginPicker();
        } else if (options[index] === "Continue to choose destination") {
          const seed = originOverride?.location ?? currentLatLng ?? null;
          setDestinationPinLatLng(seed);
          setDestinationPinAddress(null);
          setDestinationPickerView("pin");
          setPickingDestinationPoint(true);
        } else if (options[index] === "Exit") {
          clearOriginOverride();
        }
      }
    );
  }, [pendingDestination, pickingDestinationPoint, originOverride, currentLatLng, openOriginPicker, clearOriginOverride]);


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
  // Which Settings > Reports item is being placed (the report grid's choice).
  const pendingReportItemRef = useRef<ReportItemId | null>(null);

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
    navigation.navigate("VehicleDetection", { isNavigating: !!route });
  }, [navigation, route]);
  const onToolsSheetOpenDetection = useCallback(() => {
    toolsSheetRef.current?.close();
    Sentry.logger.info("map: opening vehicle detection screen");
    navigation.navigate("VehicleDetection", { isNavigating: !!route });
  }, [navigation, route]);

  const onReportItemSelected = useCallback(
    (item: ReportItemId) => {
      const type = baseTypeOf(item);
      if (!currentLatLng || !type) return;
      pendingAlertTypeRef.current = type;
      pendingReportItemRef.current = item;
      setPlacingItem(item);
      setClosureDraft(DEFAULT_CLOSURE);
      reportSheetRef.current?.close();
      setAlertPlacementLatLng(initialAlertPlacement(currentLatLng));
      setPlacingAlert(true);
      setPlacementFrontView(true);
      autoOverheadPlacementRef.current = false;
      // Snap the map to center on the current location so the fixed center pin starts exactly
      // where alertPlacementLatLng says it is, even if the user had panned away beforehand. Real,
      // confirmed fix: this used to be a plain animateToRegion (a region-fit call that resets
      // pitch/heading to 0/north-up as part of fitting the given lat/lng deltas), which silently
      // flattened the camera to overhead the instant placement opened regardless of
      // placementFrontView's own state -- the actual root cause of placement always opening
      // overhead no matter what. animateCamera with an explicit pitch/heading/zoom (matching the
      // same tilt togglePlacementFrontView's own "front" pose already uses) opens already in the
      // real driving-style angle this is supposed to default to.
      camera.move("transition", { center: currentLatLng, heading, pitch: PLACEMENT_PITCH, zoom: 17.5 }, { duration: 300 });
    },
    [currentLatLng, initialAlertPlacement, heading, camera]
  );

  // Optional `overrideLocation` -- the "Set at my location" button below passes the driver's
  // own live GPS fix directly, skipping the fixed-center pin's current alertPlacementLatLng
  // entirely, so it reports at the real current position in one tap instead of requiring the
  // map to already be panned there. Deliberately typed as a real LatLng (never the Pressable's
  // own event object) -- every call site below passes either nothing or an explicit LatLng, no
  // call site passes onPress={confirmAlertPlacement} directly, which would otherwise hand the
  // GestureResponderEvent to this parameter instead.
  // The 3 s Undo after sending a report (held on the server until then).
  const [pendingReport, setPendingReport] = useState<{ result: ReportResult; type: AlertType; label?: string; untilMs: number } | null>(null);
  const confirmAlertPlacement = useCallback(async (overrideLocation?: LatLng) => {
    if (submittingAlertRef.current) return;
    // Real enforcement, not just a disabled-looking button -- blocks the actual Firestore write
    // whenever the typed comment contains a not-allowed word (see commentFilter.ts), same check
    // reportAlert itself repeats server-side-equivalent (belt and braces, not relying on either
    // check alone).
    // A siren radar "Yes" report: what happened decides the item (nav/sirenRadar.ts).
    const sirenPlan = sirenDraft ? sirenReport(sirenDraft) : null;
    if (sirenDraft && titleProblem(sirenDraft.title)) return;
    if (!sirenPlan && containsBlockedLanguage(alertComment)) return;
    const type = sirenPlan ? baseTypeOf(sirenPlan.item) : pendingAlertTypeRef.current;
    const item = sirenPlan ? sirenPlan.item : pendingReportItemRef.current;
    const location = overrideLocation ?? alertPlacementLatLng;
    // A map chat is its message: it needs a few words.
    if (item && needsComment(item) && !alertComment.trim()) {
      setBannerMessage("Add a few words for your map chat.");
      setBannerVisible(true);
      return;
    }
    // Previously bailed here with zero feedback -- tapping Set just silently did nothing (no
    // banner, no error, placement bar stayed exactly as-is), which is indistinguishable from the
    // write itself failing. !user specifically means the anonymous/real sign-in Firebase sets up
    // on launch hasn't resolved yet, a real (if rare) race, not something the driver caused.
    if (!type || !location) return;
    if (!user) {
      setBannerMessage("Still signing you in — try Set again in a moment.");
      setBannerVisible(true);
      return;
    }
    // The server checks a report is within 1 km of where the driver really is.
    if (!currentLatLng) {
      setBannerMessage("Waiting for your location — reports need it.");
      setBannerVisible(true);
      return;
    }
    submittingAlertRef.current = true;
    setSubmittingAlert(true);
    try {
      const result = await submitReport(type, location, currentLatLng, user.uid, {
        customTtlMs: sirenPlan?.ttlMs ?? settings.alertExpiryMs,
        comment: sirenPlan ? sirenPlan.comment : alertComment,
        reporterName: settings.showNameOnReports ? user.displayName : null,
        item,
        closure: sirenPlan
          ? sirenPlan.closure
            ? closureForReport(sirenPlan.closure, headingTrack.filter.shown ?? null)
            : null
          : item === "closures"
            ? closureForReport(closureDraft, headingTrack.filter.shown ?? null)
            : null,
      });
      if (result.kind === "merged") {
        setBannerMessage(`${item ? itemLabel(item) : ALERT_LABELS[type]} was already reported here — you've confirmed it.`);
        setBannerVisible(true);
      } else {
        setPendingReport({ result, type, label: item ? itemLabel(item) : undefined, untilMs: result.kind === "pending" ? result.publishAtMs : Date.now() + UNDO_MS });
      }
      pendingAlertTypeRef.current = null;
      pendingReportItemRef.current = null;
      setPlacingItem(null);
      setPlacingAlert(false);
      setAlertPlacementLatLng(null);
      setAlertComment("");
      setSirenDraft(null);
    } catch (err) {
      if (err instanceof ReportRefused) {
        setBannerMessage(err.message);
        setBannerVisible(true);
        return;
      }
      // Same "log it, don't just swallow it" pattern as the rest of this screen (see reroute/
      // place-lookup catches above) -- but this write is important enough that the driver also
      // needs to actually see it failed, since nothing else here would ever tell them the alert
      // they just tried to set never made it to Firestore.
      console.warn("[map] reportAlert failed", err);
      Sentry.logger.error("map: reportAlert failed", { error: String(err) });
      setBannerMessage("Couldn't set that alert — check your connection and try again.");
      setBannerVisible(true);
    } finally {
      submittingAlertRef.current = false;
      setSubmittingAlert(false);
    }
  }, [alertPlacementLatLng, user, settings.alertExpiryMs, settings.showNameOnReports, alertComment, currentLatLng, closureDraft, headingTrack.filter.shown, sirenDraft]);

  // A report said out loud (nav/voiceReport.ts): where you are now, the same server rules (rate
  // limits, trust) as a tapped one, said back to you, with the same 3 s Undo.
  const sendVoiceReport = useCallback(
    async (r: VoiceReport) => {
      if (!user || !currentLatLng) {
        setBannerMessage(!user ? "Still signing you in — try again in a moment." : "Waiting for your location — reports need it.");
        setBannerVisible(true);
        return;
      }
      try {
        const result = await submitReport(r.type, currentLatLng, currentLatLng, user.uid, {
          customTtlMs: settings.alertExpiryMs,
          comment: r.note,
          reporterName: settings.showNameOnReports ? user.displayName : null,
          item: r.item,
        });
        announcePhrase({ kind: "said", text: result.kind === "merged" ? `${r.label} confirmed` : r.spoken });
        if (result.kind === "merged") {
          setBannerMessage(`${r.label} was already reported here — you've confirmed it.`);
          setBannerVisible(true);
        } else {
          setPendingReport({ result, type: r.type, label: r.label, untilMs: result.kind === "pending" ? result.publishAtMs : Date.now() + UNDO_MS });
        }
      } catch (err) {
        setBannerMessage(err instanceof ReportRefused ? err.message : "Couldn't send that report — check your connection and try again.");
        setBannerVisible(true);
        if (!(err instanceof ReportRefused)) Sentry.logger.error("map: voice report failed", { error: String(err) });
      }
    },
    [user, currentLatLng, settings.alertExpiryMs, settings.showNameOnReports, announcePhrase]
  );

  // The 3 s Undo after sending a report (held on the server until then).
  const clearPendingReport = useCallback(() => setPendingReport(null), []);
  const onUndoReport = useCallback(() => {
    const p = pendingReport;
    setPendingReport(null);
    if (!p || !user) return;
    undoReport(p.result, user.uid)
      .then(() => {
        setBannerMessage("Report taken back.");
        setBannerVisible(true);
      })
      .catch((err) => {
        setBannerMessage(err instanceof ReportRefused ? err.message : "Couldn't undo — it may already be on the map.");
        setBannerVisible(true);
      });
  }, [pendingReport, user]);

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
    pendingReportItemRef.current = null;
    setPlacingItem(null);
    setPlacingAlert(false);
    setAlertPlacementLatLng(null);
    setAlertComment("");
    setSirenDraft(null);
  }, []);

  // Siren radar "Yes": the report sheet, the pin starting where the siren was loudest.
  const onSirenYes = useCallback(() => {
    const q = sirenQuestion;
    setSirenAsking(false);
    setSirenQuestion(null);
    if (!q || !currentLatLng) return;
    setSirenDraft({ vehicle: vehicleFromType(q.type), what: "passing", title: "" });
    setSirenLoudest(q.loudest);
    onReportItemSelected("emergencyVehicles");
    const at = q.loudest ?? initialAlertPlacement(currentLatLng);
    setAlertPlacementLatLng(at);
    camera.move("transition", { center: at }, { duration: 300 });
  }, [sirenQuestion, currentLatLng, onReportItemSelected, initialAlertPlacement, camera]);
  const onSirenQuickPin = useCallback(
    (spot: QuickPinSpot) => {
      if (!currentLatLng) return;
      const at = quickPin(spot, currentLatLng, headingTrack.filter.shown ?? null, sirenLoudest);
      setAlertPlacementLatLng(at);
      camera.move("transition", { center: at }, { duration: 300 });
    },
    [currentLatLng, headingTrack.filter.shown, sirenLoudest, camera]
  );
  // Voice on ("Hey TrackLine" turned on): a spoken "yes" or "no" answers the question too.
  const sirenVoice = sirenAsking && settings.wakePhrase;
  const onSirenYesRef = useLatest(onSirenYes);
  const onSirenNoRef = useLatest(onSirenNo);
  useEffect(() => {
    if (!sirenVoice) return;
    let session: { stop: () => void } | null = null;
    let cancelled = false;
    let answered = false;
    const hear = (text: string) => {
      const a = yesNo(text);
      if (!a || answered) return;
      answered = true;
      session?.stop();
      if (a === "yes") onSirenYesRef.current();
      else onSirenNoRef.current();
    };
    startVoiceSearch(navLanguage, { onPartial: hear, onFinal: hear, onEnd: () => {}, onError: () => {} }).then((s) => {
      if (cancelled) s?.stop();
      else session = s;
    });
    return () => {
      cancelled = true;
      session?.stop();
    };
  }, [sirenVoice, navLanguage, onSirenYesRef, onSirenNoRef]);


  // Tilts (or flattens) the camera for the "2 views" alert-placement switcher -- deliberately
  // omits `center` from animateCamera (only pitch/heading are given) so the fixed-center pin's
  // actual target location, wherever the user has panned the map to, never moves. Re-centering
  // here would silently discard a careful manual pan back onto a spot the driver just passed,
  // which is the exact case this switch-view button exists to make easier.
  const togglePlacementFrontView = useCallback(() => {
    setPlacementFrontView((was) => {
      const next = !was;
      camera.move("transition", next ? { pitch: PLACEMENT_PITCH, heading } : { pitch: 0, heading: 0 }, { duration: 400 });
      return next;
    });
  }, [heading, camera]);

  // Restores the proper nav camera pose (based on overviewMode) once placement ends -- without
  // this, canceling/confirming an alert reported from the front-view switch would leave the
  // camera stuck tilted at pitch 60 with no heading tracking, since the per-tick follow effect
  // deliberately never touches pitch (see its own comment) and nothing else would ever put it
  // back. Only actually animates if the switcher was used -- the common case of never touching
  // it shouldn't cost an extra camera jog against an already-correct chase-cam pose.
  useEffect(() => {
    if (placingAlert) return;
    if (placementFrontView && route && followTilt && currentLatLng) {
      camera.move(
        "navFollow",
        overviewMode
          ? { center: currentLatLng, heading, pitch: 45, zoom: 15 }
          : navFollowPose(currentLatLng, heading, currentSpeedKmhRef.current),
        { duration: 400 }
      );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same transition as the camera restore just above (placement ended)
    setPlacementFrontView(false);
    // Deliberately scoped to only the placingAlert transition -- route/followTilt/currentLatLng
    // /overviewMode/heading are read for their value at that moment, not meant to re-trigger
    // this restore every time any of them changes independently while still placing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingAlert]);

  // ── Tap a pin → the dark alert card (components/AlertCard.tsx) ────────────────────────────
  // On the home map: the card slides down, the map dims around a spotlight on the pin, and the
  // camera eases to it (centre only -- the zoom doesn't change). Dismissing (tap the map, swipe
  // the card up, or 8 s idle) restores the camera the driver had. During navigation the compact
  // card sits under the instruction card: no dim, no camera move, follow mode carries on.
  // Tapping the card opens the full details sheet it used to open directly.
  const [alertCard, setAlertCard] = useState<OpenAlertCard | null>(null);
  const [alertCardPlaces, setAlertCardPlaces] = useState<Readonly<Record<string, string | null>>>({});
  const [thankedAlertIds, setThankedAlertIds] = useState<ReadonlySet<string>>(() => new Set());
  const alertCardCameraRef = useRef<{ camera: CameraLike | null; mode: CameraMode; gestures: number } | null>(null);
  const alertPlaceRequestedRef = useRef(new Set<string>());
  // A pin tap can also reach the map's own onPress on some platforms; that same tap mustn't
  // close the card it just opened.
  const alertCardOpenedAtRef = useRef(0);

  const openAlertCard = useCallback(
    async (next: OpenAlertCard) => {
      alertCardOpenedAtRef.current = Date.now();
      setAlertCard(next);
      if (next.alert && user && next.alert.createdBy !== user.uid) {
        const alertId = next.alert.id;
        hasThankedAlert(alertId, user.uid).then((done) => {
          if (done) setThankedAlertIds((prev) => new Set(prev).add(alertId));
        });
      }
      if (routeActiveRef.current) return;
      // Keep the camera from before the FIRST card; tapping another pin just moves on.
      if (!alertCardCameraRef.current) {
        alertCardCameraRef.current = { camera: null, mode: camera.state, gestures: camera.gestures };
        const before = (await mapRef.current?.getCamera().catch(() => null)) ?? null;
        if (alertCardCameraRef.current) alertCardCameraRef.current.camera = before;
      }
      camera.move("focus", { center: { latitude: next.model.latitude, longitude: next.model.longitude } }, { duration: ALERT_CARD_CAMERA_MS });
    },
    [user, camera]
  );

  const dismissAlertCard = useCallback(
    (options?: { keepSelection?: boolean }) => {
      setAlertCard(null);
      if (!options?.keepSelection) setSelectedAlert((current) => (detailSheetOpenRef.current ? current : null));
      const saved = alertCardCameraRef.current;
      alertCardCameraRef.current = null;
      if (!saved) return;
      // Moved the map while the card was up: that's yours now (FREE), nothing is put back.
      if (camera.gestures !== saved.gestures) return;
      camera.setMode(saved.mode);
      // Navigation started meanwhile: its own follow camera takes over.
      if (routeActiveRef.current || !saved.camera) return;
      camera.move("transition", saved.camera, { duration: ALERT_CARD_CAMERA_MS });
    },
    [detailSheetOpenRef, camera]
  );

  const onMarkerPress = useCallback(
    (alert: AlertDoc) => {
      setSelectedAlert(alert);
      openAlertCard({ model: cardForReport(alert, user?.uid ?? null), alert, incident: null });
    },
    [openAlertCard, user]
  );

  const onOfficialPinPress = useCallback(
    (incident: NearbyIncident) => openAlertCard({ model: cardForOfficial(incident), alert: null, incident }),
    [openAlertCard]
  );

  const openAlertCardDetails = useCallback(() => {
    const open = alertCard;
    dismissAlertCard({ keepSelection: true });
    if (!open) return;
    if (open.alert) {
      setSelectedAlert(open.alert);
      detailSheetRef.current?.expand();
    } else if (open.incident) {
      onSelectIncident(open.incident);
    }
  }, [alertCard, dismissAlertCard, onSelectIncident]);

  const onThankAlertCard = useCallback(() => {
    const alert = alertCard?.alert;
    if (!user || !alert || alert.createdBy === user.uid) return;
    setThankedAlertIds((prev) => new Set(prev).add(alert.id));
    thankAlert(alert.id, user.uid).catch((err) => console.warn("[map] thanks failed", err));
  }, [alertCard, user]);

  // The card follows the live alert (its thanks count updates as people tap).
  const liveAlertCard = useMemo(() => {
    if (!alertCard?.alert) return alertCard;
    const live = visibleAlerts.find((a) => a.id === alertCard.alert!.id) ?? alertCard.alert;
    return { ...alertCard, alert: live, model: cardForReport(live, user?.uid ?? null) };
  }, [alertCard, visibleAlerts, user]);

  // Road + suburb under the distance: the official incident's own "where" when it has one, else
  // one reverse geocode per alert (kept for the session). Left out until it's known.
  const alertCardKey = alertCard?.model.key ?? null;
  const alertCardNeedsPlace = !!alertCard && !alertCard.model.officialWhere;
  const alertCardLat = alertCard?.model.latitude ?? 0;
  const alertCardLng = alertCard?.model.longitude ?? 0;
  useEffect(() => {
    if (!alertCardKey || !alertCardNeedsPlace) return;
    const requested = alertPlaceRequestedRef.current;
    if (requested.has(alertCardKey)) return;
    requested.add(alertCardKey);
    reverseGeocode({ latitude: alertCardLat, longitude: alertCardLng })
      .then((address) => setAlertCardPlaces((prev) => ({ ...prev, [alertCardKey]: roadAndSuburb(address) })))
      .catch(() => requested.delete(alertCardKey));
    // The coordinates belong to the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertCardKey, alertCardNeedsPlace]);

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
    if (!user) return;
    await confirmAlert(alert.id, user.uid);
  }, [user]);

  const activeStep = route?.steps[activeStepIndex] ?? null;
  // Metres along the road to the coming manoeuvre (the end of the active step).
  const metersToManoeuvre = useMemo(
    () => (activeStep && currentLatLng ? remainingStepMeters(activeStep, currentLatLng.latitude, currentLatLng.longitude) : null),
    [activeStep, currentLatLng]
  );
  // The lane strip: only for a manoeuvre with real lane data, from 1 km out.
  const laneStripLanes =
    laneGuidanceOn && activeStep?.lanes && metersToManoeuvre !== null && showLaneStrip(activeStep.lanes, metersToManoeuvre) ? activeStep.lanes : null;
  // The road shown on the trip bar and the live street chip. While navigating it's read off the
  // route itself -- the street the previous step turned onto -- which is exact and costs no
  // lookup; the looked-up name fills in on the first step or where the route names no street.
  const navRoadName = route ? roadFromRouteSteps(route.steps, activeStepIndex) ?? currentRoadName : currentRoadName;
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
  const navLat = currentLatLng?.latitude ?? null;
  const navLng = currentLatLng?.longitude ?? null;
  const remainingPolyline = useMemo(() => {
    if (!route) return [];
    const stepsAhead = route.steps.slice(activeStepIndex);
    if (stepsAhead.length === 0) return [];
    const ahead = stepsAhead.flatMap((s) => s.polyline);
    // Starts exactly under the arrow (its projection onto the route), so there's no gap or spur
    // between the arrow and the line, and the part already driven disappears behind it.
    return routeAheadOf(ahead, navLat != null && navLng != null ? { latitude: navLat, longitude: navLng } : null);
  }, [route, activeStepIndex, navLat, navLng]);
  // How reports are drawn at the current zoom: grouped into counts when zoomed out, otherwise
  // one pin each, with reports on the active route a step larger.
  const mapZoom = zoomFromLatitudeDelta(osmZoomDelta);
  // Map polish §2 (map/zoomStates.ts): full pins close up, 60% icons + count badges in between,
  // coloured dots far out (max 60, most important first).
  const pinCentre = viewCentre ?? currentLatLng;
  const pinCentreKey = pinCentre ? `${pinCentre.latitude.toFixed(2)},${pinCentre.longitude.toFixed(2)}` : "";
  const alertPins = useMemo(() => {
    const layout = layoutPins(
      visibleAlerts.map((alert) => ({ id: alert.id, lat: alert.lat, lng: alert.lng, type: alert.type, item: alert.item ?? null, alert })),
      { zoom: mapZoom, latitudeDelta: osmZoomDelta, screenHeight: windowHeight, centre: pinCentre ?? { latitude: 0, longitude: 0 } }
    );
    const routeLine = route && remainingPolyline.length > 1 ? remainingPolyline : null;
    return {
      state: layout.state,
      clusters: layout.clusters,
      singles: layout.singles.map(({ point, scale }) => ({
        alert: point.alert,
        mid: layout.state === "mid",
        size: alertPinSize(mapZoom, !!routeLine && distanceToPolylineMeters(point.lat, point.lng, routeLine) <= 60) * scale,
      })),
      dots: layout.dots.map(({ point, colour }) => ({ alert: point.alert, colour })),
    };
    // remainingPolyline changes on every fix; whether a report is "on the route" only needs
    // re-checking when the step changes, and the far-zoom priority only when the view moves ~1 km.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAlerts, mapZoom, osmZoomDelta, route, activeStepIndex, windowHeight, pinCentreKey]);

  // The real number behind the street pill's "N reports around you": active reports within 10km.
  // Counted from a position rounded to ~100m: the count can't change meaningfully over less,
  // and this keeps it from being recounted on every GPS fix.
  const reportsLat = currentLatLng ? Math.round(currentLatLng.latitude * 1000) / 1000 : null;
  const reportsLng = currentLatLng ? Math.round(currentLatLng.longitude * 1000) / 1000 : null;
  const reportsAround = useMemo(
    () =>
      reportsLat === null || reportsLng === null
        ? 0
        : countReportsAround(visibleAlerts, { latitude: reportsLat, longitude: reportsLng }),
    [visibleAlerts, reportsLat, reportsLng]
  );
  // ---- Startup §2: "N Trackys around you" and other real messages in the pill, one at a time ----
  const [pillQueue, setPillQueue] = useState<PillMessage[]>([]);
  const [greetTick, setGreetTick] = useState(1);
  const greetDoneTickRef = useRef(0);
  const lastBackgroundAtRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (shouldGreet(lastBackgroundAtRef.current, Date.now())) setGreetTick((t) => t + 1);
      } else if (lastBackgroundAtRef.current == null || next === "background") {
        lastBackgroundAtRef.current = Date.now();
      }
    });
    return () => sub.remove();
  }, []);
  const greetInputsRef = useLatest({ here: currentLatLng, ghost: settings.visibility === "ghost", speed: currentSpeedKmh, reportsAround });
  useEffect(() => {
    // On open (and coming back after 10 min+), once signed in with a fix: say we're here, then
    // show the real count; then the reports near you, if any.
    if (!user || !currentLatLng || greetDoneTickRef.current === greetTick) return;
    greetDoneTickRef.current = greetTick;
    const { here, ghost, speed } = greetInputsRef.current;
    if (!here) return;
    let cancelled = false;
    noteActive({ lat: here.latitude, lng: here.longitude, ghost, stationary: (speed ?? 0) < 2 })
      .catch((err) => Sentry.logger.warn("trackys: noteActive failed", { error: String(err) }))
      .then(() => fetchTrackysAround(here.latitude, here.longitude))
      .then((r) => {
        if (cancelled || !r) return;
        setPillQueue((q) => enqueue(enqueue(q, { kind: "trackys", text: trackysPillText(r) }), (() => {
          const t = reportsPillText(greetInputsRef.current.reportsAround);
          return t ? { kind: "reports" as const, text: t } : null;
        })()));
      })
      .catch((err) => Sentry.logger.warn("trackys: count failed", { error: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [user, currentLatLng, greetTick, greetInputsRef]);
  // Still using the app: tell the server every 5 minutes (counts are "active in the last 15").
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      const { here, ghost, speed } = greetInputsRef.current;
      if (here && AppState.currentState === "active") noteActive({ lat: here.latitude, lng: here.longitude, ghost, stationary: (speed ?? 0) < 2 }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [user, greetInputsRef]);
  const pillHead = pillQueue[0] ?? null;
  useEffect(() => {
    if (!pillHead) return;
    const t = setTimeout(() => setPillQueue((q) => done(q)), PILL_SHOW_MS);
    return () => clearTimeout(t);
  }, [pillHead]);
  const onPillPress = useCallback(() => {
    // Zoom out a little to show the Trackys nearby (you asked to look: the camera stays there).
    setPillQueue((q) => done(q));
    mapRef.current
      ?.getCamera()
      .then((c) => camera.move("focus", { zoom: Math.max(11, (c.zoom ?? HOME_FOLLOW_ZOOM) - 2) }, { duration: 600 }))
      .catch(() => {});
  }, [camera]);

  const uiScale = scaleFor(windowWidth);
  // The Audio player button (Settings > Map shortcuts) opens the driver's music app.
  const openAudioPlayer = useCallback(() => {
    openMusicApp().then((opened) => {
      if (!opened) {
        setBannerMessage("No music app found. Install Spotify, Apple Music or YouTube Music to use this button.");
        setBannerVisible(true);
      }
    });
  }, []);

  // Which incidents to draw: those around the driver, most important first, capped (see
  // incidentsNear). The centre is rounded to roughly a kilometre so this list -- and the pins
  // made from it -- is rebuilt when the driver has actually moved somewhere, not on every GPS
  // fix.
  const trafficCenterLat = currentLatLng ? Math.round(currentLatLng.latitude * 100) / 100 : null;
  const trafficCenterLng = currentLatLng ? Math.round(currentLatLng.longitude * 100) / 100 : null;
  const nearbyTrafficIncidents = useMemo(
    () =>
      trafficCenterLat === null || trafficCenterLng === null
        ? []
        : incidentsNear(trafficIncidents, { latitude: trafficCenterLat, longitude: trafficCenterLng }),
    [trafficIncidents, trafficCenterLat, trafficCenterLng]
  );
  // ---- Settings > Reports "Alert while driving" ----
  // Every real feature whose item alerts (OSM cameras/crossings, driver reports, Live Traffic NSW
  // incidents), checked each fix: the nearest one coming up gets a short chip and one spoken
  // line, once (alerts/approachAlerts.ts). Driving only -- not walking, cycling or transit.
  // Crash history around the driver (server crashRecords), re-read when they move cell.
  const crashCell = currentLatLng && user && alertsWhileDriving(settings, "crashHistory") ? encodeGeohash(currentLatLng.latitude, currentLatLng.longitude, 5) : null;
  const [crashRecordsNear, setCrashRecordsNear] = useState<{ cell: string; records: CrashRecord[] } | null>(null);
  const crashLatLngRef = useLatest(currentLatLng);
  useEffect(() => {
    const at = crashLatLngRef.current;
    if (!crashCell || !at) return;
    let cancelled = false;
    fetchCrashRecordsNear(at.latitude, at.longitude)
      .then((records) => {
        if (!cancelled) setCrashRecordsNear({ cell: crashCell, records });
      })
      .catch((err) => console.warn("[map] crash history fetch failed", err));
    return () => {
      cancelled = true;
    };
  }, [crashCell, crashLatLngRef]);
  const crashSpots = useMemo(() => (crashRecordsNear && crashRecordsNear.cell === crashCell ? crashHistorySpots(crashRecordsNear.records) : []), [crashRecordsNear, crashCell]);

  const approachFeatures = useMemo(
    () => [
      ...collectApproachFeatures(settings, { osm: osmData, alerts: nearbyAlerts, incidents: settings.showLiveTraffic ? nearbyTrafficIncidents : [], ownUid: user?.uid }),
      // Derived: crash-history spots, and lane endings from the route's own lane counts.
      ...(alertsWhileDriving(settings, "crashHistory") ? crashSpots : []),
      ...(route && alertsWhileDriving(settings, "laneEnding") ? laneEndingFeatures(route.steps) : []),
    ],
    [osmData, nearbyAlerts, nearbyTrafficIncidents, user?.uid, settings, crashSpots, route]
  );

  const approachMemoryRef = useRef<ApproachMemory>({});
  // alongM: where the feature is along the route (while navigating), so the chip counts down
  // from the car's real progress and goes once it's passed (nav/roadFeatureAlerts.ts).
  const [approachChip, setApproachChip] = useState<{ item: ReportItemId; distanceM: number; key?: string; alongM?: number | null } | null>(null);
  const featureSpokenRef = useRef<Set<string>>(new Set());
  // Transit navigation: "Get off at the next stop" (with a buzz) / "Get off in 2 stops".
  const rideNowMs = location?.timestamp ?? 0;
  const ride = useMemo(() => {
    if (!route || travelMode !== "transit" || !currentLatLng || !route.transitSummary) return null;
    // The ride you're on: the first one not yet finished, once you're away from where it starts.
    const leg = route.transitSummary.legs.find((l) => (l.arrivalTimeMs ?? Infinity) > rideNowMs - 60_000 && haversineMeters(currentLatLng, l.arrivalLocation) > 60);
    if (!leg || haversineMeters(currentLatLng, leg.departureLocation) < 150 || (currentSpeedKmh ?? 0) < 8) return null;
    const status = rideStatus({ arrivalStop: leg.arrivalStop, arrivalLocation: leg.arrivalLocation, arrivalTimeMs: leg.arrivalTimeMs }, currentLatLng, rideNowMs, false);
    return { key: `${leg.lineName}:${leg.arrivalStop}`, text: status.text, buzz: status.vibrate };
  }, [route, travelMode, currentLatLng, rideNowMs, currentSpeedKmh]);
  const rideText = ride?.text ?? null;
  const rideBuzzedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ride?.buzz || rideBuzzedRef.current === ride.key) return;
    rideBuzzedRef.current = ride.key;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [ride]);

  // Sudden slowdown from TrackLine drivers crawling just ahead on the route: an ahead alert.
  const trackySlowdownAt = useMemo(
    () =>
      route && navMatch?.onRoute && alertsWhileDriving(settings, "suddenSlowdown")
        ? trackySlowdownAhead(presenceList, { polyline: route.polyline, alongM: navMatch.along }, location?.timestamp ?? 0)
        : null,
    [route, navMatch, settings, presenceList, location?.timestamp]
  );
  useEffect(() => {
    // An on-route chip stays until the feature is passed; any other goes after 6 s.
    if (!approachChip || approachChip.alongM != null) return;
    const t = setTimeout(() => setApproachChip(null), 6000);
    return () => clearTimeout(t);
  }, [approachChip]);
  // Live countdown for an on-route chip; voice once at ~300 m; gone once passed (not drawn).
  const chipAheadM = approachChip?.alongM != null && navMatch ? chipRemainingM(approachChip.alongM, navMatch.along) : null;
  const approachChipShown = !!approachChip && (approachChip.alongM == null || chipAheadM != null);
  useEffect(() => {
    if (!approachChip || approachChip.alongM == null || !navMatch || chipAheadM == null) return;
    const key = approachChip.key ?? "";
    if (shouldSpeakFeature(chipAheadM, featureSpokenRef.current.has(key))) {
      featureSpokenRef.current.add(key);
      announcePhrase({ kind: "feature", item: approachChip.item });
    }
    // Each matched fix re-checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipAheadM]);
  useEffect(() => {
    // While navigating, the ahead banner (nav/ahead) does this job; this chip is for free driving.
    if (route || !currentLatLng || travelMode !== "driving" || approachFeatures.length === 0) return;
    const { alert, memory } = nextApproachAlert(
      approachFeatures,
      { nowMs: location?.timestamp ?? 0, position: currentLatLng, headingDeg: heading, speedKmh: currentSpeedKmh, route: null },
      approachMemoryRef.current
    );
    approachMemoryRef.current = memory;
    if (!alert) return;
    setApproachChip({ item: alert.item, distanceM: alert.distanceM, key: alert.key, alongM: null });
    announcePhrase({ kind: "feature", item: alert.item });
    // Only a new fix (or a newly loaded feature list) runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLatLng, approachFeatures]);

  // ---- Ahead alerts while navigating (nav/ahead): ONE feed, ONE controller, ONE banner ----
  // Projection onto the route only when the sources or the route change; per fix only "ahead of".
  const aheadProjected = useMemo(() => {
    if (!route || travelMode !== "driving") return [];
    const sources = [
      ...aheadSourcesFrom(approachFeatures, nearbyAlerts, settings.showLiveTraffic ? nearbyTrafficIncidents : []),
      ...(alertsWhileDriving(settings, "traffic")
        ? aheadLiveTraffic && aheadLiveTraffic.forRoute === route
          ? trafficSources(aheadLiveTraffic.polyline, aheadLiveTraffic.intervals)
          : trafficSources(route.polyline, route.speedIntervals)
        : []),
    ];
    return projectFeed(sources, route.polyline, (msg, key) => Sentry.logger.warn(msg, { key }));
  }, [route, travelMode, approachFeatures, nearbyAlerts, nearbyTrafficIncidents, settings, aheadLiveTraffic]);
  const aheadSlowdown = useMemo(
    () =>
      route && trackySlowdownAt
        ? projectFeed([{ key: `slowdown:${trackySlowdownAt.latitude.toFixed(4)},${trackySlowdownAt.longitude.toFixed(4)}`, kind: "slowdown", item: "suddenSlowdown", source: "community", lat: trackySlowdownAt.latitude, lng: trackySlowdownAt.longitude }], route.polyline)
        : [],
    [route, trackySlowdownAt]
  );
  const aheadFeedNow = useMemo(() => {
    if (!navMatch?.onRoute) return [];
    const feed = aheadOf([...aheadProjected, ...aheadSlowdown], navMatch.along);
    // The episode clears itself when the hold ends (effect above), so non-null means heard recently.
    return feed.sort((a, b) => a.aheadM - b.aheadM);
  }, [aheadProjected, aheadSlowdown, navMatch]);
  // Closures on the route ahead: drawn closed on the map, and a full one routed around once.
  const closedStretches = useMemo(
    () => (route ? aheadFeedNow.filter((a) => a.kind === "closure").map((a) => closedStretch(route.polyline, a.alongM)).filter((l) => l.length > 1) : []),
    [route, aheadFeedNow]
  );
  const closuresTriedRef = useRef(new Set<string>());
  const blockingClosure = route && travelMode === "driving" ? aheadFeedNow.find((a) => a.aheadM > 200 && a.aheadM < 30_000 && shouldRouteAround(a)) ?? null : null;
  useEffect(() => {
    const c = blockingClosure;
    if (!c || !currentLatLng || !destinationLatLng || closuresTriedRef.current.has(c.key)) return;
    closuresTriedRef.current.add(c.key);
    const avoidPts = aheadFeedNow.filter(shouldRouteAround).map((a) => ({ latitude: a.lat, longitude: a.lng }));
    mapboxRouteAround(currentLatLng, destinationLatLng, headingTrack.filter.shown ?? null, settings.routeAvoid, stopWaypointsLiveRef.current ?? [], avoidPts)
      .then((fresh) => {
        if (!fresh || routeRef.current == null) return;
        // Only if it really keeps clear of the closure (Mapbox can't always).
        const near = projectOnPolyline(fresh.polyline, { latitude: c.lat, longitude: c.lng });
        if (near && near.offM < 40) return;
        guidanceRef.current = createGuidanceState();
        setActiveStepIndex(0);
        setRoute(fresh);
        announcePhrase({ kind: "said", text: "Road closed ahead. Taking you around it." });
      })
      .catch((err) => console.warn("[nav] route around the closure failed", err));
    // Once per closure; the refs and announcePhrase are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockingClosure?.key]);

  const [aheadCtl] = useState(
    () => new AheadBannerController({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }, Date.now)
  );
  const aheadState = useSyncExternalStore(aheadCtl.subscribe, aheadCtl.getState);
  useEffect(() => {
    aheadCtl.setOnShow((a: AheadAlert, reminder: boolean) => {
      if (reminder) return;
      if (a.critical) {
        try {
          chimePlayer.seekTo(0);
          chimePlayer.play();
        } catch {
          // No chime is no reason to miss the warning.
        }
      }
      const delayMin = a.delaySeconds && a.delaySeconds >= 60 ? Math.round(a.delaySeconds / 60) : null;
      const text = a.source === "siren" ? SIREN_SPOKEN : spokenLine(a.mergedTraffic ? "crash" : a.kind, a.title, delayMin);
      announcePhrase({ kind: "ahead", text, critical: a.critical, clipKey: aheadClipKey(a) });
    });
  });
  useEffect(() => {
    if (!route || travelMode !== "driving") return;
    aheadCtl.update({ feed: aheadFeedNow, carAlongM: navMatch?.along ?? 0, speedMps: (currentSpeedKmh ?? 0) / 3.6, manoeuvreBusy: exitZoomActive });
  }, [aheadCtl, aheadFeedNow, navMatch, currentSpeedKmh, exitZoomActive, route, travelMode]);
  // Every timer is cleared on a reroute, the end of the drive, going to the background, unmount.
  const aheadRouteRef = useRef<typeof route>(null);
  useEffect(() => {
    const prev = aheadRouteRef.current;
    aheadRouteRef.current = route;
    if (prev && !route) aheadCtl.reset("end");
    else if (prev && route && prev !== route) aheadCtl.reset("reroute");
  }, [route, aheadCtl]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") aheadCtl.reset("background");
    });
    return () => sub.remove();
  }, [aheadCtl]);
  useEffect(() => () => aheadCtl.reset("unmount"), [aheadCtl]);
  // The banner sits under the turn instruction: the compass / sound / voice move down out of its
  // way first (NavMapControls dropBy), then it slides in. The bottom controls never move.
  const aheadRoomPx = useSharedValue(0);
  const [aheadBannerHeight, setAheadBannerHeight] = useState(AHEAD_BANNER_HEIGHT);
  const aheadBannerUp = !!aheadState.alert;
  const mapScheme = useMapScheme();
  // On a short phone the raised column puts the sign beside the dial (same maths as the layout test).
  const aheadSignBeside = useMemo(() => {
    if (!route || !aheadBannerUp) return false;
    const f = navControlFrames({
      width: windowWidth,
      height: windowHeight,
      safeTop: insets.top,
      safeBottom: insets.bottom,
      bottomBarHeight,
      topBarHeight: instructionCardHeight,
      showSpeedLimit: !!speedLimitKmh,
      showRecenter: false,
      dropBy: aheadRoomFor(aheadBannerHeight),
    });
    return !!f.speedLimit && f.speedLimit.x > SIDE_MARGIN + SPEEDOMETER_SIZE / 2;
  }, [route, aheadBannerUp, windowWidth, windowHeight, insets.top, insets.bottom, bottomBarHeight, instructionCardHeight, speedLimitKmh, aheadBannerHeight]);
  /** Tap while stopped: the full card for a report or an official incident (else it just stays). */
  const openAheadCard = useCallback(() => {
    const a = aheadState.alert;
    if (!a) return;
    const report = a.alertId ? nearbyAlerts.find((x) => x.id === a.alertId) : undefined;
    const incident = a.incidentId ? nearbyTrafficIncidents.find((x) => x.id === a.incidentId) : undefined;
    if (report) onMarkerPress(report);
    else if (incident) onOfficialPinPress(incident);
    else {
      aheadCtl.tap();
      return;
    }
    aheadCtl.swipe();
  }, [aheadState.alert, nearbyAlerts, nearbyTrafficIncidents, onMarkerPress, onOfficialPinPress, aheadCtl]);
  /** Still there / Not there on a driver report: one tap, then the banner closes. */
  const voteOnAhead = useCallback(
    (still: boolean) => {
      const a = aheadState.alert;
      if (!a?.alertId || !user) return;
      (still ? confirmAlert(a.alertId, user.uid) : denyAlert(a.alertId, user.uid)).catch((err) => Sentry.logger.warn("ahead: vote failed", { error: String(err) }));
      aheadCtl.swipe();
    },
    [aheadState.alert, user, aheadCtl]
  );
  // Live traffic tinted on the route still ahead while driving: slow amber, stopped red, over their length.
  const navTrafficAll = useMemo(() => {
    if (!route || !route.speedIntervals || route.polyline.length < 2) return [];
    const cum = [0];
    for (let i = 1; i < route.polyline.length; i++) cum.push(cum[i - 1] + haversineMeters(route.polyline[i - 1], route.polyline[i]));
    return route.speedIntervals
      .filter((iv) => (iv.speed === "SLOW" || iv.speed === "TRAFFIC_JAM") && iv.endIndex > iv.startIndex)
      .map((iv) => ({
        coordinates: route.polyline.slice(Math.max(0, iv.startIndex), Math.min(route.polyline.length - 1, iv.endIndex) + 1),
        speed: iv.speed as "SLOW" | "TRAFFIC_JAM",
        endAlong: cum[Math.min(cum.length - 1, iv.endIndex)],
      }));
  }, [route]);
  const navTraffic = useMemo(
    () => (alertsWhileDriving(settings, "traffic") || isShown(settings, "traffic") ? navTrafficAll.filter((t) => t.endAlong > (navMatch?.along ?? 0)) : []),
    [navTrafficAll, navMatch, settings]
  );
  /** The road an alert is on: the route step it falls in. */
  const aheadRoad = useMemo(() => (aheadState.alert && route ? roadAtAlong(route.steps, aheadState.alert.alongM) : null), [aheadState.alert, route]);
  // "On your route" on the incident card: within 80m of the road still to be driven.
  const selectedIncidentOnRoute = useMemo(
    () =>
      !!selectedIncident &&
      remainingPolyline.length > 1 &&
      distanceToPolylineMeters(selectedIncident.lat, selectedIncident.lng, remainingPolyline) <= 80,
    [selectedIncident, remainingPolyline]
  );

  // The bottom bar's "Overview": the WHOLE of the route still to drive, fitted on screen from
  // the driver's position to the destination, flat and north-up -- not the merely pulled-back
  // chase-cam this button used to toggle (that pose still lives on the locate button).
  //
  // It drops out of camera-follow first, for the same reason a manual pan does: otherwise the
  // very next GPS fix would snap the camera straight back onto the car. From there the bar's
  // existing Re-centre state takes over -- tap it to go back, or it goes back by itself after
  // ten seconds, so a driver is never left looking at the overview by accident.
  const showRouteOverview = useCallback(() => {
    if (remainingPolyline.length < 2) return;
    camera.setMode("OVERVIEW", true);
    camera.fit("overview", remainingPolyline, {
      edgePadding: {
        top: instructionCardHeight + insets.top + spacing.xl,
        right: 56,
        bottom: bottomBarHeight + insets.bottom + spacing.xl,
        left: 56,
      },
      animated: true,
    });
  }, [remainingPolyline, instructionCardHeight, bottomBarHeight, insets.top, insets.bottom, camera]);
  // The Routes button: the whole route on screen plus the other ways there from here, each
  // labelled with the time difference; tap one to switch to it.
  const showNavRoutes = useCallback(() => {
    showRouteOverview();
    if (!currentLatLng || !destinationLatLng || travelMode !== "driving") return;
    const current = remainingPolyline;
    getRouteChoices(currentLatLng, destinationLatLng, { ...avoidRouteOptions(settings.routeAvoid), waypoint: stopWaypoints ?? undefined })
      .then((choices) => {
        const alts = pickAlternatives(choices, current);
        setNavAlternatives(alts);
        if (!alts.length) showManoeuvreChip("No other routes right now", "neutral", 3000);
      })
      .catch((err) => showManoeuvreChip(`Couldn't load other routes: ${routeErrorText(err)}`, "neutral", 4000));
  }, [showRouteOverview, currentLatLng, destinationLatLng, travelMode, remainingPolyline, settings.routeAvoid, stopWaypoints, showManoeuvreChip]);
  const switchToAlternative = useCallback((alt: Route) => {
    guidanceRef.current = createGuidanceState();
    setActiveStepIndex(0);
    setRoute(alt);
    setNavAlternatives(null);
    camera.setMode("NAV_FOLLOW", true);
  }, [camera]);

  const remainingDistanceMeters = useMemo(
    () => (route ? route.steps.slice(activeStepIndex).reduce((sum, s) => sum + s.distanceMeters, 0) : 0),
    [route, activeStepIndex]
  );
  // Real, live-traffic-synced figure whenever one's landed for this route (see the live-ETA
  // refresh effect above) -- the step-sum fallback only ever reflects the ORIGINAL plan's
  // per-step durations, so without this override, the headline ETA would just count down a
  // stale estimate for the whole trip instead of actually responding to current conditions.
  const remainingDurationSeconds = useMemo(
    () =>
      liveEtaSeconds ??
      (route ? route.steps.slice(activeStepIndex).reduce((sum, s) => sum + s.durationSeconds, 0) : 0),
    [route, activeStepIndex, liveEtaSeconds]
  );
  // The arrival time moves on with the clock (every 30 s), not only when the ETA changes -- it
  // used to stay frozen while stopped in traffic.
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!route) return;
    const t = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [route]);
  const arrivalClockText = useMemo(
    () => (route ? formatArrivalClock(clockNow + remainingDurationSeconds * 1000) : ""),
    [route, remainingDurationSeconds, clockNow]
  );

  // Keeps the real native Live Activity (Lock Screen/Dynamic Island, started in confirmRoute)
  // showing genuinely current data -- immediately whenever the active turn actually changes
  // (activeStepIndex), and otherwise on a plain 15s tick while a trip is live, same throttling
  // idea as the AI Detection screen's own side-capture loop: real live data, but not hammering
  // a system API on every single GPS tick. All values read fresh at call time (useCallback with
  // no stale-closure risk since every dependency below is itself already live render state).
  const pushLiveActivityUpdate = useCallback(() => {
    if (!route) return;
    const step = route.steps[activeStepIndex];
    updateNavNotification({
      instruction: step?.instruction ?? "Continue on route",
      distanceText: `${(remainingDistanceMeters / 1000).toFixed(1)} km`,
      etaText: formatDurationText(remainingDurationSeconds),
      roadName: currentRoadName ?? "",
    });
    updateLiveActivity({
      instruction: step?.instruction ?? "Continue on route",
      maneuverSymbol: maneuverToSfSymbol(step?.maneuver),
      distanceText: `${(remainingDistanceMeters / 1000).toFixed(1)} km`,
      etaText: formatDurationText(remainingDurationSeconds),
      roadName: currentRoadName ?? "",
      currentSpeedKmh: currentSpeedKmh !== null ? Math.round(currentSpeedKmh) : null,
      speedLimitKmh,
    });
  }, [
    route,
    activeStepIndex,
    remainingDistanceMeters,
    remainingDurationSeconds,
    currentRoadName,
    currentSpeedKmh,
    speedLimitKmh,
  ]);

  useEffect(() => {
    if (!route) return;
    pushLiveActivityUpdate();
    const interval = setInterval(pushLiveActivityUpdate, 15000);
    return () => clearInterval(interval);
    // Deliberately re-runs (firing an immediate update + resetting the 15s tick) on every
    // activeStepIndex change -- a fresh turn instruction reaching the Lock Screen right away
    // matters more here than the interval staying perfectly aligned.
  }, [route, activeStepIndex, pushLiveActivityUpdate]);

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
          etaText: formatDurationText(remainingDurationSeconds),
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
      `I'm on my way — ETA ${formatDurationText(remainingDurationSeconds)}, arriving around ${arrivalClockText}. ` +
      `Follow my live location: ${liveLink}`;
    try {
      await Share.share({ message });
    } catch (err) {
      Sentry.logger.error("map: share ETA failed", { error: String(err) });
      console.warn("[map] share ETA failed", err);
    }
  }, [route, currentLatLng, arrivalClockText, remainingDurationSeconds, heading, user]);

  const onNavOptionsShareEta = useCallback(() => {
    navOptionsSheetRef.current?.close();
    shareEta();
  }, [shareEta]);
  // Map view while driving, cycled from the ETA sheet: 3D (tilted, heading-up) -> 2D (flat,
  // heading-up) -> North up (flat) -> 3D. 3D/2D is the saved "default map view" setting; north-up
  // is just for this drive. Applied to the camera straight away.
  type NavView = "3d" | "2d" | "northUp";
  const navView: NavView = navNorthUp ? "northUp" : settings.defaultMapViewStyle === "flat" ? "2d" : "3d";
  const NAV_VIEW_LABEL: Record<NavView, string> = { "3d": "3D", "2d": "2D", northUp: "North up" };
  const applyNavView = useCallback(
    (next: NavView) => {
      setNavNorthUp(next === "northUp");
      const flat = next !== "3d";
      if ((settings.defaultMapViewStyle === "flat") !== flat) updateSettings({ defaultMapViewStyle: flat ? "flat" : "tilted3d" });
      const here = currentLatLngRef.current;
      if (here) {
        // Picking a view is asking to see the drive: following again, in that view.
        camera.recentre();
        const pose = navFollowPose(here, next === "northUp" || settings.keepNorthUp ? 0 : navBearingRef.current, currentSpeedKmhRef.current, flat);
        if (camera.move("navFollow", pose, { duration: 500 })) mapBearing.set(pose.heading);
      }
    },
    [settings.defaultMapViewStyle, settings.keepNorthUp, updateSettings, currentLatLngRef, currentSpeedKmhRef, mapBearing, camera, navBearingRef]
  );
  const nextNavView: Record<NavView, NavView> = { "3d": "2d", "2d": "northUp", northUp: "3d" };

  // "Go" in Search along route: that place becomes the destination, routed from here now (the
  // stop, if any, is dropped -- going somewhere else instead).
  const goInsteadDuringNav = useCallback(
    async (place: PlaceDetails) => {
      const here = currentLatLngRef.current;
      if (!here) return;
      setRerouting(true);
      try {
        const fresh = (await getRouteChoices(here, place.location, avoidRouteOptions(settings.routeAvoid)))[0];
        setStops([]);
        setNavDestinationPlace(place);
        startRoute(fresh, place);
      } catch (err) {
        Sentry.logger.error("map: go instead failed", { error: String(err) });
        Alert.alert("Couldn't route there", "Your current drive is kept. Check your connection and try again.");
      } finally {
        setRerouting(false);
      }
    },
    [currentLatLngRef, settings.routeAvoid, startRoute]
  );

  // Avoid while driving: the switches, then the route is worked out again from here with them.
  const onToggleAvoidDuringNav = useCallback(
    async (key: RouteAvoidKey, value: boolean) => {
      const next = { ...settings.routeAvoid, [key]: value };
      updateSettings({ routeAvoid: next });
      const here = currentLatLngRef.current;
      if (!here || !destinationLatLng || travelMode !== "driving") return;
      setRerouting(true);
      try {
        const fresh = (await getRouteChoices(here, destinationLatLng, { ...avoidRouteOptions(next), waypoint: stopWaypoints ?? undefined }))[0];
        guidanceRef.current = createGuidanceState();
        setActiveStepIndex(0);
        setRoute(fresh);
        setAcceptedSuggestionOriginalRoute(null);
      } catch (err) {
        Sentry.logger.error("map: avoid reroute failed", { error: String(err) });
        Alert.alert("Couldn't change the route", "Your current route is kept. Check your connection and try again.");
      } finally {
        setRerouting(false);
      }
    },
    [settings.routeAvoid, updateSettings, currentLatLngRef, destinationLatLng, travelMode, stopWaypoints]
  );

  // Voice command while driving (the microphone button): the phone's own speech recogniser hears
  // it, nav/voiceCommand.ts decides what it means. "Stop navigation" ends the drive the same way
  // as every other end path (exitNavigation).
  const [navListening, setNavListening] = useState(false);
  const navVoiceSessionRef = useRef<VoiceSearchSession | null>(null);
  const navCommandRef = useRef<(text: string) => void>(() => {});
  const listenForNavCommand = useCallback(() => {
    if (navVoiceSessionRef.current) {
      navVoiceSessionRef.current.stop();
      return;
    }
    setNavListening(true);
    startVoiceSearch(navLanguage, {
      onPartial: () => {},
      onFinal: (text) => navCommandRef.current(text),
      onEnd: () => {
        navVoiceSessionRef.current = null;
        setNavListening(false);
      },
      onError: (failure) => {
        setNavListening(false);
        Alert.alert("Voice command", VOICE_SEARCH_MESSAGES[failure]);
      },
    }).then((session) => {
      navVoiceSessionRef.current = session;
      if (!session) setNavListening(false);
    });
  }, [navLanguage]);
  // THE end of a drive (nav/endDrive.ts): Stop, long-press + confirm, the voice command, the X on
  // the top bar and arriving all come here, so the reset can't differ by path. Closes and unmounts
  // every driving overlay, clears the route from the map, stops guidance, saves the trip to
  // Recents, and eases the camera back to the live location in the home follow view (or snaps to
  // the first fix if there isn't one right now).
  const homeSnapPendingRef = useRef(false);
  // "Remember where I parked" (nav/autoParking.ts): saved on arrival, or once you walk away.
  const autoParkingOnRef = useLatest(settings.autoParking);
  const travelModeRef = useLatest(travelMode);
  const navMatchRef = useLatest(navMatch);
  const savedPlacesRef = useLatest(savedPlaces);
  const parkingWatchRef = useRef<ParkingWatch | null>(null);
  const saveAutoParking = useCallback((spot: { latitude: number; longitude: number; label: string }) => {
    setParkingSpot(spot)
      .then(() => {
        setBannerMessage("Parking spot saved — tap the P to walk back to your car.");
        setBannerVisible(true);
      })
      .catch((err) => Sentry.logger.error("map: auto parking save failed", { error: String(err) }));
  }, []);
  useEffect(() => {
    const watch = parkingWatchRef.current;
    if (!watch || !currentLatLng || route) return;
    const verdict = onFixAfterDrive(watch, { ...currentLatLng, speedKmh: currentSpeedKmh ?? null, at: Date.now() });
    if (!verdict) return;
    parkingWatchRef.current = null;
    if (verdict === "save") saveAutoParking({ latitude: watch.at.latitude, longitude: watch.at.longitude, label: watch.label });
  }, [currentLatLng, currentSpeedKmh, route, saveAutoParking]);

  const exitNavigation = useCallback(
    (reason: EndReason = "exit") => {
      Sentry.logger.info("map: drive ended", { reason });
      if (autoParkingOnRef.current && travelModeRef.current === "driving") {
        const end = currentLatLngRef.current;
        const dest = navDestinationPlaceRef.current;
        const decision = onDriveEnd({
          reason,
          at: end,
          label: reason === "arrived" && dest ? dest.address || dest.name : "Where you parked",
          drivenM: navMatchRef.current?.along ?? 0,
          endedAt: Date.now(),
          home: savedPlacesRef.current.home?.location ?? null,
        });
        parkingWatchRef.current = decision.watch;
        if (decision.save) saveAutoParking(decision.save);
      }
      stopNavSpeech();
      navVoiceSessionRef.current?.stop();
      navOptionsSheetRef.current?.close();
      reportSheetRef.current?.close();
      soundSheetRef.current?.close();
      directionsSheetRef.current?.close();
      toolsSheetRef.current?.close();
      setSearchAlongOpen(false);
      setNavAlternatives(null);
      setArrivalParking(null);
      setWalkAfterParking(null);
      setNavAvoidOpen(false);
      setAddingStopDuringNav(false);
      setStopPreviewRoute(null);
      setStopPreviewPlace(null);
      setOverviewMode(false);
      setTrafficSuggestionRoute(null);
      setTrafficSuggestionSavedSeconds(0);
      setFasterRouteBanner(null);
      setManoeuvreChip(null);
      setAlertCard(null);
      setRerouting(false);
      setNavNorthUp(false);
      setArrival(null);
      approachRef.current = INITIAL_APPROACH;
      setApproach(INITIAL_APPROACH);
      guidanceRef.current = createGuidanceState();
      // Ending navigation is the other way back into following (permanent fix §2).
      camera.setMode("FOLLOW", false);
      // The trip's destination goes into Recents (a dropped pin has no name to list).
      const place = navDestinationPlaceRef.current;
      if (place && place.placeId) addSearchHistoryEntry(place).catch(() => {});
      setPlanDriveFor(null);
      const pose = homeCameraAfterDrive(currentLatLngRef.current, followHeadingRef.current, northUpRef.current);
      if (pose) {
        camera.move("transition", pose, { duration: HOME_RESET_MS });
        mapBearing.set(pose.heading);
      } else {
        homeSnapPendingRef.current = true;
      }
      setRoute(null);
      setActiveStepIndex(0);
      setStops([]);
      setDestinationLatLng(null);
      setAcceptedSuggestionOriginalRoute(null);
    // Ends the real native Live Activity started in confirmRoute -- fire-and-forget, same
    // reasoning as endLiveShare below (nothing useful to block exit on; a safe no-op on
    // Android/unsupported iOS versions/no activity currently running).
    endLiveActivity();
    endNavNotification();
    // Per explicit user answer ("Until navigation ends"), a share started this trip stops
    // updating right here -- fire-and-forget since there's nothing useful to block exit on.
    if (liveShareIdRef.current) {
      const shareId = liveShareIdRef.current;
      liveShareIdRef.current = null;
      endLiveShare(shareId).catch((err) => {
        Sentry.logger.error("map: end live share failed", { error: String(err) });
      });
    }
    // Real, explicit request -- "Auto-ghost ... on arrival." This is the one real place a trip
    // ends (the manual Exit button today; any future automatic arrival detection would call
    // this same function), so it's the real, single hook point for that trigger -- see
    // useAutoGhostMode.ts's own comment.
    autoGhostOnArrival(visibilityRef.current, updateSettingsRef.current);
    },
    [currentLatLngRef, northUpRef, mapBearing, navDestinationPlaceRef, autoParkingOnRef, travelModeRef, navMatchRef, savedPlacesRef, saveAutoParking, camera]
  );
  // No fix when the drive ended: snap home to the first one that arrives.
  useEffect(() => {
    if (!homeSnapPendingRef.current || !currentLatLng || route) return;
    homeSnapPendingRef.current = false;
    const pose = homeCameraAfterDrive(currentLatLng, followHeadingRef.current, northUpRef.current);
    if (pose) camera.move("follow", pose, { duration: 0 });
  }, [currentLatLng, route, northUpRef, camera]);

  // "You've arrived": the destination, the time, Rate drive / Park here / Done. Ends the drive
  // after ARRIVAL_CARD_MS or on Done (any button ends it too, after doing its job).
  useEffect(() => {
    if (!arrival) return;
    const t = setTimeout(() => exitNavigation("arrived"), ARRIVAL_CARD_MS);
    return () => clearTimeout(t);
  }, [arrival, exitNavigation]);

  useEffect(() => {
    navCommandRef.current = (text: string) => {
      // "Crash ahead", "police on the left": a report, sent from here (nav/voiceReport.ts).
      const spokenReport = parseVoiceReport(text);
      if (spokenReport) return void sendVoiceReport(spokenReport);
      const cmd = parseNavVoiceCommand(text);
      if (cmd === "stop") exitNavigation("voice");
      else if (cmd === "report") openAlertTypePicker();
      else if (cmd === "mute") updateSettings({ spokenDirections: "off" });
      else if (cmd === "unmute") updateSettings({ spokenDirections: "normal" });
      else if (cmd === "routes") showNavRoutes();
      else if (cmd === "search") setSearchAlongOpen(true);
      else Alert.alert("Voice command", `Didn't catch a command in "${text}". Try "crash ahead", "police on the left", "stop navigation" or "mute".`);
    };
  });

  // "Hey TrackLine" (Settings > Voice guidance, opt-in): on the phone, while this screen is open
  // and the app is in front; off while the mic button is listening (one microphone).
  const wakeIntentRef = useRef<(i: WakeIntent) => void>(() => {});
  useEffect(() => {
    wakeIntentRef.current = (i: WakeIntent) => {
      if (i.kind === "report") void sendVoiceReport(i.report);
      else if (i.kind === "mute") updateSettings({ spokenDirections: "off" });
      else if (i.kind === "unmute") updateSettings({ spokenDirections: "normal" });
      else if (i.kind === "stop") {
        if (route) exitNavigation("voice");
      } else if (i.kind === "eta") {
        announcePhrase({ kind: "said", text: route ? `You'll arrive at ${arrivalClockText}, in ${formatDurationText(remainingDurationSeconds)}` : "You're not navigating" });
      } else if (i.kind === "drive") {
        getSavedPlaces()
          .then((saved) => {
            const place = saved[i.to];
            if (place) onDestinationSelected(place);
            else announcePhrase({ kind: "said", text: `Save your ${i.to} address first` });
          })
          .catch(() => {});
      } else announcePhrase({ kind: "said", text: "Sorry, I didn't catch that" });
    };
  });
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const wakeOn = settings.wakePhrase && appActive && isFocused && !navListening;
  useEffect(() => {
    if (!wakeOn) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startWakeListener(
      RECOGNITION_LOCALES[navLanguage] ?? "en-AU",
      (i) => wakeIntentRef.current(i),
      (status) => {
        if (status === "denied" || status === "unavailable") {
          setBannerMessage(status === "denied" ? "“Hey TrackLine” needs microphone and speech access in your phone's Settings." : "“Hey TrackLine” needs on-device speech recognition, which this phone doesn't have.");
          setBannerVisible(true);
        }
      }
    ).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [wakeOn, navLanguage]);

  // The ETA sheet's "On your route" list: reports and live incidents within reach of the road
  // still ahead. Only worked out while the sheet is open.
  // The ETA sheet's "On your route": every ahead alert in order, with road, distance and time.
  const aheadRows = useMemo<AheadRow[]>(() => {
    if (!route) return [];
    const pace = remainingDistanceMeters > 0 ? remainingDurationSeconds / remainingDistanceMeters : null;
    // A siren has no place on the route, so it isn't listed (it's in the banner and spoken).
    return aheadFeedNow.filter((a) => a.source !== "siren").map((a) => ({
      key: a.key,
      kind: a.kind,
      title: a.title,
      road: roadAtAlong(route.steps, a.alongM),
      aheadM: a.aheadM,
      etaSeconds: pace != null ? Math.round(a.aheadM * pace) : null,
    }));
  }, [route, aheadFeedNow, remainingDistanceMeters, remainingDurationSeconds]);
  // ---- Multi-stop (nav/multiStop.ts): each stop's distance + time, "Arriving at stop 1" ----
  const stopRowsNow = useMemo(() => {
    if (!route || !stops.some((x) => !x.reached)) return [];
    const pace = remainingDistanceMeters > 0 ? remainingDurationSeconds / remainingDistanceMeters : null;
    return stopRows(stops, route.polyline, navMatch?.along ?? 0, pace);
  }, [route, stops, navMatch, remainingDistanceMeters, remainingDurationSeconds]);
  useEffect(() => {
    if (!navMatch?.onRoute) return;
    const ev = nextStopEvent(stops, stopRowsNow);
    if (!ev) return;
    if (ev.kind === "arriving") announcePhrase({ kind: "said", text: `Arriving at stop ${ev.number}, ${ev.name}` });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the stop the car just reached (GPS progress), once
    setStops((prev) => markStop(prev, ev.id, ev.kind === "arriving" ? { announced: true } : { reached: true }));
    // announcePhrase is stable for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRowsNow, navMatch?.onRoute]);
  const stopsSection = useMemo(
    () =>
      stopRowsNow.length
        ? {
            rows: stopRowsNow,
            onMove: (id: string, dir: -1 | 1) => applyStopsDuringNav(moveStop(stops, id, dir)),
            onRemove: (id: string) => applyStopsDuringNav(removeStop(stops, id)),
          }
        : null,
    [stopRowsNow, stops, applyStopsDuringNav]
  );

  // ---- Arrival flow: car parks near the destination from 1 km out (nav/arrivalFlow.ts) ----
  const fetchArrivalParking = useCallback((key: string, near: string, nearLocation: LatLng) => {
    setArrivalParking({ key, near, nearLocation, state: "loading" });
    withTimeout(searchNearbyOsmPlaces(nearLocation, "parking", undefined, PARKING_NEAR_M), 10_000, "Car parks")
      .then((places) => {
        const offers = rankParking(nearLocation, places);
        setArrivalParking((cur) => (cur?.key === key ? { key, near, nearLocation, state: "ready", offers } : cur));
        if (offers.length) announcePhrase({ kind: "said", text: `There's parking near ${near}. It's in the trip sheet.` });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error && /timed out/.test(err.message) ? "no answer in 10 s" : "the map data service didn't answer";
        setArrivalParking((cur) => (cur?.key === key ? { key, near, nearLocation, state: "error", message } : cur));
      });
    // announcePhrase is stable for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const arrivalParkingKey = navDestinationPlace ? `${navDestinationPlace.placeId}:${navDestinationPlace.location.latitude.toFixed(5)},${navDestinationPlace.location.longitude.toFixed(5)}` : null;
  useEffect(() => {
    if (!route || travelMode !== "driving" || !navDestinationPlace || !arrivalParkingKey) return;
    if (!shouldOfferParking(remainingDistanceMeters, navDestinationPlace, arrivalParking?.key === arrivalParkingKey)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- crossing 1 km from the destination starts an external lookup (OpenStreetMap car parks); "loading" is its state
    fetchArrivalParking(arrivalParkingKey, navDestinationPlace.name, navDestinationPlace.location);
  }, [route, travelMode, navDestinationPlace, arrivalParkingKey, remainingDistanceMeters, arrivalParking?.key, fetchArrivalParking]);
  const parkingSection = useMemo<ParkingSection | null>(() => {
    const p = arrivalParking;
    if (!p || p.key !== arrivalParkingKey) return null;
    if (p.state === "loading") return { state: "loading", near: p.near };
    if (p.state === "error") return { state: "error", near: p.near, message: p.message, onRetry: () => fetchArrivalParking(p.key, p.near, p.nearLocation) };
    return {
      state: "ready",
      near: p.near,
      offers: p.offers,
      onGo: (placeId: string) => {
        const o = p.offers.find((x) => x.placeId === placeId);
        const going = navDestinationPlaceRef.current;
        if (!o || !going) return;
        navOptionsSheetRef.current?.close();
        // Remember where you were really going, for the walk on arrival.
        setWalkAfterParking({ name: going.name, address: going.address ?? null, location: going.location });
        goInsteadDuringNav({ placeId: o.placeId, name: o.name, address: o.address, location: o.location });
      },
    };
  }, [arrivalParking, arrivalParkingKey, fetchArrivalParking, goInsteadDuringNav, navDestinationPlaceRef]);
  const arrivalWalk = arrival ? walkLeft(arrival.location ?? currentLatLng, walkAfterParking) : null;

  const onAheadRowPress = useCallback(
    (key: string) => {
      const a = aheadFeedNow.find((x) => x.key === key);
      if (!a) return;
      navOptionsSheetRef.current?.close();
      // Off the follow camera (Re-centre comes back), and over to the spot.
      camera.move("focus", { center: { latitude: a.lat, longitude: a.lng }, zoom: 16, pitch: 0 }, { duration: 600 });
    },
    [aheadFeedNow, camera]
  );
  const etaSheetEvents = useMemo(() => {
    if (!route || remainingPolyline.length < 2) return [];
    const points: RoutePoint[] = [
      ...nearbyAlerts.map((a) => ({ id: `a-${a.id}`, kind: "report" as const, label: ALERT_LABELS[a.type] ?? "Report", lat: a.lat, lng: a.lng })),
      ...trafficIncidents.map((i) => ({ id: `i-${i.id}`, kind: "incident" as const, label: i.category || i.headline, lat: i.lat, lng: i.lng })),
    ];
    return eventsAlongRoute(remainingPolyline, points);
  }, [route, remainingPolyline, nearbyAlerts, trafficIncidents]);
  // Only name the place if it's still where this trip ends (a later dropped-pin trip has none).
  const etaSheetPlace =
    navDestinationPlace &&
    destinationLatLng &&
    distanceKm(navDestinationPlace.location.latitude, navDestinationPlace.location.longitude, destinationLatLng.latitude, destinationLatLng.longitude) < 0.2
      ? navDestinationPlace
      : null;
  // Google's predicted drive time from here if you left now or at the next quarter hours.
  const loadLeaveTimes = useCallback(() => {
    if (!currentLatLng || !destinationLatLng) return Promise.reject(new Error("no current location"));
    const origin = currentLatLng;
    const dest = destinationLatLng;
    const waypoint = stopWaypoints ?? undefined;
    return predictLeaveTimes(departureSlots(Date.now()), (t) =>
      getDirections(origin, dest, { useTraffic: t === "now" ? true : t, waypoint }).then((r) => r.durationInTrafficSeconds ?? r.durationSeconds)
    );
  }, [currentLatLng, destinationLatLng, stopWaypoints]);
  const onNavOptionsEndNavigation = useCallback(() => exitNavigation("stop"), [exitNavigation]);

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
        etaText: formatDurationText(remainingDurationSeconds),
        arrivalClockText,
      }).catch((err) => {
        Sentry.logger.error("map: update live share failed", { error: String(err) });
      });
    }, 12000);
    return () => clearInterval(interval);
  }, [route, heading, arrivalClockText, remainingDurationSeconds, currentLatLngRef]);

  // Road features on the route while driving are ahead alerts now (nav/ahead: banner + pins).
  // Off a drive: cameras (and, at street level, traffic lights) in view as road-sign icons.
  const homeRoadSignList = useMemo(() => {
    const points: SignPoint[] = [];
    for (const p of osmData?.trafficLights ?? []) points.push({ key: `tl:${p.id}`, item: "trafficLights", lat: p.lat, lng: p.lng });
    for (const p of osmData?.speedCameras ?? []) points.push({ key: `sc:${p.id}`, item: "speedCamera", lat: p.lat, lng: p.lng });
    for (const p of osmFeaturePins({ ...settings, reportPrefs: settings.reportPrefs }, osmData, nearbyAlerts)) {
      // Cameras as road signs; every other road feature by zoom (roadFeatureState): icon / mark / hidden.
      points.push({ key: p.id, item: p.kind as ReportItemId, lat: p.lat, lng: p.lng });
    }
    // Before the map first reports where it's looking, it's looking at you.
    const centre = viewCentre ?? currentLatLng;
    const view = centre ? { latitude: centre.latitude, longitude: centre.longitude, latitudeDelta: osmZoomDelta, zoom: zoomFromLatitudeDelta(osmZoomDelta) } : null;
    return homeRoadSigns(points, view, { navigating: !!route, shown: (item) => isShown(settings, item) });
  }, [osmData, settings, nearbyAlerts, viewCentre, currentLatLng, osmZoomDelta, route]);

  // ---- What the Mapbox map draws (map-v2/MapboxLayers.tsx) ----
  // Every icon pin with what tapping it does, keyed by the pin's id.
  const mapboxPinData = useMemo(() => {
    const pins: MapPin[] = [];
    const targets = new Map<string, PinTarget>();
    const add = (pin: MapPin, target?: PinTarget) => {
      pins.push(pin);
      if (target) targets.set(pin.id, target);
    };
    for (const cluster of alertPins.clusters) {
      add(
        { id: `alert-cluster:${cluster.ids[0]}`, coordinate: { latitude: cluster.lat, longitude: cluster.lng }, icon: "alert-cluster", label: String(cluster.count), priority: 20 },
        { kind: "zoomTo", lat: cluster.lat, lng: cluster.lng }
      );
    }
    for (const { alert, size, mid } of alertPins.singles) {
      // A reported road feature (speed bump, crossing...) is drawn like the mapped ones: small
      // grey icon / tiny mark / hidden by zoom -- never a big coloured badge.
      const feature = roadFeatureReportIcon(itemOfAlert(alert), mapZoom);
      if (feature === "hidden") continue;
      if (feature) {
        add({ id: `alert:${alert.id}`, coordinate: { latitude: alert.lat, longitude: alert.lng }, icon: feature, priority: 3 }, { kind: "alert", alert });
        continue;
      }
      add(
        {
          id: `alert:${alert.id}`,
          coordinate: { latitude: alert.lat, longitude: alert.lng },
          // Mid zoom: the same icon without its pointer, centred on the spot.
          icon: mid ? midPinIcon(reportPinIcon(alert)) : reportPinIcon(alert),
          size: size / 30,
          anchor: mid ? "center" : "bottom",
          priority: selectedAlert?.id === alert.id ? 31 : 30,
        },
        { kind: "alert", alert }
      );
    }
    for (const { alert, colour } of alertPins.dots) {
      if (roadFeatureReportIcon(itemOfAlert(alert), mapZoom)) continue; // road features: no far dots
      add({ id: `alert:${alert.id}`, coordinate: { latitude: alert.lat, longitude: alert.lng }, icon: `dot:${colour}`, anchor: "center", priority: 20 }, { kind: "alert", alert });
    }
    // Off a drive: cameras (and traffic lights at street level) in view, as road-sign icons.
    for (const f of homeRoadSignList) {
      add(
        { id: `road-sign:${f.key}`, coordinate: { latitude: f.lat, longitude: f.lng }, icon: signIcon(f.item, mapZoom), priority: signKind(f.item) === "other" ? 3 : 6 },
        {
          kind: "osm",
          osm: f.item === "trafficLights" ? "traffic_light" : f.item === "speedCamera" ? "speed_camera" : (f.item as OsmFeatureKind),
          at: { latitude: f.lat, longitude: f.lng },
        }
      );
    }
    // Ahead (nav/ahead): the next things on the route within 1.5 km, at most three, as raised
    // pins at their exact spot. Reports and Live Traffic NSW already have their own pins; these
    // are the mapped road features and live traffic, which have none.
    for (const a of aheadFeedNow.filter((x) => (x.source === "map" || x.source === "traffic") && x.aheadM <= MAP_ICONS_AHEAD_M).slice(0, MAX_MAP_ICONS)) {
      const pin = { id: `ahead:${a.key}`, coordinate: { latitude: a.lat, longitude: a.lng }, icon: `ahead:${a.kind}`, anchor: "bottom" as const, priority: 7 };
      if (a.source === "traffic" || !a.item) add(pin);
      else
        add(pin, {
          kind: "osm",
          osm: a.item === "trafficLights" ? "traffic_light" : a.item === "speedCamera" ? "speed_camera" : (a.item as OsmFeatureKind),
          at: { latitude: a.lat, longitude: a.lng },
        });
    }
    const venueLayer = (
      kind: "fuel" | "restaurant" | "hotel",
      clusters: typeof fuelViewportClusters
    ) => {
      for (const c of clusters) {
        if (c.count === 1) {
          const place = c.points[0].place;
          add({ id: `${kind}-vp:${place.placeId}`, coordinate: place.location, icon: kind, priority: 10 }, { kind: "venue", placeId: place.placeId });
        } else {
          add(
            { id: `${kind}-vpc:${c.key}`, coordinate: { latitude: c.lat, longitude: c.lng }, icon: `${kind}-cluster`, label: String(c.count), priority: 10 },
            { kind: "zoomTo", lat: c.lat, lng: c.lng }
          );
        }
      }
    };
    // The open nearby list's results: category badge, with the price or brand under it.
    const listPins = (icon: string, list: NearbyPin[]) => {
      for (const pin of list) {
        add({ id: `${icon}:${pin.id}`, coordinate: { latitude: pin.lat, longitude: pin.lng }, icon, caption: pin.label, priority: 11 }, { kind: "fuelPin", pin });
      }
    };
    if (fuelStationsSheetOpen) {
      listPins("fuel", fuelStationPins);
      venueLayer("fuel", fuelViewportClusters);
    }
    if (restaurantsSheetOpen) {
      listPins("restaurant", nearbyPins.food);
      venueLayer("restaurant", restaurantViewportClusters);
    }
    if (hotelsSheetOpen) {
      listPins("hotel", nearbyPins.hotel);
      venueLayer("hotel", hotelViewportClusters);
    }
    if (parkingSheetOpen) listPins("parking", nearbyPins.parking);
    {
      for (const incident of visibleIncidents(settings, nearbyTrafficIncidents)) {
        const st = incidentStyle(incident);
        // Far out (map/zoomStates.ts): a dot like every other item -- red for crashes and
        // closures, amber for the rest.
        const far = alertPins.state === "far";
        const farColour = /crash|collision|clos/i.test(`${incident.category} ${incident.headline}`) ? "red" : "amber";
        add(
          {
            id: `incident:${incident.id}`,
            coordinate: { latitude: incident.lat, longitude: incident.lng },
            ...(far ? { anchor: "center" as const } : {}),
            icon: far ? `dot:${farColour}` : `incident:${st.color}:${st.glyph}:${st.shape}:${st.icon}:${incident.major ? 1 : 0}`,
            priority: incident.major ? 26 : 25,
          },
          { kind: "incident", incident }
        );
      }
    }
    if (settings.showLiveCameras) {
      for (const camera of liveCameras) {
        add({ id: `livecam:${camera.id}`, coordinate: { latitude: camera.lat, longitude: camera.lng }, icon: "live-camera", priority: 12 }, { kind: "liveCamera", camera });
      }
    }
    if (placePage && !route && !pendingDestination) {
      add({ id: `place-page:${placePage.placeId}`, coordinate: placePage.location, icon: "place-page", priority: 60 });
    }
    if (!route && !pendingDestination) {
      for (const sp of savedPinPlaces(savedPlaces, parkingSpot)) {
        add({ id: `saved:${sp.kind}:${sp.placeId}`, coordinate: sp.location, icon: savedPinIcon(sp), anchor: "bottom", priority: 40 }, { kind: "saved", place: sp });
      }
    }
    if (originOverride && !route && !pickingOrigin && !inRouteSelection) {
      add({ id: "origin-override", coordinate: originOverride.location, icon: "origin", anchor: "bottom", priority: 55 }, { kind: "origin" });
    }
    return { pins, targets };
  }, [
    alertPins,
    selectedAlert?.id,
    // Settings > Reports switches, live traffic and camera layers all decide which pins show.
    settings,
    aheadFeedNow,
    homeRoadSignList,
    mapZoom,
    fuelStationsSheetOpen,
    fuelStationPins,
    nearbyPins,
    parkingSheetOpen,
    fuelViewportClusters,
    restaurantsSheetOpen,
    restaurantViewportClusters,
    hotelsSheetOpen,
    hotelViewportClusters,
    nearbyTrafficIncidents,
    liveCameras,
    placePage,
    route,
    pendingDestination,
    originOverride,
    pickingOrigin,
    inRouteSelection,
    savedPlaces,
    parkingSpot,
  ]);
  // Waze-match §1: a clean route-preview map (previewOverlays.ts).
  const mapOverlays = useMemo(
    () => overlaysFor(inRouteSelection ? "routePreview" : approachDrawing ? "approach" : "home", { pins: mapboxPinData.pins, presences: visiblePresences, badges: brandBadgesOn }),
    [inRouteSelection, approachDrawing, mapboxPinData.pins, visiblePresences, brandBadgesOn]
  );
  const onMapboxPinPress = useCallback(
    (pinId: string) => {
      const target = mapboxPinData.targets.get(pinId);
      if (!target) return;
      switch (target.kind) {
        case "zoomTo":
          return onPlaceClusterPress(target.lat, target.lng);
        case "alert":
          return onMarkerPress(target.alert);
        case "osm":
          return onOsmMarkerPress(target.osm, target.at);
        case "trafficLightCluster":
          return onTrafficLightClusterPress(target.lat, target.lng);
        case "speedCameraCluster":
          return onSpeedCameraClusterPress(target.lat, target.lng);
        case "venue":
          return onViewVenueDetails(target.placeId);
        case "saved":
          return setSelectedSaved(target.place);
        case "fuelPin":
          return target.pin.onPress();
        case "incident":
          return onOfficialPinPress(target.incident);
        case "liveCamera":
          return onLiveCameraPress(target.camera);
        case "origin":
          return onOriginMarkerPress();
      }
    },
    [
      mapboxPinData,
      onPlaceClusterPress,
      onMarkerPress,
      onOsmMarkerPress,
      onTrafficLightClusterPress,
      onSpeedCameraClusterPress,
      onViewVenueDetails,
      onOfficialPinPress,
      onLiveCameraPress,
      onOriginMarkerPress,
    ]
  );

  // Route preview camera: flat and north-up, fitted to every route (or the picked one) plus the
  // start and destination, inside the space the top card and the sheet leave (mapPadding). Runs
  // again when the routes, the mode, Avoid, the top card or the sheet's height change.
  useEffect(() => {
    if (!inRouteSelection || !mapReady || previewFit.lines.length === 0) return;
    const t = setTimeout(() => {
      const coords = previewFitCoordinates(previewFit.lines, routeOriginLatLng, pendingDestination?.location ?? null);
      camera.fit("previewFit", coords, { animated: true });
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the fit request and the UI sizes
  }, [previewFit, inRouteSelection, mapReady, routeTopCardBottom, routeSheetHeight]);

  const mapboxNavRoute = useMemo(() => (route ? detailedRoutePolyline(route) : null), [route]);
  // The purple street callout: only at the NEXT manoeuvre, and hidden once it's close enough
  // to sit on top of the arrow (the top bar already names the street then).
  const calloutVisible = showManoeuvreCallout(metersToManoeuvre);
  const mapboxTurnCallouts = useMemo(
    () =>
      route && !addingStopDuringNav && !stopPreviewRoute && calloutVisible && activeStepIndex < route.steps.length - 1
        ? [route.steps[activeStepIndex]].map((step) => ({ key: `turn-${activeStepIndex}`, coordinate: step.endLocation, text: step.targetStreetName ?? step.instruction }))
        : [],
    [route, addingStopDuringNav, stopPreviewRoute, activeStepIndex, calloutVisible]
  );
  const mapboxSelection = useMemo(
    () =>
      inRouteSelection
        ? {
            drawn: drawnSelection,
            selectedIndex: selectionIndex,
            selectedLine: selectedSelectionLine,
            trafficStretches: selectedTrafficStretches,
            bubbles: drawnSelection.flatMap(({ index }, pos) => {
              const anchor = selectionBubbleAnchors[pos];
              const row = selectionRows[index];
              return anchor && row
                ? [{ index, key: row.key, coordinate: anchor, timeText: row.timeText, tag: selectionTags[index] ?? null, selected: index === selectionIndex }]
                : [];
            }),
            start: routeOriginLatLng,
            destination: pendingDestination?.location ?? null,
            onSelect: onSelectRouteRow,
          }
        : null,
    [
      inRouteSelection,
      drawnSelection,
      selectionIndex,
      selectedSelectionLine,
      selectedTrafficStretches,
      selectionBubbleAnchors,
      selectionRows,
      selectionTags,
      routeOriginLatLng,
      pendingDestination,
      onSelectRouteRow,
    ]
  );
  const mapboxUser = useMemo(
    () =>
      currentLatLng
        ? {
            coordinate: currentLatLng,
            // No heading yet: null, so the arrow keeps its last direction (UserArrow), never a dot.
            heading: headingTrack.filter.shown ?? null,
            turret: route ? null : turret,
            fixTimeMs: location?.timestamp,
            accuracyMeters: currentAccuracyMeters,
            deviceHeading: route && compassConeAllowed ? deviceHeading : null,
            navigating: !!route,
            markerStyle: settings.mapMarkerStyle,
            ghost: settings.visibility === "ghost",
          }
        : null,
    [currentLatLng, headingTrack.filter.shown, location?.timestamp, currentAccuracyMeters, route, deviceHeading, compassConeAllowed, settings.mapMarkerStyle, settings.visibility, turret]
  );

  // A tap on a named place drawn by the Mapbox map: find it with Google Places (same details,
  // photos and hours as before) and open its card.
  const onMapboxPoiPress = useCallback(
    async (poi: { name: string; coordinate: LatLng }) => {
      if (route || placingAlert || anySheetOpen) return;
      setPlaceInfoLoading(true);
      try {
        const found = await searchPlaces(poi.name, poi.coordinate);
        if (!found[0]) return;
        const info = await getPlaceInfo(found[0].placeId);
        if (!info) return;
        setPlaceInfo(info);
        placeInfoSheetRef.current?.expand();
      } catch (err) {
        Sentry.logger.error("map: mapbox poi lookup failed", { error: String(err) });
      } finally {
        setPlaceInfoLoading(false);
      }
    },
    [route, placingAlert, anySheetOpen]
  );

  return (
    <View style={styles.container} onTouchStart={autoGoRunning ? stopAutoGo : undefined}>
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
      // Google provider on every platform, iOS included -- reverted back per explicit request
      // after briefly trying Apple's native MapKit on iOS for speed (see git history). Google
      // keeps the Settings map-theme picker (customMapStyle) actually working on iOS, which
      // Apple's renderer has no equivalent for -- that was the real, confirmed tradeoff Apple
      // Maps cost, not worth it after all. Android was never affected either way (already
      // Google, still needed there for the custom Map3DView native module).
      !mapboxUsable ? (
        <View style={[StyleSheet.absoluteFill, styles.mapPlaceholder]} testID="map-unavailable">
          <MapErrorBanner text={mapboxUnavailableReason() ?? "Map engine failed to start"} />
        </View>
      ) : (
        <TrackLineMap
          ref={mapRef}
          driver={currentLatLng}
          // Waze-match §1: the route preview map is clean -- no POI badges, signs, report dots or Trackys.
          badges={mapOverlays.badges}
          theme={mapTheme}
          labelLanguage={settings.mapLabels}
          roadThickness={settings.roadThickness}
          satellite={mapType === "hybrid"}
          dimmed={isPickingRoute}
          // Map styles §2: no raised buildings over satellite imagery.
          show3DBuildings={settings.show3DBuildings && !inRouteSelection && mapType !== "hybrid"}
          routeShown={!!route || inRouteSelection}
          showTraffic={showsTrafficLayer}
          padding={mapPadding}
          initialCenter={currentLatLng ?? { latitude: -33.8688, longitude: 151.2093 }}
          initialZoom={17}
          onRegionChangeComplete={onRegionChangeComplete}
          onPanDrag={onMapPanDrag}
          onPress={
            alertCard
              ? () => {
                  if (Date.now() - alertCardOpenedAtRef.current > 350) dismissAlertCard();
                }
              : undefined
          }
          onPoiPress={onMapboxPoiPress}
          onMapReady={() => setMapReady(true)}
        >
          <MapboxLayers
            routeColours={routeColours}
            navRoute={mapboxNavRoute}
            navTraffic={route ? navTraffic : []}
            closedStretches={closedStretches}
            navAlternatives={
              route && navAlternatives
                ? navAlternatives.map((alt, i) => ({
                    key: `alt-${i}`,
                    line: detailedRoutePolyline(alt),
                    label: altDeltaLabel(alt.durationInTrafficSeconds ?? alt.durationSeconds, remainingDurationSeconds),
                    onPress: () => switchToAlternative(alt),
                  }))
                : []
            }
            remaining={route ? remainingPolyline : []}
            onRoutePress={enterOverviewMode}
            turnCallouts={mapboxTurnCallouts}
            nextTurn={route && activeStep ? activeStep.endLocation : null}
            stopPreview={stopPreviewRoute ? detailedRoutePolyline(stopPreviewRoute) : null}
            trafficSuggestion={
              trafficSuggestionRoute && !stopPreviewRoute
                ? {
                    line: detailedRoutePolyline(trafficSuggestionRoute),
                    etaText: trafficSuggestionRoute.etaInTrafficText ?? trafficSuggestionRoute.etaText,
                    labelPoint: pointAtPolylineFraction(trafficSuggestionRoute.polyline, 0.5),
                  }
                : null
            }
            user={mapboxUser}
            presences={mapOverlays.presences}
            presenceCellSize={presenceCellSizeDegrees}
            onSelectPresence={onSelectPresenceBubble}
            onPresenceCluster={onPlaceClusterPress}
            selection={mapboxSelection}
            arrival={destinationLatLng ?? (pendingDestination && !route && !inRouteSelection ? pendingDestination.location : null)}
            pins={mapOverlays.pins}
            onPinPress={onMapboxPinPress}
            selectedComment={
              selectedAlert?.comment ? { coordinate: { latitude: selectedAlert.lat, longitude: selectedAlert.lng }, text: selectedAlert.comment } : null
            }
            manoeuvre={approachDrawing}
            schoolZones={schoolZoneDrawings}
          />
        </TrackLineMap>
      )
      )}

      {/* Real, confirmed bug: before this, nothing in the app ever reacted to a missing/denied
          location permission -- the map's own mount-time placeholder coordinate (an arbitrary
          engineering default, never meant to be shown to a real user) just sat there looking like
          a real position, with no indication it wasn't. Covers the whole screen (so that
          placeholder is never actually visible) until a real GPS fix lands; shows a real retry/
          Settings path once permission is genuinely denied, instead of silently giving up. */}
      {!currentLatLng && (
        <View style={styles.locationGateOverlay} pointerEvents="auto">
          {permissionDenied ? (
            <>
              <Icon name="map-marker-off-outline" size={40} color="#FFFFFF" />
              <Text style={styles.locationGateTitle}>Location access needed</Text>
              <Text style={styles.locationGateText}>
                TrackLine needs your real location to show you on the map and navigate — it never
                shows a placeholder or guessed position.
              </Text>
              <Button
                variant="primary"
                label={canAskAgain ? "Allow location access" : "Open settings"}
                onPress={() => (canAskAgain ? requestLocationPermission() : Linking.openSettings())}
                style={{ marginTop: spacing.sm }}
              />
            </>
          ) : (
            <>
              <ActivityIndicator color="#FFFFFF" size="large" />
              <Text style={styles.locationGateText}>Finding your real location…</Text>
            </>
          )}
        </View>
      )}

      {/* Real, explicit request -- live speed + posted speed limit, bottom-left, on the Home map
          view as well as during navigation (see useLiveSpeed.ts/LiveSpeedometer.tsx's own
          headers). Hidden entirely while a bottom sheet/picker covers this corner of the screen
          anyway, same real "don't render on top of stuff" gating every other on-demand overlay
          on this screen already follows. */}
      {!anySheetOpen &&
        !placingAlert &&
        !pendingDestination &&
        !pickingOrigin &&
        !pickingDestinationPoint &&
        // On the home map the dial is only shown with the sheet at its peek: it's fixed to the
        // map, and a raised sheet would otherwise slide up over it.
        (!!route || whereToSheetIndex === 0) && (
        <Reanimated.View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <LiveSpeedometer
          signBeside={aheadSignBeside}
          speedKmh={liveSpeed.speedKmh}
          speedLimitKmh={resolvedLimit?.kmh ?? null}
          unit={signUnit}
          signStyle={signStyle}
          schoolZone={resolvedLimit?.schoolZone ?? null}
          thresholdKmh={thresholdKmhFor(settings, resolvedLimit?.kmh ?? null)}
          showLimit={showLimitSign(settings.speedLimitDisplay, liveSpeed.speedKmh, resolvedLimit?.kmh ?? null)}
          onPressSign={() => setRoadReportOpen(true)}
          visible={speedometerVisible && settings.showSpeedometer}
          chimeEnabled={settings.speedWarningChimeEnabled}
          // Real, confirmed bug this fixes: this dial used a fixed bottom:24 regardless of
          // whether NavBottomBar (the full-width live ETA/distance/arrival-time strip, only
          // rendered once a route is active) was also on screen -- NavBottomBar's own real
          // measured height easily reaches well past 24px up from the bottom, so during
          // navigation the two sat directly on top of each other, the exact "speedometer
          // covered by the ETA bar" complaint. Every other bottom-anchored control on this
          // screen already shifts up by NavBottomBar's own real measured height
          // (bottomBarHeight) while a route is active -- this now does the same instead of
          // being the one exception.
          // On the home map it sits just above the sheet's peek edge, one slot above where
          // Re-centre appears, so the two never share a spot.
          bottom={
            route
              ? controlsBottom(insets.bottom, bottomBarHeight)
              : whereToHeights.peek + 12 + 58 * uiScale + 8
          }
        />
        </Reanimated.View>
      )}
      <RoadReportSheet
        visible={roadReportOpen}
        onClose={() => setRoadReportOpen(false)}
        uid={user?.uid ?? null}
        position={currentLatLng}
        heading={moving ? heading : null}
        region={currentLatLng ? regionAt(currentLatLng.latitude, currentLatLng.longitude).region : null}
        unit={signUnit}
        shownKmh={resolvedLimit?.kmh ?? null}
        schoolZoneId={schoolZoneNow?.shape.zone.id ?? null}
      />


      {/* Fixed center-of-screen pin for manual alert placement -- see the comment on
          onAlertTypeSelected/onRegionChangeComplete above for why this replaced a draggable
          Marker. Never moves itself; the map pans/zooms underneath it instead. */}
      {placingAlert && (
        <View style={styles.placementPinOverlay} pointerEvents="none">
          <Icon name="location" size={44} color={colors.danger} />
        </View>
      )}

      {/* Same fixed-center-pin pattern, for the "choose starting point" pin-drop picker -- blue
          to match the app's own accent (a start point, not a hazard report). */}
      {pickingOrigin && originPickerView === "pin" && (
        <View style={styles.placementPinOverlay} pointerEvents="none">
          <Icon name="location" size={44} color={colors.accent} />
        </View>
      )}

      {/* Green, matching this app's existing "arrival" convention (see destinationLatLng's own
          halo/pin below) -- the destination step that follows a confirmed start point. */}
      {pickingDestinationPoint && destinationPickerView === "pin" && (
        <View style={styles.placementPinOverlay} pointerEvents="none">
          <Icon name="location" size={44} color="#22C55E" />
        </View>
      )}


      {/* Custom "From" picker -- reachable either from the idle search panel's own From row
          (no destination picked yet) or from the route-options card's From row once one has
          been (see onOriginSelected re-fetching against pendingDestination when that's the
          case). Gated only on !pendingDestination||pickingOrigin isn't needed since pickingOrigin
          itself is the switch; it just needs to win over whichever of the two other panels would
          otherwise show for the current pendingDestination state. Defaults to the real pin-drop
          picker (openOriginPicker); the (X) on that view switches to this search fallback, per
          explicit request. */}
      {!route && !placingAlert && pickingOrigin && originPickerView === "search" && (
        <MapSurface>
          <DestinationSearchBar
            biasLocation={currentLatLng ?? undefined}
            onDestinationSelected={onOriginSearchPickedForPin}
            placeholder="Choose starting point"
            onCancel={cancelOriginPicker}
            showMyLocation
            myLocationAddress={liveAddress ?? undefined}
          />
        </MapSurface>
      )}

      {/* Same picker, the destination step that automatically follows once a start point is
          confirmed with no destination chosen yet (see confirmOriginPin). */}
      {!route && !placingAlert && pickingDestinationPoint && destinationPickerView === "search" && (
        <MapSurface>
          <DestinationSearchBar
            biasLocation={originPinLatLng ?? currentLatLng ?? undefined}
            onDestinationSelected={onDestinationSearchPickedForPin}
            placeholder="Choose destination"
            onCancel={cancelDestinationPicker}
          />
        </MapSurface>
      )}

      {!route && !pendingDestination && !placingAlert && !pickingOrigin && !pickingDestinationPoint && (
        // Real, explicit request (Waze-style redesign, Phase 2) -- the old always-floating-at-
        // the-top DestinationSearchBar is replaced by a real draggable "Where to?" bottom sheet.
        // Stays mounted (not gated on !anySheetOpen) so it can collapse to its peek height
        // rather than unmount/remount whenever a category chip opens Restaurants/Hotels/Fuel/
        // Parking on top of it (see onFindRestaurants/onFindHotels/onFindPetrol/onFindParking's
        // own whereToSheetRef.collapse() calls above).
        <MapSurface>
          <WhereToSheet
            ref={whereToSheetRef}
            biasLocation={routeOriginLatLng ?? undefined}
            onDestinationSelected={onDestinationSelected}
            onFindNearestStation={onFindNearestStation}
            findingNearestStation={findingNearestStation}
            onFindRestaurants={onFindRestaurants}
            onFindHotels={onFindHotels}
            onFindPetrol={onFindPetrol}
            onFindParking={onFindParking}
            bottomInset={bannerAreaHeight}
            visibleHeight={sheetVisibleHeight}
            onSheetChange={setWhereToSheetIndex}
            onPlaceChosen={onPlaceChosen}
          />
        </MapSurface>
      )}

      {placePage && !route && !pendingDestination && (
        <MapSurface>
          <PlacePage
            place={placePage}
            origin={currentLatLng}
            onBack={() => {
              closePlacePage();
              whereToSheetRef.current?.openSearch();
            }}
            onClose={closePlacePage}
            onViewRoutes={(place) => {
              setPlacePage(null);
              onDestinationSelected(place);
            }}
            onSeeMoreParking={(place) => {
              setParkingCenter(place.location);
              onFindParking();
            }}
            onPlanDrive={(place) => {
              closePlacePage();
              navigation.navigate("PlanADrive", { initialDestination: place });
            }}
          />
        </MapSurface>
      )}

      {!route && pendingDestination && pickingStop && !pickingOrigin && (
        <MapSurface>
          <DestinationSearchBar
            biasLocation={currentLatLng ?? undefined}
            onDestinationSelected={onStopSelected}
            placeholder="Add a stop on the way"
            onCancel={() => setPickingStop(false)}
          />
        </MapSurface>
      )}

      {inRouteSelection && pendingDestination && (
        <>
          <MapSurface>
            <RouteSelectionTopCard
              originLabel={originOverride?.name ?? YOUR_LOCATION_LABEL}
              destinationLabel={pendingDestination.name}
              onBack={cancelRouteOptions}
              onEditOrigin={openOriginPicker}
              onEditDestination={editDestinationFromRouteSelection}
              onSwap={onSwapOriginDestination}
              avoidLabel={avoidPillLabel(settings.routeAvoid)}
              avoidActive={avoidCount(settings.routeAvoid) > 0}
              onOpenAvoid={() => setAvoidSheetOpen(true)}
              travelMode={selectedMode}
              vehicle={selectedMode === "drive" || selectedMode === "motorbike" ? vehicleOption(selectedMode === "motorbike" ? "motorcycle" : settings.vehicleType) : null}
              onOpenMode={() => setModeSheetOpen(true)}
              onHeightChange={setRouteTopCardBottom}
            />
          </MapSurface>
          <MapSurface>
            <RouteSelectionSheet
              rows={selectionRows}
              selectedIndex={selectionIndex}
              onSelect={onSelectRouteRow}
              loading={loadingRouteOptions}
              errorText={routeOptionsError}
              notice={routeOfflineNote ?? (selectedMode === "motorbike" ? modeResults.motorbike?.note ?? null : vehicleRouteNote(settings.vehicleType, selectedMode))}
              loadingText={
                travelMode === "driving"
                  ? "Finding the best routes…"
                  : `Finding a ${TRAVEL_MODE_LABELS[travelMode].toLowerCase()} route…`
              }
              onLeaveLater={travelMode === "driving" ? leaveLaterFromRouteSelection : undefined}
              onEditDrive={fromPlanADrive && pendingDestination ? () => navigation.navigate("PlanADrive", { initialDestination: pendingDestination }) : undefined}
              onGoNow={goNowFromRouteSelection}
              countdownRunning={autoGoRunning && travelMode === "driving" && !reduceMotion}
              onCountdownDone={goNowFromRouteSelection}
              onAddStop={travelMode !== "transit" ? () => setPickingStop(true) : undefined}
              onDetails={selectionRoutes[selectionIndex] && (travelMode === "transit" || routeHasFerry(selectionRoutes[selectionIndex])) ? openTripDetails : undefined}
              hasStop={!!stopWaypoints}
              stopNames={stops.filter((x) => !x.reached).map((x) => x.name)}
              stopsFull={stops.filter((x) => !x.reached).length >= MAX_STOPS}
              onClearStops={() => {
                setStops([]);
                if (pendingDestination && routeOriginLatLng) requestRoutes(routeOriginLatLng, pendingDestination.location, undefined, selectedMode);
              }}
              onHeightChange={setRouteSheetHeight}
            />
          </MapSurface>
          <TripDetailsSheet
            visible={tripDetails.open}
            route={selectionRoutes[selectionIndex] ?? null}
            alternatives={selectionRoutes}
            realtime={tripDetails.realtime}
            realtimeNote={tripDetails.note}
            inNsw={!!routeOriginLatLng && classifyAuRegion(routeOriginLatLng.latitude, routeOriginLatLng.longitude) === "NSW"}
            onClose={() => setTripDetails((t) => ({ ...t, open: false }))}
          />
          <MapSurface>
            <AvoidSheet
              visible={avoidSheetOpen}
              prefs={settings.routeAvoid}
              onToggle={onToggleAvoid}
              onClose={() => setAvoidSheetOpen(false)}
              note={routeAvoidNote}
            />
          </MapSurface>
          <MapSurface>
            <TravelModeSheet
              visible={modeSheetOpen}
              mode={selectedMode}
              summaries={ferrySummary ? { ...modeSummaries, ferry: ferrySummary } : modeSummaries}
              ferryAvailable={ferryAvailable}
              note={selectedMode === "motorbike" ? modeResults.motorbike?.note ?? null : null}
              onSelect={(mode) => {
                setModeSheetOpen(false);
                onSelectTravelMode(mode);
              }}
              vehicle={settings.vehicleType}
              onSelectVehicle={(v) => {
                setModeSheetOpen(false);
                onSelectVehicle(v);
              }}
              onClose={() => setModeSheetOpen(false)}
            />
          </MapSurface>
        </>
      )}

      {__DEV__ && route && (
        <Chip
          icon={simulatingDrive ? "stop" : "car-sport"}
          label={simulatingDrive ? "Stop simulation" : "Simulate drive"}
          onPress={() => (simulatingDrive ? stopSimulatedDrive() : startSimulatedDrive(remainingPolyline.length > 1 ? remainingPolyline : detailedRoutePolyline(route), route.steps))}
          accessibilityLabel={simulatingDrive ? "Stop simulated drive" : "Simulate drive"}
          onMap style={[styles.simulateDriveSpot, { bottom: insets.bottom + bottomBarHeight + spacing.xl * 3 }]}
        />
      )}

      {route && (
        <NavigationInstructionCard
          step={activeStep}
          roadName={navRoadName}
          themeKey={settings.navCardTheme}
          onExit={() => exitNavigation("exit")}
          onExpandDirections={() => directionsSheetRef.current?.expand()}
          onHeightChange={setInstructionCardHeight}
          nextStep={route.steps[activeStepIndex + 1] ?? null}
          isFinalStep={activeStepIndex === route.steps.length - 1}
          onRepeatInstruction={() => {
            // Tapping the card repeats the instruction on request -- so it's said whatever
            // "Spoken directions" is set to, in the selected voice, with the real distance left.
            if (!activeStep) return;
            const distanceMeters = currentLatLng
              ? remainingStepMeters(activeStep, currentLatLng.latitude, currentLatLng.longitude)
              : activeStep.distanceMeters;
            speakPlan(
              planStepAnnouncement({ step: activeStep, distanceMeters, kind: "early" }, settings.distanceUnit, navLanguage),
              { voiceIdentifier: voiceIdentifierRef.current, volume: voiceVolumeRef.current }
            );
          }}
          distanceUnit={settings.distanceUnit}
          lanes={laneStripLanes}
          metersToManoeuvre={metersToManoeuvre}
        />
      )}

      {/* Waze/Google-Maps-style bottom trip bar -- ETA/arrival/distance + road name, Add Stop,
          and the "..." options menu (Report/Share ETA/AI Detection/End -- see NavOptionsSheet).
          Hidden while the add-stop search or its green preview is up (both render their own
          bottom bar/confirm bar in this same screen region) to avoid stacking two bars. */}
      {route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && (
        <NavBottomBar
          etaText={formatDurationText(remainingDurationSeconds)}
          arrivalClockText={arrivalClockText}
          distanceRemainingText={formatDistance(remainingDistanceMeters, settings.distanceUnit)}
          roadName={navRoadName}
          themeKey={settings.navCardTheme}
          hasStop={!!stopWaypoints}
          onAddStop={() => setSearchAlongOpen(true)}
          onRemoveStop={removeStopDuringNav}
          onOptions={() => navOptionsSheetRef.current?.expand()}
          onLongPressEnd={() =>
            Alert.alert("End navigation?", undefined, [
              { text: "Keep driving", style: "cancel" },
              { text: "End", style: "destructive", onPress: () => exitNavigation("longPress") },
            ])
          }
          onHeightChange={setBottomBarHeight}
          isFollowing={followTilt}
          onRecenter={onRecenter}
          onOverview={showNavRoutes}
        />
      )}

      {/* Every floating control while driving, at the frames nav/navControlsLayout.ts computes
          (checked for overlaps on 320-430pt phones): compass, audio player, sound, voice command,
          the street chip and the info banner. */}
      {route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && (
        <NavMapControls
          safeTop={insets.top}
          safeBottom={insets.bottom}
          topBarHeight={instructionCardHeight}
          // The live road view sits on the ETA bar: the bottom controls go above it.
          bottomBarHeight={liveViewOn ? bottomBarHeight + 8 + liveViewH : bottomBarHeight}
          showSpeedLimit={!!speedLimitKmh}
          bearing={mapBearing}
          northUp={navNorthUp}
          onCompass={() => applyNavView(navNorthUp ? (settings.defaultMapViewStyle === "flat" ? "2d" : "3d") : "northUp")}
          showAudioPlayer={settings.showAudioPlayer}
          onAudioPlayer={openAudioPlayer}
          soundOff={settings.spokenDirections === "off"}
          onSound={() => soundSheetRef.current?.expand()}
          onVoice={listenForNavCommand}
          listening={navListening}
          streetName={navRoadName}
          banner={null}
          onBanner={() => navOptionsSheetRef.current?.expand()}
          dropBy={radarBanner && radarBannerHeight ? aheadRoomFor(radarBannerHeight) : aheadBannerUp ? aheadRoomFor(aheadBannerHeight) : 0}
        />
      )}

      {/* Live road view: above the ETA bar while navigating (toggle in Settings › Vehicle & AI tools). */}
      {liveViewOn && (
        <View style={[styles.liveView, { bottom: insets.bottom + bottomBarHeight + 8 }]}>
          <LiveRoadView
            status={liveStatus}
            vehicles={liveVehicles}
            route={liveRoute}
            dark={mapScheme === "dark"}
            height={liveViewH}
            onTurnOff={() => updateSettings({ liveRoadView: false })}
            onRetry={() => setLiveAttempt((n) => n + 1)}
            onOpenSettings={() => Linking.openSettings().catch(() => {})}
            cameraPreview={<LiveCameraSlot attempt={liveAttempt} egoSpeedKmh={currentSpeedKmh} onTracks={onLiveTracks} onStatus={setLiveStatus} />}
          />
        </View>
      )}

      {/* Siren radar: its own banner at the top (one banner at a time, so the ahead banner waits). */}
      {showRadarBanner(radarBanner, exitZoomActive) && radarBanner && !placingAlert && (
        <EmergencyVehicleBanner
          top={insets.top + (route ? instructionCardHeight + 12 : 12)}
          type={radarBanner.type}
          closeness={radarBanner.closeness}
          dark={mapScheme === "dark"}
          onHeight={setRadarBannerHeight}
        />
      )}
      {sirenAsking && !radarBanner && !placingAlert && (
        <SirenQuestionCard
          top={insets.top + (route ? instructionCardHeight + 12 : 12)}
          dark={mapScheme === "dark"}
          onYes={onSirenYes}
          onNo={onSirenNo}
          listening={sirenVoice}
        />
      )}

      {/* The ahead-alert banner (nav/ahead): just above the ETA bar; the controls above rise first. */}
      {route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && (
        <AheadBanner
          state={navOptionsSheetOpen || radarBanner ? { ...aheadState, alert: null } : aheadState}
          unit={settings.distanceUnit}
          dark={mapScheme === "dark"}
          road={aheadRoad}
          warnM={aheadState.alert ? warnDistanceM(aheadState.alert, (currentSpeedKmh ?? 0) / 3.6) : 1}
          speedKmh={currentSpeedKmh}
          nowMs={location?.timestamp ?? 0}
          top={insets.top + instructionCardHeight}
          room={aheadRoomPx}
          onHeight={setAheadBannerHeight}
          onTap={() => aheadCtl.tap()}
          onSwipe={() => aheadCtl.swipe()}
          onOpenCard={openAheadCard}
          canVote={!!user}
          onStillThere={() => voteOnAhead(true)}
          onNotThere={() => voteOnAhead(false)}
          fasterRoute={
            trafficSuggestionRoute && trafficSuggestionSavedSeconds >= 60
              ? { savesMin: Math.round(trafficSuggestionSavedSeconds / 60), onSwitch: acceptTrafficSuggestion, onKeep: () => aheadCtl.swipe() }
              : null
          }
        />
      )}

      {/* Real, explicit request -- a small, distinct, Apple-Maps-style live "current street"
          chip, separate from the plain text rows already inside NavigationInstructionCard/
          NavBottomBar: a real, compact rounded badge of its own rather than a line of text
          folded into a bigger card. Reads the exact same currentRoadName those two cards already
          show (the real OSM road lookup keyed on live GPS position -- see its own state comment),
          so it updates and swaps the instant the driver actually crosses onto a different real
          road, same "ongoing, live in sync" value, just surfaced as its own glanceable element
          too. Floats just above NavBottomBar, horizontally centered -- same hide conditions as
          that bar (the add-stop search/confirm bars occupy this same screen region) so nothing
          ever stacks on top of it. */}
      {/* The street-name pill under the driver's arrow on the home map (components/StreetPill).
          Shown only while the map is actually following the driver -- once they pan away the
          arrow is no longer above it, so a pill there would be labelling empty road. */}
      {/* The street-name pill now rides the sheet inside HomeMapControls (same baseline as
          Report); see the streetPill prop below. */}

      {/* Real, explicit request: a dedicated exit-lane guidance bar, shown only during the
          exit-zoom camera window above (see exitZoomActive) -- deliberately separate from the
          always-on NavigationInstructionCard at the top so this reads as a distinct, urgent,
          this-moment-only signal instead of a restyled version of the normal turn card. Same
          MapView/mapRef regardless of mapType ("standard" vs "hybrid" satellite -- see the
          MapView's own mapType prop), so this and the exit-zoom camera pose both already apply
          identically in satellite navigation, not just the standard map. */}
      {route && exitZoomActive && exitZoomDirection && !laneStripLanes && !addingStopDuringNav && !stopPreviewRoute && (
        <ExitLaneGuidance
          direction={exitZoomDirection}
          distanceMeters={metersToManoeuvre ?? 0}
          instruction={activeStep?.instruction ?? ""}
          bottom={insets.bottom + bottomBarHeight + spacing.sm}
        />
      )}

      {route && arrival && (
        <ArrivedCard
          arrival={arrival}
          bottom={insets.bottom + bottomBarHeight + spacing.md}
          onRate={() => {
            exitNavigation("arrived");
            navigation.navigate("Help");
          }}
          onPark={
            currentLatLng
              ? () => {
                  const here = currentLatLng;
                  // The one parking spot (P pin, "Find my car"), at exactly where you are now. With
                  // "Remember where I parked" on, ending the drive as arrived saves it already.
                  if (!settings.autoParking) saveAutoParking({ latitude: here.latitude, longitude: here.longitude, label: arrival.address ?? arrival.name });
                  exitNavigation("arrived");
                }
              : null
          }
          onDone={() => exitNavigation("arrived")}
          walk={
            arrivalWalk && walkAfterParking
              ? {
                  label: `Walk ${formatDistance(arrivalWalk.metres, settings.distanceUnit)} to ${arrivalWalk.name}`,
                  onPress: () => {
                    const to = walkAfterParking;
                    exitNavigation("arrived");
                    walkTo({ placeId: `walk-${to.location.latitude},${to.location.longitude}`, name: to.name, address: to.address ?? "", location: to.location });
                  },
                }
              : null
          }
        />
      )}

      {route && searchAlongOpen && (
        <SearchAlongRouteSheet
          route={remainingPolyline}
          origin={currentLatLng}
          remainingSeconds={remainingDurationSeconds}
          unit={settings.distanceUnit}
          onClose={() => setSearchAlongOpen(false)}
          onAddStop={(r) => {
            setSearchAlongOpen(false);
            onStopSelectedDuringNav({ placeId: r.placeId, name: r.name, address: r.address, location: r.location });
          }}
          onGo={(r) => {
            setSearchAlongOpen(false);
            goInsteadDuringNav({ placeId: r.placeId, name: r.name, address: r.address, location: r.location });
          }}
        />
      )}
      {route && navAlternatives && navAlternatives.length > 0 && (
        <View pointerEvents="box-none" style={[styles.altBar, { top: insets.top + instructionCardHeight + spacing.md }]}>
          <Button variant="secondary" label="Keep current route" onPress={() => setNavAlternatives(null)} testID="nav-keep-route" />
        </View>
      )}

      {/* Report while driving: bottom-right, 12pt above the bar (Re-centre sits over it only
          after panning). See nav/navControlsLayout.ts for the whole column layout. */}
      {route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && (
        <Reanimated.View pointerEvents="box-none" style={[styles.navReport, { bottom: controlsBottom(insets.bottom, bottomBarHeight) }]}>
          <FloatingButton tone="report" shape="menu" size={REPORT_SIZE} onPress={openAlertTypePicker} accessibilityLabel="Report something on the road" testID="nav-report">
            <ReportIcon size={30} />
          </FloatingButton>
        </Reanimated.View>
      )}

      {/* Mapbox's junction picture for a complex interchange, until the manoeuvre point. */}
      {route && activeStep?.guidanceViewUrl && metersToManoeuvre !== null && metersToManoeuvre <= 1000 && !addingStopDuringNav && !aheadBannerUp && (
        <JunctionViewCard url={activeStep.guidanceViewUrl} token={usableMapboxToken()} top={insets.top + instructionCardHeight + 8} />
      )}

      {/* "Exit taken ✓" after a confirmed manoeuvre, "Rerouting…" after a missed one. */}
      {route && manoeuvreChip && (
        <ManoeuvreChip text={manoeuvreChip.text} tone={manoeuvreChip.tone} top={insets.top + instructionCardHeight + 8} />
      )}

      {/* Real mid-trip add-a-stop search -- overlays the turn card at the same top position
          (same as the pre-Start search bar) but deliberately does NOT touch `route`, so the
          route line, puck, and live GPS tracking underneath keep running the whole time this is
          open instead of the screen dropping back to a bare map with no navigation context. */}
      {route && addingStopDuringNav && (
        <MapSurface>
          <DestinationSearchBar
            biasLocation={currentLatLng ?? undefined}
            onDestinationSelected={onStopSelectedDuringNav}
            placeholder="Add a stop on the way"
            onCancel={() => setAddingStopDuringNav(false)}
          />
        </MapSurface>
      )}

      {/* Confirm/back bar for the green add-stop preview above -- Back discards it and returns
          to live navigation exactly as it was; Add Stop actually commits the reroute. */}
      {stopPreviewRoute && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>Add this stop to your route?</Text>
          <View style={styles.placementBarButtons}>
            <Button
              variant="secondary"
              icon="arrow-back"
              onPress={cancelStopPreview}
              accessibilityLabel="Back — cancel adding this stop"
            />
            <Button
              variant="primary"
              icon="checkmark"
              label="Add stop"
              onPress={confirmStopPreview}
              accessibilityLabel="Confirm add stop"
            />
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
              <Icon name="flash" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              {/* "Back-lane shortcut" / "Side-street shortcut" / "Faster route found", then
                  "Save 4 min via Smith Ln — arrive 5:42 pm": the real saving, the road it takes
                  you onto and the real arrival time (nav/shortcuts.ts shortcutText). */}
              <Text style={styles.trafficSuggestionTitle} testID="shortcut-title">
                {trafficSuggestionInfo.slowAhead ? "Traffic ahead · " : ""}
                {shortcutTitle.title}
              </Text>
              <Text style={styles.trafficSuggestionBody} testID="shortcut-body">
                {shortcutTitle.body}
              </Text>
            </View>
            <Pressable
              onPress={dismissTrafficSuggestion}
              hitSlop={10}
              style={({ pressed }) => [styles.trafficSuggestionClose, pressed && { opacity: pressedOpacity }]}
              accessibilityLabel="Close — not wanted, keep current route"
            >
              <Icon name="close" size={16} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.trafficSuggestionActionRow}>
            <Button
              variant="secondary"
              label="No"
              onPress={dismissTrafficSuggestion}
              accessibilityLabel="No — keep current route"
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              icon="checkmark"
              label="Yes"
              onPress={acceptTrafficSuggestion}
              accessibilityLabel={`Yes — switch to the faster route, save about ${Math.max(1, Math.round(trafficSuggestionSavedSeconds / 60))} minutes`}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}

      {/* "End suggested route" -- only shown while actually driving an accepted suggestion (see
          acceptedSuggestionOriginalRoute), per explicit request. Restores the exact route the
          driver was on before they accepted. */}
      {route && acceptedSuggestionOriginalRoute && !stopPreviewRoute && !addingStopDuringNav && !placingAlert && (
        <View style={[styles.endSuggestedRouteWrap, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]}>
          <Button
            variant="secondary"
            icon="return-up-back"
            label="End suggested route"
            onPress={endSuggestedRoute}
            accessibilityLabel="End suggested route — return to your original route"
          />
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

      {/* Real, explicit request -- surfaces a genuinely faster real alternative the reroute's
          own alternates search found (see the off-route effect above). Auto-dismisses itself;
          never blocks anything underneath. */}
      {rideText && (
        <View style={[styles.reroutingBadge, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]} accessibilityRole="alert" accessibilityLabel={rideText} testID="ride-chip">
          <Icon name="bus" size={16} color="#FFFFFF" />
          <Text style={styles.reroutingBadgeText}>{rideText}</Text>
        </View>
      )}
      {approachChip && approachChipShown && (
        <Pressable
          style={[styles.reroutingBadge, { top: insets.top + spacing.md + (route ? instructionCardHeight + spacing.md : 0) + (fasterRouteBanner || rerouting ? 48 : 0) }]}
          onPress={() => setApproachChip(null)}
          accessibilityRole="alert"
          accessibilityLabel={featureChipText(approachChip.item, chipAheadM ?? approachChip.distanceM, settings.distanceUnit)}
          testID="approach-chip"
        >
          <ReportItemIcon id={approachChip.item} size={24} />
          <Text style={styles.reroutingBadgeText}>{featureChipText(approachChip.item, chipAheadM ?? approachChip.distanceM, settings.distanceUnit)}</Text>
        </Pressable>
      )}

      {!rerouting && fasterRouteBanner && (
        <Pressable
          style={[styles.reroutingBadge, { top: insets.top + spacing.md + instructionCardHeight + spacing.md }]}
          onPress={() => setFasterRouteBanner(null)}
          accessibilityLabel={fasterRouteBanner}
        >
          <Icon name="flash" size={16} color="#FFFFFF" />
          <Text style={styles.reroutingBadgeText}>{fasterRouteBanner}</Text>
        </Pressable>
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
          <Icon name="bus" size={18} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.transitWaitTitle}>
              You&apos;ve arrived at {firstBoardingStop.departureStop || "the stop"}
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
        {/* While navigating: just the sound button (it opens the sound sheet). Re-centre sits
            above the bottom bar after a pan; ending the drive is in the ETA sheet. */}
        {/* While navigating, the compass, audio, sound and voice buttons are NavMapControls. */}
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
      {/* Every floating button on the idle home map -- Menu, Compass, Audio player, Sound,
          Report, Re-centre -- lives in HomeMapControls. Report and Re-centre ride 12pt above
          the "Where to?" sheet and all of them fade out as it rises past half height, so none
          can overlap it. Navigation has its own controls and shows none of these. */}
      {isHomeIdle && !anySheetOpen && pillHead ? (
        <HomeInfoPill key={pillHead.kind} message={pillHead} sheetVisibleHeight={sheetVisibleHeight} scheme={mapScheme} onPress={onPillPress} />
      ) : null}
      {isHomeIdle && !anySheetOpen && (
        <HomeMapControls
          sheetVisibleHeight={sheetVisibleHeight}
          sheetHalfHeight={whereToHeights.half}
          bottomInset={0}
          // The info pill ("N Trackys around you") borrows the street pill's slot while it shows.
          streetPill={!anySheetOpen && !pannedAwayIdle && !pillHead ? { streetName: currentRoadName, reportsAround, stationary } : null}
          topInset={insets.top}
          unreadCount={inboxUnreadCount}
          onMenu={() => navigation.navigate("MainMenu")}
          onMenuLongPress={() => visibilitySheetRef.current?.expand()}
          showCompass={settings.showCompass}
          bearing={mapBearing}
          onCompass={() => {
            // Toggle: north-up (held), or back to heading-up.
            const next = !northUp;
            setNorthUp(next);
            const bearing = next ? 0 : followHeadingRef.current;
            camera.move("transition", { heading: bearing }, { duration: 400 });
            mapBearing.set(bearing);
          }}
          showAudioPlayer={settings.showAudioPlayer}
          onAudioPlayer={openAudioPlayer}
          showSoundButton={settings.showSoundButton}
          soundOff={settings.spokenDirections === "off"}
          onSound={() => soundSheetRef.current?.expand()}
          onReport={openAlertTypePicker}
          showRecenter={pannedAwayIdle}
          onRecenter={onRecenter}
        />
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
      {bannerShown && (
        <AdsErrorBoundary>
          <BannerAdBar />
        </AdsErrorBoundary>
      )}

      {placingAlert && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>{sirenDraft ? "Drag the map to where it was" : "Move the map to place the pin"}</Text>
          {placingItem === "closures" && !sirenDraft ? <ClosureDetailsPicker value={closureDraft} onChange={setClosureDraft} /> : null}
          {sirenDraft ? (
            <SirenReportPicker value={sirenDraft} onChange={setSirenDraft} stopped={(currentSpeedKmh ?? 0) < 10} onQuickPin={onSirenQuickPin} />
          ) : (
            <>
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
              <Text style={styles.placementCommentError}>That wording isn&apos;t allowed — please rephrase.</Text>
            ) : (
              <View />
            )}
            <Text style={styles.placementCommentCount}>
              {alertComment.trim() ? alertComment.trim().split(/\s+/).length : 0}/{MAX_ALERT_COMMENT_WORDS} words
            </Text>
          </View>
            </>
          )}
          <View style={styles.placementBarButtons}>
            <Button
              variant="secondary"
              icon="close"
              onPress={cancelAlertPlacement}
              disabled={submittingAlert}
              accessibilityLabel="Cancel placing alert"
            />
            {/* "Set incidents from 2 views" -- only offered while reporting during active
                navigation, since that's the real scenario this exists for: spotting something
                just passed and wanting the clearer, driver's-eye front view to place it
                precisely, an option that doesn't apply when just browsing the map. */}
            {/* Satellite on/off, right here on the placement bar: lining a pin up against real
                ground features is exactly when aerial imagery helps, and the Map tools button
                that used to offer it during placement no longer floats over the map. */}
            <Button
              variant="secondary"
              icon={mapType === "hybrid" ? "map-outline" : "earth-outline"}
              onPress={() => setMapType((v) => (v === "standard" ? "hybrid" : "standard"))}
              disabled={submittingAlert}
              accessibilityLabel={mapType === "hybrid" ? "Switch to the drawn map" : "Switch to satellite view"}
            />
            {route && (
              <Button
                variant="secondary"
                icon={placementFrontView ? "eye-off-outline" : "eye-outline"}
                onPress={togglePlacementFrontView}
                disabled={submittingAlert}
                accessibilityLabel={placementFrontView ? "Switch to normal height view" : "Switch to front driving view"}
              />
            )}
            {/* One-tap "place it exactly where I am right now" -- per explicit request, beside
                Cancel/Set. Sets AND immediately confirms in the same tap using the driver's own
                live GPS fix, rather than requiring the fixed-center pin to already be panned
                there. The normal pan-anywhere flow (Set button) is untouched. */}
            <Button
              variant="secondary"
              icon="locate"
              onPress={confirmAlertPlacementAtMyLocation}
              disabled={submittingAlert || !currentLatLng}
              accessibilityLabel="Set alert at my current location"
            />
            <Button
              variant="primary"
              icon="checkmark"
              label={sirenDraft ? "Report" : "Set"}
              onPress={() => confirmAlertPlacement()}
              disabled={submittingAlert || (sirenDraft ? !!titleProblem(sirenDraft.title) : alertCommentBlocked)}
              accessibilityLabel={sirenDraft ? "Report the emergency vehicle" : "Set alert location"}
              loading={submittingAlert}
              testID={sirenDraft ? "siren-report-send" : undefined}
            />
          </View>
        </View>
      )}

      {/* Real, explicit request: a real pin-drop picker for "choose starting point" -- drag the
          map (pinch to zoom, pan to move) to place the fixed center pin, an (X) to fall back to
          search instead of a pin, and Set to confirm. Same bar layout as manual alert placement
          above, without its comment field/front-view toggle (neither applies here). */}
      {pickingOrigin && originPickerView === "pin" && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>Choose starting point</Text>
          <Text style={styles.placementBarSubtext} numberOfLines={2}>
            {originPinAddressLoading ? "Finding address…" : originPinAddress ?? "Move the map to place the pin"}
          </Text>
          <View style={styles.placementBarButtons}>
            <Button
              variant="secondary"
              icon="search"
              onPress={switchOriginToSearch}
              accessibilityLabel="Search for a starting point instead"
            />
            <Button
              variant="primary"
              icon="checkmark"
              label="Set"
              onPress={confirmOriginPin}
              disabled={!originPinLatLng}
              accessibilityLabel="Set starting point"
            />
          </View>
        </View>
      )}

      {/* Same picker, for the destination step that automatically follows once a start point is
          confirmed (see confirmOriginPin) -- also reachable as a standalone way to check a real
          ETA/distance between any two points without starting navigation, since landing on
          "Choose a route" (RouteOptionsCard) below shows exactly that without requiring Start. */}
      {pickingDestinationPoint && destinationPickerView === "pin" && (
        <View style={[styles.placementBar, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.placementBarText}>Choose destination</Text>
          <Text style={styles.placementBarSubtext} numberOfLines={2}>
            {destinationPinAddressLoading ? "Finding address…" : destinationPinAddress ?? "Move the map to place the pin"}
          </Text>
          {/* Real, explicit request: a way to revisit the just-set starting point, laid out
              neatly beside the (X)/Set pair in the same row -- space-between instead of the
              usual flex-end so this sits on its own at the left while X/Set stay paired on the
              right, a clear, uncluttered three-action layout instead of stacking a fourth row. */}
          <View style={[styles.placementBarButtons, styles.placementBarButtonsSpread]}>
            <Button
              variant="secondary"
              icon="arrow-undo"
              label="Change starting point"
              onPress={onChangeStartingPointFromDestinationStep}
              accessibilityLabel="Change starting point"
            />
            <View style={styles.placementBarButtonsPair}>
            <Button
              variant="secondary"
              icon="search"
              onPress={switchDestinationToSearch}
              accessibilityLabel="Search for a destination instead"
            />
            <Button
              variant="primary"
              icon="checkmark"
              label="Set"
              onPress={confirmDestinationPin}
              disabled={!destinationPinLatLng}
              accessibilityLabel="Set destination"
            />
            </View>
          </View>
        </View>
      )}

      <AlertReportSheet
        ref={reportSheetRef}
        onItemSelected={onReportItemSelected}
        onRoadReport={() => {
          reportSheetRef.current?.close();
          setRoadReportOpen(true);
        }}
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
        etaText={placeInfoEtaText}
        streetViewUrl={placeInfoStreetViewUrl}
        streetViewEmbedUrl={placeInfoStreetViewEmbedUrl}
        onClose={() => placeInfoSheetRef.current?.close()}
        onGetDirections={(p) => {
          placeInfoSheetRef.current?.close();
          onDestinationSelected(p);
        }}
        onStartNavigation={onQuickStartFromPlace}
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
      {/* Real, confirmed root cause (not just a "call .close() sooner" issue): RouteOptionsCard
          ("Choose a route") is a plain conditional view, not a bottom sheet, and these three are
          plain `BottomSheet` (not `BottomSheetModal`) -- they stay mounted in the tree and stack
          by render order, not by index/open-closed state, regardless of whether .close() was
          called or whether its animation has actually finished. Unmounting them outright
          whenever a route flow is active (picking a destination or already navigating) is a
          strictly stronger guarantee than the ref-based .close() calls elsewhere in this file
          (still kept, since a route can also start mid-way through one of these being open) --
          if the component isn't mounted at all, it categorically cannot render on top of
          anything else, no ref/animation-timing race possible. */}
      {!pendingDestination && !route && (
        <>
          <RestaurantsSheet
            ref={restaurantsSheetRef}
            location={currentLatLng}
            onViewDetails={onViewVenueDetails}
            onSheetChange={(index) => setRestaurantsSheetOpen(index >= 0)}
            onPinsChange={setFoodPins}
          />
          <HotelsSheet
            ref={hotelsSheetRef}
            location={currentLatLng}
            onSelect={(place) => {
              hotelsSheetRef.current?.close();
              onDestinationSelected(place);
            }}
            onViewDetails={onViewVenueDetails}
            onSheetChange={(index) => setHotelsSheetOpen(index >= 0)}
            onPinsChange={setHotelPins}
          />
          <FuelStationsSheet
            ref={fuelStationsSheetRef}
            location={currentLatLng}
            onViewDetails={onViewVenueDetails}
            onSheetChange={(index) => setFuelStationsSheetOpen(index >= 0)}
            onStationsChange={setFuelStationPins}
          />
          <NearbyPlacesSheet
            ref={parkingSheetRef}
            category="parking"
            location={parkingCenter ?? currentLatLng}
            onViewDetails={onViewVenueDetails}
            onPinsChange={setParkingPins}
            onMoreFilters={() => {
              parkingSheetRef.current?.close();
              parkingFiltersSheetRef.current?.snapToIndex(0);
            }}
            onSheetChange={(index) => {
              setParkingSheetOpen(index >= 0);
              // Closed (and the filter list not open): back to "around the driver" for next time.
              if (index < 0 && !parkingFiltersOpen) setParkingCenter(null);
            }}
          />
          <ParkingSheet
            ref={parkingFiltersSheetRef}
            location={parkingCenter ?? currentLatLng}
            onViewDetails={onViewVenueDetails}
            onSheetChange={(index) => {
              setParkingFiltersOpen(index >= 0);
              if (index < 0 && !parkingSheetOpen) setParkingCenter(null);
            }}
          />
        </>
      )}
      <RouteDirectionsSheet
        ref={directionsSheetRef}
        route={route}
        activeStepIndex={activeStepIndex}
        onClose={() => directionsSheetRef.current?.close()}
        onSheetChange={(index) => setDirectionsSheetOpen(index >= 0)}
      />
      <NavOptionsSheet
        ref={navOptionsSheetRef}
        arrivalClockText={arrivalClockText}
        etaText={formatDurationText(remainingDurationSeconds)}
        distanceText={formatDistance(remainingDistanceMeters, settings.distanceUnit)}
        distanceUnit={settings.distanceUnit}
        destinationName={etaSheetPlace?.name ?? null}
        destinationAddress={etaSheetPlace?.address ?? null}
        viaText={route?.summary}
        events={etaSheetEvents}
        ahead={aheadRows}
        parking={parkingSection}
        stops={stopsSection}
        onAheadPress={onAheadRowPress}
        loadLeaveTimes={loadLeaveTimes}
        onShowMoreTimes={() => {
          navOptionsSheetRef.current?.close();
          if (!destinationLatLng) return;
          navigation.navigate("PlanADrive", {
            initialDestination: etaSheetPlace ?? { placeId: "", name: "Dropped pin", address: "", location: destinationLatLng },
          });
        }}
        onOpenSettings={() => {
          navOptionsSheetRef.current?.close();
          navigation.navigate("Settings", { category: "navigationVoice" });
        }}
        onRoutes={() => {
          navOptionsSheetRef.current?.close();
          showRouteOverview();
        }}
        onReportAlert={onNavOptionsReportAlert}
        onAddStop={() => {
          navOptionsSheetRef.current?.close();
          setSearchAlongOpen(true);
        }}
        onShareDrive={onNavOptionsShareEta}
        onSoundVoice={() => {
          navOptionsSheetRef.current?.close();
          navigation.navigate("Settings", { category: "navigationVoice" });
        }}
        mapViewLabel={NAV_VIEW_LABEL[navView]}
        onMapView={() => applyNavView(nextNavView[navView])}
        satelliteOn={mapType === "hybrid"}
        onToggleSatellite={() => setMapType((v) => (v === "standard" ? "hybrid" : "standard"))}
        avoidSummary={avoidCount(settings.routeAvoid) ? avoidPillLabel(settings.routeAvoid) : "None"}
        onAvoid={() => {
          navOptionsSheetRef.current?.close();
          setNavAvoidOpen(true);
        }}
        onHelp={() => {
          navOptionsSheetRef.current?.close();
          navigation.navigate("Help");
        }}
        onOpenDetection={onNavOptionsOpenDetection}
        onOpenMapTools={() => {
          navOptionsSheetRef.current?.close();
          toolsSheetRef.current?.expand();
        }}
        onEndNavigation={onNavOptionsEndNavigation}
        onClose={() => navOptionsSheetRef.current?.close()}
        onSheetChange={(index) => setNavOptionsSheetOpen(index >= 0)}
        detectionBatteryLow={detectionBatteryLow}
      />

      {route ? (
        <MapSurface>
          <AvoidSheet visible={navAvoidOpen} prefs={settings.routeAvoid} onToggle={onToggleAvoidDuringNav} onClose={() => setNavAvoidOpen(false)} />
        </MapSurface>
      ) : null}

      <SoundSheet
        ref={soundSheetRef}
        onClose={() => soundSheetRef.current?.close()}
        onSheetChange={(index) => setSoundSheetOpen(index >= 0)}
        onOpenVoiceSettings={() => navigation.navigate("VoicePicker")}
      />

      <VisibilitySheet
        ref={visibilitySheetRef}
        onClose={() => visibilitySheetRef.current?.close()}
        onOpenPrivacySettings={() => {
          visibilitySheetRef.current?.close();
          navigation.navigate("Settings", { category: "privacy" });
        }}
      />

      <GhostModeExplainerModal
        visible={ghostExplainerVisible}
        onStayHidden={dismissGhostExplainer}
        onBecomeVisible={() => {
          updateSettings({ visibility: "everyone" });
          dismissGhostExplainer();
        }}
      />

      {alertCard && !route && (
        <MapSpotlight
          width={windowWidth}
          height={mapAreaHeight}
          centre={spotlightCentre(windowWidth, mapAreaHeight, mapPadding)}
          onPress={() => dismissAlertCard()}
        />
      )}
      {liveAlertCard && (
        <AlertCard
          key={liveAlertCard.model.key}
          card={liveAlertCard.model}
          incident={liveAlertCard.incident}
          distanceText={distanceLine(
            currentLatLng
              ? distanceKm(currentLatLng.latitude, currentLatLng.longitude, liveAlertCard.model.latitude, liveAlertCard.model.longitude) * 1000
              : null,
            settings.distanceUnit
          )}
          place={liveAlertCard.model.officialWhere ?? alertCardPlaces[liveAlertCard.model.key] ?? null}
          now={clockNow}
          thanked={!!liveAlertCard.alert && thankedAlertIds.has(liveAlertCard.alert.id)}
          compact={!!route}
          // Compact: below the instruction card (the lane strip is inside it), never over it.
          top={route ? insets.top + spacing.md + instructionCardHeight + spacing.md : insets.top + spacing.sm}
          scale={scaleFor(windowWidth)}
          onThanks={onThankAlertCard}
          onOpenDetails={openAlertCardDetails}
          onDismiss={() => dismissAlertCard()}
        />
      )}

      <TrafficIncidentCard
        incident={selectedIncident}
        onRoute={selectedIncidentOnRoute}
        distanceText={selectedIncident ? formatDistance(selectedIncident.distanceMeters, settings.distanceUnit) : ""}
        openedAtMs={selectedIncidentAt}
        onClose={() => setSelectedIncident(null)}
      />

      {bubblePresence && !selectedPresence && (
        <TrackyBubble
          presence={bubblePresence}
          nowMs={bubbleAtMs}
          top={insets.top + spacing.md + (route ? instructionCardHeight + spacing.md : 64)}
          onWave={onWaveFromBubble}
          onMore={() => {
            setSelectedPresence(bubblePresence);
            setBubblePresence(null);
          }}
          onClose={() => setBubblePresence(null)}
        />
      )}

      {selectedSaved && !route && (
        <SavedPlacePopup
          place={selectedSaved}
          bottom={whereToHeights.peek + spacing.md}
          onClose={() => setSelectedSaved(null)}
          onSend={() => {
            Share.share({ message: buildDriveLink({ latitude: selectedSaved.location.latitude, longitude: selectedSaved.location.longitude, name: selectedSaved.title, address: selectedSaved.address }) }).catch(() => {});
          }}
          onRoutes={() => {
            const sp = selectedSaved;
            setSelectedSaved(null);
            onDestinationSelected({ placeId: sp.placeId, name: sp.title, address: sp.address, location: sp.location });
          }}
          onPreview={() => {
            camera.move("focus", { center: selectedSaved.location, zoom: 17, pitch: 0 }, { duration: 600 });
          }}
          onMarkParking={() => {
            setParkingSpot({ latitude: selectedSaved.location.latitude, longitude: selectedSaved.location.longitude, label: selectedSaved.address || selectedSaved.title }).then(() => {
              setBannerMessage("Parking spot marked — tap the P to find your car.");
              setBannerVisible(true);
            });
            setSelectedSaved(null);
          }}
          onFindCar={
            parkingSpot
              ? () => {
                  setSelectedSaved(null);
                  findMyCar(parkingSpot);
                }
              : null
          }
          onEdit={(newLabel) => {
            const sp = selectedSaved;
            setSelectedSaved(null);
            if (sp.kind === "home" || sp.kind === "work") {
              whereToSheetRef.current?.openSearch(sp.kind);
              return;
            }
            const original = savedPlaces.custom.find((p) => p.placeId === sp.placeId);
            if (original && newLabel) {
              addCustomPlace(original, newLabel).then((next) => {
                if (user) pushSavedPlacesToProfile(user.uid, next).catch(() => {});
              });
            }
          }}
          onRemove={() => {
            const sp = selectedSaved;
            setSelectedSaved(null);
            const done = sp.kind === "parking" ? clearParkingSpot().then(() => null) : sp.kind === "custom" ? removeCustomPlace(sp.placeId) : removeHomeOrWork(sp.kind);
            done.then((next) => {
              if (next && user) pushSavedPlacesToProfile(user.uid, next).catch(() => {});
            });
          }}
        />
      )}

      {user && (
        <PresenceCard
          presence={selectedPresence}
          selfUid={user.uid}
          onClose={() => setSelectedPresence(null)}
          onBlocked={(uid) => setBlockedUids((prev) => new Set(prev).add(uid))}
        />
      )}

      <MapToolsSheet
        ref={toolsSheetRef}
        onRecenter={() => {
          toolsSheetRef.current?.close();
          onLocateButtonPress();
        }}
        show3D={show3D}
        onToggle3D={() => {
          Sentry.logger.info("map: toggling 3D view", { next: !show3D });
          updateSettings({ show3DBuildings: !show3D });
        }}
        satelliteOn={mapType === "hybrid"}
        onToggleSatellite={() => setMapType((v) => (v === "standard" ? "hybrid" : "standard"))}
        onOpenDetection={onToolsSheetOpenDetection}
        detectionBatteryLow={detectionBatteryLow}
        alertsEnabled={settings.alertsEnabled}
        onToggleAlerts={() => updateSettings({ alertsEnabled: !settings.alertsEnabled })}
        // snapToIndex(0), not expand() -- these sheets have two snap points (["50%", "88%"]),
        // and expand() jumps straight to the largest one. Opening at index 0 lands on the
        // shorter default; dragging the handle still reaches 88%. Same real, now-shared
        // handlers the Phase 2 "Where to?" sheet's own category chips call too -- see their own
        // definition above.
        onFindRestaurants={onFindRestaurants}
        onFindHotels={onFindHotels}
        onFindPetrol={onFindPetrol}
        onFindParking={onFindParking}
        onOpenSettings={() => {
          toolsSheetRef.current?.close();
          navigation.navigate("SettingsCategories");
        }}
        onSheetChange={(index) => setToolsSheetOpen(index >= 0)}
      />


      {/* Rendered last so it always paints on top of the search bar/nav card below it,
          instead of being silently covered by them when both occupy the same top area. */}
      <AlertBanner
        visible={bannerVisible}
        message={bannerMessage}
        onDismiss={() => setBannerVisible(false)}
      />

      <NearbyAlertToast notification={alertToastQueue[0] ?? null} onDismiss={dismissAlertToast} />

      {/* Rendered last of all -- an actionable prompt the driver is being actively asked to
          answer, so it needs to sit on top of everything else, same reasoning as AlertBanner
          above it. */}
      {pendingReport && (
        <ReportUndoBar
          type={pendingReport.type}
          label={pendingReport.label}
          untilMs={pendingReport.untilMs}
          onUndo={onUndoReport}
          onDone={clearPendingReport}
          bottom={route ? insets.bottom + bottomBarHeight + spacing.sm : insets.bottom + spacing.xl}
        />
      )}

      {stillHerePrompt && !pendingReport && (
        <AlertStillHereCard
          key={stillHerePrompt.id}
          alert={stillHerePrompt}
          onStillHere={() => onStillHereRespond(stillHerePrompt, true)}
          onNotHere={() => onStillHereRespond(stillHerePrompt, false)}
          bottom={route ? insets.bottom + bottomBarHeight + spacing.sm : undefined}
        />
      )}
      {/* Waze-match §3: "What's your ride?" once, after the location question, over the map. */}
      {shouldShowVehiclePicker({ settingsLoaded, chosen: settings.vehicleChosen, locationAnswered: permissionGranted || permissionDenied }) && (
        <VehiclePickerScreen onDone={(v) => void updateSettings(vehiclePatch(settings, v))} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  simulateDriveSpot: { position: "absolute", left: spacing.lg },
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapArea: { flex: 1 },
  mapPlaceholder: { backgroundColor: colors.surfaceMuted },
  locationGateOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.dark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    zIndex: 50,
  },
  locationGateTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: spacing.xs,
  },
  locationGateText: {
    fontSize: 14,
    color: "#C7CDD6",
    textAlign: "center",
    lineHeight: 20,
  },
  // Small, clear pointed pill for each route option's live ETA -- deliberately compact (not a
  // full card) so it reads at a glance without covering meaningful map area, per explicit
  // request. Unselected pills stay light/neutral so the selected one's red is what actually
  // draws the eye, matching the selected route line's own highlight color.
  // Wide, soft, translucent "flashlight" cone -- apex (the narrow point) sits at the puck's
  // exact coordinate (see the Marker's anchor: {y: 1} above) and fans out in whichever
  // direction deviceHeading currently points.
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
  liveView: { position: "absolute", left: 12, right: 12 },
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
  // Live address readout under the fixed pin for the origin/destination pin pickers -- same
  // slot placementCommentInput/its footer occupy for the alert-placement bar, just plain text
  // here since neither picker needs a comment field.
  placementBarSubtext: {
    fontSize: 13,
    color: colors.textMuted,
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
  // Overrides placementBarButtons' own flex-end for the destination-pin bar specifically, which
  // has a third action (Change starting point) that belongs on its own at the left instead of
  // crowding in next to the icon-only X/Set pair.
  placementBarButtonsSpread: {
    justifyContent: "space-between",
    alignItems: "center",
  },
  placementBarButtonsPair: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  frontViewSpot: { position: "absolute", alignSelf: "center" },
  // Same shape as fuelPinBadge, distinct colors so all three viewport layers stay visually
  // distinguishable from each other and from the green fuel pin at a glance.
  // Shared cluster badge for the fuel/restaurant/hotel viewport layers -- wider than the single-
  // pin badges above to fit an icon plus a real count, backgroundColor set per-category inline.
  // Deliberately a different color from both OSM markers above (blue, not purple/teal) -- this
  // is a real live NSW government camera feed, an entirely separate dataset from the mapped
  // OSM traffic-light/speed-camera layer, and shouldn't visually read as a third variant of it.
  navReport: { position: "absolute", right: SIDE_MARGIN },
  altBar: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  topRightControls: {
    position: "absolute",
    // Hugs the true right edge (rather than floating inward) so this reads as a compact,
    // edge-anchored toolbar the way Apple/Google Maps' own side controls do, instead of a
    // column of buttons sitting out over the middle of the route/map.
    right: spacing.sm,
    gap: spacing.xs + 2,
  },
  // Small and muted on purpose -- explicit request: not a big, bright button, just enough to
  // notice and tap when the camera has drifted from the driver's own position.
  currentStreetChipWrap: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    alignItems: "center",
  },
  currentStreetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "80%",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    ...shadow.low,
  },
  currentStreetChipText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  // The place page's pin: a red disc with a white centre and a soft shadow.
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
  endSuggestedRouteWrap: {
    position: "absolute",
    left: spacing.md,
    alignItems: "flex-start",
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
  // Small advisory badge on the AI Detection FAB when battery is under 50% -- see
  // detectionBatteryLow's own comment. Purely visual, the Pressable underneath stays fully
  // tappable either way.
});
