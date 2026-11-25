import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import { DEFAULT_CUSTOMIZATION, type TrackyCustomization } from "@/components/trackys/customization";

// Real, explicit request (ADD-ON Part A -- "Make your Tracky" customiser, "Firestore storage as
// compact JSON"). Same real local+Firestore two-tier pattern trackyMood.ts/settings.ts already
// use -- a design works offline/signed-out (AsyncStorage), and syncs to Firestore's
// `users/{uid}.trackyCustomization` field (merge:true, never clobbering any other field on that
// doc) the instant a real, non-anonymous account is signed in.
//
// `appearanceMode` is the real switch between "show my auto/selected MOOD" (moods.ts, the
// existing default, unchanged) and "show my own custom design" -- a driver can have a saved
// customization ready without it actually being the active look, same "Back to auto" relationship
// useTrackyMood's own `selected` field already has.
export interface TrackyAppearanceState {
  mode: "mood" | "custom";
  customization: TrackyCustomization;
}

const DEFAULT_APPEARANCE_STATE: TrackyAppearanceState = { mode: "mood", customization: DEFAULT_CUSTOMIZATION };
const APPEARANCE_STATE_KEY = "@trackline/trackyCustomization";

export async function getLocalAppearanceState(): Promise<TrackyAppearanceState> {
  const raw = await AsyncStorage.getItem(APPEARANCE_STATE_KEY);
  if (!raw) return DEFAULT_APPEARANCE_STATE;
  try {
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode === "custom" ? "custom" : "mood",
      customization: { ...DEFAULT_CUSTOMIZATION, ...parsed.customization },
    };
  } catch {
    return DEFAULT_APPEARANCE_STATE;
  }
}

// Same reason as trackyMood.ts's own subscribeMoodState -- the customiser saves from its own
// hook instance while the menu header/profile screen behind it are still mounted with theirs.
const appearanceListeners = new Set<(state: TrackyAppearanceState) => void>();

export function subscribeAppearanceState(listener: (state: TrackyAppearanceState) => void): () => void {
  appearanceListeners.add(listener);
  return () => {
    appearanceListeners.delete(listener);
  };
}

export async function setLocalAppearanceState(state: TrackyAppearanceState): Promise<void> {
  appearanceListeners.forEach((listener) => listener(state));
  await AsyncStorage.setItem(APPEARANCE_STATE_KEY, JSON.stringify(state));
}

export async function pushAppearanceToProfile(uid: string, state: TrackyAppearanceState): Promise<void> {
  await setDoc(doc(db, "users", uid), { trackyCustomization: state }, { merge: true });
}

export async function pullAppearanceFromProfile(uid: string): Promise<TrackyAppearanceState | null> {
  const snap = await getDoc(doc(db, "users", uid));
  const remote = snap.exists() ? (snap.data().trackyCustomization as Partial<TrackyAppearanceState> | undefined) : undefined;
  if (!remote) return null;
  // Merged over the defaults the same way the local read is -- a doc saved by an older build
  // (missing a field added since) must never render a Tracky with an undefined colour/eye style.
  return {
    mode: remote.mode === "custom" ? "custom" : "mood",
    customization: { ...DEFAULT_CUSTOMIZATION, ...remote.customization },
  };
}
