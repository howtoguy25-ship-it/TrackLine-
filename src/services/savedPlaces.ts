import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import type { PlaceDetails } from "@/services/places";

// Real, explicit request (Waze-style redesign, Phase 2 "Where to?" sheet) -- the [Home] [Work]
// [+ New] chip row. Home/Work are real, singleton, user-set addresses (same real PlaceDetails
// shape search already produces -- never a guessed/placeholder location); "custom" is the real
// list of additional named saved places from "+ New". Persisted the same real two-tier way every
// other real per-user data in this app is (AsyncStorage locally so it works signed-out/offline,
// Firestore sync once a real non-anonymous driver is signed in) -- mirrors settings.ts's own
// pushSettingsToProfile/pullSettingsFromProfile pattern exactly.

export type SavedPlaceSlot = "home" | "work";

export interface SavedPlace extends PlaceDetails {
  // User-given name for a "+ New" entry (defaults to the picked place's own real name if the
  // user didn't type one). Home/Work entries don't need this -- their slot IS the label.
  label?: string;
}

export interface SavedPlaces {
  home: SavedPlace | null;
  work: SavedPlace | null;
  // Real, explicit "+ New" list -- most-recently-added first. Keyed by the real place's own
  // placeId for de-dup (re-saving an existing custom place updates it in place rather than
  // creating a second copy with the same real address).
  custom: SavedPlace[];
}

const SAVED_PLACES_KEY = "@trackline/savedPlaces";
const EMPTY: SavedPlaces = { home: null, work: null, custom: [] };

export async function getSavedPlaces(): Promise<SavedPlaces> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_PLACES_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      home: parsed.home ?? null,
      work: parsed.work ?? null,
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    // A corrupted/unparsable cache entry should never break the search sheet -- behave as if
    // nothing had been saved yet, same real-world-safe fallback searchHistory.ts uses.
    return EMPTY;
  }
}

async function persist(next: SavedPlaces): Promise<SavedPlaces> {
  await AsyncStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(next));
  return next;
}

export async function setHomeOrWork(slot: SavedPlaceSlot, place: PlaceDetails): Promise<SavedPlaces> {
  const current = await getSavedPlaces();
  const next: SavedPlaces = { ...current, [slot]: place };
  return persist(next);
}

export async function removeHomeOrWork(slot: SavedPlaceSlot): Promise<SavedPlaces> {
  const current = await getSavedPlaces();
  const next: SavedPlaces = { ...current, [slot]: null };
  return persist(next);
}

export async function addCustomPlace(place: PlaceDetails, label?: string): Promise<SavedPlaces> {
  const current = await getSavedPlaces();
  const deduped = current.custom.filter((p) => p.placeId !== place.placeId);
  const entry: SavedPlace = label ? { ...place, label } : place;
  const next: SavedPlaces = { ...current, custom: [entry, ...deduped] };
  return persist(next);
}

export async function removeCustomPlace(placeId: string): Promise<SavedPlaces> {
  const current = await getSavedPlaces();
  const next: SavedPlaces = { ...current, custom: current.custom.filter((p) => p.placeId !== placeId) };
  return persist(next);
}

// Same real cross-device sync pattern as settings.ts -- pushed on every real change while signed
// in (non-anonymous), pulled once per real sign-in. Stored as its own `savedPlaces` field on the
// user's profile doc, independent of `settings`.
export async function pushSavedPlacesToProfile(uid: string, places: SavedPlaces): Promise<void> {
  await setDoc(doc(db, "users", uid), { savedPlaces: places, savedPlacesUpdatedAt: Date.now() }, { merge: true });
}

export async function pullSavedPlacesFromProfile(uid: string): Promise<SavedPlaces | null> {
  const snap = await getDoc(doc(db, "users", uid));
  const remote = snap.exists() ? (snap.data().savedPlaces as SavedPlaces | undefined) : undefined;
  return remote ?? null;
}
