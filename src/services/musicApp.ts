import { Linking, Platform } from "react-native";

// The "Audio player" shortcut on the home map. It opens the driver's own music app -- it does
// not play, pause or show what's playing: iOS and Android don't let one app control another's
// playback, and this app has no music service of its own to control.
//
// The apps are tried in order and the first one that's installed opens. On iOS, asking whether
// an app is installed only works for URL schemes declared in app.config.js
// (LSApplicationQueriesSchemes) -- the three below are declared there.

const MUSIC_APPS: { name: string; url: string }[] =
  Platform.OS === "ios"
    ? [
        { name: "Spotify", url: "spotify://" },
        { name: "Apple Music", url: "music://" },
        { name: "YouTube Music", url: "youtubemusic://" },
      ]
    : [
        { name: "Spotify", url: "spotify://" },
        { name: "YouTube Music", url: "youtubemusic://" },
      ];

/** Opens the first installed music app. Resolves false if none could be opened. */
export async function openMusicApp(): Promise<boolean> {
  for (const app of MUSIC_APPS) {
    try {
      // canOpenURL can say "no" on Android 11+ for an app that IS installed (package
      // visibility), so there the open is simply attempted and a failure moves on to the next.
      if (Platform.OS === "ios" && !(await Linking.canOpenURL(app.url))) continue;
      await Linking.openURL(app.url);
      return true;
    } catch {
      // Not installed, or refused to open -- try the next one.
    }
  }
  return false;
}
