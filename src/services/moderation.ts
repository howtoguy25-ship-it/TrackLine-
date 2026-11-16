// Admin moderation queue: fixed cameras / road features drivers reported, waiting for 3
// confirmations or an admin's approval (firebase/functions/index.js moderationQueue,
// moderateReport -- both refuse anyone who isn't an admin).
export interface QueueItem {
  id: string;
  type: string;
  item: string;
  lat: number;
  lng: number;
  comment: string | null;
  confirmCount: number;
  denyCount: number;
  createdAtMs: number;
}

async function call<T>(name: string, data: unknown): Promise<T> {
  // Loaded on use (see services/alerts.ts callable()).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { httpsCallable } = require("@firebase/functions") as typeof import("@firebase/functions");
  const { functions } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return (await httpsCallable(functions, name)(data)).data as T;
}

export async function getModerationQueue(): Promise<QueueItem[]> {
  return (await call<{ items: QueueItem[] }>("moderationQueue", {})).items;
}

export async function moderateReport(alertId: string, approve: boolean): Promise<string> {
  return (await call<{ result: string }>("moderateReport", { alertId, approve })).result;
}
