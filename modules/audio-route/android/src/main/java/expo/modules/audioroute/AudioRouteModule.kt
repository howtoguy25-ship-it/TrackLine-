package expo.modules.audioroute

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRouter2
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reads where Android is sending audio right now, and opens the system's own output picker.
// Read-only: it never changes the route, the audio mode or focus itself.
class AudioRouteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    AsyncFunction("getCurrentRoute") {
      currentRoute()
    }

    AsyncFunction("showRoutePicker") {
      showPicker()
    }
  }

  private fun currentRoute(): Map<String, String> {
    val unknown = mapOf("name" to "", "type" to "other")
    val context = appContext.reactContext ?: return unknown
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return unknown

    // Android 13+ can say outright which device navigation-guidance audio is routed to.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      try {
        val attributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val routed = audioManager.getAudioDevicesForAttributes(attributes).firstOrNull()
        if (routed != null) return describe(routed)
      } catch (_: Throwable) {
        // Fall through to the list-based answer below.
      }
    }

    // Before Android 13 there's no direct answer, only the list of connected outputs. Android
    // itself prefers an external device over the built-in speaker, most personal first, so the
    // same order is applied here. This is "what Android will use", inferred -- not a readout.
    val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val best = outputs.minByOrNull { priority(it.type) } ?: return unknown
    return describe(best)
  }

  private fun describe(device: AudioDeviceInfo): Map<String, String> {
    val type = routeType(device.type)
    // A built-in output's "product name" is just the phone's model, which isn't useful as a
    // name for the speaker; the app shows its own plain label for those.
    val name = if (type == "speaker" || type == "phone") "" else (device.productName?.toString() ?: "")
    return mapOf("name" to name, "type" to type)
  }

  private fun routeType(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> "speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "phone"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "headphones"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
    AudioDeviceInfo.TYPE_BUS -> "car"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb"
    AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC -> "hdmi"
    else -> "other"
  }

  private fun priority(type: Int): Int = when (routeType(type)) {
    "bluetooth" -> 0
    "headphones" -> 1
    "usb" -> 2
    "car" -> 3
    "hdmi" -> 4
    "speaker" -> 5
    "phone" -> 7
    else -> 6
  }

  private fun showPicker(): Boolean {
    val context = appContext.reactContext ?: return false

    // Android 14 added a public way to open the system output switcher.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      try {
        if (MediaRouter2.getInstance(context).showSystemOutputSwitcher()) return true
      } catch (_: Throwable) {
        // Fall through to Bluetooth settings.
      }
    }

    // Earlier versions have no public picker. Bluetooth settings is where a car or headset is
    // connected, so that's the useful place to land instead.
    return try {
      context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Throwable) {
      false
    }
  }
}
