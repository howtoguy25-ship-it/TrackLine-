// Every account id this phone has driven as (a guest's anonymous id, then the real account after
// signing in, or after switching accounts). Root cause of "my own Tracky sits on my arrow": the map
// only hid the CURRENT uid, but signing in changes the uid while the server still holds the old
// guest presence at the same spot for a few minutes, so the old one was drawn on top of the
// driver. All of them are hidden now. Kept on the phone only; tested in
// __tests__/presence/ownUids.test.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@trackline/ownUids";
const MAX = 20;

/** Adds `uid` to the list (most recent last) and returns the whole list. */
export function addOwnUid(list: readonly string[], uid: string | null | undefined): string[] {
  if (!uid) return list.slice();
  const next = list.filter((u) => u !== uid);
  next.push(uid);
  return next.slice(-MAX);
}

export async function loadOwnUids(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function rememberOwnUid(uid: string | null | undefined): Promise<string[]> {
  const next = addOwnUid(await loadOwnUids(), uid);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saved this time; still used for this session.
  }
  return next;
}
