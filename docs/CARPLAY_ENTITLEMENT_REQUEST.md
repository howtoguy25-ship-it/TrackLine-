# CarPlay Navigation entitlement — request text (gap item 9)

Status: **BLOCKED** until Apple grants the entitlement. Nothing CarPlay is built or shown in the
app until then (no "CarPlay" button or setting exists). Android Auto needs the same kind of
review from Google (Android for Cars App Library, navigation category) and is not built either.

## Where to send it

developer.apple.com › Contact › "Request a CarPlay entitlement" (signed in as the Account Holder
of team `9C85Z8Z8BD`). Choose **Navigation** (`com.apple.developer.carplay-maps`).
Bundle ID: `com.trackline.navigate`. App Store Connect app id: `6790121934`.

## Text to paste

> **App name:** TrackLine
>
> **Bundle ID:** com.trackline.navigate
>
> **Category requested:** CarPlay Navigation (com.apple.developer.carplay-maps)
>
> **What the app does:** TrackLine is a turn-by-turn driving navigation app for Australia. It
> gives spoken turn-by-turn guidance on a live map, reroutes around traffic, and warns drivers
> about hazards ahead on their route: crashes, road closures, roadworks and traffic reported by
> Live Traffic NSW (official), reports from other drivers, school zones, speed limits and mapped
> road features (railway crossings, toll points). It also has a home-screen widget and a Live
> Activity with the next turn on the Lock Screen and Dynamic Island.
>
> **Why CarPlay:** drivers use TrackLine for its core purpose — turn-by-turn navigation while
> driving. On CarPlay it would show the route map, the next manoeuvre and the ETA, using the
> CarPlay navigation templates (CPMapTemplate, CPManeuver, CPTravelEstimates, CPNavigationAlert
> for hazards ahead). Hazard alerts would use CPNavigationAlert so they follow CarPlay's
> driver-distraction rules, and reporting a hazard would be one tap or by voice, never typing.
>
> **Is navigation the primary function?** Yes. Turn-by-turn route guidance is the main feature;
> everything else (hazard alerts, reports, planned drives) supports driving to a destination.
>
> **Current availability:** on TestFlight now; App Store release planned after testing.
>
> **Contact:** the Account Holder of team 9C85Z8Z8BD.

## After Apple says yes

1. Apple adds the entitlement to the App ID; create a new App Store provisioning profile
   (`npx eas-cli credentials -p ios`, remove the old profile so EAS makes a new one).
2. Tell Claude: the CarPlay scene (CPTemplateApplicationSceneDelegate + map/maneuver templates)
   is then built as a native module, with the entitlement added in `app.config.js`.
