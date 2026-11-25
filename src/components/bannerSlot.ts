// The banner slot's height rule, with no React Native imports (so the proof scripts and pure
// tests can use it too). BannerAdBar.tsx re-exports these.
//
// 50pt tall, the full width of the phone: an inline adaptive banner capped at 50pt. Permanent fix
// §6 root cause of the "black bars": a fixed 320-wide banner on a 375-430pt phone left 27-55pt
// strips either side of the ad, which read as black bars on the dark sheet. Full width, there's no
// strip. (Not "large anchored adaptive": that one grew to 90pt+ on wide phones.)
export const BANNER_HEIGHT = 50;
/** Never let an adaptive ad grow past this (a 90pt banner would eat the map on a phone). */
export const BANNER_MAX_HEIGHT = 60;

/** The slot follows the ad's reported height, between 50 and 60 pt. */
export function bannerSlotHeight(reported: number | null | undefined): number {
  if (!reported || !Number.isFinite(reported) || reported <= 0) return BANNER_HEIGHT;
  return Math.min(BANNER_MAX_HEIGHT, Math.max(BANNER_HEIGHT, Math.ceil(reported)));
}
