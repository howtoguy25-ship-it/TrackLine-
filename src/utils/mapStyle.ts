/**
 * TrackLine's map color themes -- standard Google Maps JSON styling format, applied via
 * react-native-maps' `customMapStyle` prop. Each theme recolors the whole map consistently
 * (land, water, roads, highways, labels) rather than just tinting the background, and every
 * one keeps a deliberately high contrast between road surface and label text so street names
 * stay legible glancing at it while driving -- the actual point of a map, regardless of theme.
 *
 * Requires the Google Maps provider (MapScreen.tsx renders with provider={PROVIDER_GOOGLE} on
 * every platform) -- Apple's native MapKit has no equivalent JSON styling mechanism at all, so
 * this prop is a silent no-op there. That used to be iOS's actual renderer, which is exactly
 * why the theme picker looked like it did nothing on iOS -- every theme rendered as Apple's own
 * fixed palette regardless of which one was selected.
 *
 * Real road-level styling, not just color: every theme now also sets a `weight` styler (line
 * thickness in pixels -- a genuine, documented property of Google's native style JSON, not
 * something invented here) per road class, so local/arterial/highway/freeway are visually
 * distinct in actual thickness, not color alone: local roads thinnest, arterials a step up,
 * named highways thicker again, and real freeways (road.highway.controlled_access -- a
 * distinct feature type from a plain named "highway" that just happens to be busy) thickest
 * and boldest of all, the same road-class hierarchy Waze/Google Maps' own default styles use.
 * Weights bumped again (1/2/3.5/4.5 -> 2/3.5/5.5/7) per explicit request for a bolder, more
 * custom look overall -- same relative hierarchy, just chunkier across the board.
 */
export type MapThemeKey = "normal" | "purpleBlue" | "blueGrey" | "greenYellow";

export const MAP_THEME_LABELS: Record<MapThemeKey, string> = {
  normal: "Normal",
  purpleBlue: "Purple & Blue",
  blueGrey: "Blue & Grey",
  greenYellow: "Green & Yellow",
};

// TrackLine's original brand look -- black background, green highways/text. Lightened from the
// original pure-black (#000000) background and dimmer greens -- real feedback: streets and
// street names were hard to make out against how dark it was. Land is now a lighter charcoal
// and every green (labels, arterial/local road fill, park) is a noticeably brighter shade, so
// the road network and place names stand out clearly instead of blending into the background.
const NORMAL_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#14201a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a120d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a3d6ac" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#dcf2e0" }] },
  { featureType: "poi", stylers: [{ visibility: "simplified" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#7fa886" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1c3324" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#79a681" }] },
  // Real 3-tier road hierarchy via weight (line thickness), not just color -- Google's native
  // style JSON supports a `weight` styler (pixels) on road geometry, which genuinely changes
  // how thick each road class renders, on top of the color contrast already here. Local roads
  // stay thin/dim, arterials step up, highways step up again, and real freeways (controlled-
  // access, a distinct feature type from a plain "highway") get the thickest, boldest line --
  // matching how Waze/Google Maps' own default styles visually separate a freeway from a busy
  // arterial that just happens to be tagged "highway".
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#28352c", weight: 2 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#28352c", weight: 2 }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a120d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9dc4a4" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#324a39", weight: 3.5 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#34d976", weight: 5.5 }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0a120d" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#eafff1" }] },
  { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: "#0a120d" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#34d976", weight: 7 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: "#0a120d" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a2318" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5c9c74" }] },
];

// Deep indigo/purple land, violet-blue water, bright lavender highways -- streets get a
// visibly lighter purple than the land so they read clearly against it, matching the
// dark-background-plus-bright-road-accent pattern the "Normal" theme already established.
const PURPLE_BLUE_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1a1033" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1033" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#c7bdf0" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#e4defa" }] },
  { featureType: "poi", stylers: [{ visibility: "simplified" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#9c8fd6" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#201545" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#a89ae0" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#2d2159", weight: 2 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d2159", weight: 2 }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#140b29" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#b3a6e8" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#392c68", weight: 3.5 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#8b7cf6", weight: 5.5 }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#140b29" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f2eeff" }] },
  { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: "#140b29" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#8b7cf6", weight: 7 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: "#140b29" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#16224a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#7d93d6" }] },
];

// Cool slate-grey land, deep blue water, bright sky-blue highways -- a neutral, low-glare
// scheme (closest to a "night driving" feel) with the same bright-accent-on-dark-street
// pattern for road hierarchy to stay obvious at a glance.
const BLUE_GREY_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#232a35" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#232a35" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#b9c4d4" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#dde4ee" }] },
  { featureType: "poi", stylers: [{ visibility: "simplified" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#8b98aa" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1c2833" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#7f95a6" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#3a4451", weight: 2 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#3a4451", weight: 2 }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#171d24" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9fadc0" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#48566a", weight: 3.5 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#5b9bf0", weight: 5.5 }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#171d24" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#eaf3ff" }] },
  { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: "#171d24" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#5b9bf0", weight: 7 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: "#171d24" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#16273f" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6f93bf" }] },
];

// Deep forest-green land, teal water, bright gold/yellow highways -- the highest-contrast pair
// of the four (yellow-on-dark-green), reserved for the highway/arterial accent only so it
// reads as "the important road" rather than the whole map competing for attention.
const GREEN_YELLOW_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f2417" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f2417" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#c8e6b0" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#eef7de" }] },
  { featureType: "poi", stylers: [{ visibility: "simplified" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#8fb877" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#173420" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#86b16d" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#243c26", weight: 2 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#243c26", weight: 2 }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a1810" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#a8cf8f" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#33512f", weight: 3.5 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#facc15", weight: 5.5 }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0a1810" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#fffbe6" }] },
  { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: "#0a1810" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#facc15", weight: 7 }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.stroke", stylers: [{ color: "#0a1810" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a2e2a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4fa090" }] },
];

export const MAP_THEME_STYLES: Record<MapThemeKey, typeof NORMAL_STYLE> = {
  normal: NORMAL_STYLE,
  purpleBlue: PURPLE_BLUE_STYLE,
  blueGrey: BLUE_GREY_STYLE,
  greenYellow: GREEN_YELLOW_STYLE,
};
