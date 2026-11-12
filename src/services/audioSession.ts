import { setAudioModeAsync } from "expo-audio";

// One place that sets the iOS audio session for driving. expo-audio replaces the whole session
// on every setAudioModeAsync call (a mode without allowsRecording turns the microphone off), so
// whoever sets it has to know whether the siren listener is using the microphone right now.
//
// While navigating, the voice, the recorded clips and the "Exit taken ✓" chime must play with
// the ring/silent switch on silent (most phones in a car) and keep playing with the screen
// locked. They mix with the driver's music, as before.

let micInUse = false;

/** The siren listener says when it holds the microphone. */
export function setMicInUse(inUse: boolean): void {
  micInUse = inUse;
}

export function isMicInUse(): boolean {
  return micInUse;
}

export function navigationAudioMode() {
  return { allowsRecording: micInUse, playsInSilentMode: true, shouldPlayInBackground: true } as const;
}

/** Called when a drive starts. Never throws: no sound setup is no reason to stop navigating. */
export async function prepareNavigationAudio(): Promise<void> {
  try {
    await setAudioModeAsync(navigationAudioMode());
  } catch {
    // The next playback still tries; TTS works regardless.
  }
}
