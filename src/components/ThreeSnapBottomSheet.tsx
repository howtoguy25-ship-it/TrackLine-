import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from "react-native-reanimated";
import { colors, radius, shadow } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign Phase 2) -- the persistent "Where to?" sheet has
// three real snap points (peek/half/full), none of which is "closed": unlike SimpleBottomSheet's
// on-demand info panels (Restaurants/Hotels/Fuel/Parking, which start fully off-screen and can be
// dismissed), this sheet IS the home screen's permanent idle entry point -- Waze's own "Where
// to?" bar never disappears, it only collapses down to its shortest (peek) height. Built as its
// own sibling component rather than adding a third state to SimpleBottomSheet, same reasoning
// that component's own header gives for staying narrow/single-purpose rather than growing a
// generic do-everything sheet: a different real contract (no closed state at all) deserves its
// own component, not an overloaded one.

export interface ThreeSnapBottomSheetRef {
  collapse: () => void;
  expandHalf: () => void;
  expandFull: () => void;
}

interface Props {
  // Fractions (0-1) of the available height (screen height minus topInset) each snap point
  // uses -- [peek, half, full].
  snapFractions: [number, number, number];
  topInset: number;
  onChange?: (index: 0 | 1 | 2) => void;
  children: React.ReactNode;
}

const HANDLE_HEIGHT = 22;
const SPRING_CONFIG = { damping: 32, stiffness: 300, mass: 0.9 };
const VELOCITY_FLING_THRESHOLD = 800;

export const ThreeSnapBottomSheet = forwardRef<ThreeSnapBottomSheetRef, Props>(function ThreeSnapBottomSheet(
  { snapFractions, topInset, onChange, children },
  ref
) {
  const { height: screenHeight } = useWindowDimensions();
  const maxSheetHeight = Math.max(0, screenHeight - topInset);
  const [peekHeight, halfHeight, fullHeight] = useMemo(
    () => snapFractions.map((f) => f * maxSheetHeight) as [number, number, number],
    [snapFractions, maxSheetHeight]
  );
  // Same translateY convention as SimpleBottomSheet -- measured downward from the fully-
  // expanded ("full") position. 0 = full, larger = shorter. There is no off-screen/closed
  // offset at all here -- peekOffset (the largest valid value) is this sheet's floor.
  const peekOffset = fullHeight - peekHeight;
  const halfOffset = fullHeight - halfHeight;
  const translateY = useSharedValue(peekOffset);
  const dragStartY = useSharedValue(0);

  const currentIndexRef = useRef<0 | 1 | 2>(0);

  const notifyIndex = useCallback(
    (index: 0 | 1 | 2) => {
      if (currentIndexRef.current === index) return;
      currentIndexRef.current = index;
      onChange?.(index);
    },
    [onChange]
  );

  const animateToOffset = useCallback(
    (offset: number, index: 0 | 1 | 2) => {
      translateY.value = withSpring(offset, SPRING_CONFIG);
      notifyIndex(index);
    },
    [notifyIndex, translateY]
  );

  useImperativeHandle(
    ref,
    () => ({
      collapse: () => animateToOffset(peekOffset, 0),
      expandHalf: () => animateToOffset(halfOffset, 1),
      expandFull: () => animateToOffset(0, 2),
    }),
    [animateToOffset, peekOffset, halfOffset]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          "worklet";
          dragStartY.value = translateY.value;
        })
        .onUpdate((e) => {
          "worklet";
          const next = dragStartY.value + e.translationY;
          // Clamped between 0 (full) and peekOffset (the shortest real state) -- never drags
          // further down/off-screen, matching "no closed state" above.
          translateY.value = Math.max(0, Math.min(next, peekOffset));
        })
        .onEnd((e) => {
          "worklet";
          const current = translateY.value;
          let targetOffset: number;
          let targetIndex: 0 | 1 | 2;
          if (e.velocityY > VELOCITY_FLING_THRESHOLD) {
            // Fast downward flick -- one step down (full -> half -> peek), never past peek.
            if (current < halfOffset - 1) {
              targetOffset = halfOffset;
              targetIndex = 1;
            } else {
              targetOffset = peekOffset;
              targetIndex = 0;
            }
          } else if (e.velocityY < -VELOCITY_FLING_THRESHOLD) {
            // Fast upward flick -- one step up (peek -> half -> full).
            if (current > halfOffset + 1) {
              targetOffset = halfOffset;
              targetIndex = 1;
            } else {
              targetOffset = 0;
              targetIndex = 2;
            }
          } else {
            const distToFull = Math.abs(0 - current);
            const distToHalf = Math.abs(halfOffset - current);
            const distToPeek = Math.abs(peekOffset - current);
            if (distToFull <= distToHalf && distToFull <= distToPeek) {
              targetOffset = 0;
              targetIndex = 2;
            } else if (distToHalf <= distToPeek) {
              targetOffset = halfOffset;
              targetIndex = 1;
            } else {
              targetOffset = peekOffset;
              targetIndex = 0;
            }
          }
          translateY.value = withSpring(targetOffset, SPRING_CONFIG);
          runOnJS(notifyIndex)(targetIndex);
        }),
    [peekOffset, halfOffset, translateY, dragStartY, notifyIndex]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Same real "FlatList viewport must match the sheet's actual visible height" fix as
  // SimpleBottomSheet's own contentAnimatedStyle -- see that component's header for the full
  // account of the bug this prevents.
  const contentAnimatedStyle = useAnimatedStyle(() => ({
    height: Math.max(0, fullHeight - translateY.value - HANDLE_HEIGHT),
  }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.sheet, { height: fullHeight }, animatedStyle]}>
      <GestureDetector gesture={panGesture}>
        <View style={styles.handleWrap}>
          <View style={styles.handle} />
        </View>
      </GestureDetector>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>{children}</Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.high,
  },
  handleWrap: {
    height: HANDLE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  content: {
    overflow: "hidden",
  },
});
