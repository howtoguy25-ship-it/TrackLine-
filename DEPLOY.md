# Deploying the server (from your phone)

Everything server-side (Cloud Functions, Firestore rules + indexes, Storage rules) is deployed by
the GitHub Action **"Deploy Firebase (functions, Firestore rules, Storage rules)"**
(`.github/workflows/firebase-deploy.yml`). It only runs when you press **Run workflow**, never on
a push. Each run:

1. runs the Firestore/Storage rules and Cloud Functions tests on the real Firebase emulators
   (placeholder keys only) -- **if any test fails, nothing is deployed**;
2. copies your API keys into Firebase (only when you tick "Copy API keys");
3. deploys;
4. runs `refreshSchoolZones` once, so the official NSW school zones are on the server straight
   away, and waits until it has written them (the log says how many zones loaded).

Until the first successful run, none of these work in the app: other drivers' Trackys, Live
Traffic NSW, school zones, speed-limit/school-zone reports, character voices, REV Check.

You need: a phone browser (Safari/Chrome) and the GitHub app (or github.com). About 15 minutes,
once.

---

## Step 1 -- Create the deploy account (Google Cloud, phone browser)

Tip: Google Cloud Console works on a phone, but turn on **"Request Desktop Website"** (Safari:
the **aA** button; Chrome: **⋮ › Desktop site**) so every menu shows.

1. Open **https://console.cloud.google.com/iam-admin/serviceaccounts**.
2. At the top, tap the project picker and choose your **TrackLine Firebase project**.
3. Tap **+ Create service account**. Name: `github-deploy`. Tap **Create and continue**.
4. **Grant this service account access to project** -- add each of these roles (tap **Add
   another role** between them; type the name in the role search box):

   | Role | Why |
   |---|---|
   | **Firebase Admin** | Firestore rules, indexes, Storage rules |
   | **Cloud Functions Admin** | Deploy the functions |
   | **Service Account User** | Functions run as a service identity |
   | **Cloud Run Admin** | 2nd-gen functions run on Cloud Run |
   | **Artifact Registry Administrator** | Functions are built into a container image |
   | **Secret Manager Admin** | Store the API keys (step 4) |
   | **Cloud Scheduler Admin** | The scheduled functions (weekly school zones, traffic refresh), and the "load school zones now" step |
   | **Service Usage Consumer** | The Firebase CLI checks which Google APIs are on |

5. Tap **Continue**, skip the last section, tap **Done**.

## Step 2 -- Download its key

1. In the list, tap **github-deploy@...** › **Keys** tab › **Add key** › **Create new key** ›
   **JSON** › **Create**. A `.json` file downloads.
   - iPhone: it's in the **Files** app › **Downloads**.
   - Android: **Files** › **Downloads**.
2. Treat this file like a password.

## Step 3 -- Save it as a GitHub secret

The GitHub app can't edit secrets, so use the phone browser:

1. Open the `.json` file (tap it in Files -- it shows as text), **Select All**, **Copy**.
2. Go to **https://github.com/howtoguy25-ship-it/TrackLine-/settings/secrets/actions**
   (sign in if asked; Desktop Website mode helps here too).
3. **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT` (exactly). Secret: paste the
   whole file contents (it starts with `{` and ends with `}`). **Add secret**.
4. Delete the `.json` file from Downloads.

## Step 4 -- API keys (same page, one secret each)

| Secret name | Needed for | Where to get it |
|---|---|---|
| `MAPBOX_SERVER_TOKEN` | **Required** -- other drivers' Trackys snapped to roads | account.mapbox.com › Tokens (the same token as the app's `MAPBOX_PUBLIC_TOKEN` works) |
| `TFNSW_API_KEY` | Live Traffic NSW incidents and congestion | opendata.transport.nsw.gov.au › sign up › My account › Applications › Create › copy the API key (free) |
| `ELEVENLABS_API_KEY` | The four character voices (paid service) | elevenlabs.io › profile › API keys |
| `CARJAM_API_KEY` | Vehicle full check: details, VIN, rego, stolen, written-off | dev.carjam.co.nz › sign up (consumer resale connection) |
| `AUCN_API_KEY` | Vehicle full check: PPSR, written-off, stolen, odometer | aucn.net.au/business (business account) |
| `MOTORWEB_API_KEY` | Vehicle full check: rego, stolen, written-off | MotorWeb AU (business account) |
| `EQUIFAX_API_KEY` | Vehicle full check: odometer, written-off, stolen | equifax.com.au CarHistory (business account) |
| `PPSR_API_KEY` | Vehicle full check: PPSR (government B2G) | ppsr.gov.au B2G access |
| `PPSR_BUSINESSAPI_KEY` | Vehicle full check: PPSR via BusinessAPI (already built) | businessapi.com.au |

Only `MAPBOX_SERVER_TOKEN` is required. Skip the others and the deploy still works; those
features say "not set up" in the app (vehicle check sections say BLOCKED). Which vehicle-check
keys you need, the store products and how to switch the check on: **PROVIDERS.md**.
Add a key later and re-run with **Copy API keys** ticked -- no app update needed.

## Step 5 -- Run it

1. **GitHub app** › this repository › **Actions** › **Deploy Firebase (functions, Firestore
   rules, Storage rules)** › **Run workflow**. (If your app version doesn't show the button, use
   github.com › Actions in the browser -- same thing.)
2. Branch: **`claude/go-session-0d5bup`** (that's where the current app builds come from).
3. Leave **Deploy Cloud Functions / Firestore rules / Storage rules** ticked. The first time,
   tick **Copy API keys**. Leave the **"load the official NSW school zones now"** box ticked.
4. **Run workflow**. It takes about 10-15 minutes: tests (~3 min), deploy (~5-8 min), school
   zones (~2 min).
5. Green tick = deployed and school zones loaded. The last step's log says e.g.
   "School zones loaded: 3301 zones in 697 tiles". A red cross: tap the failed step and read the
   last lines. Common ones:
   - "Permission denied" / "does not have ... permission" → a role from step 1 is missing.
   - "API ... has not been used in project ... or it is disabled" → open the link in the error
     and tap **Enable**, then re-run.
   - A test failed → nothing was deployed; tell me which test.

## Afterwards

- Re-run the workflow whenever server code changes (I'll tell you when).
- School zones then refresh by themselves every Monday at 3:17 am Sydney time.
- **Not deployed by this workflow**: Hosting (the website, including `privacy.html` that the app's
  Privacy policy link opens) and Firestore TTL policies. Hosting needs adding before App Store
  review if the privacy page isn't already live -- check the link in Settings › About opens.

### Optional: Firestore cleanup policies (needs a computer with gcloud)

A scheduled function already does this cleanup every two minutes; this just lets Firestore do it
itself:

```
gcloud firestore fields ttl-policies create expireAt --collection-group=presence --project=<project-id>
gcloud firestore fields ttl-policies create expireAt --collection-group=presencePending --project=<project-id>
```

### Character voice IDs

Each character uses an ElevenLabs stock voice (`PERSONA_ELEVENLABS_VOICE` in
`firebase/functions/index.js`), never tested against a real account. To change one, put voice
IDs in `firebase/functions/.env` (not secret, can be committed):

```
ELEVENLABS_VOICE_MATILDA=<voice id>
ELEVENLABS_VOICE_FOOTY_FAN=<voice id>
ELEVENLABS_VOICE_SARCASTIC_COPILOT=<voice id>
ELEVENLABS_VOICE_DRY_WIT=<voice id>
```
