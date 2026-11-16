import { useLayoutEffect, useRef } from "react";

/**
 * A ref that always holds the latest value, for callbacks and effects that must read it without
 * re-running when it changes. Updated in a layout effect (not during render), which runs before
 * every ordinary effect of the same commit, so those effects already see the new value.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
