// The "Sample" report shown before paying, so a buyer sees exactly what they get. A made-up
// example, labelled "Sample" everywhere it appears (VehicleReportView shows a banner when
// `sample` is set). It is not any real vehicle: the plate reads SAMPLE and the VIN is a
// placeholder pattern, so it can never be mistaken for a real check.
import type { VehicleReport } from "@/vehicleCheck/model";

export const SAMPLE_REPORT: VehicleReport = {
  id: "sample",
  sample: true,
  query: { kind: "plate", plate: "SAMPLE", state: "NSW", vin: null },
  queryKey: "sample",
  status: "complete",
  createdAt: Date.UTC(2026, 0, 15),
  providers: ["Sample data"],
  sections: {
    vehicle: {
      status: "ok",
      grade: "green",
      summary: "2018 Example Motors Hatch",
      source: "Sample data",
      asAt: "2026-01-15",
      data: { make: "Example Motors", model: "Hatch", year: "2018", body: "Hatchback", colour: "Silver", engine: "2.0 L, 4 cyl", fuel: "Petrol", transmission: "Automatic", vin: "SAMPLEVIN00000000" },
    },
    registration: {
      status: "ok",
      grade: "green",
      summary: "Registered until 2026-09-30",
      source: "Sample data",
      asAt: "2026-01-15",
      data: { plate: "SAMPLE", state: "NSW", status: "REGISTERED", expiry: "2026-09-30" },
    },
    writtenOff: {
      status: "ok",
      grade: "amber",
      summary: "Repairable write-off recorded",
      source: "Sample data",
      asAt: "2026-01-15",
      data: { writtenOff: true, records: [{ category: "repairable", incident: "Repairable Write-off", reason: "Collision", date: "2021-03-02", jurisdiction: "NSW" }] },
    },
    stolen: {
      status: "ok",
      grade: "green",
      summary: "Not reported stolen",
      source: "Sample data",
      asAt: "2026-01-15",
      data: { stolen: false, records: [] },
    },
    ppsr: {
      status: "ok",
      grade: "red",
      summary: "1 security interest registered (possible finance owing)",
      source: "Sample data",
      asAt: "2026-01-15",
      data: { securedInterests: 1, certificateUrl: null },
    },
    odometer: {
      status: "ok",
      grade: "red",
      summary: "Odometer went backwards: possible rollback",
      source: "Sample data",
      asAt: "2026-01-15",
      data: {
        readings: [
          { date: "2019-04-10", km: 18200 },
          { date: "2020-04-22", km: 39750 },
          { date: "2021-05-03", km: 61400 },
          { date: "2022-05-19", km: 44100 },
          { date: "2023-06-01", km: 59800 },
        ],
      },
    },
  },
};
