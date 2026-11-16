// The report rules the server enforces (firebase/functions/reports/policy.json), read by the app
// so the "Still there?" prompt and the undo bar use exactly the same numbers.
import POLICY from "../../firebase/functions/reports/policy.json";
import type { AlertType } from "@/types/alert";

export const REPORT_POLICY = POLICY;

const MIN = 60_000;

export interface StillThereWindow {
  /** Ask once a report is at least this old (and this long since anyone last confirmed it). */
  askAfterMs: number;
  /** "Still here" keeps it this much longer. */
  extendMs: number;
}

export function stillThereWindow(type: AlertType): StillThereWindow {
  const t = POLICY.types[type];
  return { askAfterMs: t.askAfterMinutes * MIN, extendMs: t.extendMinutes * MIN };
}

export const UNDO_MS = POLICY.undoSeconds * 1000;
