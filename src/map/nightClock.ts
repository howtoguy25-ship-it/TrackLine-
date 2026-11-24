// "Only at night" for the map's dark mode: night by the real sun where the driver is (the last
// GPS position the map saw), or -- before any fix -- by the phone's clock (7 pm to 6 am).
import { isNightTime } from "@/utils/sunTimes";

let last: { latitude: number; longitude: number } | null = null;

export function noteNightPosition(latitude: number, longitude: number): void {
  last = { latitude, longitude };
}

export function isNightNow(now: Date = new Date(), at: { latitude: number; longitude: number } | null = last): boolean {
  if (at) return isNightTime(now, at.latitude, at.longitude);
  const h = now.getHours();
  return h >= 19 || h < 6;
}
