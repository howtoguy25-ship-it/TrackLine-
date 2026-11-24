// Fix pass 7 §4: where the street callout ("Vanessa St") sits at the next turn. It used to be
// anchored bottom-centre ON the turn point, so the pill covered the route's corner (and the road
// you turn into when it went up the screen). Now it sits beside the turn on the OUTSIDE of it
// (left of a right turn, right of a left turn: the route never goes there), with a small tail
// pointing at the corner. The driving camera is heading-up, so the driver's left/right is the
// screen's left/right, and the turn is ahead of the arrow -- the callout is level with the turn,
// above the arrow, never on it. POI labels are hidden while a callout shows.
// Pure; tested in __tests__/nav/turnCallout.test.ts.

export type CalloutSide = "left" | "right";

/** The side of the turn point the callout goes on. */
export function calloutSide(maneuver: string | null | undefined, drivingSide: "left" | "right" = "left"): CalloutSide {
  const m = maneuver ?? "";
  if (/right/.test(m) && !/roundabout/.test(m)) return "left";
  if (/left/.test(m) && !/roundabout/.test(m)) return "right";
  // Roundabouts, straight on, merges without a side: away from the kerb you drive on, so it sits
  // over the opposite carriageway's verge rather than the lane you're in.
  return drivingSide === "left" ? "right" : "left";
}

/**
 * The marker anchor for a callout view laid out as [pill][tail] (left side) or [tail][pill]
 * (right side): the tail's tip is the view's edge, vertically centred, on the turn point.
 */
export function calloutAnchor(side: CalloutSide): { x: number; y: number } {
  return side === "left" ? { x: 1, y: 0.5 } : { x: 0, y: 0.5 };
}

/** Gap between the tail's tip and the pill (pt): the corner stays visible. */
export const CALLOUT_TAIL = 8;
