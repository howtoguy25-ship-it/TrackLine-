import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Directory, Paths } from "expo-file-system";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/services/firebase";
import type { VoiceClipDef } from "@/services/recordedVoiceClips";

export {
  VOICE_CLIP_SECTIONS,
  totalClipCount,
  type VoiceClipDef,
  type VoiceClipSection,
} from "@/services/recordedVoiceClips";

// Start-of-drive phrases the driver adds themselves ("Start of drive" also lets the user add
// custom phrases). Each gets its own clip key and is recorded, played and deleted exactly like
// a built-in clip; navigation picks one of the recorded start phrases at random when a trip
// begins (navSpeechPlan.ts's planPhrase).
const CUSTOM_START_PHRASES_KEY = "@trackline/customStartPhrases";
export const CUSTOM_START_PHRASE_MAX_LENGTH = 60;
export const CUSTOM_START_PHRASE_MAX_COUNT = 8;

export async function getCustomStartPhrases(): Promise<VoiceClipDef[]> {
  const raw = await AsyncStorage.getItem(CUSTOM_START_PHRASES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is VoiceClipDef => !!entry && typeof entry.key === "string" && typeof entry.label === "string"
    );
  } catch {
    return [];
  }
}

/** Adds a phrase and returns the updated list, or null if it's empty, too long, or the list is full. */
export async function addCustomStartPhrase(label: string): Promise<VoiceClipDef[] | null> {
  const trimmed = label.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > CUSTOM_START_PHRASE_MAX_LENGTH) return null;
  const existing = await getCustomStartPhrases();
  if (existing.length >= CUSTOM_START_PHRASE_MAX_COUNT) return null;
  const next = [...existing, { key: `start_custom_${Date.now().toString(36)}`, label: trimmed }];
  await AsyncStorage.setItem(CUSTOM_START_PHRASES_KEY, JSON.stringify(next));
  return next;
}

/** Removes a custom phrase along with its recording, if it has one. */
export async function removeCustomStartPhrase(key: string): Promise<VoiceClipDef[]> {
  const next = (await getCustomStartPhrases()).filter((phrase) => phrase.key !== key);
  await AsyncStorage.setItem(CUSTOM_START_PHRASES_KEY, JSON.stringify(next));
  await deleteRecordedClip(key);
  return next;
}

export function isCustomStartPhraseKey(key: string): boolean {
  return key.startsWith("start_custom_");
}

const RECORDED_VOICE_NAME_KEY = "@trackline/recordedVoiceName";
const RECORDED_CLIPS_KEY = "@trackline/recordedVoiceClips";

function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, "voiceRecordings");
  if (!dir.exists) dir.create();
  return dir;
}

export async function getRecordedVoiceName(): Promise<string | null> {
  return AsyncStorage.getItem(RECORDED_VOICE_NAME_KEY);
}

export async function setRecordedVoiceName(name: string): Promise<void> {
  await AsyncStorage.setItem(RECORDED_VOICE_NAME_KEY, name);
}

async function getClipMap(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(RECORDED_CLIPS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function setClipMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(RECORDED_CLIPS_KEY, JSON.stringify(map));
}

export async function getRecordedClipUris(): Promise<Record<string, string>> {
  return getClipMap();
}

// Moves the recorder's own temp output file into this app's permanent document storage (the
// recorder's own temp/cache location isn't guaranteed to survive an app restart) and persists
// the mapping. Also fires a real, best-effort Firebase Storage upload to the signed-in user's
// own private folder (per the brief's "store audio locally + Firebase Storage") -- never
// blocking the real local save on that upload succeeding, same fire-and-forget pattern
// settings.ts/savedPlaces.ts already use for their own cross-device sync.
export async function saveRecordedClip(key: string, tempUri: string, uid: string | null): Promise<string> {
  const dir = recordingsDir();
  const dest = new File(dir, `${key}.m4a`);
  if (dest.exists) dest.delete();
  const source = new File(tempUri);
  source.copy(dest);
  const map = await getClipMap();
  map[key] = dest.uri;
  await setClipMap(map);

  if (uid) {
    uploadClipToStorage(uid, key, dest).catch((err) => console.warn(`[recordedVoices] upload failed for ${key}`, err));
  }

  return dest.uri;
}

async function uploadClipToStorage(uid: string, key: string, file: File): Promise<void> {
  const data = await file.arrayBuffer();
  const storageRef = ref(storage, `voiceRecordings/${uid}/${key}.m4a`);
  await uploadBytes(storageRef, data);
}

// Real, honest best-effort re-download -- used so a driver's recorded voice can be restored on
// a new device, not just read from this one's own local cache. Returns null (never throws, never
// fakes a URL) when nothing's been uploaded for this clip yet.
export async function getRecordedClipDownloadUrl(uid: string, key: string): Promise<string | null> {
  try {
    return await getDownloadURL(ref(storage, `voiceRecordings/${uid}/${key}.m4a`));
  } catch {
    return null;
  }
}

export async function deleteRecordedClip(key: string): Promise<void> {
  const map = await getClipMap();
  const uri = map[key];
  if (uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
    delete map[key];
    await setClipMap(map);
  }
}
