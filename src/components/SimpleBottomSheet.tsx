import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from "react-native-reanimated";
import { colors, radius, shadow } from "@/theme/tokens";

// Real, confirmed root cause this exists to replace @gorhom/bottom-sheet for (see
// RestaurantsSheet.tsx's own history of fixes -- enableDynamicSizing, a keyboardDidHide global-
// listener bug, a live-GPS-refetch bug -- each real, each shipped, and the scroll-resets-after-
// a-few-seconds complaint STILL kept coming back after all three): read directly from gorhom's
// own installed source (node_modules/@gorhom/bottom-sheet/src/components/bottomSheetScrollable/
// createBottomSheetScrollableComponent.tsx) -- even with enableContentPanningGesture={false},
// the list's own native scroll gesture is still wired up as
// `Gesture.Native().simultaneousWithExternalGesture(draggableGesture)`, i.e. still formally
// composed with the sheet's OWN pan recognizer, never fully independent of it. That's a real,
// permanent seam for exactly this class of bug regardless of which of the library's own props
// get tuned around it. This component has no such coupling at all: the drag handle below is the
// ONLY thing wired to a pan gesture; the list content a caller renders inside is a completely
// plain, unwrapped FlatList/ScrollView with zero gesture composition of any kind.
//
// Deliberately minimal -- two snap points (a default height and a taller one), pan-down-to-close
// from the handle only, matching exactly what RestaurantsSheet/HotelsSheet/FuelStationsSheet
// actually used from @gorhom/bottom-sheet (snapToIndex(0)/close(), enablePanDownToClose,
// enableOverDrag={false} already meant it never went past the taller snap point either). Not a
// general-purpose replacement for every @gorhom/bottom-sheet usage elsewhere in the app -- those
// haven't shown this bug and stay exactly as they are.

export interface SimpleBottomSheetRef {
  close: () => void;
  snapToIndex: (index: 0 | 1) => void;
}

interface Props {
  // Fraction (0-1) of the available height (screen height minus topInset) each snap point uses.
  // [default, expanded] -- matches the ["50%", "88%"] convention the gorhom version used.
  snapFractions: [number, number];
  topInset: number;
  onChange?: (index: -1 | 0 | 1) => void;
  children: React.ReactNode;
}

const SPRING_CONFIG = { damping: 32, stiffness: 300, mass: 0.9 };
// A fast enough flick in either direction wins over raw position -- matches the "flick to
// dismiss/expand" feel every real bottom sheet has, not just a plain nearest-snap-point rule.
const VELOCITY_FLING_THRESHOLD = 800;

export const SimpleBottomSheet = forwardRef<SimpleBottomSheetRef, Props>(function SimpleBottomSheet(
  { snapFractions, topInset, onChange, children },
  ref
) {
  const { height: screenHeight } = useWindowDimensions();
  const maxSheetHeight = Math.max(0, screenHeight - topInset);
  const [shortHeight, tallHeight] = useMemo(
    () => [snapFractions[0] * maxSheetHeight, snapFractions[1] * maxSheetHeight] as [number, number],
    [snapFractions, maxSheetHeight]
  );
  // translateY is measured DOWNWARD from the sheet's fully-expanded (tallest) position -- 0 means
  // showing its full tallHeight, larger values push it further down/shorter, and closedOffset
  // pushes it entirely off-screen.
  const closedOffset = tallHeight + 40;
  const shortOffset = tallHeight - shortHeight;
  const translateY = useSharedValue(closedOffset);
  const dragStartY = useSharedValue(0);

  const currentIndexRef = useRef<-1 | 0 | 1>(-1);

  // Plain JS-thread callback -- the only thing the UI-thread gesture worklet below is allowed to
  // call directly is runOnJS(this), never onChange itself (a closure over whatever the calling
  // component's current React state setters are, not safely worklet-callable).
  const notifyIndex = useCallback(
    (index: -1 | 0 | 1) => {
      if (currentIndexRef.current === index) return;
      currentIndexRef.current = index;
      onChange?.(index);
    },
    [onChange]
  );

  const animateToOffset = useCallback(
    (offset: number, index: -1 | 0 | 1) => {
      translateY.value = withSpring(offset, SPRING_CONFIG);
      notifyIndex(index);
    },
    [notifyIndex, translateY]
  );

  useImperativeHandle(
    ref,
    () => ({
      close: () => animateToOffset(closedOffset, -1),
      snapToIndex: (index: 0 | 1) => animateToOffset(index === 0 ? shortOffset : 0, index),
    }),
    [animateToOffset, closedOffset, shortOffset]
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
          // Clamped -- never drags past fully expanded (0) or past closed (closedOffset), same
          // real fix enableOverDrag={false} used to provide on the gorhom version.
          const next = dragStartY.value + e.translationY;
          translateY.value = Math.max(0, Math.min(next, closedOffset));
        })
        .onEnd((e) => {
          "worklet";
          const current = translateY.value;
          let targetOffset: number;
          let targetIndex: -1 | 0 | 1;
          if (e.velocityY > VELOCITY_FLING_THRESHOLD) {
            // Fast downward flick -- go one step down (tall -> short -> closed), not
            // necessarily all the way to closed from tall, matching natural bottom-sheet feel.
            if (current < shortOffset - 1) {
              targetOffset = shortOffset;
              targetIndex = 0;
            } else {
              targetOffset = closedOffset;
              targetIndex = -1;
            }
          } else if (e.velocityY < -VELOCITY_FLING_THRESHOLD) {
            targetOffset = 0;
            targetIndex = 1;
          } else {
            // No strong flick -- snap to whichever of the three real positions is nearest.
            const distToTall = Math.abs(0 - current);
            const distToShort = Math.abs(shortOffset - current);
            const distToClosed = Math.abs(closedOffset - current);
            if (distToTall <= distToShort && distToTall <= distToClosed) {
              targetOffset = 0;
              targetIndex = 1;
            } else if (distToShort <= distToClosed) {
              targetOffset = shortOffset;
              targetIndex = 0;
            } else {
              targetOffset = closedOffset;
              targetIndex = -1;
            }
          }
          translateY.value = withSpring(targetOffset, SPRING_CONFIG);
          runOnJS(notifyIndex)(targetIndex);
        }),
    [closedOffset, shortOffset, translateY, dragStartY, notifyIndex]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.sheet, { height: tallHeight }, animatedStyle]}>
      <GestureDetector gesture={panGesture}>
        <View style={styles.handleWrap}>
          <View style={styles.handle} />
        </View>
      </GestureDetector>
      <View style={styles.content}>{children}</View>
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
    height: 22,
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
    flex: 1,
  },
});
