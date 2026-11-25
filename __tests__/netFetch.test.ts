// Requests never hang: each try times out, one retry, at most 10 s in all; the real outcome is
// recorded for Diagnostics (host + status, never the URL with its key).
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { REQUEST_BUDGET_MS, REQUEST_TIMEOUT_MS, RequestTimeoutError, netFetch } from "@/services/netFetch";
import { getDiagnostics, resetDiagnostics } from "@/diagnostics/diagnostics";

const ok = (status = 200) => Promise.resolve({ ok: status < 300, status } as Response);
const never = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));

beforeEach(() => {
  resetDiagnostics();
  jest.useRealTimers();
});

describe("netFetch", () => {
  it("two tries fit inside the 10 s budget", () => {
    expect(REQUEST_TIMEOUT_MS * 2).toBeLessThanOrEqual(REQUEST_BUDGET_MS);
  });

  it("a request that never answers gives up after the budget with a real error, not a forever spinner", async () => {
    jest.useFakeTimers();
    const calls: string[] = [];
    const p = netFetch("places", "https://places.googleapis.com/v1/places:searchNearby?key=SECRET", undefined, {
      fetchImpl: ((url: string, init?: RequestInit) => (calls.push(url), never(url, init))) as typeof fetch,
    });
    const settled = p.then(() => "resolved", (e) => e);
    await jest.advanceTimersByTimeAsync(REQUEST_BUDGET_MS + 1);
    const err = await settled;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(calls).toHaveLength(2); // one retry
    const rec = getDiagnostics().services.places!;
    expect(rec).toMatchObject({ host: "places.googleapis.com", status: null, ok: false });
    expect(JSON.stringify(rec)).not.toContain("SECRET");
  });

  it("a server error is retried once; a 403 isn't (it won't change) and is recorded with its status", async () => {
    let n = 0;
    const res = await netFetch("routes", "https://routes.googleapis.com/x", undefined, { fetchImpl: (() => (n++ === 0 ? ok(503) : ok(200))) as typeof fetch });
    expect(res.status).toBe(200);
    expect(n).toBe(2);
    let m = 0;
    const denied = await netFetch("places", "https://places.googleapis.com/x", undefined, { fetchImpl: (() => (m++, ok(403))) as typeof fetch });
    expect(denied.status).toBe(403);
    expect(m).toBe(1);
    expect(getDiagnostics().services.places).toMatchObject({ status: 403, ok: false, message: "HTTP 403" });
    expect(getDiagnostics().services.routes).toMatchObject({ status: 200, ok: true });
  });
});
