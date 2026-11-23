// Gap item 12: the arrival flow.
//   1 km before the destination   real car parks near it (OpenStreetMap amenity=parking, the same
//                                 search as the Parking list), up to 3 within PARKING_NEAR_M of the
//                                 destination, nearest to it first; in the trip sheet with "Go",
//                                 and said once. Not offered when the destination is a car park.
//   after parking at one          the arrival card offers the walk to where you were going
//                                 ("Walk 180 m"), a walking route for the last part.
// Pure; tested in __tests__/gap/arrivalFlow.test.ts.

export const PARKING_PROMPT_M = 1000;
export const PARKING_NEAR_M = 600;
export const MAX_PARKING_OFFERS = 3;
export const MIN_WALK_M = 40;

type LatLng = { latitude: number; longitude: number };

export interface ParkingOffer {
  placeId: string;
  name: string;
  address: string;
  location: LatLng;
  /** From the car park to the destination. */
  toDestinationM: number;
}

export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** A destination that is itself a car park (or the driver's car) doesn't need parking offered. */
export function isParkingPlace(place: { placeId: string; name: string }): boolean {
  return place.placeId === "parking" || /\b(car ?park|parking|park ?(and|&) ?ride)\b/i.test(place.name);
}

export function shouldOfferParking(remainingM: number | null, destination: { placeId: string; name: string } | null, alreadyAsked: boolean): boolean {
  if (alreadyAsked || !destination || remainingM == null) return false;
  if (isParkingPlace(destination)) return false;
  return remainingM <= PARKING_PROMPT_M;
}

export function rankParking(destination: LatLng, places: readonly { placeId: string; name: string; vicinity: string; location: LatLng }[]): ParkingOffer[] {
  return places
    .map((p) => ({ placeId: p.placeId, name: p.name || "Car park", address: p.vicinity, location: p.location, toDestinationM: metresBetween(p.location, destination) }))
    .filter((p) => p.toDestinationM <= PARKING_NEAR_M)
    .sort((a, b) => a.toDestinationM - b.toDestinationM)
    .slice(0, MAX_PARKING_OFFERS);
}

/** After arriving at a car park picked for `goingTo`: the walk left, or null if it's right there. */
export function walkLeft(arrivedAt: LatLng | null, goingTo: { name: string; location: LatLng } | null): { name: string; location: LatLng; metres: number } | null {
  if (!arrivedAt || !goingTo) return null;
  const m = metresBetween(arrivedAt, goingTo.location);
  return m >= MIN_WALK_M ? { name: goingTo.name, location: goingTo.location, metres: Math.round(m) } : null;
}
