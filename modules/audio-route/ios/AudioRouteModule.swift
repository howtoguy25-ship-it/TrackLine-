import AVFoundation
import AVKit
import ExpoModulesCore
import UIKit

// Reads where iOS is sending audio right now, and opens iOS's own route picker.
//
// Deliberately read-only as far as the audio session goes: it never sets a category, a mode or
// an output override. Siren detection and navigation speech own the session; this only looks.
public class AudioRouteModule: Module {
  // AVRoutePickerView is Apple's supported way to show the output picker, but it is a button
  // meant to be tapped. To open it from the Sound sheet's own row, one is kept (all but
  // invisible) in the key window and its internal button is triggered programmatically.
  private var routePicker: AVRoutePickerView?

  public func definition() -> ModuleDefinition {
    Name("AudioRoute")

    AsyncFunction("getCurrentRoute") { () -> [String: String] in
      guard let output = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
        return ["name": "", "type": "other"]
      }
      return ["name": output.portName, "type": AudioRouteModule.routeType(output.portType)]
    }

    AsyncFunction("showRoutePicker") { () -> Bool in
      guard let window = AudioRouteModule.keyWindow() else { return false }
      let picker = self.routePicker ?? AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
      picker.alpha = 0.01
      if picker.superview !== window {
        picker.removeFromSuperview()
        window.addSubview(picker)
      }
      self.routePicker = picker
      for subview in picker.subviews {
        if let button = subview as? UIButton {
          button.sendActions(for: .touchUpInside)
          return true
        }
      }
      return false
    }.runOnQueue(.main)
  }

  private static func keyWindow() -> UIWindow? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return windows.first(where: { $0.isKeyWindow }) ?? windows.first
  }

  private static func routeType(_ port: AVAudioSession.Port) -> String {
    switch port {
    case .builtInSpeaker:
      return "speaker"
    case .builtInReceiver:
      return "phone"
    case .headphones:
      return "headphones"
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
      return "bluetooth"
    case .carAudio:
      return "car"
    case .airPlay:
      return "airplay"
    case .usbAudio:
      return "usb"
    case .HDMI:
      return "hdmi"
    default:
      return "other"
    }
  }
}
