// Web map editor helpers (gap item 16). Pure; tested in tests/mapEditor.test.ts.
export type AreaReport = { id: string; type: string; item: string | null; lat: number; lng: number; comment: string | null; permanent: boolean; awaitingApproval: boolean; confirmCount: number; notThere: number; createdAtMs: number | null };
export type MapEdit = { id: string; kind: string; lat: number; lng: number; speedLimit: number | null; confirmCount: number };

/** Pin colour: needs approval (amber) > fixed (blue) > live report (red). */
export function pinColour(r: Pick<AreaReport, "permanent" | "awaitingApproval">): string {
  if (r.awaitingApproval) return "#D97706";
  if (r.permanent) return "#2563EB";
  return "#DC2626";
}

/** The map's bounds as the server's view box; null when it's wider than the server allows. */
export function viewBox(b: { getSouth(): number; getWest(): number; getNorth(): number; getEast(): number }): { south: number; west: number; north: number; east: number } | null {
  const box = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  if (box.north - box.south > 0.5 || box.east - box.west > 0.5) return null;
  return box;
}
