import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { radius, shadow } from "@/theme/tokens";

// Mapbox's junction-view picture of a complex interchange, shown big under the top card until
// the manoeuvre point. Only when Mapbox has one for this manoeuvre (coverage in Australia is
// limited); if the image fails to load the card simply goes away.

export function junctionImageUri(url: string, token: string): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
}

export function JunctionViewCard({ url, token, top }: { url: string; token: string; top: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View pointerEvents="none" style={[styles.card, { top }]} testID="junction-view">
      <Image
        source={{ uri: junctionImageUri(url, token) }}
        style={styles.image}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityLabel="Junction view"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: "#1C1D20",
    ...shadow.card,
  },
  image: { width: "100%", height: "100%" },
});
