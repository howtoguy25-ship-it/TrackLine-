/**
 * Selectable vehicle icons for the driver's own live-position marker (see LocationMarkers.tsx's
 * CarNavArrow) -- per explicit request to let a driver pick how THEY appear on the map, same
 * theming pattern as alertIconThemes.ts. "default" keeps CarNavArrow's original hand-drawn SVG
 * arrow badge exactly as it was; every other option swaps in a real MaterialCommunityIcons
 * vehicle glyph (verified against the installed glyphmap) inside the same rotating badge shape,
 * so picking one is a real, live-rotating marker change, not just a static preview swap.
 */
export type MapMarkerStyleKey =
  | "default"
  | "car"
  | "taxi"
  | "policeCar"
  | "ambulance"
  | "fireTruck"
  | "bus"
  | "truck"
  | "motorbike"
  | "sportsCar"
  | "helicopter"
  | "tank";

export const MAP_MARKER_STYLE_LABELS: Record<MapMarkerStyleKey, string> = {
  default: "Default",
  car: "Car",
  taxi: "Taxi",
  policeCar: "Police Car",
  ambulance: "Ambulance",
  fireTruck: "Fire Truck",
  bus: "Bus",
  truck: "Truck",
  motorbike: "Motorbike",
  sportsCar: "Sports Car",
  helicopter: "Helicopter",
  tank: "Tank",
};

export interface MapMarkerIconSpec {
  name: string; // MaterialCommunityIcons glyph name
  color: string;
}

// "default" intentionally omitted -- CarNavArrow keeps its own original SVG path for that one.
export const MAP_MARKER_STYLE_ICONS: Record<Exclude<MapMarkerStyleKey, "default">, MapMarkerIconSpec> = {
  car: { name: "car", color: "#1D4ED8" },
  taxi: { name: "taxi", color: "#F59E0B" },
  policeCar: { name: "car-emergency", color: "#1D4ED8" },
  ambulance: { name: "ambulance", color: "#DC2626" },
  fireTruck: { name: "fire-truck", color: "#EA580C" },
  bus: { name: "bus", color: "#16A34A" },
  truck: { name: "truck", color: "#6B7280" },
  motorbike: { name: "motorbike", color: "#111827" },
  sportsCar: { name: "car-sports", color: "#DB2777" },
  helicopter: { name: "helicopter", color: "#0891B2" },
  tank: { name: "tank", color: "#4D7C0F" },
};
