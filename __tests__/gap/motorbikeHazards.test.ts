// Gap item 7: motorbike hazards as their own report types -- pothole, loose gravel, tram tracks --
// in the report grid, Settings > Reports, the server's rules, voice reports and ahead alerts; and
// a server not yet redeployed still takes them (as "Other hazard" with what it is in the note).
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockCallable = jest.fn<(name: string, data: unknown) => Promise<{ data: unknown }>>();
jest.mock("@firebase/functions", () => ({ httpsCallable: (_f: unknown, name: string) => (data: unknown) => mockCallable(name, data) }));

import { REPORT_CATEGORIES, baseTypeOf, isFixedItem } from "@/settings/reportGrid";
import { REPORT_ITEM_BY_ID, alertsWhileDriving } from "@/settings/reportCatalog";
import { parseVoiceReport } from "@/nav/voiceReport";
import { kindOfItem, titleFor } from "@/nav/ahead/aheadKinds";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { submitReport, ReportRefused } from "@/services/alerts";
const server = require("../../firebase/functions/reports/core.js");

const NEW = ["pothole", "looseGravel", "tramTracks"] as const;

describe("motorbike hazards", () => {
  it("in the Hazard category of the report grid, filed as hazards; tram tracks stay once confirmed", () => {
    const hazard = REPORT_CATEGORIES.find((c) => c.id === "hazard")!;
    for (const id of NEW) {
      expect(hazard.items).toContain(id);
      expect(baseTypeOf(id)).toBe("hazard");
      expect(REPORT_ITEM_BY_ID[id]).toMatchObject({ section: "hazards", show: true, alert: true });
    }
    expect(isFixedItem("tramTracks")).toBe(true);
    expect(isFixedItem("pothole")).toBe(false);
    expect(server.POLICY.items.pothole.lifetimeMinutes).toBe(7 * 24 * 60);
    expect(server.POLICY.items.looseGravel.lifetimeMinutes).toBe(24 * 60);
  });

  it("the server's own rules accept them", () => {
    for (const item of NEW) {
      const { decision } = server.decide({ uid: "u", input: { type: "hazard", item, at: { lat: -33.87, lng: 151.2 }, from: { lat: -33.87, lng: 151.2 } }, state: null, nearby: [], nowMs: Date.now() });
      expect([item, decision.action]).toEqual([item, "create"]);
    }
  });

  it("voice: 'pothole in the left lane', 'loose gravel', 'tram tracks'", () => {
    expect(parseVoiceReport("pothole in the left lane")).toMatchObject({ item: "pothole", label: "Pothole", lane: "left", spoken: "Pothole reported" });
    expect(parseVoiceReport("there's loose gravel")).toMatchObject({ item: "looseGravel", spoken: "Loose gravel reported" });
    expect(parseVoiceReport("tram tracks")).toMatchObject({ item: "tramTracks" });
  });

  it("ahead alerts by their own name; each has its own Alert toggle", () => {
    for (const id of NEW) expect(titleFor(kindOfItem(id, true)!, id)).toBe(REPORT_ITEM_BY_ID[id].title);
    const report = { id: "r1", type: "hazard" as const, item: "pothole", lat: -33.87, lng: 151.2, createdBy: "someone" };
    expect(collectApproachFeatures(DEFAULT_SETTINGS, { osm: null, alerts: [report], incidents: [] }).map((f) => f.item)).toEqual(["pothole"]);
    const off = { ...DEFAULT_SETTINGS, reportPrefs: { ...DEFAULT_SETTINGS.reportPrefs, pothole: { alert: false } } } as typeof DEFAULT_SETTINGS;
    expect(alertsWhileDriving(off, "pothole")).toBe(false);
    expect(collectApproachFeatures(off, { osm: null, alerts: [report], incidents: [] })).toEqual([]);
  });

  describe("server not redeployed yet", () => {
    beforeEach(() => {
      mockCallable.mockReset();
    });
    const at = { latitude: -33.87, longitude: 151.2 };
    const badType = () => Object.assign(new Error("Unknown report type."), { code: "functions/invalid-argument", details: { reason: "bad-type" } });

    it("refused as an unknown type -> sent again as Other hazard with 'Pothole' in the note", async () => {
      mockCallable.mockRejectedValueOnce(badType());
      mockCallable.mockResolvedValueOnce({ data: { merged: false, pendingId: "p1", publishAtMs: 1, needsConfirmation: false } });
      const r = await submitReport("hazard", at, at, "me", { item: "pothole", comment: "deep one" });
      expect(r).toMatchObject({ kind: "pending", pendingId: "p1" });
      expect(mockCallable).toHaveBeenNthCalledWith(1, "submitReport", expect.objectContaining({ item: "pothole" }));
      expect(mockCallable).toHaveBeenNthCalledWith(2, "submitReport", expect.objectContaining({ item: "otherHazards", comment: "Pothole · deep one" }));
    });

    it("any other refusal, or an item that isn't new, is not retried", async () => {
      mockCallable.mockRejectedValueOnce(badType());
      await expect(submitReport("hazard", at, at, "me", { item: "animals" })).rejects.toBeInstanceOf(ReportRefused);
      mockCallable.mockRejectedValueOnce(Object.assign(new Error("Up to 10 an hour."), { code: "functions/resource-exhausted", details: { reason: "hourly-limit" } }));
      await expect(submitReport("hazard", at, at, "me", { item: "pothole" })).rejects.toMatchObject({ reason: "hourly-limit" });
      expect(mockCallable).toHaveBeenCalledTimes(2);
    });
  });
});
