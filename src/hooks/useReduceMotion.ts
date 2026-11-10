import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Real OS-level "Reduce Motion" accessibility setting (iOS Settings > Accessibility > Motion,
 *  Android Settings > Accessibility > Remove animations) -- defaults to false until the real
 *  async check resolves, then stays live via the real change-event listener so toggling it in
 *  OS settings while the app is open takes effect immediately, not just on next launch. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
