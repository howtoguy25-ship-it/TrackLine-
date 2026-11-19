# Vehicle check fixtures

No provider key was available while building this, so these are NOT live recordings. They are:

| File | Where it comes from |
|---|---|
| `carjam_TEST80_SC.xml`, `carjam_TEST80_WO.xml` | Verbatim from CarJam's AU reference examples (carjam.co.nz/dev:page?t=australian-vehicles, test vehicle TEST80 / WAUZZZ8X4GB00TEST: stolen + written off). |
| `carjam_TEST00_VDRSBC.xml`, `carjam_TEST80_VDRSBC.xml` | CarJam's documented VDRSBC fields with the documented test-vehicle values (plate, state, VIN, make/model where the docs show them, status REGISTERED, expiry 2023-01-16). Fields the docs' examples don't show are left out rather than invented. |
| `carjam_TEST00_SC.xml`, `carjam_TEST00_WO.xml` | TEST00 is documented as not stolen / not written off; the empty `__array` element is how CarJam marks arrays, but an empty one isn't shown in the docs. |
| `carjam_not_found.xml` | An empty `vehicles` array (not shown in the AU docs). |
| `carjam_error.xml` | The error format from CarJam's NZ reference ("Requires an API key"). |
| `ppsr_*.json` | BusinessAPI PPSR search responses with only the fields the existing REV check already reads (`status`, `data.registrations`, `data.certificates[].downloadUrl`, `data.nevdisData.vehicles[].safetyRecalls`). |

Odometer history has no provider yet (stub adapters only), so the rollback test uses an in-test
adapter with dated readings.

Re-record the CarJam ones from the test service once a development key exists:
`CARJAM_TEST_KEY=... node scripts/record-vehicle-check.mjs` (writes `*.recorded.xml` next to these).
