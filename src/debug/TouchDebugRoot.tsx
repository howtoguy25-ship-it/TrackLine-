import React, { useRef, useSyncExternalStore } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { Text } from "@/components/AppText";
import { getTouchHits, inspectTouch, isTouchDebugEnabled, subscribeTouchDebug } from "@/debug/touchDebug";

// Wraps the whole app. Watches every touch start without ever claiming it (the capture handler
// always answers "no"), and draws the outlines from debug/touchDebug.ts on top, untouchable.
export function TouchDebugRoot({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<View>(null);
  const enabled = useSyncExternalStore(subscribeTouchDebug, isTouchDebugEnabled);
  const hits = useSyncExternalStore(subscribeTouchDebug, getTouchHits);

  const onCapture = (e: GestureResponderEvent) => {
    if (enabled) inspectTouch(rootRef.current, e.nativeEvent.pageX, e.nativeEvent.pageY);
    return false;
  };

  return (
    <View ref={rootRef} style={styles.root} onStartShouldSetResponderCapture={__DEV__ ? onCapture : undefined}>
      {children}
      {enabled && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {hits.map((hit) => (
            <View
              key={hit.id}
              style={[styles.box, { left: hit.frame.left, top: hit.frame.top, width: hit.frame.width, height: hit.frame.height }]}
            >
              <Text style={styles.label} numberOfLines={1}>
                {hit.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  box: { position: "absolute", borderWidth: 2, borderColor: "#FF0000" },
  label: { position: "absolute", top: 0, left: 0, backgroundColor: "#FF0000", color: "#FFFFFF", fontSize: 10, paddingHorizontal: 3 },
});
