// Waze-match §1: what the map draws on top of itself in each state. The route preview is a clean,
// flat map -- the routes, their time bubbles, your start dot and the finish flag only: no POI
// badges, road signs, report dots or other Trackys. The approach view (the close-up of the next
// manoeuvre) keeps only the alerts. Pure; tested in __tests__/wazeMatch/routeSheet.test.tsx.
export type OverlayMode = "home" | "routePreview" | "approach";

export function overlaysFor<P extends { id: string }, T>(mode: OverlayMode, o: { pins: readonly P[]; presences: readonly T[]; badges: boolean }): { pins: P[]; presences: T[]; badges: boolean } {
  if (mode === "routePreview") return { pins: [], presences: [], badges: false };
  if (mode === "approach") return { pins: o.pins.filter((p) => p.id.startsWith("alert")), presences: [], badges: o.badges };
  return { pins: [...o.pins], presences: [...o.presences], badges: o.badges };
}
