import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Autocomplete,
  DirectionsRenderer,
  Circle,
  OverlayView,
} from "@react-google-maps/api";
import { onIdTokenChanged, type User } from "firebase/auth";
import { auth, ensureSignedIn, signInWithGoogle, signInWithApple, signOutUser } from "@/services/firebase";
import { upsertSignedInProfile, updateLastKnownLocation } from "@/services/userProfile";
import {
  subscribeVisibleAlerts,
  reportAlert,
  deleteAlert,
  hideAlertForUser,
  confirmAlert,
} from "@/services/alerts";
import { classifyAuRegion, type AuRegionCode } from "@/utils/auStates";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useSettings } from "@/hooks/useSettings";
import { ReportAlertPanel } from "@/components/ReportAlertPanel";
import { AlertDetailPanel } from "@/components/AlertDetailPanel";
import { PlacementBar } from "@/components/PlacementBar";
import { NavigationCard, type NavViewMode } from "@/components/NavigationCard";
import { NavMiniBox } from "@/components/NavMiniBox";
import { TrafficSuggestionBanner, EndSuggestedRouteButton } from "@/components/TrafficSuggestionBanner";
import { OsmMarkerPanel, type OsmMarkerKind } from "@/components/OsmMarkerPanel";
import { VoiceControl } from "@/components/VoiceControl";
import { RouteOptionsCard } from "@/components/RouteOptionsCard";
import { StreetViewNav } from "@/components/StreetViewNav";
import { ConfirmPrompt } from "@/components/ConfirmPrompt";
import { AboutPanel } from "@/components/AboutPanel";
import { AlertCameraSettingsPanel } from "@/components/AlertCameraSettingsPanel";
import { RevCheckPanel } from "@/components/RevCheckPanel";
import { PhoneAuthPanel } from "@/components/PhoneAuthPanel";
import { AccountCenter } from "@/components/AccountCenter";
import { WebGates } from "@/components/WebGates";
import { featureOn, type RemoteConfig } from "@/services/account";
import { AdminPanel } from "@/components/AdminPanel";
import { BusinessDetailPanel } from "@/components/BusinessDetailPanel";
import { Street3DJoystick } from "@/components/Street3DJoystick";
import { Map3DView, type Map3DViewHandle } from "@/components/Map3DView";
import { DestinationPulseCircle } from "@/components/DestinationPulseCircle";
import { RecentSearchesPanel } from "@/components/RecentSearchesPanel";
import {
  getSearchHistory,
  addSearchHistoryEntry,
  removeSearchHistoryEntry,
  clearSearchHistory,
  type SearchHistoryEntry,
} from "@/services/searchHistory";
import { ROUTE_PROFILES, type RouteKey, type TravelMode, toGoogleTravelMode } from "@/utils/routeProfiles";
// Lazy-loaded: pulls in TensorFlow.js + COCO-SSD (~2MB), so keep it out of the initial bundle.
const LiveVehicleDetection = lazy(() =>
  import("@/components/LiveVehicleDetection").then((m) => ({ default: m.LiveVehicleDetection }))
);
import { ALERT_COLORS, ALERT_EMOJI, type AlertDoc, type AlertType } from "@/types/alert";
import { containsBlockedLanguage, clampToWordLimit } from "@/utils/commentFilter";
import { bearingDegrees, distanceKm, distanceToPolylineMeters, pointAheadOnPolylineMeters } from "@/utils/geo";
import { stripHtml, formatArrivalClock } from "@/utils/navFormat";
import { DARK_MAP_STYLE, LIGHT_MAP_STYLE, MAP_THEME_STYLES } from "@/utils/mapStyles";
import { fetchOsmTrafficData, fetchSpeedLimitNear, type OsmPoint } from "@/services/osmTrafficData";
import { fetchLiveTrafficCameras, type LiveTrafficCamera } from "@/services/liveTrafficCameras";
import { speak, stopSpeaking } from "@/services/voice";
import { LiveCamerasPanel } from "@/components/LiveCamerasPanel";
import { SpeedLimitSign } from "@/components/SpeedLimitSign";
import type { DetectionNavContext } from "@/components/LiveVehicleDetection";
import "./App.css";

const LIBRARIES: "places"[] = ["places"];
const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
// Touch devices get two-finger-drag look-around during 3D Follow instead of the on-screen
// joystick (see the touch-listener effect below) -- one finger is left free for normal map
// panning. Desktop/mouse users keep the joystick since there's no touch gesture to give them.
const IS_TOUCH_DEVICE =
  typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
// Re-fetch directions from the live position while navigating once you've drifted this
// far from where the route was last computed — keeps ETA/remaining-distance accurate
// without hammering the Directions API on every GPS tick.
const REROUTE_THRESHOLD_KM = 0.05;
// Distance to a step's endpoint (km) below which that maneuver counts as complete and
// guidance advances to the next step.
const STEP_COMPLETE_KM = 0.035;
// How many steps ahead to check for "already passed this one too, in the same GPS tick" --
// bounded so this stays a cheap, constant-time check every tick instead of scanning the whole
// remaining route.
const STEP_SKIP_AHEAD_LIMIT = 4;
// Real off-route detection thresholds -- see the reroute effect below.
const OFF_ROUTE_METERS = 60;
// Requires the drift to still be true a couple of ticks later, not just one, before reacting --
// a single noisy/bad fix shouldn't kick off a reroute on its own.
const OFF_ROUTE_CONFIRM_TICKS = 2;
// Minimum gap between forced off-route reroutes -- otherwise a fresh reroute that's itself
// briefly still off the eventual snapped route (GPS settling right after a fetch) could
// immediately trigger a second one back-to-back.
const OFF_ROUTE_REROUTE_COOLDOWN_MS = 15000;

// Real traffic-jam reroute suggestion (see the periodic check effect below) -- mirrors
// mobile's own constants of the same name exactly. How often to re-check, how long to stay
// quiet after a decline, the minimum genuine time saving worth interrupting for, how close to
// the destination it stops bothering to check at all, and how long the suggestion banner stays
// up before auto-dismissing if left untouched.
const TRAFFIC_CHECK_INTERVAL_MS = 90_000;
const TRAFFIC_SUGGESTION_COOLDOWN_MS = 8 * 60_000;
const MIN_SAVED_SECONDS_TO_SUGGEST = 180;
const MIN_REMAINING_METERS_TO_CHECK = 1500;
const TRAFFIC_SUGGESTION_DISPLAY_MS = 10_000;
// The actual trigger window, per explicit request ("traffic ... from their location live -to
// 1km") -- the suggestion only fires off a real, live-traffic delay detected in the next 1km
// of the route ahead of the driver, not an average over the whole remaining trip. Mirrors
// mobile's own constant exactly.
const NEAR_TERM_TRAFFIC_CHECK_METERS = 1000;

// Cached by "color:scale" so repeated calls return the *same* object reference instead of a
// fresh one on every render -- markers (alerts + every OSM traffic light/speed camera, which
// can number in the hundreds at street zoom) were otherwise getting a new `icon` prop on every
// App re-render, forcing Google Maps to re-diff/re-paint every marker on each keystroke or GPS
// tick even though the icon itself never actually changes.
const markerIconCache = new Map<string, google.maps.Symbol>();
function markerIcon(color: string, scale = 12, strokeWeight = 2): google.maps.Symbol {
  const key = `${color}:${scale}:${strokeWeight}`;
  let icon = markerIconCache.get(key);
  if (!icon) {
    icon = {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight,
      scale,
    };
    markerIconCache.set(key, icon);
  }
  return icon;
}

// Static (never changes), so build it once instead of a fresh object literal on every render
// -- but lazily, on first call, NOT as a plain top-level const. The Google Maps script that
// defines the `google` global loads asynchronously (see useJsApiLoader below); a top-level
// `const x = { path: google.maps.SymbolPath.CIRCLE, ... }` runs the instant this module is
// first evaluated by the browser, before that script has necessarily finished loading --
// `google` is undefined at that point, which threw and crashed the entire app to a blank
// white screen on every page load. Deferring the object-literal construction into a function
// (only ever called from inside JSX that's already gated on isLoaded) fixes that.
let currentLocationIconCache: google.maps.Symbol | null = null;
function currentLocationIcon(): google.maps.Symbol {
  if (!currentLocationIconCache) {
    currentLocationIconCache = {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: "#2563EB",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 3,
      scale: 8,
    };
  }
  return currentLocationIconCache;
}

// Real, recognizable glyphs instead of plain colored dots -- a purple camera body for speed
// cameras, a green traffic-light housing (three lenses) for signals -- cached by exact pixel
// size (same lazy-build-once pattern as the functions above, for the same reason: `google`
// isn't defined yet at module-load time, only once the Maps script has actually loaded).
const speedCameraIconCache = new Map<number, google.maps.Icon>();
function speedCameraIcon(scale: number): google.maps.Icon {
  // Deliberately much bigger than the traffic-light icon below -- a fixed speed camera is the
  // rarer, higher-stakes marker (a real fine, not just "there's a light here"), so it's sized
  // to stand out and be hard to miss glancing at the map rather than blending in as just
  // another same-sized dot.
  const w = Math.round(34 * scale);
  const h = Math.round(25 * scale);
  let icon = speedCameraIconCache.get(w);
  if (!icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 33 24">
      <rect x="1" y="5" width="24" height="15" rx="3" fill="#7C3AED" stroke="#ffffff" stroke-width="2"/>
      <rect x="24" y="9" width="7" height="8" rx="1.5" fill="#7C3AED" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="13" cy="12.5" r="5.4" fill="#ffffff"/>
      <circle cx="13" cy="12.5" r="2.8" fill="#7C3AED"/>
    </svg>`;
    icon = {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(w, h),
      anchor: new google.maps.Point(w / 2, h / 2),
    };
    speedCameraIconCache.set(w, icon);
  }
  return icon;
}

const trafficLightIconCache = new Map<number, google.maps.Icon>();
function trafficLightIcon(scale: number): google.maps.Icon {
  // Smaller than the speed camera icon above -- traffic lights are by far the more common
  // marker (dozens on screen at once in a city), so it stays compact to avoid cluttering the
  // map instead of competing for attention with the rarer, higher-stakes speed camera marker.
  const w = Math.round(12 * scale);
  const h = Math.round(19 * scale);
  let icon = trafficLightIconCache.get(w);
  if (!icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 38">
      <rect x="3" y="1" width="18" height="36" rx="7" fill="#0D9488" stroke="#ffffff" stroke-width="2"/>
      <circle cx="12" cy="10.5" r="4" fill="#ffffff" opacity="0.95"/>
      <circle cx="12" cy="19" r="4" fill="#ffffff" opacity="0.55"/>
      <circle cx="12" cy="27.5" r="4" fill="#ffffff" opacity="0.55"/>
    </svg>`;
    icon = {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(w, h),
      anchor: new google.maps.Point(w / 2, h / 2),
    };
    trafficLightIconCache.set(w, icon);
  }
  return icon;
}

const liveCameraIconCache = new Map<number, google.maps.Icon>();
function liveCameraIcon(scale: number): google.maps.Icon {
  const w = Math.round(24 * scale);
  const h = Math.round(18 * scale);
  let icon = liveCameraIconCache.get(w);
  if (!icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 34 26">
      <rect x="1" y="4" width="22" height="18" rx="4" fill="#EA580C" stroke="#ffffff" stroke-width="2"/>
      <path d="M23 11.5 L32 6 V20 L23 14.5 Z" fill="#EA580C" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="4.5" fill="#ffffff"/>
      <circle cx="12" cy="13" r="2.3" fill="#EA580C"/>
    </svg>`;
    icon = {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(w, h),
      anchor: new google.maps.Point(w / 2, h / 2),
    };
    liveCameraIconCache.set(w, icon);
  }
  return icon;
}

// A real, classic map-pin glyph for the destination -- distinct from every other marker on
// the map (alerts, current location, OSM layer) so it's unambiguous which point you're
// actually driving to, whatever kind of place it is (house, warehouse, carpark, park...).
let destinationIconCache: google.maps.Icon | null = null;
function destinationIcon(): google.maps.Icon {
  if (!destinationIconCache) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 32 44">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 28 16 28s16-16 16-28C32 7.2 24.8 0 16 0z" fill="#16A34A" stroke="#ffffff" stroke-width="2"/>
      <circle cx="16" cy="16" r="6.5" fill="#ffffff"/>
    </svg>`;
    destinationIconCache = {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(34, 46),
      anchor: new google.maps.Point(17, 46),
    };
  }
  return destinationIconCache;
}

// Fetches (and shows) the OSM traffic-light/speed-camera layer from a city-wide zoom level
// on down -- zoom 11 comfortably fits an entire metro area like greater Sydney in view at
// once, so panning/zooming around a whole city surfaces its cameras/signals, not just a
// tight street-level block. Still viewport-based (whatever's currently on screen), not a
// single unbounded fetch -- a literal all-of-Australia-at-once request would be tens of
// thousands of nodes in one call and would time out against Overpass's public API, so it
// stays capped to "however wide the visible map currently is", same debounced/cached
// fetching as before, just triggered from further out.
const OSM_LAYER_MIN_ZOOM = 11;

// Line-icon FAB glyphs matching the mobile app's Ionicons exactly ("locate" and "map-outline")
// instead of emoji, which render inconsistently across OSes/browsers and don't match iOS's
// look at all -- the recenter button in particular used a paper-plane arrow (➤) that isn't
// what "locate" looks like on mobile (a target/crosshair), and satellite used a 🛰️ emoji where
// mobile's own toggle uses a plain flat-map glyph, not a satellite.
function LocateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function MapOutlineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" />
      <path d="M9 3v16M15 5v16" />
    </svg>
  );
}

export default function App() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const { location, error: locationError } = useGeolocation();
  const {
    settings,
    setVisibleRegions,
    setAlertsEnabled,
    setVisibleAlertTypes,
    setAlertExpiryMs,
    setHideDetectionTrace,
    setTheme,
    setMapTheme,
    setShowTrafficLights,
    setShowSpeedCameras,
    setOsmLayerRadiusKm,
    setShowLiveCameras,
    setVoiceEnabled,
    setVoiceVolume,
  } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // A newly-arrived error should always show, even if the user dismissed a previous one.
  useEffect(() => {
    setBannerDismissed(false);
  }, [authError, locationError]);

  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertDoc | null>(null);
  const [selectedOsmMarker, setSelectedOsmMarker] = useState<{
    kind: OsmMarkerKind;
    lat: number;
    lng: number;
  } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [detectionOpen, setDetectionOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [phoneAuthOpen, setPhoneAuthOpen] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [, setAuthTick] = useState(0);
  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig>({});
  const [revCheckOpen, setRevCheckOpen] = useState(false);
  const [revCheckReturnSessionId, setRevCheckReturnSessionId] = useState<string | null>(null);

  // Picks up the return trip from Stripe Checkout (?revcheck_session=<id> on the success_url) --
  // opens the panel straight to its "running the check" state and strips the param so a refresh
  // afterward doesn't re-trigger it.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("revcheck_session");
    if (!sessionId) return;
    setRevCheckReturnSessionId(sessionId);
    setRevCheckOpen(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Business/POI detail panel (hours, rating, reviews) -- fetched via Places whenever a
  // clickable map icon is tapped outside of any placement/zoom mode.
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [placeDetails, setPlaceDetails] = useState<google.maps.places.PlaceResult | null>(null);

  const [destination, setDestination] = useState<google.maps.LatLngLiteral | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeOptions, setRouteOptions] = useState<Record<RouteKey, google.maps.DirectionsResult | null>>({
    best: null,
    fast: null,
    comfort: null,
  });
  const [selectedRouteKey, setSelectedRouteKey] = useState<RouteKey>("best");
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  // Real single-route result for walking/bicycling/transit -- see the directions-fetch effect
  // below. Only ever populated while travelMode !== "driving".
  const [modeRoute, setModeRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<google.maps.LatLngLiteral | null>(null);
  // Real measured height of RouteOptionsCard (see its onHeightChange) -- the route-preview
  // fitBounds effect below uses this real number instead of a fixed guess, so the previewed
  // route never ends up partly hidden behind the card. 280 is a reasonable fallback for the
  // one frame before the first real measurement lands.
  const [routeCardHeight, setRouteCardHeight] = useState(280);
  // Real measured height of the nav card / mini-box (see their own onHeightChange), so the
  // traffic-suggestion banner and "End suggested route" pill can sit right below whichever one
  // is currently showing instead of guessing a fixed top offset that could overlap it. 260 is a
  // reasonable fallback for the one frame before the first real measurement lands (same pattern
  // routeCardHeight above uses).
  const [navCardHeight, setNavCardHeight] = useState(260);
  // Real traffic-jam reroute suggestion -- a genuinely faster, avoid-highways (side streets)
  // alternative found while a real, meaningful traffic delay exists on the remaining route (see
  // the periodic check effect below). Held separately from `directions` itself so it can be
  // previewed before the driver actually accepts it. Mirrors mobile's own implementation.
  const [trafficSuggestionRoute, setTrafficSuggestionRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [trafficSuggestionSavedSeconds, setTrafficSuggestionSavedSeconds] = useState(0);
  // The route that was live right before a traffic suggestion was accepted -- kept around only
  // while driving the accepted suggestion, so "End suggested route" can put the driver straight
  // back on the exact route they started with.
  const [acceptedSuggestionOriginalRoute, setAcceptedSuggestionOriginalRoute] =
    useState<google.maps.DirectionsResult | null>(null);
  // Read (not a dependency) by the live-ETA refresh in the directions-fetch effect above, so a
  // refresh that happens to land while a suggestion is active keeps requesting the side-streets
  // route instead of silently reverting to the original profile.
  const suggestedRouteActiveRef = useRef(false);
  suggestedRouteActiveRef.current = acceptedSuggestionOriginalRoute !== null;
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(() => getSearchHistory());
  // Shown while the search input is focused/non-empty-typed -- explicitly NOT tied to blur, since
  // blur fires before a history row's onClick registers and would hide the panel first.
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const map3dHandleRef = useRef<Map3DViewHandle | null>(null);

  // Manual alert placement: pick a type, then tap/drag on the map to choose where the
  // report actually goes, instead of always using your current GPS fix.
  const [pendingType, setPendingType] = useState<AlertType | null>(null);
  const [pendingLocation, setPendingLocation] = useState<google.maps.LatLngLiteral | null>(null);

  // Single-waypoint "Add Stop": tap the map once to insert a stop into the current route.
  const [addingStop, setAddingStop] = useState(false);
  const [stopLocation, setStopLocation] = useState<google.maps.LatLngLiteral | null>(null);

  // Live turn-by-turn navigation
  const [navigating, setNavigating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [heading, setHeading] = useState(0);
  // "follow" = tilted, rotating, close-up camera that tracks your heading (driving view);
  // "street" = real Google Street View imagery facing your direction of travel (front/driver view);
  // "overview" = flat, north-up, zoomed out to show the entire route start-to-finish.
  // Starts unset each time navigation begins -- the driver picks a view instead of one being
  // forced on them, so none of the three toggle buttons shows as pre-selected.
  const [navViewMode, setNavViewMode] = useState<NavViewMode | null>(null);
  const [distanceToManeuverM, setDistanceToManeuverM] = useState<number | null>(null);
  const [streetViewUnavailable, setStreetViewUnavailable] = useState(false);
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);
  const lastSpeedLimitFetchRef = useRef<google.maps.LatLngLiteral | null>(null);
  const speedLimitFetchInFlightRef = useRef(false);
  // A small explainer bubble the first few times the "hide AI Detection route guide" button
  // is tapped -- it only visibly does anything once you're actually inside AI Detection, so
  // on the plain map screen it can look like it does nothing at all. Shown at most 3 times
  // ever (persisted in localStorage, not just this session), then never again.
  const [trailTip, setTrailTip] = useState<string | null>(null);
  const trailTipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onAlertTypeToggle = useCallback(
    (type: AlertType, value: boolean) => {
      setVisibleAlertTypes((types) => (value ? [...types, type] : types.filter((t) => t !== type)));
    },
    [setVisibleAlertTypes]
  );

  const onRegionToggle = useCallback(
    (code: AuRegionCode, value: boolean) => {
      setVisibleRegions((regions) => (value ? [...regions, code] : regions.filter((r) => r !== code)));
    },
    [setVisibleRegions]
  );

  const [customExpiryOpen, setCustomExpiryOpen] = useState(false);
  const [customHoursText, setCustomHoursText] = useState("");
  const [customMinutesText, setCustomMinutesText] = useState("");
  const onExpiryPresetSelect = useCallback(
    (ms: number | null) => {
      setCustomExpiryOpen(false);
      setAlertExpiryMs(ms);
    },
    [setAlertExpiryMs]
  );
  const onApplyCustomExpiry = useCallback(() => {
    const hours = Math.max(0, parseInt(customHoursText, 10) || 0);
    const minutes = Math.max(0, Math.min(59, parseInt(customMinutesText, 10) || 0));
    const ms = (hours * 60 + minutes) * 60 * 1000;
    if (ms <= 0) return;
    setAlertExpiryMs(ms);
    setCustomExpiryOpen(false);
  }, [customHoursText, customMinutesText, setAlertExpiryMs]);

  const onToggleHideTrace = useCallback(() => {
    const next = !settings.hideDetectionTrace;
    setHideDetectionTrace(next);

    const key = "trackline.hideTraceTipShownCount";
    const shown = Number(localStorage.getItem(key) ?? "0");
    if (shown < 3) {
      localStorage.setItem(key, String(shown + 1));
      setTrailTip(
        next
          ? "Route guide line will be hidden next time you open AI Detection"
          : "Route guide line will show again next time you open AI Detection"
      );
      if (trailTipTimeoutRef.current) clearTimeout(trailTipTimeoutRef.current);
      trailTipTimeoutRef.current = setTimeout(() => setTrailTip(null), 3500);
    }
  }, [settings.hideDetectionTrace, setHideDetectionTrace]);
  const lastLocationSyncRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // Drives the smoothed 3D Follow camera rotation (see the rAF loop below) -- "target" is
  // where the GPS/manual-offset math says the camera should point right now, "displayed" is
  // what's actually been pushed to the map, eased toward the target every frame instead of
  // snapping straight to it. Keeps turns/GPS jitter from producing a visible whip-pan.
  const targetHeadingRef = useRef(0);
  const displayedHeadingRef = useRef(0);
  const lastAppliedTiltRef = useRef<number | null>(null);
  const lastLocationRef = useRef<google.maps.LatLngLiteral | null>(null);
  // Off-route detection state -- see the reroute effect below for how these are used.
  const offRouteStreakRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  // Tracks the last instruction actually spoken, so the voice-guidance effect below only
  // speaks again once the active step genuinely changes, not on every GPS tick.
  const lastSpokenInstructionRef = useRef<string | null>(null);
  // Joystick-driven adjustments to the 3D Follow camera, layered on top of the
  // auto-computed travel heading/default tilt so the driver can nudge the view to
  // wherever feels comfortable. Reset via the recenter button.
  const [manualHeadingOffset, setManualHeadingOffset] = useState(0);
  const [manualTiltOverride, setManualTiltOverride] = useState<number | null>(null);
  // True the moment the driver actually drags/swipes the map away during 3D Follow --
  // previously the GPS-tick follow effect below called map.panTo(location) unconditionally
  // every tick regardless, which yanked the map back to the live position within a second or
  // two of any manual pan (looked ahead down the road, checked a spot off to the side, etc.),
  // fighting the very gesture that just moved it. Pauses the auto pan/zoom/tilt/heading
  // entirely (not just position) until Recenter is tapped, matching the mobile app's
  // followTilt=false-on-manual-pan behavior -- the view the driver set stays exactly as they
  // left it instead of snapping back on its own.
  const [manualViewActive, setManualViewActive] = useState(false);
  const onMapDragStart = useCallback(() => {
    if (navigating && navViewMode === "follow") setManualViewActive(true);
  }, [navigating, navViewMode]);

  // Lets the driver collapse the full turn-by-turn card down to a small direction pill --
  // the full card (ETA, action row, view toggle, end-nav button) covers a meaningful chunk
  // of the screen, especially with the real 3D satellite view underneath it. Reset whenever
  // navigation starts/ends so it never carries over collapsed into a fresh trip.
  const [navCardCollapsed, setNavCardCollapsed] = useState(false);
  // Alert pins can get dense enough in a busy area to clutter the driving view -- lets the
  // driver hide them just for the duration of this navigation without touching the
  // always-on region-wide alert visibility setting.
  const [hideAlertsWhileNavigating, setHideAlertsWhileNavigating] = useState(false);

  // Real traffic-signal/speed-camera locations from OpenStreetMap, refreshed as the
  // visible map area changes (see onMapIdle below).
  const [osmTrafficLights, setOsmTrafficLights] = useState<OsmPoint[]>([]);
  const [osmSpeedCameras, setOsmSpeedCameras] = useState<OsmPoint[]>([]);
  const osmFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOsmBoundsRef = useRef<google.maps.LatLngBounds | null>(null);

  // The fetch above (onMapIdle) pulls in whatever the current *viewport* covers, which can be
  // far from the driver's own position after panning around to look at somewhere else. This
  // trims what's actually rendered down to the configured radius from the driver's own live
  // location (settings.osmLayerRadiusKm, 1-200km), so "how far this layer shows from me" means
  // what it says regardless of where the map itself is currently panned to look.
  const visibleOsmTrafficLights = useMemo(
    () =>
      location
        ? osmTrafficLights.filter(
            (p) => distanceKm(location.lat, location.lng, p.lat, p.lng) <= settings.osmLayerRadiusKm
          )
        : osmTrafficLights,
    [osmTrafficLights, location?.lat, location?.lng, settings.osmLayerRadiusKm]
  );
  const visibleOsmSpeedCameras = useMemo(
    () =>
      location
        ? osmSpeedCameras.filter(
            (p) => distanceKm(location.lat, location.lng, p.lat, p.lng) <= settings.osmLayerRadiusKm
          )
        : osmSpeedCameras,
    [osmSpeedCameras, location?.lat, location?.lng, settings.osmLayerRadiusKm]
  );

  // Real NSW government live traffic cameras (see services/liveTrafficCameras.ts) -- a small,
  // near-static dataset (~200 cameras), fetched once and cached, not re-queried per pan like
  // the OSM layer above.
  const [liveCameras, setLiveCameras] = useState<LiveTrafficCamera[]>([]);
  const [selectedLiveCamera, setSelectedLiveCamera] = useState<LiveTrafficCamera | null>(null);

  useEffect(() => {
    if (!settings.showLiveCameras || liveCameras.length > 0) return;
    fetchLiveTrafficCameras()
      .then(setLiveCameras)
      .catch((err) => console.warn("[live-cameras] fetch failed", err));
  }, [settings.showLiveCameras, liveCameras.length]);

  // Real satellite imagery toggle -- "hybrid" (not plain "satellite") so road/place names stay
  // legible over the photo, matching what Google's own Maps app actually shows under its
  // "Satellite" button despite the underlying API type being called "hybrid". A plain string
  // state, reactively applied via the map's own mapTypeId prop (see <GoogleMap> below) --
  // unlike center/heading earlier in this file, this is a primitive value that only changes
  // reference when it actually changes, so there's no controlled-prop fighting to guard against.
  const [mapTypeId, setMapTypeId] = useState<"roadmap" | "hybrid">("roadmap");

  // "View in 3D?" prompt — triggers automatically on reaching max zoom for this location
  // (native double-click-to-zoom-in is left on, so a double-click here counts too). A plain
  // single click while already at max zoom (see onClick below) just zooms back out again,
  // no priming/arming step needed.
  const [maxZoomHere, setMaxZoomHere] = useState<number | null>(null);
  // Drives the OSM traffic-light/speed-camera icon size below -- compact at a city-wide
  // view (so hundreds of markers don't clutter it), normal size at street level, bigger
  // once you're zoomed in close. Only updates on whole zoom levels (see onZoomChanged),
  // not continuously during a pinch gesture.
  const [mapZoomLevel, setMapZoomLevel] = useState<number | null>(null);
  const [show3DPrompt, setShow3DPrompt] = useState(false);
  const [street3DMode, setStreet3DMode] = useState(false);
  const promptedAtMaxZoomRef = useRef(false);


  // Theme: "system" tracks the OS/browser preference live; "light"/"dark" is a saved
  // override. The actual color swap happens via CSS variables keyed off a data-theme
  // attribute on <html> (see App.css) so it applies instantly with no re-render needed.
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (settings.theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", settings.theme);
    }
  }, [settings.theme]);

  const isDarkTheme = settings.theme === "dark" || (settings.theme === "system" && systemPrefersDark);

  useEffect(() => {
    // Bootstraps the very first session (anonymous sign-in if nothing exists yet).
    ensureSignedIn().catch((err) => {
      console.warn("[auth] anonymous sign-in failed", err);
      const code = err instanceof Object && "code" in err ? String((err as any).code) : null;
      setAuthError(`Couldn't sign in: ${code ?? (err instanceof Error ? err.message : String(err))}`);
    });

    // The real, persistent subscription -- keeps `user` in sync with Firebase's own auth
    // state for the rest of the session, not just whatever each individual sign-in/out call
    // site below happens to pass to setUser itself. Without this, any auth change that isn't
    // routed through one of those exact call sites would never reflect in the UI.
    // onIdTokenChanged, not onAuthStateChanged: it also fires when a guest becomes a real
    // account in place (linking keeps the same user object), so the UI re-renders then too.
    const unsubscribe = onIdTokenChanged(auth, (u) => {
      setUser(u);
      setAuthTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  // Records name/email/provider for the admin panel -- never a password, since Firebase
  // never gives that to the client either way. No-ops for anonymous "Guest" sessions.
  useEffect(() => {
    if (user && !user.isAnonymous) {
      upsertSignedInProfile(user).catch((err) => console.warn("[auth] profile sync failed", err));
    }
  }, [user]);

  // Last-known location for the admin panel (see userProfile.ts) -- refreshed at most every
  // 5 minutes or every 0.5km moved, whichever comes first, so a real signed-in account's
  // location stays reasonably current for support/moderation purposes without writing to
  // Firestore on every single GPS tick. No-op for guests (updateLastKnownLocation itself
  // checks isAnonymous too, matching the sign-in-history sync above).
  useEffect(() => {
    if (!user || user.isAnonymous || !location) return;
    const last = lastLocationSyncRef.current;
    const now = Date.now();
    if (last && now - last.at < 5 * 60 * 1000 && distanceKm(last.lat, last.lng, location.lat, location.lng) < 0.5) {
      return;
    }
    lastLocationSyncRef.current = { lat: location.lat, lng: location.lng, at: now };
    updateLastKnownLocation(user, location.lat, location.lng).catch((err) =>
      console.warn("[profile] location sync failed", err)
    );
  }, [user, location?.lat, location?.lng]);

  const handleSignInGoogle = useCallback(async () => {
    try {
      const signedInUser = await signInWithGoogle();
      setUser(signedInUser);
      // A prior failed attempt's error otherwise sits in the banner forever -- authError was
      // never cleared on success, so signing in fine on a retry still showed the earlier
      // failure's message indefinitely.
      setAuthError(null);
    } catch (err) {
      console.warn("[auth] Google sign-in failed", err);
      setAuthError(err instanceof Error ? err.message : "Google sign-in failed.");
    }
  }, []);

  const handleSignInApple = useCallback(async () => {
    try {
      const signedInUser = await signInWithApple();
      setUser(signedInUser);
      setAuthError(null);
    } catch (err) {
      console.warn("[auth] Apple sign-in failed", err);
      setAuthError(err instanceof Error ? err.message : "Apple sign-in failed.");
    }
  }, []);

  const handlePhoneSignedIn = useCallback((signedInUser: User) => {
    setUser(signedInUser);
    setPhoneAuthOpen(false);
    setAuthError(null);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      // signOutUser() now re-establishes a fresh anonymous session itself (see
      // services/firebase.ts) -- the persistent onAuthStateChanged listener above picks up
      // both transitions on its own, no separate ensureSignedIn()/setUser() call needed here.
      await signOutUser();
    } catch (err) {
      console.warn("[auth] sign-out failed", err);
    }
  }, []);

  // First-launch default: the moment a real geolocation fix comes in, if the driver hasn't
  // toggled on any region yet, seed visibleRegions with whichever real Australian state/
  // territory their current location falls in -- mirrors mobile's own MapScreen.tsx effect
  // exactly. Only ever fires once (guarded by visibleRegions.length === 0).
  const regionSeededRef = useRef(false);
  useEffect(() => {
    if (regionSeededRef.current || !location || settings.visibleRegions.length > 0) return;
    regionSeededRef.current = true;
    setVisibleRegions(() => [classifyAuRegion(location.lat, location.lng)]);
  }, [location, settings.visibleRegions]);

  // Fully off (and cleared) when the user has disabled alerts altogether -- matches mobile's
  // own spec exactly ("if toggled off user who is active doesn't receive no alerts"). Real
  // Australian state/territory selection instead of a distance radius, per explicit request --
  // mirrors mobile's own subscribeVisibleAlerts call exactly.
  useEffect(() => {
    if (!user || !settings.alertsEnabled) {
      setAlerts([]);
      return;
    }
    return subscribeVisibleAlerts(settings.visibleRegions, user.uid, setAlerts);
  }, [settings.alertsEnabled, settings.visibleRegions, user?.uid]);

  // Per-type visibility filter, applied on top of the region subscription above -- lets a
  // driver e.g. only care about police + hazards without changing what's actually fetched.
  // Mirrors mobile's own visibleAlerts useMemo exactly.
  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => settings.visibleAlertTypes.includes(alert.type)),
    [alerts, settings.visibleAlertTypes]
  );

  // Compute/refresh directions. Before navigating, this fetches three real, distinctly
  // -constrained routes (Best/Fast/Comfort) so the route picker has real options to show.
  // While navigating, it only re-fetches whichever profile is already selected — live
  // re-routing (see the drift-triggered update further down) shouldn't silently swap the
  // route's character mid-drive, and refetching all three every reroute would be wasteful.
  useEffect(() => {
    const origin = routeOrigin ?? location;
    if (!origin || !destination) {
      setRouteOptions({ best: null, fast: null, comfort: null });
      setModeRoute(null);
      setDirections(null);
      return;
    }
    const directionsService = new google.maps.DirectionsService();

    const waypoints = stopLocation ? [{ location: stopLocation, stopover: true }] : undefined;

    // Walking/bicycling/transit: exactly one real, independently-fetched Google Directions
    // route for that mode -- not the 3-way Best/Fast/Comfort picker below, which only makes
    // sense for driving's highway/toll trade-offs (avoidHighways/avoidTolls/drivingOptions
    // are driving-only params; passing them for another mode isn't meaningful). Transit has
    // no real notion of an arbitrary mid-trip waypoint (it's governed by fixed timetables),
    // so a stop is silently dropped for it rather than sent and ignored/erroring.
    if (travelMode !== "driving") {
      directionsService.route(
        {
          origin,
          destination,
          waypoints: travelMode === "transit" ? undefined : waypoints,
          travelMode: toGoogleTravelMode(travelMode),
        },
        (result, status) => {
          if (status === "OK" && result) {
            setModeRoute(result);
            setDirections(result);
            setActiveStepIndex(0);
          } else {
            setModeRoute(null);
          }
        }
      );
      return;
    }

    if (navigating) {
      const profile = ROUTE_PROFILES[selectedRouteKey];
      // While an accepted traffic suggestion is active (see acceptedSuggestionOriginalRoute /
      // the traffic-check effect below), this same live-ETA refresh -- which normally re-fires
      // every ~50m of travel regardless -- keeps requesting the side-streets (avoidHighways)
      // character instead of silently snapping back to the originally-selected profile's, which
      // would otherwise revert "Yes" within about 50m without the driver ever touching "End
      // suggested route".
      const avoidHighways = suggestedRouteActiveRef.current ? true : profile.avoidHighways;
      directionsService.route(
        {
          origin,
          destination,
          waypoints,
          travelMode: google.maps.TravelMode.DRIVING,
          avoidHighways,
          avoidTolls: profile.avoidTolls,
          // Traffic-aware ETA -- previously none of the three profiles requested this at all,
          // so every ETA shown was a static/typical-conditions estimate with zero live-traffic
          // input, not what "Best"/"Fast"/"Comfort" honestly cost right now.
          drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
        },
        (result, status) => {
          if (status === "OK" && result) {
            setDirections(result);
            // Not written into routeOptions[selectedRouteKey] while a suggestion is active --
            // that key still represents the driver's original Best/Fast/Comfort pick, and
            // overwriting it here would mislabel a side-streets result as that profile.
            if (!suggestedRouteActiveRef.current) {
              setRouteOptions((prev) => ({ ...prev, [selectedRouteKey]: result }));
            }
            setActiveStepIndex(0);
          }
        }
      );
      return;
    }

    let cancelled = false;
    const keys = Object.keys(ROUTE_PROFILES) as RouteKey[];
    Promise.all(
      keys.map(
        (key) =>
          new Promise<[RouteKey, google.maps.DirectionsResult | null]>((resolve) => {
            const profile = ROUTE_PROFILES[key];
            directionsService.route(
              {
                origin,
                destination,
                waypoints,
                travelMode: google.maps.TravelMode.DRIVING,
                avoidHighways: profile.avoidHighways,
                avoidTolls: profile.avoidTolls,
                drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
              },
              (result, status) => resolve([key, status === "OK" ? result : null])
            );
          })
      )
    ).then((results) => {
      if (cancelled) return;
      const next = { best: null, fast: null, comfort: null } as Record<
        RouteKey,
        google.maps.DirectionsResult | null
      >;
      for (const [key, result] of results) next[key] = result;
      setRouteOptions(next);
      const chosen = next[selectedRouteKey] ?? next.best ?? next.fast ?? next.comfort;
      if (chosen) {
        setDirections(chosen);
        setActiveStepIndex(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    routeOrigin?.lat,
    routeOrigin?.lng,
    location?.lat,
    location?.lng,
    destination,
    navigating,
    stopLocation?.lat,
    stopLocation?.lng,
    travelMode,
  ]);

  // Switching which route card is selected (before navigation starts) just swaps in the
  // already-fetched route — no need to hit the Directions API again.
  useEffect(() => {
    if (navigating || travelMode !== "driving") return;
    const chosen = routeOptions[selectedRouteKey];
    if (chosen) {
      setDirections(chosen);
      setActiveStepIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteKey]);

  // Set just before a *different* route key is picked (see onSelectRouteKey below) so the
  // fitBounds effect right after knows to skip re-fitting for that one change -- switching
  // preview routes should only swap which polyline is drawn, at whatever zoom/position the
  // driver already has, not yank a manually zoomed-in view back out to the new route's bounds.
  const skipNextRouteFitRef = useRef(false);

  const onSelectRouteKey = useCallback(
    (key: RouteKey) => {
      const reselectingSame = key === selectedRouteKey;
      if (!reselectingSame) {
        skipNextRouteFitRef.current = true;
        setSelectedRouteKey(key);
        return;
      }
      // Re-picking the already-selected route is the deliberate "reset the view" gesture --
      // re-fits to that route's full overview even though the key itself didn't change (so the
      // effect above wouldn't have fired on its own).
      const map = mapRef.current;
      const bounds = routeOptions[key]?.routes[0]?.bounds;
      if (map && bounds) {
        map.fitBounds(bounds, { top: 80, right: 60, bottom: routeCardHeight + 20, left: 60 });
      }
    },
    [selectedRouteKey, routeOptions, routeCardHeight]
  );

  // Fits the map to whichever route is previewed, padded for the route-picker card's real
  // measured height (routeCardHeight) -- DirectionsRenderer's own automatic fit (used once
  // navigating starts, via preserveViewport: false then) has no concept of that card sitting
  // over the bottom of the screen, so relying on it alone here left the lower part of the
  // previewed route hidden behind the card. Skipped once for a plain route-switch (see
  // skipNextRouteFitRef above) -- still runs for a genuinely fresh fetch (new destination, new
  // travel mode) and for the explicit reselect-to-reset gesture handled imperatively above.
  useEffect(() => {
    if (navigating || !directions) return;
    if (skipNextRouteFitRef.current) {
      skipNextRouteFitRef.current = false;
      return;
    }
    const map = mapRef.current;
    const bounds = directions.routes[0]?.bounds;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { top: 80, right: 60, bottom: routeCardHeight + 20, left: 60 });
  }, [directions, navigating, routeCardHeight]);

  // Live tracking while navigating: advance to the next step as you approach it, rotate
  // the map to face your direction of travel, and trigger a re-route if you've drifted
  // far enough from where the current route was computed.
  useEffect(() => {
    if (!navigating || !location || !directions) return;

    const last = lastLocationRef.current;
    let currentHeading = heading;
    // Real GPS-chip course-over-ground (from the Geolocation API, backed by the device's own
    // Doppler/course estimate) is far steadier than a bearing computed from two consecutive
    // fixes -- deriving our own bearing from two close, noisy lat/lng points is numerically
    // unstable (a few meters of ordinary GPS jitter can swing the computed angle wildly),
    // which is exactly what was reading as the 3D Follow camera "wiggling and spinning" and
    // then "resetting" mid-drive. Only fall back to the two-fix bearing when the platform
    // doesn't provide one (some desktop browsers never populate it), and require a bigger,
    // more deliberate movement before trusting that fallback.
    if (location.heading !== null && !Number.isNaN(location.heading) && (location.speed ?? 0) > 0.5) {
      currentHeading = location.heading;
      setHeading(currentHeading);
    } else if (last) {
      const movedKm = distanceKm(last.lat, last.lng, location.lat, location.lng);
      if (movedKm > 0.008) {
        currentHeading = bearingDegrees(last.lat, last.lng, location.lat, location.lng);
        setHeading(currentHeading);
      }
    }
    lastLocationRef.current = location;

    const steps = directions.routes[0]?.legs[0]?.steps ?? [];
    const currentStep = steps[activeStepIndex];
    if (currentStep) {
      const stepEnd = currentStep.end_location;
      const distToStepEndKm = distanceKm(location.lat, location.lng, stepEnd.lat(), stepEnd.lng());
      setDistanceToManeuverM(Math.round(distToStepEndKm * 1000));
      // Widened from a fixed 30m -- geolocation fixes here can land tens of meters apart
      // between ticks, especially at highway speed, and a narrow-only capture window was a
      // real way for a completed instruction to get stuck on screen: a fast-moving car could
      // land past the 30m mark on the very fix that would have triggered it.
      if (distToStepEndKm < STEP_COMPLETE_KM && activeStepIndex < steps.length - 1) {
        setActiveStepIndex((i) => i + 1);
      } else if (distToStepEndKm >= STEP_COMPLETE_KM) {
        // GPS-jump case: this fix isn't close to the *current* step's end, but check whether
        // it already landed past one or more of the next few steps too (several short,
        // closely-spaced maneuvers -- consecutive roundabout exits, a quick double turn --
        // covered in a single tick). Without this, that one fix would leave activeStepIndex
        // stuck on an already-passed step instead of advancing to whichever one is actually
        // next, which is exactly what showed up as a stale, already-completed instruction
        // staying on screen indefinitely after a fast or GPS-sparse stretch.
        for (let ahead = 1; ahead <= STEP_SKIP_AHEAD_LIMIT && activeStepIndex + ahead < steps.length; ahead++) {
          const aheadStep = steps[activeStepIndex + ahead];
          const aheadEnd = aheadStep.end_location;
          const distToAheadEndKm = distanceKm(location.lat, location.lng, aheadEnd.lat(), aheadEnd.lng());
          if (distToAheadEndKm < STEP_COMPLETE_KM) {
            setActiveStepIndex(Math.min(activeStepIndex + ahead + 1, steps.length - 1));
            break;
          }
        }
      }
    }

    // Real off-route detection -- previously the only reroute trigger was "have I moved 50m
    // from where the route was last computed" (below), which fires at the exact same cadence
    // whether the driver is perfectly on-route or has missed a turn entirely. It happens to
    // eventually recover from a miss too (recomputing from wherever the car currently is), but
    // only after up to 50m of travel in a possibly wrong direction, and isn't actually
    // triggered by whether the driver has really left the route. This measures live distance
    // from the route line itself and forces an immediate reroute once that's sustained and
    // confirmed, without waiting on the next scheduled 50m-travel refresh below.
    const routePath = directions.routes[0]?.overview_path;
    if (routePath && routePath.length > 1) {
      const distOffRouteM = distanceToPolylineMeters(
        location.lat,
        location.lng,
        routePath.map((p) => ({ lat: p.lat(), lng: p.lng() }))
      );
      if (distOffRouteM > OFF_ROUTE_METERS) {
        offRouteStreakRef.current += 1;
        if (
          offRouteStreakRef.current >= OFF_ROUTE_CONFIRM_TICKS &&
          Date.now() - lastRerouteAtRef.current >= OFF_ROUTE_REROUTE_COOLDOWN_MS
        ) {
          offRouteStreakRef.current = 0;
          lastRerouteAtRef.current = Date.now();
          setRouteOrigin(location);
        }
      } else {
        offRouteStreakRef.current = 0;
      }
    }

    // Keeps ETA/remaining-distance accurate while cruising normally along the route, without
    // hammering the Directions API on every GPS tick -- unrelated to the off-route recovery
    // above, which fires independently (and immediately) once a genuine miss is confirmed.
    if (!routeOrigin || distanceKm(routeOrigin.lat, routeOrigin.lng, location.lat, location.lng) > REROUTE_THRESHOLD_KM) {
      setRouteOrigin(location);
    }

    if (navViewMode === "follow" && !manualViewActive) {
      // Real photorealistic 3D tiles (Map3DView) render as a separate overlay on top of this
      // classic map when active -- the classic map sits hidden underneath it the whole time.
      // It used to still get a full panTo/setZoom/setTilt every single GPS tick regardless,
      // which is real, wasted rendering/reflow work competing with the visible WebGL 3D view
      // for the same frame budget -- part of what read as "lag" during 3D Follow. Only touch
      // the classic map's own camera when it's actually the one on screen.
      const showing3D = mapTypeId === "hybrid" && navViewMode === "follow";
      if (!showing3D) {
        // Reasserted every tick (not just on mode change) so the 2D camera can't get stuck
        // flattened out -- Google's renderer silently drops tilt below a certain zoom level,
        // and a wide zoom-out (deliberate or accidental) would otherwise never self-correct
        // while stationary, since nothing else would re-trigger it.
        const map = mapRef.current;
        if (map) {
          map.panTo(location);
          const currentZoom = map.getZoom();
          if (currentZoom !== undefined && currentZoom < 16) {
            map.setZoom(18);
          }
          // Only pushed to the map when it actually changed -- calling setTilt every single
          // GPS tick with the same value still makes the vector renderer redo work it didn't
          // need to, which is part of what reads as "blurry"/stuttery during a steady drive.
          const targetTilt = manualTiltOverride ?? 67.5;
          if (lastAppliedTiltRef.current !== targetTilt) {
            map.setTilt(targetTilt);
            lastAppliedTiltRef.current = targetTilt;
          }
        }
      }
      // Always kept current regardless of which view is visible -- both the classic map's
      // own heading-easing loop and Map3DView's independent one (see Map3DView.tsx) ease
      // toward this same ref, so turns/GPS jitter ease into place instead of whip-panning to
      // the new bearing every tick, on whichever view is actually on screen.
      targetHeadingRef.current = (currentHeading + manualHeadingOffset + 360) % 360;
    }
  }, [
    location?.lat,
    location?.lng,
    navigating,
    navViewMode,
    manualHeadingOffset,
    manualTiltOverride,
    mapTypeId,
    manualViewActive,
  ]);

  // Periodic real traffic check while navigating -- every 90s. The actual trigger is scoped
  // tightly to the next NEAR_TERM_TRAFFIC_CHECK_METERS (1km) of the route ahead of the
  // driver's live position (pointAheadOnPolylineMeters walks the current route's own
  // overview_path forward from wherever the driver actually is), not a whole-trip average -- a
  // real, meaningful live-traffic delay (10%+60s floor over free-flow, same formula mobile's
  // getDirections uses) has to exist in that near-term window specifically. Only once that's
  // confirmed does it fetch the actual full-route alternative (the side-streets/avoid-highways
  // route that would actually be switched to) and re-check it's genuinely at least
  // MIN_SAVED_SECONDS_TO_SUGGEST faster -- never a guessed/simulated "there's a jam ahead",
  // always Google's own real-time traffic model (itself built from real aggregated
  // device-location data across Google's whole user base -- this app's own install base isn't
  // remotely large enough to build an independent version of that from its own users' phone
  // signals the way Waze does). "Back streets/alleyways" maps to Google's real avoidHighways
  // flag -- the actual mechanism it exposes for this.
  const trafficSuggestionRouteRef = useRef<google.maps.DirectionsResult | null>(null);
  trafficSuggestionRouteRef.current = trafficSuggestionRoute;
  const trafficCheckInFlightRef = useRef(false);
  const trafficSuggestionDismissedAtRef = useRef(0);
  const trafficCheckLocationRef = useRef<google.maps.LatLngLiteral | null>(null);
  trafficCheckLocationRef.current = location;
  const trafficCheckDirectionsRef = useRef<google.maps.DirectionsResult | null>(null);
  trafficCheckDirectionsRef.current = directions;

  useEffect(() => {
    if (!navigating || travelMode !== "driving" || !destination) return;
    const interval = setInterval(() => {
      if (trafficSuggestionRouteRef.current || trafficCheckInFlightRef.current) return;
      if (suggestedRouteActiveRef.current) return;
      if (Date.now() - trafficSuggestionDismissedAtRef.current < TRAFFIC_SUGGESTION_COOLDOWN_MS) return;
      const origin = trafficCheckLocationRef.current;
      if (!origin) return;
      const remainingMeters = distanceKm(origin.lat, origin.lng, destination.lat, destination.lng) * 1000;
      if (remainingMeters < MIN_REMAINING_METERS_TO_CHECK) return;
      const currentRoutePath = trafficCheckDirectionsRef.current?.routes[0]?.overview_path;
      if (!currentRoutePath) return;
      trafficCheckInFlightRef.current = true;

      const directionsService = new google.maps.DirectionsService();
      const waypoints = stopLocation ? [{ location: stopLocation, stopover: true }] : undefined;
      const fetchRoute = (routeDestination: google.maps.LatLngLiteral, avoidHighways: boolean, withWaypoints: boolean) =>
        new Promise<google.maps.DirectionsResult>((resolve, reject) => {
          directionsService.route(
            {
              origin,
              destination: routeDestination,
              waypoints: withWaypoints ? waypoints : undefined,
              travelMode: google.maps.TravelMode.DRIVING,
              avoidHighways,
              drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
            },
            (result, status) => {
              if (status === "OK" && result) resolve(result);
              else reject(new Error(status));
            }
          );
        });

      const totals = (result: google.maps.DirectionsResult) =>
        result.routes[0]?.legs.reduce(
          (acc, leg) => ({
            normal: acc.normal + (leg.duration?.value ?? 0),
            traffic: acc.traffic + (leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0),
          }),
          { normal: 0, traffic: 0 }
        ) ?? { normal: 0, traffic: 0 };

      // Step 1: the actual trigger -- is there a real, live-traffic delay in just the next 1km
      // of the route ahead of the driver right now. aheadPoint is a real point on the current
      // route's own path (falls back to the destination itself if the remaining route is
      // already shorter than the window, which the remainingMeters guard above already covers
      // in practice).
      const aheadPointLatLng = pointAheadOnPolylineMeters(
        origin.lat,
        origin.lng,
        currentRoutePath.map((p) => ({ lat: p.lat(), lng: p.lng() })),
        NEAR_TERM_TRAFFIC_CHECK_METERS
      );
      const aheadPoint = aheadPointLatLng ?? destination;

      fetchRoute(aheadPoint, false, false)
        .then((nearTerm) => {
          const near = totals(nearTerm);
          const hasNearTermDelay = near.traffic > near.normal + Math.max(60, near.normal * 0.1);
          if (!hasNearTermDelay) return null;

          // Step 2: only once a real, near-term jam is confirmed does this fetch the actual
          // full-route side-streets alternative (what's offered/switched to if accepted) and
          // re-check the whole trip is still genuinely worth the interruption.
          return Promise.all([fetchRoute(destination, false, true), fetchRoute(destination, true, true)]);
        })
        .then((pair) => {
          if (!pair) return;
          const [liveCurrent, sideStreets] = pair;
          const current = totals(liveCurrent);
          const alt = totals(sideStreets);
          const savedSeconds = current.traffic - alt.traffic;
          if (savedSeconds >= MIN_SAVED_SECONDS_TO_SUGGEST) {
            setTrafficSuggestionRoute(sideStreets);
            setTrafficSuggestionSavedSeconds(savedSeconds);
          }
        })
        .catch((err) => {
          console.warn("[map] traffic reroute check failed", err);
        })
        .finally(() => {
          trafficCheckInFlightRef.current = false;
        });
    }, TRAFFIC_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [navigating, travelMode, destination?.lat, destination?.lng, stopLocation?.lat, stopLocation?.lng]);

  // Clears any stale suggestion the moment directions is replaced for any other reason (a real
  // reroute, an add-stop confirm, exiting navigation) -- a suggestion computed against the old
  // remaining path would no longer mean anything once directions change. Deliberately does NOT
  // touch acceptedSuggestionOriginalRoute -- accepting a suggestion itself calls setDirections,
  // which would otherwise wipe out the very state it just set in the same tick.
  useEffect(() => {
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
  }, [directions]);

  // "Displays for 10 seconds" per explicit request -- an unattended banner auto-dismisses
  // itself (same cooldown as a manual No/X) instead of sitting over the map indefinitely.
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
    setAcceptedSuggestionOriginalRoute(directions);
    setActiveStepIndex(0);
    setDirections(trafficSuggestionRoute);
  }, [trafficSuggestionRoute, directions]);

  // Covers both the No button and the X -- dismisses the suggestion (the live route was never
  // actually replaced, so there's nothing else to undo) and starts the cooldown so the same jam
  // doesn't immediately re-suggest itself again next check.
  const dismissTrafficSuggestion = useCallback(() => {
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
    trafficSuggestionDismissedAtRef.current = Date.now();
  }, []);

  // "End suggested route" -- only ever available while actually driving an accepted
  // suggestion (see acceptedSuggestionOriginalRoute). Restores the exact route the driver was
  // on before they said yes.
  const endSuggestedRoute = useCallback(() => {
    if (!acceptedSuggestionOriginalRoute) return;
    setActiveStepIndex(0);
    setDirections(acceptedSuggestionOriginalRoute);
    setAcceptedSuggestionOriginalRoute(null);
  }, [acceptedSuggestionOriginalRoute]);

  // Spoken turn-by-turn guidance -- speaks the active step's instruction once when it actually
  // changes (a turn was completed / navigation just started), not on every GPS tick.
  useEffect(() => {
    if (!navigating || !directions) {
      lastSpokenInstructionRef.current = null;
      return;
    }
    const step = directions.routes[0]?.legs[0]?.steps?.[activeStepIndex];
    if (!step) return;
    const instructionText = stripHtml(step.instructions);
    if (lastSpokenInstructionRef.current === instructionText) return;
    lastSpokenInstructionRef.current = instructionText;
    if (settings.voiceEnabled) speak(instructionText, settings.voiceVolume);
  }, [navigating, directions, activeStepIndex, settings.voiceEnabled, settings.voiceVolume]);

  // Smoothly eases the 3D Follow camera's heading toward targetHeadingRef every frame
  // instead of snapping to it -- exponential ease (each frame closes ~14% of the remaining
  // angular gap) reads as a natural, weighted turn like a real nav app instead of a jump-cut,
  // while still catching up to a moving target within well under a second. Only runs while
  // actually in follow mode so it doesn't burn frames the rest of the time. Also skipped
  // whenever the real 3D tiles are what's actually on screen -- Map3DView runs this exact
  // same easing loop itself (see Map3DView.tsx), so running a second one here would just be
  // wasted rAF work on a hidden map, competing with the visible WebGL view for frame time.
  useEffect(() => {
    if (!navigating || navViewMode !== "follow" || mapTypeId === "hybrid" || manualViewActive) return;
    const map = mapRef.current;
    if (!map) return;

    displayedHeadingRef.current = map.getHeading() ?? targetHeadingRef.current;
    let rafId: number;

    function tick() {
      const current = displayedHeadingRef.current;
      const target = targetHeadingRef.current;
      const delta = ((target - current + 540) % 360) - 180;
      if (Math.abs(delta) > 0.05) {
        displayedHeadingRef.current = (current + delta * 0.14 + 360) % 360;
        map?.setHeading(displayedHeadingRef.current);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [navigating, navViewMode, mapTypeId, manualViewActive]);

  // Real posted speed limit for the road the driver is currently on, from OpenStreetMap's
  // maxspeed tags (see osmTrafficData.ts) -- refetched only after moving ~50m so a live GPS
  // track doesn't hammer the Overpass API every tick, and skipped entirely while a fetch is
  // already in flight.
  useEffect(() => {
    if (!navigating || !location) return;
    const last = lastSpeedLimitFetchRef.current;
    if (last && distanceKm(last.lat, last.lng, location.lat, location.lng) < 0.05) return;
    if (speedLimitFetchInFlightRef.current) return;

    lastSpeedLimitFetchRef.current = location;
    speedLimitFetchInFlightRef.current = true;
    fetchSpeedLimitNear(location.lat, location.lng)
      .then((result) => setSpeedLimitKmh(result?.kmh ?? null))
      .catch(() => setSpeedLimitKmh(null))
      .finally(() => {
        speedLimitFetchInFlightRef.current = false;
      });
  }, [navigating, location?.lat, location?.lng]);

  // Switch between the tilted "follow" driving view and the flat "overview" of the
  // whole route whenever the toggle changes (or a fresh route comes in while already
  // in overview mode). "street" mode swaps in a full-screen Street View overlay instead
  // (see the StreetViewNav render below) and doesn't move the map camera underneath it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigating) return;

    if (navViewMode === "follow") {
      map.setTilt(67.5);
      map.setZoom(18);
      if (location) map.panTo(location);
    } else if (navViewMode === "overview") {
      map.setTilt(0);
      map.setHeading(0);
      const bounds = directions?.routes[0]?.bounds;
      if (bounds) map.fitBounds(bounds, 80);
    }
  }, [navViewMode, navigating, directions]);

  const onStreetViewNoCoverage = useCallback(() => {
    setStreetViewUnavailable(true);
    setNavViewMode("follow");
  }, []);

  useEffect(() => {
    if (!streetViewUnavailable) return;
    const timer = setTimeout(() => setStreetViewUnavailable(false), 4000);
    return () => clearTimeout(timer);
  }, [streetViewUnavailable]);

  // Look up the real max zoom Google has imagery for at this location (varies by area —
  // dense cities go much deeper than rural roads), so the "view in 3D?" prompt triggers
  // at an actually-meaningful "you've zoomed in as far as this place goes" point instead
  // of a guessed constant.
  useEffect(() => {
    if (!location || !isLoaded) return;
    const maxZoomService = new google.maps.MaxZoomService();
    maxZoomService.getMaxZoomAtLatLng(location, (result) => {
      if (result.status === "OK") setMaxZoomHere(result.zoom);
    });
  }, [location?.lat, location?.lng, isLoaded]);

  const onZoomChanged = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom === undefined) return;

    // Rounded to whole levels -- the OSM marker icon sizing below reads this, and only
    // needs to change a handful of times across a zoom gesture, not on every fractional
    // in-between value a pinch can report.
    setMapZoomLevel(Math.round(zoom));

    if (maxZoomHere === null) return;
    if (zoom >= maxZoomHere) {
      if (!promptedAtMaxZoomRef.current && !street3DMode) {
        promptedAtMaxZoomRef.current = true;
        setShow3DPrompt(true);
      }
    } else {
      promptedAtMaxZoomRef.current = false;
    }
  }, [maxZoomHere, street3DMode]);

  // Fetches real OSM traffic-signal/speed-camera data for the visible area once settled
  // (debounced) at street-level zoom, skipping the request entirely when the current
  // viewport is already covered by the last fetch so panning around a small area doesn't
  // keep re-querying Overpass's shared public endpoint.
  const onMapIdle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    // Skip the fetch entirely (not just hide the results) when both layers are turned off --
    // no Overpass request, no markers at all. If either is on, the fetch still runs as one
    // combined request (it's a single query for both node types); each layer only renders
    // its own markers based on its own toggle below.
    if (!settings.showTrafficLights && !settings.showSpeedCameras) return;
    const zoom = map.getZoom();
    if (zoom === undefined || zoom < OSM_LAYER_MIN_ZOOM) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const last = lastOsmBoundsRef.current;
    if (last && last.contains(bounds.getNorthEast()) && last.contains(bounds.getSouthWest())) {
      return;
    }

    if (osmFetchTimeoutRef.current) clearTimeout(osmFetchTimeoutRef.current);
    osmFetchTimeoutRef.current = setTimeout(() => {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      // Pad the fetched area so small subsequent pans don't immediately re-trigger.
      const latPad = (ne.lat() - sw.lat()) * 0.5;
      const lngPad = (ne.lng() - sw.lng()) * 0.5;
      const paddedBounds = new google.maps.LatLngBounds(
        { lat: sw.lat() - latPad, lng: sw.lng() - lngPad },
        { lat: ne.lat() + latPad, lng: ne.lng() + lngPad }
      );
      lastOsmBoundsRef.current = paddedBounds;
      fetchOsmTrafficData(paddedBounds)
        .then(({ trafficLights, speedCameras }) => {
          // NOTE: an earlier version of this raised these caps to 8000/4000, reasoning that
          // clustering made render cost stop scaling with marker count -- true for the visual
          // result, but not for *mounting* that many markers in the first place (each one is a
          // real google.maps.Marker construction), and a separate bug (see noClustererRedraw
          // below) made every single one of those trigger a full recluster over the
          // whole-growing list, an O(n^2) cost that could genuinely hang the tab for several
          // seconds on modest hardware at 12,000 markers. That recluster bug is fixed now, but
          // the sheer mount cost of a very large batch is still real, so this stays well below
          // the old 8000/4000 as a safety margin -- still comfortably above the original
          // 1500/600 for real coverage.
          setOsmTrafficLights(trafficLights.slice(0, 4000));
          setOsmSpeedCameras(speedCameras.slice(0, 2000));
        })
        .catch((err) => console.warn("[osm] traffic data fetch failed", err));
    }, 1200);
  }, [settings.showTrafficLights, settings.showSpeedCameras]);

  // onMapIdle (above) only ever runs off the map's own 'idle' event -- which does fire once
  // after the initial render (so a toggle already on when the map first loads is covered), but
  // nothing calls it again if the toggle is flipped on later while the map is sitting still.
  // That left both layers invisible until the next real pan/zoom, even with the setting
  // already on. This fires the same fetch directly on the off-to-on transition instead.
  const osmLayersEnabledRef = useRef(settings.showTrafficLights || settings.showSpeedCameras);
  useEffect(() => {
    const nowEnabled = settings.showTrafficLights || settings.showSpeedCameras;
    if (nowEnabled && !osmLayersEnabledRef.current) {
      // Force a fresh fetch even if the viewport bounds haven't changed since the layers were
      // last (or never) fetched.
      lastOsmBoundsRef.current = null;
      onMapIdle();
    }
    osmLayersEnabledRef.current = nowEnabled;
  }, [settings.showTrafficLights, settings.showSpeedCameras, onMapIdle]);

  useEffect(() => {
    if (!selectedPlaceId || !mapRef.current) return;
    const service = new google.maps.places.PlacesService(mapRef.current);
    service.getDetails(
      {
        placeId: selectedPlaceId,
        fields: [
          "name",
          "formatted_address",
          "formatted_phone_number",
          "website",
          "rating",
          "user_ratings_total",
          "opening_hours",
          "reviews",
          "geometry",
        ],
      },
      (result, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && result) {
          setPlaceDetails(result);
        } else {
          setPlaceDetails(null);
          setSelectedPlaceId(null);
        }
      }
    );
  }, [selectedPlaceId]);

  const closeBusinessPanel = useCallback(() => {
    setSelectedPlaceId(null);
    setPlaceDetails(null);
  }, []);

  const getDirectionsToPlace = useCallback(() => {
    const loc = placeDetails?.geometry?.location;
    if (!loc) return;
    setDestination({ lat: loc.lat(), lng: loc.lng() });
    setTravelMode("driving");
    setModeRoute(null);
    closeBusinessPanel();
  }, [placeDetails, closeBusinessPanel]);

  const enterStreet3D = useCallback(() => {
    setShow3DPrompt(false);
    setStreet3DMode(true);
    mapRef.current?.setTilt(67.5);
  }, []);

  const declineStreet3D = useCallback(() => {
    setShow3DPrompt(false);
  }, []);

  const exitStreet3D = useCallback(() => {
    setStreet3DMode(false);
    mapRef.current?.setTilt(0);
    mapRef.current?.setHeading(0);
  }, []);

  // When satellite's real 3D tiles are the ones actually on screen (see use3DSatellite
  // below), the joystick has to reach that element instead -- it renders in a separate
  // overlay on top of the classic 2D map, so calling mapRef's own setHeading/setTilt here
  // would silently spin the hidden 2D map underneath while the visible 3D view never moves.
  const rotateStreet3D = useCallback((deltaDeg: number) => {
    if (mapTypeId === "hybrid") {
      map3dHandleRef.current?.rotate(deltaDeg);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const current = map.getHeading() ?? 0;
    map.setHeading((current + deltaDeg + 360) % 360);
  }, [mapTypeId]);

  const tiltStreet3D = useCallback((deltaDeg: number) => {
    if (mapTypeId === "hybrid") {
      map3dHandleRef.current?.tilt(deltaDeg);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const current = map.getTilt() ?? 0;
    map.setTilt(Math.max(0, Math.min(67.5, current + deltaDeg)));
  }, [mapTypeId]);

  // 3D Follow's joystick: unlike Street 3D's, these persist as state (not just direct map
  // calls) since the per-tick tracking effect reasserts the camera every location update
  // and would otherwise immediately overwrite a direct map.setHeading/setTilt call.
  const rotateFollow = useCallback((deltaDeg: number) => {
    setManualHeadingOffset((prev) => (prev + deltaDeg + 360) % 360);
  }, []);

  const tiltFollow = useCallback((deltaDeg: number) => {
    setManualTiltOverride((prev) => Math.max(0, Math.min(67.5, (prev ?? 67.5) + deltaDeg)));
  }, []);

  // Two-finger look-around during 3D Follow, replacing the on-screen joystick entirely:
  // a two-finger drag adjusts heading/tilt (feeding the same manual offsets the old joystick
  // buttons did) -- horizontal movement rotates the view, vertical movement ("lift" the
  // fingers up/down) digs the camera deeper into/out of the tilt angle. One finger is left
  // completely alone so it keeps doing normal native map panning/dragging, exactly like the
  // home map screen -- only a *second* simultaneous touch engages look-around, so there's no
  // ambiguity between "I'm panning" and "I'm looking around".
  useEffect(() => {
    if (!navigating || navViewMode !== "follow") return;
    const map = mapRef.current;
    if (!map) return;
    const div = map.getDiv();

    let lastX: number | null = null;
    let lastY: number | null = null;

    function midpoint(touches: TouchList): { x: number; y: number } {
      const a = touches[0];
      const b = touches[1];
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) {
        lastX = null;
        lastY = null;
        return;
      }
      const mid = midpoint(e.touches);
      lastX = mid.x;
      lastY = mid.y;
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || lastX === null || lastY === null) return;
      const mid = midpoint(e.touches);
      const dx = mid.x - lastX;
      const dy = mid.y - lastY;
      lastX = mid.x;
      lastY = mid.y;
      rotateFollow(dx * 0.3);
      tiltFollow(-dy * 0.3);
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        lastX = null;
        lastY = null;
      }
    }

    div.addEventListener("touchstart", onTouchStart, { passive: true });
    div.addEventListener("touchmove", onTouchMove, { passive: true });
    div.addEventListener("touchend", onTouchEnd, { passive: true });
    div.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      div.removeEventListener("touchstart", onTouchStart);
      div.removeEventListener("touchmove", onTouchMove);
      div.removeEventListener("touchend", onTouchEnd);
      div.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [navigating, navViewMode, rotateFollow, tiltFollow]);

  const onPlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    setDestination({ lat: loc.lat(), lng: loc.lng() });
    setTravelMode("driving");
    setModeRoute(null);
    setHistoryPanelOpen(false);
    if (place?.place_id) {
      setSearchHistory(
        addSearchHistoryEntry({
          placeId: place.place_id,
          name: place.name ?? "",
          address: place.formatted_address ?? "",
          lat: loc.lat(),
          lng: loc.lng(),
        })
      );
    }
  }, []);

  const onSelectHistoryEntry = useCallback((entry: SearchHistoryEntry) => {
    setDestination({ lat: entry.lat, lng: entry.lng });
    setTravelMode("driving");
    setModeRoute(null);
    setHistoryPanelOpen(false);
    if (searchInputRef.current) searchInputRef.current.value = entry.name;
    setSearchHistory(addSearchHistoryEntry(entry));
  }, []);

  const onRemoveHistoryEntry = useCallback((placeId: string) => {
    setSearchHistory(removeSearchHistoryEntry(placeId));
  }, []);

  const onClearHistory = useCallback(() => {
    clearSearchHistory();
    setSearchHistory([]);
  }, []);

  // Biases (doesn't restrict) destination search toward wherever the user actually is, so
  // typing "Lak..." near Lakemba, NSW ranks Lakemba first instead of a same-named place
  // elsewhere in the world -- a real Autocomplete `bounds` soft bias, not a hard filter, so
  // a deliberately-typed far-away destination is still reachable.
  const biasAutocompleteToLocation = useCallback((loc: google.maps.LatLngLiteral) => {
    if (!autocompleteRef.current) return;
    const circle = new google.maps.Circle({ center: loc, radius: 50000 });
    const bounds = circle.getBounds();
    if (bounds) autocompleteRef.current.setBounds(bounds);
  }, []);

  useEffect(() => {
    if (location) biasAutocompleteToLocation(location);
  }, [location?.lat, location?.lng, biasAutocompleteToLocation]);

  const startPlacement = useCallback(
    (type: AlertType) => {
      setPendingType(type);
      setPendingLocation(location ?? mapRef.current?.getCenter()?.toJSON() ?? DEFAULT_CENTER);
      setPendingComment("");
      setReportOpen(false);
    },
    [location]
  );

  // Optional "up to 7 words" comment, mirroring the mobile app -- clamped live to the word cap
  // on every keystroke (see commentFilter.ts) so it's never possible to type past it.
  const [pendingComment, setPendingComment] = useState("");
  const onChangePendingComment = useCallback((text: string) => {
    setPendingComment(clampToWordLimit(text));
  }, []);
  const pendingCommentBlocked = containsBlockedLanguage(pendingComment);

  // Optional `overrideLocation` -- the "Set at my location" button passes the driver's own real
  // live geolocation directly, skipping whatever the pin is currently at, so it reports at the
  // real current position in one click instead of requiring the pin to already be dragged/
  // tapped there. The normal drag/tap-to-place flow (Confirm location) is unchanged.
  const confirmPlacement = useCallback(
    async (overrideLocation?: google.maps.LatLngLiteral) => {
      if (pendingCommentBlocked) return;
      const targetLocation = overrideLocation ?? pendingLocation;
      if (!pendingType || !targetLocation) return;
      if (!user) {
        alert("Not signed in yet — check the banner at the top of the page.");
        return;
      }
      try {
        await reportAlert(pendingType, targetLocation, user.uid, settings.alertExpiryMs, pendingComment);
        setPendingType(null);
        setPendingLocation(null);
        setPendingComment("");
      } catch (err) {
        // Previously unhandled -- a failed write (permission denied, network drop) left the
        // placement pin sitting there with zero feedback, indistinguishable from Confirm having
        // silently done nothing at all.
        console.warn("[app] reportAlert failed", err);
        alert("Couldn't set that alert -- check your connection and try again.");
      }
    },
    [pendingType, pendingLocation, user, settings.alertExpiryMs, pendingComment, pendingCommentBlocked]
  );

  const confirmPlacementAtMyLocation = useCallback(() => {
    if (!location) return;
    confirmPlacement(location);
  }, [location, confirmPlacement]);

  const cancelPlacement = useCallback(() => {
    setPendingType(null);
    setPendingLocation(null);
    setPendingComment("");
  }, []);

  const onDeleteAlert = useCallback(async (alert: AlertDoc) => {
    await deleteAlert(alert.id);
    setSelectedAlert(null);
  }, []);

  const onHideAlert = useCallback(
    async (alert: AlertDoc) => {
      if (!user) return;
      await hideAlertForUser(alert.id, user.uid);
      setSelectedAlert(null);
    },
    [user]
  );

  const onConfirmStillHere = useCallback(async (alert: AlertDoc) => {
    await confirmAlert(alert.id);
  }, []);

  const startNavigation = useCallback(() => {
    setNavigating(true);
    // Chase-cam engages by default -- previously navigation always started with no view mode
    // picked, leaving the driver looking at a flat, non-following map until they manually
    // tapped "3D Follow" every single time. "3D Follow" is still one tap away to back out of
    // via the existing view-toggle row if they'd rather not have it.
    setNavViewMode("follow");
    setManualViewActive(false);
    setActiveStepIndex(0);
    setRouteOrigin(location);
    lastLocationRef.current = location;
    setNavCardCollapsed(false);
    // Safety clear for a fresh nav session -- normally already cleared by endNavigation, but a
    // stray leftover here would incorrectly show "End suggested route" and force
    // avoidHighways on this brand-new trip.
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
    setAcceptedSuggestionOriginalRoute(null);
  }, [location]);

  const endNavigation = useCallback(() => {
    setNavigating(false);
    setHeading(0);
    setSpeedLimitKmh(null);
    mapRef.current?.setTilt(0);
    mapRef.current?.setHeading(0);
    mapRef.current?.setZoom(15);
    setNavCardCollapsed(false);
    setTravelMode("driving");
    setModeRoute(null);
    setManualViewActive(false);
    setTrafficSuggestionRoute(null);
    setTrafficSuggestionSavedSeconds(0);
    setAcceptedSuggestionOriginalRoute(null);
    stopSpeaking();
  }, []);

  const clearRoute = useCallback(() => {
    setDestination(null);
    setDirections(null);
    setRouteOptions({ best: null, fast: null, comfort: null });
    setSelectedRouteKey("best");
    setTravelMode("driving");
    setModeRoute(null);
    setRouteOrigin(null);
    setStopLocation(null);
    setAddingStop(false);
    if (navigating) endNavigation();
  }, [navigating, endNavigation]);

  const onAddStopClick = useCallback(() => {
    setDetectionOpen(false);
    if (stopLocation) {
      setStopLocation(null);
    } else {
      setAddingStop(true);
    }
  }, [stopLocation]);

  const onReportClick = useCallback(() => {
    setDetectionOpen(false);
    setReportOpen(true);
  }, []);

  // One-time snapshot share (Web Share API, or copy to clipboard as a fallback) -- not a
  // live-updating tracking link, since that would need a backend to serve a page that keeps
  // refreshing your position, which isn't wired up here.
  const shareEta = useCallback(() => {
    const leg = directions?.routes[0]?.legs[0];
    if (!leg || !location) return;
    const eta = leg.duration_in_traffic ?? leg.duration;
    const arrivalText = formatArrivalClock(Date.now() + (eta?.value ?? 0) * 1000);
    const mapsLink = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    const text = `I'm on my way — ETA ${eta?.text ?? ""}, arriving around ${arrivalText}. My current location: ${mapsLink}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert("Copied your ETA and current location to the clipboard — paste it to send.");
      });
    }
  }, [directions, location]);

  const recenter = useCallback(() => {
    if (!location) return;
    mapRef.current?.panTo(location);
    if (!navigating) {
      mapRef.current?.setZoom(15);
    } else {
      // Also doubles as "reset the 3D Follow view" -- clears any joystick adjustment AND
      // resumes the auto-follow camera if a manual drag had paused it (see manualViewActive).
      setManualHeadingOffset(0);
      setManualTiltOverride(null);
      setManualViewActive(false);
      lastAppliedTiltRef.current = null;
    }
  }, [location, navigating]);

  // Seeds the map's center exactly once, the first time a real GPS fix arrives -- NOT
  // reactively tied to `location` on every tick. <GoogleMap>'s `center` prop is controlled:
  // the wrapper library calls map.setCenter() any time this value's object reference changes,
  // which used to happen on every single GPS update (useGeolocation hands back a fresh
  // {lat,lng} object each time). That meant freely panning/dragging around the map got
  // periodically yanked back to your live position mid-drag -- the "little delay"/jank
  // reported when moving the map. Ongoing recentering is already handled imperatively
  // elsewhere (the recenter button, and the 3D Follow effect's own map.panTo() calls), so
  // this only ever needs to fire once.
  const [center, setCenter] = useState<google.maps.LatLngLiteral>(DEFAULT_CENTER);
  const centerSeededRef = useRef(false);
  useEffect(() => {
    if (location && !centerSeededRef.current) {
      centerSeededRef.current = true;
      setCenter(location);
    }
  }, [location]);

  // Memoized so the map's `options` prop keeps a stable identity across renders that don't
  // actually change any of these values -- @react-google-maps/api re-applies map options
  // whenever this object's reference changes, which is wasted work on every render otherwise.
  // Declared before the `isLoaded` early return below (along with onMapLoad/onMapClick) so
  // every hook in this component runs on every render, regardless of that guard -- hooks
  // declared after an early return violate the Rules of Hooks (React error #310, "Rendered
  // more hooks than during the previous render") the moment isLoaded flips from false to true.
  const mapOptions = useMemo<google.maps.MapOptions>(
    () => ({
      disableDefaultUI: true,
      zoomControl: false,
      draggable: true,
      gestureHandling: "greedy",
      clickableIcons: true,
      // No `mapId` here on purpose -- Google Maps ignores a client-side `styles` array
      // entirely on any map that has a Map ID (vector) set, styling only via the cloud
      // console instead. That silently broke the map color themes below the moment a
      // VITE_GOOGLE_MAPS_MAP_ID env var got configured (for the optional 3D tilt view),
      // even though the theme picker itself still looked like it was working. Matching the
      // mobile app -- whose color themes always apply via a plain style array -- wins here.
      styles: MAP_THEME_STYLES[settings.mapTheme] ?? (isDarkTheme ? DARK_MAP_STYLE : LIGHT_MAP_STYLE),
    }),
    [isDarkTheme, settings.mapTheme]
  );

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const placeEvent = e as google.maps.MapMouseEvent & { placeId?: string };
      if (pendingType && e.latLng) {
        setPendingLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      } else if (addingStop && e.latLng) {
        setStopLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setAddingStop(false);
      } else if (placeEvent.placeId) {
        placeEvent.stop();
        setSelectedPlaceId(placeEvent.placeId);
      }
    },
    [pendingType, addingStop]
  );

  if (!isLoaded) {
    return (
      <div className="loading-screen">
        <img src="/logo.png" alt="TrackLine" className="loading-logo" />
        Loading map…
      </div>
    );
  }

  // Hides the browse-mode chrome (search bar, radius panel, about button, FABs) whenever
  // any full-panel overlay is open on top of it, instead of letting them show through
  // behind/around the panel.
  const chromeHidden =
    pendingType !== null ||
    navigating ||
    aboutOpen ||
    phoneAuthOpen ||
    adminOpen ||
    reportOpen ||
    detectionOpen ||
    revCheckOpen;

  // Real satellite selection, available while placing an alert -- previously the satellite FAB
  // lived inside the chromeHidden-gated cluster below, so it (and everything else in that
  // cluster) went away the instant pendingType became non-null, leaving no way to switch to
  // satellite imagery to place a pin accurately against real ground features. Same fix as
  // mobile's own MapScreen. Every other chromeHidden reason (navigating, an actual full-panel
  // overlay open) still hides it -- only alert placement is the exception.
  const satelliteToggleVisible =
    !navigating && !aboutOpen && !phoneAuthOpen && !adminOpen && !reportOpen && !detectionOpen && !revCheckOpen;

  const statusMessage = authError ?? locationError ?? null;
  const navSteps = directions?.routes[0]?.legs[0]?.steps ?? [];
  const navLeg = directions?.routes[0]?.legs[0];
  // duration_in_traffic (live, requested via drivingOptions above) over plain duration
  // (static/typical-conditions) whenever Google actually returned it -- every ETA shown
  // during navigation should reflect current traffic, not silently ignore it.
  const navEta = navLeg?.duration_in_traffic ?? navLeg?.duration;
  const currentStep = navSteps[activeStepIndex] ?? null;

  const remainingMeters = navSteps
    .slice(activeStepIndex)
    .reduce((sum, s) => sum + (s.distance?.value ?? 0), 0);
  const distanceRemainingText =
    remainingMeters < 1000 ? `${remainingMeters} m` : `${(remainingMeters / 1000).toFixed(1)} km`;

  const bearingToManeuverDeg =
    currentStep && location
      ? bearingDegrees(location.lat, location.lng, currentStep.end_location.lat(), currentStep.end_location.lng())
      : null;

  const detectionNavContext: DetectionNavContext | null =
    navigating && navLeg
      ? {
          instructionText: currentStep ? stripHtml(currentStep.instructions) : "Recalculating…",
          distanceToManeuverM,
          etaText: navEta?.text ?? "",
          arrivalClockText: formatArrivalClock(Date.now() + (navEta?.value ?? 0) * 1000),
          distanceRemainingText,
          bearingToManeuverDeg,
          travelHeadingDeg: heading,
          hideTrace: settings.hideDetectionTrace,
          hasStop: !!stopLocation,
          onAddStop: onAddStopClick,
          onShareEta: shareEta,
          onReportAlert: onReportClick,
        }
      : null;

  const bannerVisible = Boolean(statusMessage) && !bannerDismissed;
  // Both the error banner and the top-pinned 3D-view prompt live at the very top of the
  // screen -- whichever one is showing, the search bar/about button/radius control shift
  // down out of its way so nothing overlaps.
  const topBannerActive = bannerVisible || show3DPrompt;
  // Compact at a city-wide view (a whole metro area's worth of markers shouldn't clutter
  // it), normal size at ordinary street-browsing zoom, bigger once zoomed in close --
  // navigating always gets at least the "zoomed in" size, since visibility while actually
  // driving matters more than decluttering.
  const osmZoomTierScale = mapZoomLevel === null ? 1 : mapZoomLevel >= 17 ? 1.3 : mapZoomLevel >= 14 ? 1 : 0.7;
  const osmIconScale = navigating ? Math.max(osmZoomTierScale, 1.4) : osmZoomTierScale;

  // Real photorealistic 3D tiles replace the flat (and, tilted, visibly squashed) satellite
  // imagery specifically when satellite's selected AND the camera's actually tilted into a
  // 3D view -- either live-navigation follow mode or the manual "Explore in 3D" prompt. The
  // plain roadmap tilt path is untouched; it already renders tilt cleanly via the vector Map
  // ID, this was only ever a satellite-imagery problem. Stage 1 (see Map3DView.tsx): core
  // rendering + live position + route only, no traffic-light/camera/alert overlays yet.
  const navFollow3D = navigating && navViewMode === "follow";
  const use3DSatellite = mapTypeId === "hybrid" && (navFollow3D || street3DMode);
  const map3dTilt = manualTiltOverride ?? 67.5;
  const map3dRoutePath =
    directions?.routes[0]?.overview_path?.map((p) => ({ lat: p.lat(), lng: p.lng() })) ?? null;
  // Nav-follow gets one fixed, deliberately-tuned chase-cam distance every time -- not
  // whatever the flat 2D map's zoom happened to be showing the moment satellite got turned
  // on, which is how this was producing an inconsistent, seemingly arbitrary framing instead
  // of a proper "behind and above the driver, facing the road ahead" view. "Explore in 3D"
  // still starts from roughly the zoom level the user was already looking at, since that
  // mode is explicitly about picking up where their own manual browsing left off.
  const NAV_FOLLOW_3D_RANGE_M = 380;
  const map3dInitialRange = navFollow3D
    ? NAV_FOLLOW_3D_RANGE_M
    : mapZoomLevel === null
      ? 400
      : mapZoomLevel >= 18
        ? 200
        : mapZoomLevel >= 16
          ? 350
          : mapZoomLevel >= 14
            ? 700
            : 1200;

  return (
    <div className="app-root">
      {bannerVisible && (
        <div className="status-banner">
          <span>{statusMessage}</span>
          <button className="status-banner-close" onClick={() => setBannerDismissed(true)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <GoogleMap
        onLoad={onMapLoad}
        center={center}
        mapTypeId={mapTypeId}
        zoom={location ? 15 : 11}
        // Left undefined during 3D Follow -- heading is applied imperatively by the smoothing
        // rAF loop above instead. This is a *controlled* prop: feeding it the raw, unsmoothed
        // `heading` state here would fire the library's own map.setHeading() on every GPS
        // tick and fight the smoothing loop for control, snapping the camera right back to
        // the unsmoothed bearing every time -- exactly the jumpiness the loop exists to fix.
        heading={navigating && navViewMode === "follow" ? undefined : 0}
        tilt={(navigating && navViewMode === "follow") || street3DMode ? 67.5 : 0}
        mapContainerClassName="map-container"
        onZoomChanged={onZoomChanged}
        onDragStart={onMapDragStart}
        onIdle={onMapIdle}
        options={mapOptions}
        onClick={onMapClick}
      >
        {location && (
          <Marker position={location} icon={currentLocationIcon()} />
        )}

        {!(navigating && hideAlertsWhileNavigating) &&
          visibleAlerts.map((alert) => (
            <Marker
              key={alert.id}
              position={{ lat: alert.lat, lng: alert.lng }}
              icon={markerIcon(ALERT_COLORS[alert.type])}
              label={{ text: ALERT_EMOJI[alert.type], fontSize: "14px" }}
              onClick={() => setSelectedAlert(alert)}
            />
          ))}

        {/* Comment caption -- mirrors the mobile app: shown only while this exact alert is the
            one currently selected (its detail panel open), hiding once closed and reappearing
            if reselected, per explicit request. OverlayView (unlike react-native-maps' Marker)
            positions from real map pixel projection, so no anchor-fraction math is needed here
            the way mobile's fixed pin height required -- getPixelPositionOffset just nudges it
            below the marker's own circle each render. */}
        {!(navigating && hideAlertsWhileNavigating) &&
          visibleAlerts.map(
            (alert) =>
              alert.comment &&
              selectedAlert?.id === alert.id && (
                <OverlayView
                  key={`${alert.id}-comment`}
                  position={{ lat: alert.lat, lng: alert.lng }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  getPixelPositionOffset={(width) => ({ x: -(width / 2), y: 14 })}
                >
                  <div
                    style={{
                      maxWidth: 160,
                      padding: "3px 8px",
                      borderRadius: 8,
                      // Semi-transparent -- not fully opaque, not so see-through it's hard to
                      // read against a busy map background -- per explicit request, same style
                      // as the mobile app's own caption.
                      background: "rgba(17, 24, 39, 0.72)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: "center",
                      pointerEvents: "none",
                    }}
                  >
                    {alert.comment}
                  </div>
                </OverlayView>
              )
          )}

        {/* Real OpenStreetMap data -- see osmTrafficData.ts for what "real" means here
            (community-mapped, not an official feed). Green traffic-light glyph = signal,
            purple camera glyph = speed camera -- compact at a city-wide view, normal size
            browsing at street level, bigger zoomed in close or while navigating. Each type has
            its own independent on/off toggle -- both the fetch (onMapIdle) and the render here
            check the relevant one, so turning either off actually drops its cost, not just its
            icons. Neither type is ever clustered -- always the real individual icon itself, at
            every zoom level, per direct request. */}
        {settings.showTrafficLights &&
          visibleOsmTrafficLights.map((point) => (
            <Marker
              key={`tl-${point.id}`}
              position={{ lat: point.lat, lng: point.lng }}
              icon={trafficLightIcon(osmIconScale)}
              title="Traffic signal (OpenStreetMap data) -- tap for a real Street View image"
              // Explicit, high zIndex -- markers always sit above the base map tiles
              // regardless of type in normal Google Maps behavior, but this makes
              // that non-negotiable rather than assumed, specifically because
              // satellite/hybrid imagery is a much busier, more visually competing
              // background than the plain roadmap this was originally tuned against.
              zIndex={500}
              onClick={() => setSelectedOsmMarker({ kind: "traffic_light", lat: point.lat, lng: point.lng })}
            />
          ))}

        {settings.showSpeedCameras &&
          visibleOsmSpeedCameras.map((point) => (
            <Marker
              key={`sc-${point.id}`}
              position={{ lat: point.lat, lng: point.lng }}
              icon={speedCameraIcon(osmIconScale)}
              title="Speed camera (OpenStreetMap data) -- tap for a real Street View image"
              zIndex={500}
              onClick={() => setSelectedOsmMarker({ kind: "speed_camera", lat: point.lat, lng: point.lng })}
            />
          ))}

        {/* Real NSW government live traffic cameras -- see services/liveTrafficCameras.ts.
            Clicking a marker opens that camera's live image in the panel below. */}
        {settings.showLiveCameras &&
          liveCameras.map((camera) => (
            <Marker
              key={`cam-${camera.id}`}
              position={{ lat: camera.lat, lng: camera.lng }}
              icon={liveCameraIcon(osmIconScale)}
              title={camera.title}
              zIndex={500}
              onClick={() => setSelectedLiveCamera(camera)}
            />
          ))}

        {pendingLocation && (
          <Marker
            position={pendingLocation}
            draggable
            onDragEnd={(e) => {
              if (e.latLng) setPendingLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
            }}
            icon={markerIcon(pendingType ? ALERT_COLORS[pendingType] : "#2563EB", 14, 3)}
            zIndex={999}
          />
        )}

        {stopLocation && (
          <Marker
            position={stopLocation}
            onClick={() => setStopLocation(null)}
            title="Stop (click to remove)"
            icon={markerIcon("#F59E0B", 10, 3)}
            zIndex={998}
          />
        )}

        {directions && (
          <DirectionsRenderer
            directions={directions}
            options={{
              suppressMarkers: true,
              // Google's own auto-fit has no concept of the route-picker card sitting at the
              // bottom of the screen, so it was never accounted for -- the fitBounds effect
              // below does that explicitly instead, while actually picking a route (not yet
              // navigating).
              preserveViewport: !navigating,
              // Red and thick while still picking a route option -- previously left
              // completely unstyled (Google's default thin blue), which was the exact same
              // shade as the eventual committed route below, with no way to tell "this is
              // just a preview" from "this is what you're now navigating."
              polylineOptions: !navigating
                ? { strokeColor: "#DC2626", strokeWeight: 7, strokeOpacity: 0.9 }
                : undefined,
            }}
          />
        )}

        {/* A real pin so you can actually see which building/spot you're headed to -- house,
            warehouse, carpark, park, whatever it is -- instead of the route just ending with
            nothing marking it. The green ring is a genuine live-computed pulse (not a static
            image), and grows visually more prominent as you approach purely because 3D
            Follow zooms in tighter the whole drive, without needing to know the destination's
            actual building footprint (not available through this API). */}
        {destination && <Marker position={destination} icon={destinationIcon()} zIndex={950} />}
        {navigating && destination && <DestinationPulseCircle center={destination} />}
      </GoogleMap>

      <Map3DView
        ref={map3dHandleRef}
        active={use3DSatellite}
        location={location}
        targetHeadingRef={targetHeadingRef}
        tilt={map3dTilt}
        follow={navFollow3D}
        routePath={map3dRoutePath}
        initialRange={map3dInitialRange}
      />

      {/* Web-only, kept on purpose -- unlike mobile, a lot of web visitors are on a desktop/
          laptop without a trackpad's pinch gesture, so an explicit +/- control matters here
          even though scroll-wheel/double-click zoom also work. */}
      <div className="zoom-control">
        <button
          onClick={() => {
            const map = mapRef.current;
            if (map) map.setZoom((map.getZoom() ?? 15) + 1);
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => {
            const map = mapRef.current;
            if (map) map.setZoom((map.getZoom() ?? 15) - 1);
          }}
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {!chromeHidden && (
        <button
          className={`about-button${topBannerActive ? " chrome-shifted" : ""}`}
          onClick={() => setAboutOpen(true)}
          aria-label="About TrackLine"
        >
          <img src="/logo.png" alt="" />
        </button>
      )}

      {!chromeHidden && (
        <div className={`top-bar${topBannerActive ? " chrome-shifted" : ""}`}>
          <Autocomplete
            onLoad={(ac) => {
              autocompleteRef.current = ac;
              if (location) biasAutocompleteToLocation(location);
            }}
            onPlaceChanged={onPlaceChanged}
          >
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="Search destination"
              onFocus={() => setHistoryPanelOpen(true)}
            />
          </Autocomplete>
          {historyPanelOpen && (
            <RecentSearchesPanel
              history={searchHistory}
              onSelect={onSelectHistoryEntry}
              onRemove={onRemoveHistoryEntry}
              onClearAll={onClearHistory}
            />
          )}
        </div>
      )}

      {directions && !navigating && !pendingType && (
        <RouteOptionsCard
          routeOptions={routeOptions}
          selectedRouteKey={selectedRouteKey}
          onSelect={onSelectRouteKey}
          travelMode={travelMode}
          onSelectTravelMode={setTravelMode}
          modeRoute={modeRoute}
          onStart={startNavigation}
          onClear={clearRoute}
          onHeightChange={setRouteCardHeight}
        />
      )}

      {navigating && navViewMode === "street" && location && (
        <StreetViewNav
          position={location}
          heading={heading}
          destination={destination}
          onNoCoverage={onStreetViewNoCoverage}
        />
      )}

      {navigating && speedLimitKmh !== null && <SpeedLimitSign kmh={speedLimitKmh} />}

      {navigating && navLeg && !navCardCollapsed && (
        <NavigationCard
          step={navSteps[activeStepIndex] ?? null}
          distanceToManeuverM={distanceToManeuverM}
          etaText={navEta?.text ?? ""}
          distanceRemainingText={distanceRemainingText}
          navViewMode={navViewMode}
          onSetNavViewMode={setNavViewMode}
          onClearRoute={clearRoute}
          onExit={endNavigation}
          onCollapse={() => setNavCardCollapsed(true)}
          hasStop={!!stopLocation}
          onAddStop={onAddStopClick}
          onShareEta={shareEta}
          onReportAlert={onReportClick}
          onOpenDetection={() => setDetectionOpen(true)}
          onHeightChange={setNavCardHeight}
        />
      )}

      {navigating && navLeg && navCardCollapsed && (
        <NavMiniBox
          step={navSteps[activeStepIndex] ?? null}
          distanceToManeuverM={distanceToManeuverM}
          etaText={navEta?.text ?? ""}
          onExpand={() => setNavCardCollapsed(false)}
          onHeightChange={setNavCardHeight}
        />
      )}

      {navigating && trafficSuggestionRoute && (
        <TrafficSuggestionBanner
          top={16 + navCardHeight + 12}
          savedMinutes={Math.max(1, Math.round(trafficSuggestionSavedSeconds / 60))}
          onAccept={acceptTrafficSuggestion}
          onDismiss={dismissTrafficSuggestion}
        />
      )}

      {navigating && acceptedSuggestionOriginalRoute && (
        <EndSuggestedRouteButton top={16 + navCardHeight + 12} onEnd={endSuggestedRoute} />
      )}

      {streetViewUnavailable && (
        <div className="status-banner">No street-level imagery here — showing 3D Follow instead.</div>
      )}

      {pendingType && pendingLocation && (
        <PlacementBar
          type={pendingType}
          comment={pendingComment}
          onCommentChange={onChangePendingComment}
          commentBlocked={pendingCommentBlocked}
          // Explicitly wrapped (not onConfirm={confirmPlacement} directly) -- confirmPlacement
          // takes an optional overrideLocation, and a plain DOM button's onClick always calls
          // its handler with the native MouseEvent as the first argument; passed straight
          // through, that event object would get used AS the override location instead of
          // falling back to pendingLocation. Same fix already applied to mobile's own Set button.
          onConfirm={() => confirmPlacement()}
          onCancel={cancelPlacement}
          onConfirmAtMyLocation={confirmPlacementAtMyLocation}
          canUseMyLocation={!!location}
        />
      )}

      {addingStop && (
        <div className="stop-placement-bar">
          <span>Tap the map to add a stop</span>
          <button onClick={() => setAddingStop(false)}>Cancel</button>
        </div>
      )}

      {/* Recenter used to disappear entirely during navigation (bundled into the same FAB
          cluster below, all gated on !chromeHidden, and chromeHidden is true whenever
          navigating is) -- leaving no way to recenter at all while actually driving, exactly
          when panning away from your own position is most likely. Rendered as its own
          standalone button, independent of the browse-mode FAB cluster. */}
      {navigating && (
        <button
          className="fab fab-tertiary"
          onClick={recenter}
          disabled={!location}
          aria-label="Recenter on my location"
        >
          <LocateIcon />
        </button>
      )}

      {navigating && (
        <VoiceControl
          enabled={settings.voiceEnabled}
          volume={settings.voiceVolume}
          onToggleEnabled={() => setVoiceEnabled(!settings.voiceEnabled)}
          onSetVolume={setVoiceVolume}
        />
      )}

      {!chromeHidden && (
        <>
          <button className="fab" onClick={() => setReportOpen(true)} aria-label="Report an alert">
            +
          </button>

          <button
            className="fab fab-secondary"
            onClick={() => setDetectionOpen(true)}
            aria-label="Live vehicle detection"
          >
            🎥
          </button>

          <button
            className="fab fab-tertiary"
            onClick={recenter}
            disabled={!location}
            aria-label="Recenter on my location"
          >
            <LocateIcon />
          </button>

          {trailTip && <div className="trail-tip">{trailTip}</div>}
          <button
            className={`fab fab-quaternary${settings.hideDetectionTrace ? " fab-toggle-active" : ""}`}
            onClick={onToggleHideTrace}
            aria-label={
              settings.hideDetectionTrace
                ? "AI Detection route guide hidden — tap to show it again"
                : "Hide AI Detection route guide"
            }
            title={settings.hideDetectionTrace ? "Route guide hidden in AI Detection" : "Hide AI Detection route guide"}
          >
            🧭
          </button>

          <button
            className={`fab fab-senary${settings.showLiveCameras ? " fab-toggle-active" : ""}`}
            onClick={() => {
              const next = !settings.showLiveCameras;
              setShowLiveCameras(next);
              if (!next) setSelectedLiveCamera(null);
            }}
            aria-label={settings.showLiveCameras ? "Hide live traffic cameras" : "Show live traffic cameras"}
            title="Live traffic cameras (NSW)"
          >
            {/* Deliberately not 🎥/📹 -- those look nearly identical to the AI Detection
                button's own 🎥 at FAB size and were getting confused for it. 📡 reads as "live
                feed" instead, which is also honestly what this is (a real government camera
                feed), not "open my own camera" like AI Detection is. */}
            📡
          </button>
        </>
      )}

      {satelliteToggleVisible && (
        <button
          className={`fab fab-quinary${mapTypeId === "hybrid" ? " fab-toggle-active" : ""}`}
          onClick={() => setMapTypeId((v) => (v === "hybrid" ? "roadmap" : "hybrid"))}
          aria-label={mapTypeId === "hybrid" ? "Switch to standard map" : "Switch to satellite view"}
          title={mapTypeId === "hybrid" ? "Standard map" : "Satellite view"}
        >
          <MapOutlineIcon />
        </button>
      )}

      {/* Persistent 3D buildings toggle, matching mobile's always-present FAB (Ionicons
          "business-outline") -- web previously only ever entered 3D via tapping the route
          line or the max-zoom prompt, with no discoverable button for casual browsing.
          Also switches to satellite/hybrid imagery so this always lands on the real
          photorealistic 3D tiles (Map3DView) instead of just tilting a flat road map. */}
      {satelliteToggleVisible && (
        <button
          className={`fab fab-septenary${street3DMode ? " fab-toggle-active" : ""}`}
          onClick={() => {
            if (street3DMode) {
              exitStreet3D();
            } else {
              setMapTypeId("hybrid");
              enterStreet3D();
            }
          }}
          aria-label={street3DMode ? "Switch to standard map" : "Switch to 3D buildings view"}
          title={street3DMode ? "Standard map" : "3D buildings"}
        >
          🏙️
        </button>
      )}

      {/* REV Check: real stolen/written-off/money-owing PPSR lookup, $14.99 AUD via Stripe --
          matches mobile's IAP-gated REV Check feature. Own FAB slot so it never overlaps the
          other persistent buttons above it. */}
      {satelliteToggleVisible && featureOn(remoteConfig, "vehicleCheck", user?.uid ?? null) && (
        <button
          className="fab fab-octonary"
          onClick={() => setRevCheckOpen(true)}
          aria-label="Run a vehicle REV check"
          title="Vehicle REV check"
        >
          🚗
        </button>
      )}

      {street3DMode && (
        <>
          <button className="street3d-exit" onClick={exitStreet3D} aria-label="Exit 3D view">
            ✕ Exit 3D
          </button>
          {/* Touch devices get native two-finger rotate/tilt (Google Maps' own gesture
              handling, unopposed here since nothing's programmatically driving the camera
              every frame outside follow mode) instead of the on-screen joystick -- matching
              mobile, which has never had one, always relying on native map gestures.
              Desktop/mouse users keep the joystick since there's no touch gesture to give
              them. */}
          {!IS_TOUCH_DEVICE && <Street3DJoystick onRotate={rotateStreet3D} onTilt={tiltStreet3D} />}
        </>
      )}

      {navigating && navViewMode === "follow" && !IS_TOUCH_DEVICE && (
        <Street3DJoystick onRotate={rotateFollow} onTilt={tiltFollow} />
      )}

      {navigating && (
        <button
          className={`nav-alerts-toggle${hideAlertsWhileNavigating ? " nav-alerts-toggle-active" : ""}`}
          onClick={() => setHideAlertsWhileNavigating((v) => !v)}
          aria-label={hideAlertsWhileNavigating ? "Show alert pins" : "Hide alert pins"}
          title={hideAlertsWhileNavigating ? "Alert pins hidden — tap to show" : "Hide alert pins"}
        >
          {hideAlertsWhileNavigating ? "🚫" : "🚩"}
        </button>
      )}

      {settings.showLiveCameras && (
        <LiveCamerasPanel
          location={location}
          onClose={() => {
            setShowLiveCameras(false);
            setSelectedLiveCamera(null);
          }}
          onSelectCamera={setSelectedLiveCamera}
          selectedCameraId={selectedLiveCamera?.id ?? null}
        />
      )}

      {show3DPrompt && (
        <ConfirmPrompt
          message="Do you want to view 3D?"
          onYes={enterStreet3D}
          onNo={declineStreet3D}
          variant="top"
        />
      )}

      {reportOpen && (
        <ReportAlertPanel onPlaceOnMap={startPlacement} onClose={() => setReportOpen(false)} />
      )}

      {detectionOpen && (
        <Suspense fallback={<div className="detection-loading">Loading detection model…</div>}>
          <LiveVehicleDetection onClose={() => setDetectionOpen(false)} navContext={detectionNavContext} />
        </Suspense>
      )}

      <WebGates user={user} onConfig={setRemoteConfig} />

      {accountCenterOpen && (
        <AccountCenter
          user={user}
          onSignInGoogle={handleSignInGoogle}
          onSignInApple={handleSignInApple}
          onSignInPhone={() => {
            setAccountCenterOpen(false);
            setPhoneAuthOpen(true);
          }}
          onSignOut={handleSignOut}
          onClose={() => setAccountCenterOpen(false)}
        />
      )}

      {aboutOpen && (
        <AboutPanel
          theme={settings.theme}
          onSetTheme={setTheme}
          mapTheme={settings.mapTheme}
          onSetMapTheme={setMapTheme}
          user={user}
          onSignInGoogle={handleSignInGoogle}
          onSignInApple={handleSignInApple}
          onSignInPhone={() => {
            setAboutOpen(false);
            setPhoneAuthOpen(true);
          }}
          onSignOut={handleSignOut}
          onOpenAdmin={() => {
            setAboutOpen(false);
            setAdminOpen(true);
          }}
          onOpenAccountCenter={() => {
            setAboutOpen(false);
            setAccountCenterOpen(true);
          }}
          onClose={() => setAboutOpen(false)}
          settingsPanel={
            <AlertCameraSettingsPanel
              settings={settings}
              setAlertsEnabled={setAlertsEnabled}
              onRegionToggle={onRegionToggle}
              onAlertTypeToggle={onAlertTypeToggle}
              onExpiryPresetSelect={onExpiryPresetSelect}
              customExpiryOpen={customExpiryOpen}
              setCustomExpiryOpen={setCustomExpiryOpen}
              customHoursText={customHoursText}
              setCustomHoursText={setCustomHoursText}
              customMinutesText={customMinutesText}
              setCustomMinutesText={setCustomMinutesText}
              onApplyCustomExpiry={onApplyCustomExpiry}
              setShowTrafficLights={setShowTrafficLights}
              setShowSpeedCameras={setShowSpeedCameras}
              setOsmLayerRadiusKm={setOsmLayerRadiusKm}
              trafficLightIconUrl={trafficLightIcon(1).url as string}
              speedCameraIconUrl={speedCameraIcon(1).url as string}
            />
          }
        />
      )}

      {phoneAuthOpen && (
        <PhoneAuthPanel onSignedIn={handlePhoneSignedIn} onCancel={() => setPhoneAuthOpen(false)} />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {revCheckOpen && (
        <RevCheckPanel
          returnSessionId={revCheckReturnSessionId}
          onClose={() => {
            setRevCheckOpen(false);
            setRevCheckReturnSessionId(null);
          }}
        />
      )}

      {placeDetails && (
        <BusinessDetailPanel place={placeDetails} onGetDirections={getDirectionsToPlace} onClose={closeBusinessPanel} />
      )}

      {selectedAlert && (
        <AlertDetailPanel
          alert={selectedAlert}
          currentUid={user?.uid ?? null}
          onDelete={onDeleteAlert}
          onHide={onHideAlert}
          onConfirmStillHere={onConfirmStillHere}
          onClose={() => setSelectedAlert(null)}
        />
      )}

      {selectedOsmMarker && (
        <OsmMarkerPanel
          kind={selectedOsmMarker.kind}
          location={{ lat: selectedOsmMarker.lat, lng: selectedOsmMarker.lng }}
          onClose={() => setSelectedOsmMarker(null)}
        />
      )}
    </div>
  );
}
