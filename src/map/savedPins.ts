// Home, Work, saved places and the parking spot as map pins (each opens SavedPlacePopup).
import type { SavedPlaces } from "@/services/savedPlaces";
import type { ParkingSpot } from "@/services/parkingSpot";
import type { SavedPinPlace } from "@/components/SavedPlacePopup";

export function savedPinPlaces(saved: SavedPlaces, parking: ParkingSpot | null): SavedPinPlace[] {
  const out: SavedPinPlace[] = [];
  if (saved.home) out.push({ kind: "home", placeId: saved.home.placeId, title: "Home", address: saved.home.address, location: saved.home.location });
  if (saved.work) out.push({ kind: "work", placeId: saved.work.placeId, title: "Work", address: saved.work.address, location: saved.work.location });
  for (const p of saved.custom) out.push({ kind: "custom", placeId: p.placeId, title: p.label || p.name, address: p.address, location: p.location });
  if (parking) out.push({ kind: "parking", placeId: "parking", title: "Your parking spot", address: parking.label, location: { latitude: parking.latitude, longitude: parking.longitude } });
  return out;
}

export const savedPinIcon = (p: SavedPinPlace) => (p.kind === "parking" ? "parking" : `saved:${p.kind}`);
