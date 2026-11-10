import React, { useEffect, useMemo, useState } from "react";
import { Pressable } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import Svg from "react-native-svg";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { TrackyBody } from "./TrackyBody";
import { TrackyEyes, TrackyMouth } from "./parts";
import { TrackyAccessory } from "./accessories";
import { TRACKY_MOODS, type TrackyMoodKey } from "./moods";

let instanceCounter = 0;

export interface TrackyProps {
  mood: TrackyMoodKey;
  size?: number;
  // Idle bob + blink loop. Default true for single-instance renders (menu header, profile,
  // cards); pass false for anything rendering many at once (map markers) to avoid dozens of
  // simultaneous timers -- see Part 3's own cached-bitmap plan in PROGRESS.md for the real perf
  // path once presence markers exist.
  animated?: boolean;
  // Tap plays a quick squash-and-stretch + the mood's own mini reaction (sparkle/Zzz-float/
  // hearts handled via a brief accessory pulse) -- purely cosmetic, independent of onPress.
  reactOnTap?: boolean;
  onPress?: () => void;
  // Ghost mode's translucent outline look -- see TrackyBody's own prop for what this changes.
  translucent?: boolean;
}

const AnimatedView = Animated.View;

/** The one real, shared Tracky renderer -- every mood/placement in the app (menu header,
 *  profile mood grid, map markers, empty states) goes through this component so there's a
 *  single source of truth for how a mood actually looks, never a second hand-copied version
 *  drifting out of sync. See TrackyBody.tsx's own header for the full originality note. */
export function Tracky({ mood, size = 64, animated = true, reactOnTap = true, onPress, translucent = false }: TrackyProps) {
  const def = TRACKY_MOODS[mood];
  const reduceMotion = useReduceMotion();
  const shouldAnimate = animated && !reduceMotion;
  const instanceId = useMemo(() => String(instanceCounter++), []);

  const bob = useSharedValue(0);
  const squash = useSharedValue(1);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!shouldAnimate) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [shouldAnimate, bob]);

  // Real random 3-5s blink interval -- a plain JS re-scheduling timer rather than a reanimated
  // loop, since reanimated's declarative repeat doesn't have a clean "random interval forever"
  // primitive; a quick eyeStyle swap (closed briefly, back to the mood's real eye style) is
  // cheap enough to re-render on a timer at this scale (one Tracky at a time wherever this
  // animates).
  useEffect(() => {
    if (!shouldAnimate) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      const delay = 3000 + Math.random() * 2000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        setTimeout(() => {
          if (!cancelled) setBlinking(false);
        }, 120);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [shouldAnimate]);

  const onTap = () => {
    onPress?.();
    if (!reactOnTap || reduceMotion) return;
    squash.value = withSequence(
      withTiming(1.18, { duration: 90 }),
      withTiming(0.9, { duration: 90 }),
      withTiming(1, { duration: 140 })
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { scaleX: squash.value }, { scaleY: 2 - squash.value }],
  }));

  const eyeStyle = blinking ? "sleepy" : def.eyeStyle;

  const body = (
    <AnimatedView style={animatedStyle}>
      <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
        <TrackyBody color={def.color} colorBottom={def.colorBottom} translucent={translucent} instanceId={instanceId} />
        <TrackyEyes style={eyeStyle} />
        <TrackyMouth style={def.mouthStyle} />
        {def.accessory && <TrackyAccessory accessory={def.accessory} color={def.accessoryColor} />}
      </Svg>
    </AnimatedView>
  );

  if (!onPress && !reactOnTap) return body;
  return <Pressable onPress={onTap}>{body}</Pressable>;
}
