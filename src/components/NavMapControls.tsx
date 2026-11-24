import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { Button, FloatingButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CompassNeedle } from "@/components/icons/MapControlIcons";
import { navControlFrames, type Frame, type NavLayoutInput } from "@/nav/navControlsLayout";
import type { InfoBanner } from "@/nav/infoBanner";
import { BLUE, SURFACES, WHITE } from "@/theme/colors";

// The floating controls while driving, each drawn exactly at the frame nav/navControlsLayout.ts
// computes (the same maths the no-overlap layout test checks on 320-430pt phones): compass
// top-left; audio player, sound and voice command top-right (overflowing to the left column on a
// short phone); the street chip and the info banner between the bottom columns; the Re-centre
// pill bottom-left while the map is FREE (fix pass 5 §4). Report is drawn by MapScreen from the
// same constants.

interface Props {
  safeTop: number;
  safeBottom: number;
  topBarHeight: number;
  bottomBarHeight: number;
  showSpeedLimit: boolean;
  bearing: SharedValue<number>;
  northUp: boolean;
  onCompass: () => void;
  showAudioPlayer: boolean;
  onAudioPlayer: () => void;
  soundOff: boolean;
  onSound: () => void;
  /** null when this phone has no speech recognition: the button isn't shown. */
  onVoice: (() => void) | null;
  listening: boolean;
  streetName: string | null;
  banner: InfoBanner | null;
  onBanner: () => void;
  /** The ahead banner under the turn instruction: the top controls move down by this (pt). */
  dropBy?: number;
  /** Fix pass 5 §4: FREE (panned) -- the "Re-centre" pill bottom-left. */
  showRecenter?: boolean;
  onRecenter?: () => void;
  /** Blue ring on the compass: the map isn't facing the way you set it. */
  compassHighlighted?: boolean;
  /** A short message under the instruction bar ("North up" / "Heading up"). */
  toast?: string | null;
}

// The top controls glide to their new place when the ahead banner comes or goes (160 ms, as the banner waits).
const MOVE = LinearTransition.duration(160);

const at = (f: Frame) => ({ position: "absolute" as const, left: f.x, top: f.y, width: f.width, height: f.height });

export function NavMapControls(p: Props) {
  const { width, height } = useWindowDimensions();
  const input: NavLayoutInput = {
    width,
    height,
    safeTop: p.safeTop,
    safeBottom: p.safeBottom,
    bottomBarHeight: p.bottomBarHeight,
    topBarHeight: p.topBarHeight,
    showSpeedLimit: p.showSpeedLimit,
    showRecenter: !!p.showRecenter,
    showCompass: true,
    showAudioPlayer: p.showAudioPlayer,
    showSound: true,
    showVoice: !!p.onVoice,
    showStreetChip: !!p.streetName,
    showInfoBanner: !!p.banner,
    dropBy: p.dropBy ?? 0,
  };
  const f = navControlFrames(input);
  const needle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-p.bearing.value}deg` }] }));
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="nav-map-controls">
      {f.compass ? (
        <Animated.View layout={MOVE} style={at(f.compass)}>
          <FloatingButton
            tone="map"
            size={f.compass.width}
            onPress={p.onCompass}
            accessibilityLabel={
              p.compassHighlighted ? "Compass: map turned. Tap to re-centre." : p.northUp ? "Compass: north up. Tap for heading up." : "Compass: heading up. Tap for north up."
            }
            style={p.compassHighlighted ? [styles.compassRing, { borderRadius: f.compass.width / 2 }] : undefined}
            testID={p.compassHighlighted ? "nav-compass-highlighted" : "nav-compass"}
          >
            <Animated.View style={needle}>
              <CompassNeedle size={30} />
            </Animated.View>
          </FloatingButton>
        </Animated.View>
      ) : null}
      {f.audioPlayer ? (
        <Animated.View layout={MOVE} style={at(f.audioPlayer)}>
          <FloatingButton tone="map" size={f.audioPlayer.width} icon="musical-notes" onPress={p.onAudioPlayer} accessibilityLabel="Audio player" testID="nav-audio" />
        </Animated.View>
      ) : null}
      {f.sound ? (
        <Animated.View layout={MOVE} style={at(f.sound)}>
          <FloatingButton
            tone="map"
            size={f.sound.width}
            icon={p.soundOff ? "volume-mute" : "volume-high"}
            onPress={p.onSound}
            accessibilityLabel={p.soundOff ? "Sound: off" : "Sound"}
            testID="nav-sound"
          />
        </Animated.View>
      ) : null}
      {f.voice && p.onVoice ? (
        <Animated.View layout={MOVE} style={at(f.voice)}>
          <FloatingButton
            tone="map"
            size={f.voice.width}
            icon="mic"
            onPress={p.onVoice}
            accessibilityLabel={p.listening ? "Listening for a command" : "Voice command, for example: stop navigation"}
            testID="nav-voice"
          />
        </Animated.View>
      ) : null}
      {f.streetChip && p.streetName ? (
        <Animated.View pointerEvents="none" style={[at(f.streetChip), styles.chipWrap]} testID="nav-street-chip">
          <View style={styles.chip}>
            <Icon name="navigate" size={11} color={WHITE} />
            <Text style={styles.chipText} numberOfLines={1}>
              {p.streetName}
            </Text>
          </View>
        </Animated.View>
      ) : null}
      {f.recenter && p.showRecenter && p.onRecenter ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={at(f.recenter)}>
          <Pressable onPress={p.onRecenter} style={styles.recenterPill} accessibilityRole="button" accessibilityLabel="Re-centre on my location" testID="nav-recenter">
            <Icon name="navigate" size={18} color={WHITE} />
            <Text style={styles.recenterText}>Re-centre</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      {p.toast ? (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(250)} pointerEvents="none" style={[styles.toastWrap, { top: p.safeTop + p.topBarHeight + 12 + (p.dropBy ?? 0) }]} testID="nav-toast">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{p.toast}</Text>
          </View>
        </Animated.View>
      ) : null}
      {f.infoBanner && p.banner ? (
        <View style={at(f.infoBanner)}>
          <Button
            variant="secondary"
            icon={p.banner.kind === "incident" ? "alert-circle" : "warning"}
            label={p.banner.text}
            onPress={p.onBanner}
            accessibilityLabel={`${p.banner.text}. Show what's on your route`}
            style={styles.banner}
            testID="nav-info-banner"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipWrap: { alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: SURFACES.dark.raised,
    maxWidth: "100%",
  },
  chipText: { color: WHITE, fontSize: 13, fontWeight: "700" },
  banner: { flex: 1, paddingHorizontal: 12 },
  compassRing: { borderWidth: 3, borderColor: BLUE },
  recenterPill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 22, backgroundColor: SURFACES.dark.raised, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  recenterText: { color: WHITE, fontSize: 16, fontWeight: "700" },
  toastWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  toast: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(20,22,26,0.88)" },
  toastText: { color: WHITE, fontSize: 15, fontWeight: "600" },
});
