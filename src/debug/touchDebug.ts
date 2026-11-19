// Development-only touch debugger: when switched on (Settings > Developer > Touch debugger),
// every touch outlines the view that actually received it -- red border plus the component
// name -- so it's visible on the phone what is on top of a button. Every press is also logged
// with that component name and the screen it led to.
//
// The lookup uses the same React DevTools renderer hook React Native's own Element Inspector
// uses; it only exists in development builds, so in a release build this all does nothing.

export interface TouchHit {
  id: number;
  name: string;
  frame: { left: number; top: number; width: number; height: number };
}

type Listener = () => void;

let enabled = false;
let hits: TouchHit[] = [];
let nextId = 1;
let lastTouchedName: string | null = null;
const listeners = new Set<Listener>();

const MAX_HITS = 6;
const HIT_LIFETIME_MS = 4000;

function emit() {
  for (const l of listeners) l();
}

export function subscribeTouchDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isTouchDebugEnabled(): boolean {
  return enabled;
}

export function setTouchDebugEnabled(on: boolean): void {
  enabled = __DEV__ && on;
  if (!enabled) hits = [];
  emit();
}

export function getTouchHits(): TouchHit[] {
  return hits;
}

// Host component names say nothing about which part of the app this is.
const HOST_NAMES = new Set(["View", "RCTView", "Text", "RCTText", "RCTVirtualText", "AnimatedComponent", "Animated(View)"]);

/** The most specific named component in an inspector hierarchy (root first, leaf last). */
export function componentNameFromHierarchy(hierarchy: readonly { name?: string | null }[]): string {
  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const name = hierarchy[i]?.name;
    if (name && !HOST_NAMES.has(name)) return name;
  }
  return hierarchy[hierarchy.length - 1]?.name ?? "unknown";
}

interface InspectorData {
  hierarchy: { name?: string | null }[];
  frame: { left: number; top: number; width: number; height: number };
}

/** Called with every touch start (see TouchDebugRoot). Works out what was hit and outlines it. */
export function inspectTouch(rootView: unknown, x: number, y: number): void {
  if (!__DEV__ || !enabled) return;
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<unknown, unknown> } })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const renderers = hook?.renderers ? Array.from(hook.renderers.values()) : [];
  for (const renderer of renderers as { rendererConfig?: { getInspectorDataForViewAtPoint?: Function } }[]) {
    const lookup = renderer?.rendererConfig?.getInspectorDataForViewAtPoint;
    if (typeof lookup !== "function") continue;
    lookup(rootView, x, y, (data: InspectorData) => {
      if (!data || data.hierarchy.length === 0) return false;
      recordHit(componentNameFromHierarchy(data.hierarchy), data.frame);
      return true;
    });
  }
}

export function recordHit(name: string, frame: TouchHit["frame"]): void {
  if (!enabled) return;
  lastTouchedName = name;
  const hit = { id: nextId++, name, frame };
  hits = [...hits.slice(-(MAX_HITS - 1)), hit];
  console.log(`[touch] ${name} at (${Math.round(frame.left)}, ${Math.round(frame.top)}) ${Math.round(frame.width)}x${Math.round(frame.height)}`);
  emit();
  setTimeout(() => {
    hits = hits.filter((h) => h.id !== hit.id);
    emit();
  }, HIT_LIFETIME_MS);
}

/** Logs where a press led. Called by the navigator on every screen change. */
export function logNavigation(screen: string): void {
  if (!__DEV__) return;
  console.log(`[press] ${lastTouchedName ?? "(no touch recorded)"} -> ${screen}`);
  lastTouchedName = null;
}
