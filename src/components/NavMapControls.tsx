import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { Button, FloatingButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CompassNeedle } from "@/components/icons/MapControlIcons";
import { navControlFrames, type Frame, type NavLayoutInput } from "@/nav/navControlsLayout";
import type { InfoBanner } from "@/nav/infoBanner";
import { SURFACES, WHITE } from "@/theme/colors";

// The floating controls while driving, each drawn exactly at the frame nav/navControlsLayout.ts
// computes (the same maths the no-overlap layout test checks on 320-430pt phones): compass
// top-left; audio player, sound and voice command top-right (overflowing to the left column on a
// short phone); the street chip and the info banner between the bottom columns. Report and
// Re-centre are drawn by MapScreen / NavBottomBar from the same constants.

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
}

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
    showRecenter: false,
    showCompass: true,
    showAudioPlayer: p.showAudioPlayer,
    showSound: true,
    showVoice: !!p.onVoice,
    showStreetChip: !!p.streetName,
    showInfoBanner: !!p.banner,
  };
  const f = navControlFrames(input);
  const needle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-p.bearing.value}deg` }] }));
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="nav-map-controls">
      {f.compass ? (
        <View style={at(f.compass)}>
          <FloatingButton
            tone="map"
            size={f.compass.width}
            onPress={p.onCompass}
            accessibilityLabel={p.northUp ? "Compass: north up. Tap for heading up." : "Compass. Tap to face north."}
            testID="nav-compass"
          >
            <Animated.View style={needle}>
              <CompassNeedle size={30} />
            </Animated.View>
          </FloatingButton>
        </View>
      ) : null}
      {f.audioPlayer ? (
        <View style={at(f.audioPlayer)}>
          <FloatingButton tone="map" size={f.audioPlayer.width} icon="musical-notes" onPress={p.onAudioPlayer} accessibilityLabel="Audio player" testID="nav-audio" />
        </View>
      ) : null}
      {f.sound ? (
        <View style={at(f.sound)}>
          <FloatingButton
            tone="map"
            size={f.sound.width}
            icon={p.soundOff ? "volume-mute" : "volume-high"}
            onPress={p.onSound}
            accessibilityLabel={p.soundOff ? "Sound: off" : "Sound"}
            testID="nav-sound"
          />
        </View>
      ) : null}
      {f.voice && p.onVoice ? (
        <View style={at(f.voice)}>
          <FloatingButton
            tone="map"
            size={f.voice.width}
            icon="mic"
            onPress={p.onVoice}
            accessibilityLabel={p.listening ? "Listening for a command" : "Voice command, for example: stop navigation"}
            testID="nav-voice"
          />
        </View>
      ) : null}
      {f.streetChip && p.streetName ? (
        <View pointerEvents="none" style={[at(f.streetChip), styles.chipWrap]} testID="nav-street-chip">
          <View style={styles.chip}>
            <Icon name="navigate" size={11} color={WHITE} />
            <Text style={styles.chipText} numberOfLines={1}>
              {p.streetName}
            </Text>
          </View>
        </View>
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
});
