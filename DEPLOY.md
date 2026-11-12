# Deploying Firebase (functions, Firestore rules, Storage rules)

This repo has no checked-in Firebase CLI session and this cloud dev environment can't run one
(`firebase` isn't installed here, and there's no interactive login). Deploys instead go through
`.github/workflows/firebase-deploy.yml`, a manual-only (never on push) GitHub Action you run
yourself from your phone or a browser. This doc is the one-time setup for that, plus how to run
it afterward.

## One-time setup

### 1. Create the service account (Google Cloud Console)

1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts and make sure your
   **TrackLine Firebase project** is selected at the top (the same project this app's Firebase
   config already points at).
2. **Create Service Account** → name it something like `github-deploy` → Create and Continue.
3. **Grant this service account access to the project** — add these roles:
   - **Firebase Admin** (`roles/firebase.admin`) — covers Firestore rules and Storage rules
     deploy, and most of what Functions deploy needs too.
   - **Cloud Functions Admin** (`roles/cloudfunctions.admin`) — functions deploy specifically.
   - **Service Account User** (`roles/iam.serviceAccountUser`) — functions deploy runs as a
     service identity; this lets the deploy actually attach it.
   - **Cloud Run Admin** (`roles/run.admin`) — this project's Cloud Functions are 2nd-gen, which
     deploy on top of Cloud Run under the hood.
   - **Artifact Registry Administrator** (`roles/artifactregistry.admin`) — 2nd-gen functions
     build a container image during deploy; this lets that image be pushed.
   - **Secret Manager Admin** (`roles/secretmanager.admin`) — lets the workflow store the API
     keys the functions use (step 4) so you never need a command line for them.
   These are broader than a perfectly minimal set would be, but they're the real, documented
   combination Firebase's own CI guidance uses — a narrower set is easy to get subtly wrong and
   have deploys fail partway through.
4. Continue, skip "Grant users access," click **Done**.

### 2. Create and download the key

1. Click the new service account in the list → **Keys** tab → **Add Key** → **Create new key**
   → **JSON** → Create. This downloads a `.json` file to your device — treat it like a
   password; it's a real, long-lived credential.

### 3. Add it as a GitHub secret (from your phone)

1. Open the **GitHub mobile app** (or github.com in your phone's browser) → your `trackline`
   (or whatever this repo is named) repository → **Settings** tab.
   - On the mobile app: repo → the "..." / settings icon → **Secrets and variables** → **Actions**.
   - In a mobile browser, GitHub's settings pages work the same as desktop, just scrolled.
2. **New repository secret**.
3. Name: `FIREBASE_SERVICE_ACCOUNT` (exact name — the workflow reads this exact secret name).
4. Value: open the downloaded `.json` key file and paste its **entire contents** (the whole
   `{ "type": "service_account", ... }` object) into the value box.
5. **Add secret**.
6. Delete the downloaded `.json` file from your device once it's saved as the secret — you
   don't need to keep a second copy lying around.

That's it for the GitHub Action itself — no other GitHub secret or variable is needed, the
workflow reads the Firebase project ID directly out of the service account key at run time.

### 4. API keys (from your phone — no command line)

The Cloud Functions need a few API keys. Each is added the same way as the service account key
in step 3: **GitHub → this repo → Settings → Secrets and variables → Actions → New repository
secret**, using exactly the name below. Then run the deploy workflow with **"Copy API keys"**
ticked (see "Running a deploy") and it copies them into Firebase for you.

| GitHub secret name | Needed for | Where to get it |
|---|---|---|
| `MAPBOX_SERVER_TOKEN` | **Required.** Snapping other drivers' Trackys to roads. | Your Mapbox account — the same value as `MAPBOX_PUBLIC_TOKEN` works. |
| `ELEVENLABS_API_KEY` | Optional. Unlocks the four character voices (Matilda, Aussie Footy Fan, Sarcastic Co-pilot, Dry Wit). | elevenlabs.io → your profile → API keys. This is a paid service billed per character of speech; each sentence is generated once and then reused for every driver. |
| `TFNSW_API_KEY` | Optional. Unlocks live NSW traffic incidents on the map. | opendata.transport.nsw.gov.au → register → create an application → its API key. Free. |

What happens if you skip the optional ones: the deploy still succeeds (the workflow creates a
harmless placeholder for each), and the app shows those features as not available yet. Add the
key later, re-run the workflow with "Copy API keys" ticked, and they switch on — no app update.

You only need to tick "Copy API keys" when you've added or changed a key. Leaving it unticked
keeps whatever is already in Firebase.

**Character voices — which voice is which.** Each character is mapped to one of ElevenLabs'
stock voices in `firebase/functions/index.js` (`PERSONA_ELEVENLABS_VOICE`). Those mappings were
chosen from ElevenLabs' public voice list and have **not been tested against a real account** —
no key has ever been available to this project. If a character stays silent (the app falls back
to your phone's voice) or you'd simply prefer a different voice, put the voice ID from your
ElevenLabs voice library in a file named `firebase/functions/.env`, for example:

```
ELEVENLABS_VOICE_MATILDA=<voice id>
ELEVENLABS_VOICE_FOOTY_FAN=<voice id>
ELEVENLABS_VOICE_SARCASTIC_COPILOT=<voice id>
ELEVENLABS_VOICE_DRY_WIT=<voice id>
```

Voice IDs aren't secret, so that file can be committed.

### 5. One-time Firestore cleanup policies

This is **not** part of the GitHub Action and can't be — it's an account-level setting, set once
from a computer with the `gcloud` CLI. Skip it and everything still works; a scheduled function
does the same cleanup every two minutes.

Firestore's own automatic deletion of stale presence data (`presence.expireAt` and
`presencePending.expireAt`):

```
gcloud firestore fields ttl-policies create expireAt \
  --collection-group=presence \
  --project=<your-project-id>

gcloud firestore fields ttl-policies create expireAt \
  --collection-group=presencePending \
  --project=<your-project-id>
```

(`presencePending` is the private holding area behind the 60-second privacy delay — the second
command makes Firestore clean that up by itself too.)

This needs the `gcloud` CLI logged in (`gcloud auth login`) with the same Google account that
has access to the Firebase project. You only ever need to run this once per project — it's a
standing policy, not something that re-runs on every deploy.

## Running a deploy

1. GitHub app (or github.com) → this repo → **Actions** tab → **Deploy Firebase (functions,
   Firestore rules, Storage rules)** in the left sidebar.
2. **Run workflow** (top right) → pick the branch (normally your default branch) → tick which
   of the three targets you want deployed (all three are ticked by default). The first time,
   and any time you've added or changed an API key in step 4, also tick **"Copy API keys"**.
   Then **Run workflow**.
3. Tap into the run to watch it — it checks out the repo, installs the functions' dependencies,
   writes the service account key to a file that only exists for this one run, and runs a real
   `firebase deploy`. The key file is deleted at the end of the run either way (success or
   failure).
4. A green check means it deployed for real. A red X means something failed — open the run's
   logs (GitHub automatically redacts the secret's literal value from any log line) and read the
   actual Firebase CLI error at the bottom.

## What this deploys

- **Functions** (`firebase/functions/index.js`) — all existing functions (REV Check checkout,
  alert cleanup, plate lookup, broadcast notifications, etc.) plus anything new added for the
  Tracky presence feature.
- **Firestore rules** (`firebase/firestore.rules`).
- **Storage rules** (`firebase/storage.rules`).

It does **not** deploy Hosting (the web app), Firestore indexes, or the Firestore TTL policies
(step 5). API keys are only copied when you tick "Copy API keys" (step 4).
