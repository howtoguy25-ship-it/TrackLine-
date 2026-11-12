import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
// A standard 320x50 banner: the one size every ad network fills and the least intrusive on a
// map. (This used to be a "large anchored adaptive" banner, which grew to 90pt+ on wide phones.)
export const BANNER_HEIGHT = 50;

/**
 * Whether the ad banner shows: on the plain home map only -- not during navigation, not on route
 * selection, not on the place page (whose own sheet and "View routes" button fill the bottom).
 * The map screen uses this one rule both to draw the banner and to size the map above it.
 */
export function shouldShowBanner(state: { navigating: boolean; choosingRoute: boolean; placePageOpen: boolean }): boolean {
  return !state.navigating && !state.choosingRoute && !state.placePageOpen;
}

export function BannerAdBar() {
  const insets = useSafeAreaInsets();
  return (
    // White, and padded by the bottom safe area, so the banner sits inside it with the sheet's
    // own white running straight down to the screen edge -- no dark strip under the ad, and
    // nothing behind the home indicator but white.
    // Sits directly on the bottom safe-area edge: the only space under the 50pt banner is the
    // safe-area inset itself, filled white like the sheet above it (no dark strip).
    <View testID="ad-bar" style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.slot}>
        <BannerAd
          unitId={env.ads.bannerUnitId}
          size={BannerAdSize.BANNER}
          onAdLoaded={() => Sentry.logger.info("ads: banner loaded")}
          onAdFailedToLoad={(error) => {
            Sentry.logger.error("ads: banner failed to load", { error: String(error) });
            console.warn("[ads] banner failed to load", error);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", backgroundColor: "#FFFFFF", alignItems: "center" },
  // The slot keeps its 50pt whether or not an ad has loaded, so the layout above it (the sheet,
  // the floating buttons, the map padding) never jumps when one arrives.
  slot: { width: 320, height: BANNER_HEIGHT, alignItems: "center", justifyContent: "center" },
});
