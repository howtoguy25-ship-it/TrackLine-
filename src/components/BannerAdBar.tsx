import { View, StyleSheet, Dimensions } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { env } from "@/config/env";
import { Sentry } from "@/services/sentry";

// The underlying native BannerAd view reports width/height 0 until the ad actually finishes
// loading (see react-native-google-mobile-ads' BaseAd -- `dimensions` starts at [0, 0] and
// only updates on the real onAdLoaded/onSizeChange native event). Since this bar sits in its
// own flex row *above* the map's flex:1 area (not floating over it -- see below), that 0->real
// height jump used to shrink/grow the whole map area, and every absolutely-positioned FAB
// inside it (whose `bottom` is relative to that area's own edge) would suddenly jump by the
// same amount a second or two after launch, the instant the ad SDK finished its network round
// trip. Reserving the real expected height up front -- Google's own published adaptive-banner
// formula (height = 50-90dp scaled off device width, same math the SDK itself uses to compute
// this exact banner size) -- means the row already has its final height on the very first
// frame, so there's nothing left to jump when the ad content actually arrives.
const ADAPTIVE_BANNER_HEIGHT = Math.max(50, Math.min(90, Math.round(Dimensions.get("window").width / 6.4)));

// A persistent strip reserved at the very bottom of the screen, outside the map's own
// layout -- see MapScreen.tsx, which only renders this when NOT navigating, and gives it its
// own flex row below the map rather than floating it over the map/controls. That keeps it
// physically incapable of ever overlapping the route, turn instructions, or FAB buttons,
// including while actively driving.
export function BannerAdBar() {
  return (
    <View style={styles.container}>
      <BannerAd
        unitId={env.ads.bannerUnitId}
        size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => Sentry.logger.info("ads: banner loaded")}
        onAdFailedToLoad={(error) => {
          Sentry.logger.error("ads: banner failed to load", { error: String(error) });
          console.warn("[ads] banner failed to load", error);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: ADAPTIVE_BANNER_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});
