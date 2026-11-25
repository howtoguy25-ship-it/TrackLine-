// The navigation camera's zoom by speed: closer at low speed (junctions stay legible), further
// out at motorway speed (more road ahead). Three bands; MapScreen only re-applies the zoom when
// the band changes, never on every GPS fix.
export const SPEED_ZOOM_BANDS: { maxKmh: number; zoom: number }[] = [
  { maxKmh: 40, zoom: 18.5 },
  { maxKmh: 80, zoom: 17.5 },
  { maxKmh: Infinity, zoom: 16.5 },
];

export function speedZoomFor(speedKmh: number | null | undefined): number {
  const kmh = speedKmh != null && Number.isFinite(speedKmh) ? speedKmh : 0;
  return (SPEED_ZOOM_BANDS.find((b) => kmh <= b.maxKmh) ?? SPEED_ZOOM_BANDS[SPEED_ZOOM_BANDS.length - 1]).zoom;
}
