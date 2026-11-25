# Vehicle full check — providers, keys, products, switching it on

The vehicle full check is one paid product. Each report section is answered by whichever
provider `config/vehicleCheck` routes it to. A section whose provider has no key (or no
adapter yet) shows **BLOCKED** with the reason. It never shows made-up data. The check is only
sold when you switch it on **and** every section is ready.

## Providers

| Provider | Covers | Sign-up | Key (Firebase secret) | Status in the app |
|---|---|---|---|---|
| **CarJam** | Vehicle details, VIN, rego, stolen, written-off | Self sign-up: dev.carjam.co.nz/pricing (choose a **Consumer resale** connection — the data is shown to app users) | `CARJAM_API_KEY` | **Adapter built** (`firebase/functions/vehicleCheck/carjamAu.js`), tested on CarJam's documented AU examples. Works as soon as the key is set. |
| **AUCN** | PPSR, written-off, stolen, odometer | Business account: aucn.net.au/business | `AUCN_API_KEY` | Adapter ready, answers BLOCKED. Needs AUCN's API docs to finish. |
| **MotorWeb** (AutoReport) | Rego, stolen, written-off | Business account: motorweb.gitbook.io/product-documentation/our-au-products | `MOTORWEB_API_KEY` | Adapter ready, answers BLOCKED. Needs MotorWeb's API docs. |
| **Equifax CarHistory** | Odometer, written-off, stolen (+ sales history) | Business account: equifax.com.au | `EQUIFAX_API_KEY` | Adapter ready, answers BLOCKED. Needs Equifax's API docs. |
| **PPSR** (Australian Government) | Finance owing (PPSR) + certificate | B2G access: ppsr.gov.au (or get PPSR through AUCN / MotorWeb) | `PPSR_API_KEY` | Adapter ready, answers BLOCKED. Needs the B2G interface docs. |
| BusinessAPI.com.au (already integrated) | PPSR + certificate | businessapi.com.au | `PPSR_BUSINESSAPI_KEY` | **Adapter built** (the old REV check's provider). An alternative PPSR route: set `ppsr: "businessapi"`. |

CarJam AU prices (dev.carjam.co.nz pricing page, Nov 2026, NZD ex GST, consumer resale):
details + rego `au_vdrsbc` $5.35, stolen `au_sc` $3.41, written-off `au_wo` $3.41, VIN decode
`au_vind` $2.64 (on by default; turn off with `decodeVin: false`). That is about NZ$14.81 per
check before PPSR and odometer, which leaves little margin at $19.99 after Apple's 15–30%.
Every check's real cost is logged in Firestore `providerUsage`.

Odometer history: CarJam doesn't sell AU odometer data. **No odometer provider has a built
adapter yet**, so the check can't go on sale until AUCN or Equifax is connected.

## 1. Set the keys (Firebase secrets — never in the app or the repo)

From your phone, as in DEPLOY.md:

1. GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Name it exactly as in the table (e.g. `CARJAM_API_KEY`), paste the key, **Add secret**.
3. **Actions → Deploy Firebase backend → Run workflow**, tick **Copy API keys** (and
   **Functions**), Run.

The workflow copies each key into Firebase secrets. Keys are read only inside Cloud Functions.
Missing keys get an `unset` placeholder so the deploy still works; their sections stay BLOCKED.

## 2. Create the products

Product IDs are in code: `full_check` ($19.99) and `full_check_2499` ($24.99, in case you
raise the price). Both are **consumable**.

**App Store Connect** (appstoreconnect.apple.com):

1. Make sure **Business → Agreements** shows the Paid Apps agreement as Active (bank + tax
   done), or no purchase can work.
2. Apps → TrackLine → **Monetization → In-App Purchases → +** → type **Consumable**.
3. Reference name `Vehicle full check`, Product ID `full_check` → Create.
4. **Price Schedule → Add Pricing** → base country Australia → **A$19.99** → Next → Confirm.
5. **App Store Localization → +** English (Australia): Display name `Vehicle full check`,
   Description `Written-off, stolen, finance owing, odometer, rego and VIN for one vehicle.`
6. **Review Information**: a screenshot of the Vehicle check screen. Notes: "One-time report
   for one Australian vehicle from licensed vehicle-data providers. Test with any plate, e.g.
   TEST00 VIC, on a sandbox account."
7. Save. Repeat with Product ID `full_check_2499` at **A$24.99** (you can leave it unsubmitted
   until you need it).
8. Submit the products with the next app version (they go to review together; I won't
   submit anything for review).

**Google Play Console** (play.google.com/console):

1. **Setup → Payments profile** must be complete.
2. TrackLine → **Monetize → Products → In-app products → Create product**.
3. Product ID `full_check`, Name `Vehicle full check`, description as above, price
   **A$19.99** (Set price → Australia), **Activate**.
4. Repeat for `full_check_2499` at **A$24.99**.
5. **Users and permissions → Invite new users** → the service account the functions run as.
   For 2nd-gen functions that is the Compute default account,
   `<project-number>-compute@developer.gserviceaccount.com` (Google Cloud console → Cloud Run →
   `runvehiclecheck` → **Security** shows it). Give it app permission **View financial data**.
   The server needs this to verify Play purchases.

## 3. Route the sections (Firestore `config/vehicleCheck`, owner-only)

Firebase console → Firestore → collection `config` → document `vehicleCheck` → fields:

```json
{ "details": "carjam", "rego": "carjam", "stolen": "carjam", "writtenOff": "carjam",
  "ppsr": "aucn", "odometer": "aucn", "priceTier": "19.99", "enabled": false }
```

- Switch any section to another provider by changing its value (`carjam`, `aucn`, `motorweb`,
  `equifax`, `ppsr`, `businessapi`). No new build needed.
- `priceTier`: `"19.99"` sells `full_check`, `"24.99"` sells `full_check_2499`. Raise the
  price by changing this (after the $24.99 product is approved). Purchases of either product
  are always accepted.
- Only the owner account can read or write this document.

## 4. Turn it on

1. Set the keys for every provider your routing uses (step 1) and redeploy.
2. Open **Menu → Vehicle check** in the app while signed in as the owner. The owner panel shows
   each section's provider and status (`ready` or `BLOCKED: …`).
3. When every line says `ready`, set `"enabled": true` in `config/vehicleCheck`.
4. The menu row now appears for everyone in Australia, and the button sells the check.

`enabled: false` hides the screen in production. Development builds and the owner account
always see it, so you can test it (owner: TestFlight sandbox purchases are allowed for
admin accounts only, because each one makes real paid provider calls).

## What works today (no keys set)

| Section | Provider (default) | Today |
|---|---|---|
| Vehicle, VIN | CarJam | Built; BLOCKED until `CARJAM_API_KEY` |
| Registration | CarJam | Built; BLOCKED until `CARJAM_API_KEY` |
| Stolen | CarJam | Built; BLOCKED until `CARJAM_API_KEY` |
| Written off | CarJam | Built; BLOCKED until `CARJAM_API_KEY` |
| Finance owing (PPSR) | AUCN | BLOCKED: `AUCN_API_KEY` + adapter (or switch to `businessapi` + `PPSR_BUSINESSAPI_KEY`, built) |
| Odometer history | AUCN | BLOCKED: `AUCN_API_KEY` + adapter (or Equifax) |

Re-record CarJam's test responses once you have a development key:
`CARJAM_TEST_KEY=... node scripts/record-vehicle-check.mjs`.
