// Badge popularity, server side (functions/poiPopularity.js): Places matching, the 30-day cache,
// the per-user lookup budget, no key = no ratings, and the anonymous arrival count.
const core = require("../functions/poiPopularity");
const RESPONSE = require("./fixtures/poiPopularity/searchText.json");

const SYD = { lat: -33.8688, lng: 151.2093 };
const place = (over = {}) => ({ key: "example cafe|-33.869|151.209", name: "Example Cafe", ...SYD, ...over });
const DAY = 86_400_000;

function memoryStore() {
  const s = { cache: {}, arrivals: {}, marks: new Set(), budget: {} };
  return {
    s,
    async getCached(ids) {
      return Object.fromEntries(ids.filter((id) => s.cache[id]).map((id) => [id, s.cache[id]]));
    },
    async putCached(id, v) {
      s.cache[id] = v;
    },
    async getArrivals(ids) {
      return Object.fromEntries(ids.filter((id) => s.arrivals[id]).map((id) => [id, s.arrivals[id]]));
    },
    async takeFetchBudget(uid, n) {
      const used = s.budget[uid] || 0;
      const allowed = Math.max(0, Math.min(n, core.MAX_FETCHES_PER_USER_PER_DAY - used));
      s.budget[uid] = used + allowed;
      return allowed;
    },
    async countArrivalOnce(id, mark) {
      if (s.marks.has(mark)) return false;
      s.marks.add(mark);
      s.arrivals[id] = (s.arrivals[id] || 0) + 1;
      return true;
    },
  };
}

const okFetch = (body = RESPONSE) => jest.fn(async () => ({ ok: true, json: async () => body }));

test("asks Places for one place near the map's POI, with only the fields it needs", async () => {
  const fetchImpl = okFetch();
  const r = await core.lookup({ uid: "u", places: [place()], store: memoryStore(), apiKey: "k", fetchImpl, nowMs: 0 });
  expect(r.popularity[place().key]).toEqual({ ratingCount: 1240, businessStatus: "OPERATIONAL", arrivals: 0 });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe(core.PLACES_URL);
  expect(init.headers["X-Goog-FieldMask"]).toBe(core.FIELD_MASK);
  expect(JSON.parse(init.body)).toMatchObject({ textQuery: "Example Cafe", maxResultCount: 1, locationBias: { circle: { radius: 100 } } });
});

test("Google's place more than 150 m away is not the same place: no rating", () => {
  const far = { places: [{ ...RESPONSE.places[0], location: { latitude: SYD.lat + 0.003, longitude: SYD.lng } }] };
  expect(core.matchPlace(far, place())).toBeNull();
  expect(core.matchPlace({}, place())).toBeNull();
});

test("cached for 30 days, then looked up again", async () => {
  const store = memoryStore();
  const fetchImpl = okFetch();
  await core.lookup({ uid: "u", places: [place()], store, apiKey: "k", fetchImpl, nowMs: 0 });
  await core.lookup({ uid: "u", places: [place()], store, apiKey: "k", fetchImpl, nowMs: 29 * DAY });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await core.lookup({ uid: "u", places: [place()], store, apiKey: "k", fetchImpl, nowMs: 31 * DAY });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test("no key (or the placeholder): nothing fetched, no ratings invented", async () => {
  for (const apiKey of [undefined, "unset", "emulator-placeholder"]) {
    const fetchImpl = okFetch();
    const r = await core.lookup({ uid: "u", places: [place()], store: memoryStore(), apiKey, fetchImpl, nowMs: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toEqual({ popularity: {}, configured: false });
  }
});

test("at most 8 lookups a call and a daily budget per driver", async () => {
  const store = memoryStore();
  const fetchImpl = okFetch();
  const many = Array.from({ length: 30 }, (_, i) => place({ key: `p${i}`, lng: SYD.lng + i * 0.01 }));
  await core.lookup({ uid: "u", places: many, store, apiKey: "k", fetchImpl, nowMs: 0 });
  expect(fetchImpl).toHaveBeenCalledTimes(core.MAX_FETCHES_PER_CALL);
  store.s.budget.u = core.MAX_FETCHES_PER_USER_PER_DAY;
  await core.lookup({ uid: "u", places: many, store, apiKey: "k", fetchImpl, nowMs: 0 });
  expect(fetchImpl).toHaveBeenCalledTimes(core.MAX_FETCHES_PER_CALL);
});

test("Google failing just means no rating this time", async () => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status: 429 }));
  const r = await core.lookup({ uid: "u", places: [place()], store: memoryStore(), apiKey: "k", fetchImpl, nowMs: 0 });
  expect(r.popularity).toEqual({});
});

test("arrivals: counted once per driver per place per day, returned as a bare number", async () => {
  const store = memoryStore();
  expect(await core.recordArrival({ uid: "a", place: place(), store, nowMs: 0 })).toEqual({ counted: true });
  expect(await core.recordArrival({ uid: "a", place: place(), store, nowMs: 1000 })).toEqual({ counted: false });
  expect(await core.recordArrival({ uid: "b", place: place(), store, nowMs: 1000 })).toEqual({ counted: true });
  expect(await core.recordArrival({ uid: "a", place: place(), store, nowMs: DAY + 1 })).toEqual({ counted: true });
  const r = await core.lookup({ uid: "u", places: [place()], store, apiKey: undefined, fetchImpl: okFetch(), nowMs: 0 });
  expect(r.popularity[place().key]).toEqual({ ratingCount: null, businessStatus: null, arrivals: 3 });
  // nothing about who: the marks are hashes, the count is a number
  expect([...store.s.marks].every((m) => /^[0-9a-f]{64}$/.test(m))).toBe(true);
});

test("bad input is dropped", () => {
  expect(core.cleanPlaces([{ key: "x" }, null, place(), { ...place(), lat: NaN }])).toHaveLength(1);
  expect(core.cleanPlaces("nope")).toEqual([]);
});
