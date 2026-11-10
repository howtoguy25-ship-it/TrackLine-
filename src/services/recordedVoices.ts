import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Directory, Paths } from "expo-file-system";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/services/firebase";

// Real, explicit request (Waze-style redesign, Phase 3 "Record your own voice"). Every real
// clip the brief lists, grouped into its own 5 real sections -- nothing invented beyond this.
// "Start of drive" also lets the user add custom phrases (see addCustomStartPhrase below).
export interface VoiceClipDef {
  key: string;
  label: string;
}

export interface VoiceClipSection {
  title: string;
  clips: VoiceClipDef[];
}

const ORDINAL_EXITS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

export const VOICE_CLIP_SECTIONS: VoiceClipSection[] = [
  {
    title: "Start of drive",
    clips: [
      { key: "start_all_set", label: "All set. Let's go" },
      { key: "start_were_all_set", label: "We're all set, let's go!" },
    ],
  },
  {
    title: "Distances",
    clips: [
      { key: "dist_200m", label: "In 200 metres" },
      { key: "dist_400m", label: "In 400 metres" },
      { key: "dist_800m", label: "In 800 metres" },
      { key: "dist_1km", label: "In 1 kilometre" },
      { key: "dist_1_5km", label: "In 1.5 kilometres" },
    ],
  },
  {
    title: "Instructions",
    clips: [
      { key: "instr_keep_left", label: "Keep left" },
      { key: "instr_keep_right", label: "Keep right" },
      { key: "instr_turn_left", label: "Turn left" },
      { key: "instr_turn_right", label: "Turn right" },
      { key: "instr_exit_left", label: "Exit left" },
      { key: "instr_exit_right", label: "Exit right" },
      { key: "instr_straight", label: "Go straight on" },
      { key: "instr_uturn", label: "Make a U-turn" },
      { key: "instr_roundabout", label: "At the roundabout" },
      ...ORDINAL_EXITS.map((ordinal, i) => ({
        key: `instr_exit_${i + 1}`,
        label: `Take the ${ordinal} exit`,
      })),
    ],
  },
  {
    title: "Reports",
    clips: [
      { key: "report_police", label: "Police reported" },
      { key: "report_crash", label: "Crash reported" },
      { key: "report_hazard", label: "Hazard reported" },
      { key: "report_heavy_traffic", label: "Heavy traffic reported" },
      { key: "report_red_light_camera", label: "Red light camera reported" },
      { key: "report_speed_camera", label: "Speed camera reported" },
    ],
  },
  {
    title: "Other",
    clips: [
      { key: "other_and_then", label: "And then" },
      { key: "other_rerouting", label: "Re-routing" },
      { key: "other_arrived", label: "You've arrived" },
    ],
  },
];

export function totalClipCount(): number {
  return VOICE_CLIP_SECTIONS.reduce((sum, s) => sum + s.clips.length, 0);
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
