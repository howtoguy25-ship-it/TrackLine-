// The label/value rows under each report section -- shared by the screen and the PDF so they
// always say the same thing. Only what the provider returned: a missing value is left out.
import type { Section, SectionKey } from "@/vehicleCheck/model";

type Row = [string, string];

function rows(pairs: [string, string | number | null | undefined][]): Row[] {
  return pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]);
}

const WRITE_OFF_CATEGORY = { statutory: "Statutory", repairable: "Repairable", unknown: "Not stated" } as const;

export function sectionLines(key: SectionKey, s: Extract<Section, { status: "ok" }>): Row[] {
  const d = s.data as never as Record<string, unknown>;
  switch (key) {
    case "vehicle": {
      const v = d as { make: string; model: string; year: string; body: string; colour: string; engine: string; fuel?: string; transmission?: string; vin: string };
      return rows([
        ["Make", v.make],
        ["Model", v.model],
        ["Year", v.year],
        ["Body", v.body],
        ["Colour", v.colour],
        ["Engine", v.engine],
        ["Fuel", v.fuel],
        ["Transmission", v.transmission],
        ["VIN", v.vin],
      ]);
    }
    case "registration": {
      const r = d as { plate: string; state: string; status: string; expiry: string };
      return rows([
        ["Plate", r.plate && r.state ? `${r.plate} (${r.state})` : r.plate],
        ["Status", r.status],
        ["Expiry", r.expiry],
      ]);
    }
    case "writtenOff": {
      const w = d as { writtenOff: boolean; records: { category: keyof typeof WRITE_OFF_CATEGORY; incident: string | null; reason: string | null; date: string | null; jurisdiction: string | null }[] };
      if (!w.writtenOff) return [["Written off", "No"]];
      return w.records.flatMap((r, i) =>
        rows([
          [w.records.length > 1 ? `Write-off ${i + 1}` : "Written off", "Yes"],
          ["Category", WRITE_OFF_CATEGORY[r.category] ?? r.category],
          ["Recorded as", r.incident],
          ["Date", r.date],
          ["Reason", r.reason],
          ["State", r.jurisdiction],
        ])
      );
    }
    case "stolen": {
      const st = d as { stolen: boolean; records: { type: string | null; jurisdiction: string | null; reportedDate: string | null }[] };
      if (!st.stolen) return [["Stolen", "No"]];
      return st.records.flatMap((r) => rows([["Stolen", "Yes"], ["What", r.type], ["Reported", r.reportedDate], ["State", r.jurisdiction]]));
    }
    case "ppsr": {
      const p = d as { securedInterests: number };
      return rows([["Security interests", p.securedInterests]]);
    }
    case "odometer": {
      const o = d as { readings: { date: string; km: number }[] };
      const sorted = [...(o.readings ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
      return sorted.map((r) => [r.date, `${r.km.toLocaleString("en-AU")} km`] as Row);
    }
    case "recalls": {
      const r = d as { recalls: unknown[] };
      return (r.recalls ?? []).map((x, i) => [`Recall ${i + 1}`, typeof x === "string" ? x : JSON.stringify(x)] as Row);
    }
  }
  return [];
}
