# Switching everything on: the keys, step by step

Keys never go in the repo or in a chat message. Each one goes to exactly one of three places:

| Where | What goes there | How |
|---|---|---|
| **GitHub secret** | Server keys (Cloud Functions) | github.com/howtoguy25-ship-it/TrackLine-/settings/secrets/actions › **New repository secret** (phone browser, "Desktop site" on) |
| **EAS environment variable** | App-side IDs built into the app | expo.dev › TrackLine › **Environment variables** › **Add variable** › environments **production** and **preview** |
| **Firebase / Google console** | Switches (sign-in providers, extensions) | console.firebase.google.com › your TrackLine project |

After adding GitHub secrets, run the deploy with **Copy API keys** ticked, or tell me and I run it.
After adding EAS variables, tell me and I make a new TestFlight build. No code changes are needed
for any of these.

---

## Before launch (2 things)

### 1. `FIREBASE_SERVICE_ACCOUNT`: switches on everything between users

This one secret switches on: reports from other drivers, Trackys around you, private zones,
school zones from the server, the points board, driver fuel prices, account recovery, and your
dashboard's server side.

**This is now the only secret the deploy needs.** It used to need `MAPBOX_SERVER_TOKEN` as well.
That's optional now: without it, other drivers' Trackys move in straight lines between their
real positions instead of following the road.

1. **Blaze plan:** Firebase console › ⚙ › **Usage and billing** › **Details & settings**. The plan
   must say **Blaze (pay as you go)**. Cloud Functions don't run on the free Spark plan. Set a budget
   alert there (e.g. $25/month) so nothing surprises you.
2. Create the deploy account and its JSON key: **DEPLOY.md steps 1 and 2** (8 roles, about 10
   minutes on a phone).
3. GitHub › Settings › Secrets and variables › Actions › **New repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: the whole JSON file contents, from `{` to `}`.
4. Delete the downloaded JSON file.
5. Tell me "secret added". I push the deploy marker. It runs the server tests and then deploys
   (about 15 minutes). I then check that a report made on one phone shows on a second phone.

### 2. AdMob IDs: real ads instead of "Test mode"

1. **admob.google.com** › sign in › **Apps** › **Add app**: iOS, "Is the app listed on a supported
   app store?" › **No** for now (link it after the App Store listing is live). Name: TrackLine.
   Do the same for Android if you're shipping it.
2. In each app › **Ad units** › **Add ad unit**, twice:
   - **Banner**, name "Map banner"
   - **App open**, name "App open"
3. Copy these IDs. They are **not secret**, because they're built into every copy of the app:

   | EAS variable | Looks like |
   |---|---|
   | `ADMOB_IOS_APP_ID` | `ca-app-pub-1234…~5678…` (has a **~**) |
   | `ADMOB_IOS_BANNER_UNIT_ID` | `ca-app-pub-1234…/1111…` (has a **/**) |
   | `ADMOB_IOS_APP_OPEN_UNIT_ID` | `ca-app-pub-1234…/2222…` |
   | `ADMOB_ANDROID_APP_ID` | `ca-app-pub-1234…~…` |
   | `ADMOB_ANDROID_BANNER_UNIT_ID` | `ca-app-pub-1234…/…` |
   | `ADMOB_ANDROID_APP_OPEN_UNIT_ID` | `ca-app-pub-1234…/…` |

4. Either add them in expo.dev › Environment variables (production + preview, visibility
   **Plain text**), **or paste the six IDs to me in chat** and I'll add them with the EAS command
   line. That's fine for these IDs because they aren't secrets. Then I make a release build.
5. AdMob › **Privacy & messaging**: create a **GDPR** message and an **IDFA explainer**. Google
   requires them for ads in the EU/UK, and they're free. The app already asks for tracking
   permission, last in line after the other permissions.

---

## After launch (optional extras; each one is independent)

Each key below is a **GitHub secret** unless it says EAS. Until a key is added, the app says
plainly that the feature is off, and nothing is ever made up.

| Feature | Secret name(s) | Where to get it | Cost |
|---|---|---|---|
| **Live NSW traffic** (incidents, congestion) + transit on-time / late | `TFNSW_API_KEY` | opendata.transport.nsw.gov.au › Sign up › My Account › **Applications** › **Add application** › tick *Live Traffic* and *Public Transport* APIs › copy the **API key** | Free |
| Live buses / trains on the map (app side) | EAS `NSW_TRANSPORT_API_KEY` | The same key as above | Free |
| **Live NSW petrol prices** (FuelCheck) | `FUELCHECK_API_KEY` + `FUELCHECK_API_SECRET` | api.nsw.gov.au › sign up › **Fuel API** product › subscribe › copy key + secret | Free |
| Trackys follow the road | `MAPBOX_SERVER_TOKEN` | account.mapbox.com › **Tokens** › your default public token (`pk.…`), the same as the app's | Free tier |
| **Character voices** | `ELEVENLABS_API_KEY` | elevenlabs.io › profile › **API keys** › Create | Paid plan |
| **SMS codes** (account recovery, staff resets) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | twilio.com › Console › Account info (SID + token) › **Phone numbers** › buy an AU number (`+61…`) | Number rental + per SMS |
| **Phone-number sign-in** | none (a switch) | Firebase console › Authentication › **Sign-in method** › **Phone** › Enable | Firebase SMS pricing |
| Recovery / notice **emails** | none (an extension) | Firebase console › **Extensions** › "Trigger Email from Firestore" › collection `mail`, with your SMTP details (e.g. a Gmail app password, or SendGrid) | Free / SMTP |
| Popular places ranked by ratings | `GOOGLE_PLACES_SERVER_KEY` | console.cloud.google.com › APIs & Services › **Credentials** › Create API key › restrict to **Places API (New)** | Pay per use |
| "Summarise with AI" in your dashboard's Support | `ANTHROPIC_API_KEY` | console.anthropic.com › **API keys** | Pay per use |
| Crash-free % on your dashboard | `SENTRY_AUTH_TOKEN` | sentry.io › Settings › **Auth Tokens** | Free tier |
| Android "Continue with Google" | EAS `GOOGLE_WEB_CLIENT_ID` | Firebase console › Authentication › Google › **Web SDK configuration** › Web client ID | Free |
| Tracky's weather mood | EAS `OPENWEATHER_API_KEY` | openweathermap.org › API keys | Free tier |
| Vehicle full check | see **PROVIDERS.md** | business accounts | Paid |

After adding GitHub secrets: Actions › **Deploy Firebase** › Run workflow › tick **Copy API keys**
(or ask me). After adding EAS variables: ask me for a new build.

## How to check each one is on

Settings › About › **Diagnostics** in the app shows the last request status for each live
service (traffic, petrol, routes, places). The dashboard's **Health** page shows the server
side. Each row in **BLOCKED.md** says what to look for.
