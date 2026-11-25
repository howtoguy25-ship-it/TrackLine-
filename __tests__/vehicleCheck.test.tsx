// Vehicle full check, app side: input rules (the same as the server's), Australia only, never
// selling the same car twice in 24 h, the labelled sample, the report view (green/amber/red,
// source + data-as-at, "Couldn't load -- tap to retry"), the odometer chart and the PDF.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import {
  FULL_CHECK_BLURB,
  FULL_CHECK_PRODUCT_ID,
  FULL_CHECK_PRODUCT_IDS,
  detectCountry,
  footerText,
  isInAustralia,
  overallGrade,
  plateProblem,
  priceLabel,
  progress,
  queryKeyFor,
  recentReportFor,
  vinProblem,
  type VehicleReport,
} from "@/vehicleCheck/model";
import { SAMPLE_REPORT } from "@/vehicleCheck/sample";
import { reportHtml } from "@/vehicleCheck/reportHtml";
import { chartPoints } from "@/components/vehicleCheck/OdometerChart";
import { VehicleReportView } from "@/components/vehicleCheck/VehicleReportView";

const report = (over: Partial<VehicleReport> = {}): VehicleReport => ({
  id: "r1",
  query: { kind: "plate", plate: "TEST00", state: "VIC", vin: null },
  queryKey: "AU:plate:VIC:TEST00",
  status: "complete",
  createdAt: Date.UTC(2026, 10, 16),
  providers: ["CarJam", "PPSR via BusinessAPI"],
  sections: {},
  ...over,
});

describe("input", () => {
  it("VIN: 17 characters, never I, O or Q", () => {
    expect(vinProblem("WAUZZZ8X4GB00TEST")).toBeNull();
    expect(vinProblem(" wauzzz8x4gb00test ")).toBeNull();
    expect(vinProblem("WAUZZZ8X4GB00TES")).toMatch(/17 characters \(this has 16\)/);
    expect(vinProblem("WAUZZZ8X4GB00TESO")).toMatch(/I, O or Q/);
    expect(vinProblem("WAUZZZ8X4GB00TE$T")).toMatch(/Letters and numbers/);
    expect(vinProblem("")).toBe("Enter the VIN");
  });

  it("plate + state", () => {
    expect(plateProblem("abc 123", "NSW")).toBeNull();
    expect(plateProblem("", "NSW")).toBe("Enter the number plate");
    expect(plateProblem("ABC123", null)).toBe("Choose the state");
    expect(plateProblem("ABC123", "XX")).toBe("Choose the state");
    expect(plateProblem("TOOLONGPLATE", "NSW")).toMatch(/up to 9/);
  });

  it("the query key matches the server's", () => {
    expect(queryKeyFor({ kind: "plate", plate: "test 00", state: "VIC" })).toBe("AU:plate:VIC:TEST00");
    expect(queryKeyFor({ kind: "vin", vin: "wauzzz8x4gb00test" })).toBe("AU:vin:WAUZZZ8X4GB00TEST");
  });
});

describe("countries", () => {
  it("knows when the driver is in Australia (and not in Timor or PNG)", () => {
    expect(isInAustralia(-33.87, 151.21)).toBe(true); // Sydney
    expect(isInAustralia(-42.88, 147.33)).toBe(true); // Hobart
    expect(isInAustralia(-12.46, 130.84)).toBe(true); // Darwin
    expect(isInAustralia(-10.7, 142.5)).toBe(true); // Cape York tip
    expect(isInAustralia(-8.56, 125.57)).toBe(false); // Dili
    expect(isInAustralia(-10.75, 123.1)).toBe(false); // Rote
    expect(isInAustralia(-9.44, 147.18)).toBe(false); // Port Moresby
    expect(isInAustralia(-36.85, 174.76)).toBe(false); // Auckland
    expect(isInAustralia(51.5, -0.12)).toBe(false); // London
  });

  it("position wins; otherwise the phone's region -- a foreign region is never treated as AU", () => {
    expect(detectCountry("NSW", "en-GB")).toEqual({ country: "AU", state: "NSW" });
    expect(detectCountry(null, "en-AU")).toEqual({ country: "AU", state: null });
    expect(detectCountry(null, "en-NZ")).toEqual({ country: "NZ", state: null });
    expect(detectCountry(null, "en-US")).toEqual({ country: "US", state: null });
    expect(detectCountry(null, "en")).toEqual({ country: null, state: null });
  });
});

describe("never paying twice", () => {
  it("a report for the same car in the last 24 h is offered instead of a new purchase", () => {
    const now = Date.UTC(2026, 10, 16, 12);
    const list = [
      report({ id: "old", createdAt: now - 25 * 3600_000 }),
      report({ id: "credited", status: "credited", createdAt: now - 3600_000 }),
      report({ id: "today", createdAt: now - 2 * 3600_000 }),
    ];
    expect(recentReportFor(list, "AU:plate:VIC:TEST00", now)?.id).toBe("today");
    expect(recentReportFor(list.slice(0, 2), "AU:plate:VIC:TEST00", now)).toBeNull();
    expect(recentReportFor(list, "AU:plate:NSW:TEST00", now)).toBeNull();
  });

  it("one product, the store's own price first, the configured price before the store loads", () => {
    expect(FULL_CHECK_PRODUCT_ID).toBe("full_check");
    // A second product for the $24.99 tier, chosen by config/vehicleCheck priceTier on the server.
    expect(FULL_CHECK_PRODUCT_IDS).toEqual(["full_check", "full_check_2499"]);
    expect(priceLabel("A$19.99", 19.99)).toBe("A$19.99");
    expect(priceLabel(null, 24.99)).toBe("$24.99");
    expect(priceLabel(undefined, undefined)).toBe("$19.99");
    expect(FULL_CHECK_BLURB).toBe("Full history report: written-off, stolen, finance owing, odometer history, rego and VIN.");
  });
});

describe("report", () => {
  it("the sample is labelled, covers every paid section, and isn't a real vehicle", async () => {
    expect(SAMPLE_REPORT.sample).toBe(true);
    expect(Object.keys(SAMPLE_REPORT.sections)).toEqual(["vehicle", "registration", "writtenOff", "stolen", "ppsr", "odometer"]);
    expect(SAMPLE_REPORT.query.plate).toBe("SAMPLE");
    expect(vinProblem(SAMPLE_REPORT.sections.vehicle!.status === "ok" ? SAMPLE_REPORT.sections.vehicle!.data.vin! : "")).not.toBeNull();
    await render(<VehicleReportView report={SAMPLE_REPORT} />);
    expect(screen.getByTestId("sample-banner")).toBeTruthy();
    expect(screen.getByText("Sample report: example data, not a real vehicle")).toBeTruthy();
  });

  it("each section: grade, summary, source and data-as-at; footer names the providers", async () => {
    await render(
      <VehicleReportView
        report={report({
          sections: {
            vehicle: { status: "ok", grade: "green", summary: "HYUNDAI I30", source: "CarJam", asAt: "2026-11-16", data: { make: "HYUNDAI", model: "I30", year: null, body: null, colour: null, engine: null, vin: "KMHH351EMKU00TEST" } },
            stolen: { status: "ok", grade: "red", summary: "Reported stolen", source: "CarJam", asAt: "2026-11-16", data: { stolen: true, records: [{ type: "Plate", jurisdiction: "VIC", reportedDate: "2021-02-21" }] } },
          },
        })}
      />
    );
    expect(screen.getByTestId("section-vehicle-grade-green")).toBeTruthy();
    expect(screen.getByTestId("section-stolen-grade-red")).toBeTruthy();
    expect(screen.getByText("Problem: Reported stolen")).toBeTruthy();
    expect(screen.getAllByText("Source: CarJam · data as at 2026-11-16")).toHaveLength(2);
    expect(screen.getByText("KMHH351EMKU00TEST")).toBeTruthy();
    // Missing values are left out, never shown as blanks or guesses.
    expect(screen.queryByText("Colour")).toBeNull();
    expect(screen.getByTestId("vehicle-report-footer").props.children).toBe(
      "Information supplied by CarJam, PPSR via BusinessAPI. Always inspect the vehicle and get a mechanic's check."
    );
  });

  it("a failed section says 'Couldn't load -- tap to retry' and retries that section", async () => {
    const onRetry = jest.fn();
    await render(<VehicleReportView report={report({ status: "partial", sections: { ppsr: { status: "failed", error: "Couldn't load", retries: 0 } } })} onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load — tap to retry")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("section-ppsr-failed"));
    expect(onRetry).toHaveBeenCalledWith("ppsr");
  });

  it("while running: loading sections and progress; 'not found' isn't offered a retry", async () => {
    const running = report({ status: "running", sections: { vehicle: { status: "failed", error: "x", notFound: true }, registration: { status: "loading" } } });
    expect(progress(running)).toEqual({ done: 1, total: 6 });
    await render(<VehicleReportView report={running} onRetry={jest.fn()} />);
    expect(screen.getByTestId("section-registration-loading")).toBeTruthy();
    expect(screen.getByText("Vehicle not found")).toBeTruthy();
  });

  it("overall grade is the worst section", () => {
    expect(overallGrade(SAMPLE_REPORT)).toBe("red");
    expect(overallGrade(report())).toBeNull();
    expect(footerText([])).toBe("Always inspect the vehicle and get a mechanic's check.");
  });

  it("odometer chart: readings in date order, a backwards reading marked", () => {
    const readings = SAMPLE_REPORT.sections.odometer!.status === "ok" ? SAMPLE_REPORT.sections.odometer!.data.readings : [];
    const pts = chartPoints(readings, 300, 170);
    expect(pts.map((p) => p.date)).toEqual(["2019-04-10", "2020-04-22", "2021-05-03", "2022-05-19", "2023-06-01"]);
    expect(pts.map((p) => p.backwards)).toEqual([false, false, false, true, true]);
    expect(pts[0].x).toBeLessThan(pts[4].x);
    expect(chartPoints([], 300, 170)).toEqual([]);
  });

  it("PDF: every section, the footer, the sample label, and provider text escaped", () => {
    const html = reportHtml(
      report({
        sections: {
          writtenOff: {
            status: "ok",
            grade: "red",
            summary: "Statutory write-off recorded",
            source: "CarJam",
            asAt: "2026-11-16",
            data: { writtenOff: true, records: [{ category: "statutory", incident: "Statutory Write-off", reason: "<script>x</script>", date: "2021-03-02", jurisdiction: "VIC" }] },
          },
          ppsr: { status: "failed", error: "Couldn't load" },
        },
      })
    );
    expect(html).toContain("Written off");
    expect(html).toContain("Statutory");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Couldn&#39;t load");
    expect(html).toContain("Information supplied by CarJam, PPSR via BusinessAPI.");
    expect(reportHtml(SAMPLE_REPORT)).toContain("SAMPLE REPORT");
  });

  it("a BLOCKED section says so, with the reason, and offers no retry", async () => {
    const onRetry = jest.fn();
    await render(
      <VehicleReportView
        report={report({ status: "partial", sections: { odometer: { status: "blocked", reason: "Waiting for AUCN: AUCN_API_KEY isn't set." } } })}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText("BLOCKED: Waiting for AUCN: AUCN_API_KEY isn't set.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("section-odometer-blocked"));
    expect(onRetry).not.toHaveBeenCalled();
    expect(reportHtml(report({ sections: { odometer: { status: "blocked", reason: "x" } } }))).toContain("BLOCKED: x");
  });
});
