// Australian suburbs and their postcodes, from official ABS data (scripts/build-au-postcodes.py):
// ASGS Edition 3 (2021) Suburbs and Localities + Postal Areas, (c) Australian Bureau of
// Statistics, CC BY 4.0. A suburb has a postcode only where one postal area covers at least 80%
// of it; a suburb split between postcodes shows its name alone (never a guessed number).
import data from "@/data/auSuburbPostcodes.json";

type Row = [string, number, number, string | null, string];

export interface AuSuburb {
  name: string;
  latitude: number;
  longitude: number;
  postcode: string | null;
  state: string;
}

const rows = (data as unknown as { rows: Row[] }).rows;

export function auSuburbs(): AuSuburb[] {
  return rows.map(([name, latitude, longitude, postcode, state]) => ({ name, latitude, longitude, postcode, state }));
}

let cached: GeoJSON.FeatureCollection | null = null;

/** One point per suburb, for the map's label layer (built once). */
export function auSuburbFeatures(): GeoJSON.FeatureCollection {
  if (cached) return cached;
  cached = {
    type: "FeatureCollection",
    features: rows.map(([name, lat, lng, postcode], i) => ({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: postcode ? { name, postcode } : { name },
    })),
  };
  return cached;
}

/** "Punchbowl 2196", or the name alone where the suburb has no single postcode. */
export function suburbLabel(s: Pick<AuSuburb, "name" | "postcode">): string {
  return s.postcode ? `${s.name} ${s.postcode}` : s.name;
}
