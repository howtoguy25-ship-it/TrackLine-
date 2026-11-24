// The white pill above the sheet (startup §2): real messages, one at a time, each for 5 s --
// "1,250 Trackys around you", then e.g. "3 reports near you". Pure queue; tested in
// __tests__/startup/trackysPill.test.tsx.
export const PILL_SHOW_MS = 5000;

export type PillKind = "trackys" | "reports";
export interface PillMessage {
  kind: PillKind;
  text: string;
}

export function reportsPillText(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? "1 report near you" : `${n} reports near you`;
}

/** Adds a message unless one of the same kind is already showing or waiting. */
export function enqueue(queue: readonly PillMessage[], m: PillMessage | null): PillMessage[] {
  if (!m || queue.some((q) => q.kind === m.kind)) return [...queue];
  return [...queue, m];
}

/** The message on screen is the head of the queue; done() drops it after its 5 s. */
export function done(queue: readonly PillMessage[]): PillMessage[] {
  return queue.slice(1);
}
