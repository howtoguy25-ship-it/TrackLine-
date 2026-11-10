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

That's it — no other secret or variable is needed. The workflow reads the Firebase project ID
directly out of the service account key itself at run time, so there's nothing else to add.

## Running a deploy

1. GitHub app (or github.com) → this repo → **Actions** tab → **Deploy Firebase (functions,
   Firestore rules, Storage rules)** in the left sidebar.
2. **Run workflow** (top right) → pick the branch (normally your default branch) → tick which
   of the three targets you want deployed (all three are ticked by default) → **Run workflow**.
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

It does **not** deploy Hosting (the web app) or Firestore indexes — those aren't part of this
workflow; ask if you want them added too.
