// Real, confirmed bug this exists to fix (screenshot + video evidence: a Restaurants-sheet
// scroll that was progressing normally suddenly "recoiled" back to the very top after several
// seconds, with no matching user gesture): RestaurantsSheet/HotelsSheet/FuelStationsSheet are
// ALL mounted simultaneously (see MapScreen.tsx's own place-sheets block), and each one used to
// register its own *global* `Keyboard.addListener("keyboardDidHide", ...)` to re-snap itself
// back down to its compact 50% point once ITS search keyboard closes -- correct in isolation,
// but `keyboardDidHide` fires for ANY keyboard closing anywhere in the app, not just this one
// sheet's own input. With three identical listeners live at once, a keyboard closing for a
// totally unrelated reason (another sheet's search box losing focus, a stray OS predictive-text
// blur/refocus blip) forcibly re-snapped EVERY mounted sheet back to 50% -- including whichever
// one the driver happened to be actively scrolling through at the taller 88% point at that exact
// moment, which reads exactly like a scroll "recoiling" for no reason.
//
// This is a tiny, plain in-memory ownership token (not React state -- nothing here needs to
// trigger a re-render, only to be read synchronously inside a Keyboard event callback) tracking
// which ONE of the three sheets' own search input most recently gained focus. Only that sheet is
// allowed to react to the next keyboardDidHide event; every other sheet's listener now no-ops
// instead of blindly resnapping itself.
let activeKey: string | null = null;

export function setActiveSearchFocus(key: string): void {
  activeKey = key;
}

export function isActiveSearchFocus(key: string): boolean {
  return activeKey === key;
}

export function clearActiveSearchFocusIfOwner(key: string): void {
  if (activeKey === key) activeKey = null;
}
