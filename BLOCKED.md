# Blocked — what only you can unblock

Each row: what's missing, where you add it, and how to check it works. Keys are never put in the
repo: GitHub secrets → "Deploy Firebase" workflow with *Copy API keys* ticked (DEPLOY.md).

| # | Item | Missing | Where I add it | How to test |
|---|---|---|---|---|
| 1 | **Everything server-side** (reports, presence, school zones, Live Traffic, vehicle check, badges ranking, transit live, the whole dashboard + recovery) | The Firebase deploy has never been run | GitHub > Actions > "Deploy Firebase" > Run (needs `FIREBASE_SERVICE_ACCOUNT` secret, DEPLOY.md) | Workflow goes green; app: report a hazard → it appears on a second phone |
| 2 | Dashboard 2FA | TOTP not enabled (needs Identity Platform) | Firebase console > Authentication > Settings > Upgrade to Identity Platform; enable TOTP MFA (ADMIN.md step 2) | Sign in to the dashboard → "Set up authenticator app" works |
| 3 | Dashboard website | Web config secrets + first deploy + domain | Secrets `ADMIN_FIREBASE_API_KEY`, `ADMIN_FIREBASE_AUTH_DOMAIN`, `ADMIN_FIREBASE_APP_ID`; Actions > "Deploy owner dashboard"; Hosting > add custom domain admin.<domain> | Open `https://<project>-admin.web.app`, sign in as howtoguy25@gmail.com |
| 4 | Dashboard App Check | reCAPTCHA Enterprise site key | Secret `ADMIN_RECAPTCHA_ENTERPRISE_KEY`; then `ADMIN_ENFORCE_APP_CHECK=true` in `firebase/functions/.env` and redeploy (ADMIN.md step 6) | Dashboard still loads; a call from a plain script is refused |
| 5 | SMS codes (recovery, staff "reset by SMS") | Twilio account | Secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | App: Sign in > Forgot password > your mobile → SMS arrives; `smsOutbox` doc shows `sent` |
| 6 | Recovery / notice emails ("password changed", codes, 24 h contact-change notice) | An SMTP sender | Install Firebase extension "Trigger Email from Firestore" on collection `mail` | Reset a test account's password with an SMS code → "password changed" email arrives |
| 7 | AI assistant in Support | Anthropic key | Secret `ANTHROPIC_API_KEY` | Support > a ticket > "Summarise with AI" shows a summary |
| 8 | Crash-free sessions % | Sentry token | Secret `SENTRY_AUTH_TOKEN`; `SENTRY_ORG`, `SENTRY_PROJECT` in `firebase/functions/.env` | Overview shows a % |
| 9 | Live NSW traffic + transit live/late | TfNSW key | Secret `TFNSW_API_KEY` | Map shows LTN incidents; transit trip shows "On time / 3 min late" |
| 10 | Badge popularity ranking | Google Places (New) server key | Secret `GOOGLE_PLACES_SERVER_KEY` | Zoom 15 in a busy street: popular places get badges first |
| 11 | Vehicle full check sales | Provider keys, odometer adapter, store products | PROVIDERS.md steps 1-4 | TEST_ON_PHONE §20 |
| 12 | Character voices | ElevenLabs key | Secret `ELEVENLABS_API_KEY` | Voice picker: persona voices unlocked |
| 13 | Bad weather from a weather API | No weather key (bad weather is live from LTN floods + reports) | Say if you want OpenWeather added | -- |
| 14 | Official NSW enforcement-camera list | Dataset not integrated (cameras come from OSM + reports) | Send the dataset link to use | -- |
| 15 | Walk stairs warning | No stairs data in Mapbox walking steps | -- (no source) | -- |
| 16 | API spend for Mapbox / TfNSW / AdMob on the dashboard | No billing API connected | Each provider's own console | -- |
| 17 | CarPlay / Android Auto | Apple CarPlay Navigation entitlement (and Google's Android for Cars navigation review) | Paste the text in `docs/CARPLAY_ENTITLEMENT_REQUEST.md` into Apple's CarPlay entitlement request (Navigation) for `com.trackline.navigate` | -- (nothing CarPlay is shown in the app until then) |
| 25 | Music mini-player (play/pause, what's playing) | Spotify: a Spotify developer app (client id + redirect URI, and Spotify's quota extension for public use). Apple Music: a MusicKit key (Apple Developer › Keys › Media Services). Neither is in the project | Create the Spotify app at developer.spotify.com (redirect `trackline://spotify`), save the client id as EAS env `SPOTIFY_CLIENT_ID`; create the MusicKit key and save it as Firebase secret `MUSICKIT_PRIVATE_KEY` (+ key id, team id). Then tell Claude | Until then the map's "Audio player" button opens your music app (real: Spotify / Apple Music / YouTube Music); no in-app player is shown |
| 19 | Phone number sign-in / phone password reset (app + web) | Phone provider off; website not deployed with the new page | Firebase console > Authentication > Sign-in method > Phone > Enable; then deploy the website (`deploy.ps1`, it serves `phone-verify.html`) | App: Sign in > Continue with phone number → SMS arrives → code signs you in |
| 20 | Android Google sign-in | Web OAuth client ID | EAS env `GOOGLE_WEB_CLIENT_ID` (Firebase console > Authentication > Google > Web SDK configuration) | Android: Continue with Google works |
| 21 | Web app account features live | Website not redeployed | Actions > "Deploy web app (main website)" after the Firebase deploy (DEPLOY.md > Web app) | Open the site > logo > Account > "Account, help & inbox" |
| 22 | Custom-token sign-in after phone/SMS recovery | IAM role | Grant the functions' service account "Service Account Token Creator" | After a phone reset the app stays signed in (otherwise it asks you to sign in again) |
| 23 | **Map blank in TestFlight; Drive/Bike/Walk Mapbox routes fail** | EAS variable `MAPBOX_PUBLIC_TOKEN` (production AND preview) holds the text `***** (This is a sensitive env variable...)` instead of a token -- the hidden value `eas env:list` prints was pasted in as the value. Verified in build 202's own app.config. | expo.dev > TrackLine > Environment variables > `MAPBOX_PUBLIC_TOKEN` > Edit: paste your Mapbox **public** token (starts `pk.`, account.mapbox.com > Tokens > Default public token), visibility Sensitive or Plain text, environments production + preview + development. Or: `eas env:update --variable-name MAPBOX_PUBLIC_TOKEN --variable-environment production --value pk.…` (repeat for preview). Then tell Claude: it ships it to the installed build with an EAS Update (no new build needed) | Settings › About › Diagnostics: "Mapbox token present: Yes (…last4)", "Mapbox style loaded: Yes", "Directions: Bike/Walk: OK · Mapbox · HTTP 200" |
| 24 | Home-screen widget "Drive times" (iOS) | App Group `group.com.trackline.navigate` isn't registered at Apple: build 209 failed signing ("Provisioning profile ... com.trackline.navigate.widget ... doesn't support the group.com.trackline.navigate App Group"). EAS can't create App Groups with the App Store Connect key, and its Apple login didn't use cookies, so it skipped capability syncing. Builds since then leave the App Group off; the widget says "Drive times: not available yet" | developer.apple.com > Certificates, IDs & Profiles > Identifiers > App Groups > + `group.com.trackline.navigate`. Then Identifiers > `com.trackline.navigate` > App Groups > Configure > tick it; same for `com.trackline.navigate.widget`. Then run `npx eas-cli credentials -p ios` (production) and remove the two App Store provisioning profiles so EAS makes new ones. Then tell Claude (or set EAS env `TRACKLINE_APP_GROUP=1` for production) and build | Add the "Drive times" widget: Home/Work minutes and "as of" time show |
| 26 | Siren radar: 50 % overlapping windows; a direct phone-call check | Native code: the phone records ~1 s compressed files with one recorder, so windows are back to back; overlapping needs a PCM ring buffer in `modules/yamnet-siren` (Swift/Kotlin). Calls: iOS gives the microphone to a call so nothing is heard, but there's no CXCallObserver check | Nothing from you: it's native work for a later build (tell Claude if you want it next) | docs/siren-radar/README.md "Not done / limits" |
| 18 | App Store review | Your phone tests | You confirm TEST_ON_PHONE passes; then submit from App Store Connect | -- |


## Live NSW petrol prices (FuelCheck)

The petrol list asks our `fuelPricesNearby` Cloud Function for NSW FuelCheck prices. Until it is
deployed and has a key, the list says "Live NSW prices aren't set up yet." and shows Google's own
station prices where Google has them (no price is ever made up).

1. Register at api.nsw.gov.au and subscribe to the **Fuel API** product; note the API key and secret.
2. Add GitHub secrets `FUELCHECK_API_KEY` and `FUELCHECK_API_SECRET` on this repo.
3. Run Actions > "Deploy to Firebase" with Functions and **Copy API keys** ticked.
4. Open Petrol in the app; Settings > About > Diagnostics shows "Last petrol prices request".

Not yet run against the live FuelCheck API from this project (no key was available).

The nearby lists also need the **Places API (New)** enabled on the app's Google key, and the
drive times need the **Routes API** (route matrix) enabled. Diagnostics shows the last status of each.
