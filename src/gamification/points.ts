// Points, levels, badges and the weekly leaderboard (gap item 15), the app side. The rules are the
// server's own (firebase/functions/reports/scores.json); the server is the only writer of
// scores/{uid} (reports/scores.js), so everything shown here is what it really counted.
// Tested in __tests__/gap/points.test.tsx.
import SCORES from "../../firebase/functions/reports/scores.json";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/services/firebase";
import { withTimeout } from "@/utils/withTimeout";

export const POINTS_TIMEOUT_MS = 10_000;
export const LEADERBOARD_SIZE = 20;

export interface Score {
  points: number;
  weekKey: string;
  weekPoints: number;
  reports: number;
  confirmationsReceived: number;
  votes: number;
  name: string | null;
  level?: string;
}

export const EMPTY_SCORE: Score = { points: 0, weekKey: "", weekPoints: 0, reports: 0, confirmationsReceived: 0, votes: 0, name: null };
export const POINT_RULES = SCORES.points as Record<string, number>;

/** Same week key as the server (reports/scores.js): Monday start, Sydney time. */
export function weekKey(nowMs: number): string {
  const d = new Date(nowMs + 10 * 3600_000);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const thursday = new Date(monday.getTime() + 3 * 86400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * 86400_000)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface LevelProgress {
  name: string;
  next: { name: string; min: number } | null;
  /** 0..1 of the way to the next level (1 at the top level). */
  fraction: number;
  toNext: number;
}

export function levelProgress(points: number): LevelProgress {
  const levels = SCORES.levels;
  let i = 0;
  for (let k = 0; k < levels.length; k++) if (points >= levels[k].min) i = k;
  const next = levels[i + 1] ?? null;
  if (!next) return { name: levels[i].name, next: null, fraction: 1, toNext: 0 };
  const span = next.min - levels[i].min;
  return { name: levels[i].name, next, fraction: Math.max(0, Math.min(1, (points - levels[i].min) / span)), toNext: next.min - points };
}

export interface BadgeState {
  id: string;
  name: string;
  how: string;
  earned: boolean;
  have: number;
  need: number;
}

export function badgesFor(s: Score): BadgeState[] {
  return SCORES.badges.map((b) => {
    const have = Number((s as unknown as Record<string, number>)[b.counter] ?? 0);
    return { id: b.id, name: b.name, how: b.how, earned: have >= b.atLeast, have: Math.min(have, b.atLeast), need: b.atLeast };
  });
}

/** This week's points: only counts if the score was last touched this week. */
export function pointsThisWeek(s: Score, nowMs: number): number {
  return s.weekKey === weekKey(nowMs) ? s.weekPoints : 0;
}

export interface LeaderRow {
  uid: string;
  name: string;
  weekPoints: number;
  level: string;
  you: boolean;
}

/** Drivers who chose to show their name keep it; everyone else is "A TrackLine driver". */
export function leaderRows(docs: { id: string; data: Partial<Score> }[], myUid: string | null): LeaderRow[] {
  return docs.map((d) => ({
    uid: d.id,
    name: d.id === myUid ? "You" : d.data.name?.trim() || "A TrackLine driver",
    weekPoints: d.data.weekPoints ?? 0,
    level: levelProgress(d.data.points ?? 0).name,
    you: d.id === myUid,
  }));
}

export async function fetchMyScore(uid: string): Promise<Score> {
  const snap = await withTimeout(getDoc(doc(db, "scores", uid)), POINTS_TIMEOUT_MS, "Points");
  return snap.exists() ? { ...EMPTY_SCORE, ...(snap.data() as Partial<Score>) } : EMPTY_SCORE;
}

export async function fetchLeaderboard(nowMs: number, myUid: string | null): Promise<LeaderRow[]> {
  const q = query(collection(db, "scores"), where("weekKey", "==", weekKey(nowMs)), orderBy("weekPoints", "desc"), limit(LEADERBOARD_SIZE));
  const snap = await withTimeout(getDocs(q), POINTS_TIMEOUT_MS, "Leaderboard");
  return leaderRows(
    snap.docs.map((d) => ({ id: d.id, data: d.data() as Partial<Score> })).filter((d) => (d.data.weekPoints ?? 0) > 0),
    myUid
  );
}
