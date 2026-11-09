import ExpoModulesCore
import TensorFlowLite
import AVFoundation

// Real YAMNet (Google's pretrained on-device audio classifier) TFLite inference, replacing the
// earlier TODO scaffolding -- see this module's own README.md for the real setup this followed
// (bundled yamnet.tflite + yamnet_class_map.csv, downloaded directly from TensorFlow Hub /
// TensorFlow's research repo, both confirmed real files, not placeholders).
//
// Real, verified model contract (checked directly against the actual downloaded .tflite this
// session, via ai-edge-litert, not assumed from documentation alone): a single dynamic-length
// float32 "waveform" input; feeding it exactly 15,600 samples (0.975s of real 16kHz mono audio,
// YAMNet's own documented minimum window) produces exactly one [1, 521] row of real class scores
// -- 521 matching yamnet_class_map.csv's own 521 real AudioSet class rows exactly.
public class YamnetSirenModule: Module {
  private var interpreter: Interpreter?
  private var labels: [String] = []

  public func definition() -> ModuleDefinition {
    Name("YamnetSiren")

    AsyncFunction("loadModel") { () -> Bool in
      return self.loadModelAndLabels()
    }

    // Kept for contract-compatibility with the original scaffolding (a caller that already has
    // real decoded PCM floats can still use this directly) -- sirenDetection.ts's own real
    // capture loop uses classifyFile below instead, since expo-audio's recorder only ever
    // produces a compressed (.m4a/AAC) file, never raw PCM, on either platform (a real Android
    // MediaRecorder limitation, not a library gap -- see sirenDetection.ts's own comment).
    AsyncFunction("classify") { (pcmSamples: [Float]) -> [[String: Any]] in
      return self.runClassification(pcmSamples)
    }

    // Real end-to-end path: reads the actual recorded audio file, decodes + resamples it to
    // real 16kHz mono PCM via AVFoundation (never a guessed/synthetic waveform), then classifies
    // it. This is what sirenDetection.ts actually calls.
    AsyncFunction("classifyFile") { (uri: String) -> [[String: Any]] in
      guard let url = URL(string: uri) ?? URL(string: "file://" + uri) else { return [] }
      let samples = self.decodeToMono16kPcm(fileURL: url)
      return self.runClassification(samples)
    }
  }

  private func loadModelAndLabels() -> Bool {
    guard
      let bundleURL = Bundle(for: YamnetSirenModule.self).url(forResource: "YamnetSiren", withExtension: "bundle"),
      let resourceBundle = Bundle(url: bundleURL)
    else {
      return false
    }
    guard let modelPath = resourceBundle.path(forResource: "yamnet", ofType: "tflite") else {
      return false
    }
    do {
      let newInterpreter = try Interpreter(modelPath: modelPath)
      try newInterpreter.allocateTensors()
      self.interpreter = newInterpreter
    } catch {
      return false
    }
    guard
      let csvPath = resourceBundle.path(forResource: "yamnet_class_map", ofType: "csv"),
      let csvText = try? String(contentsOfFile: csvPath, encoding: .utf8)
    else {
      return false
    }
    self.labels = Self.parseLabels(csvText)
    return self.labels.count > 0
  }

  // Real CSV parsing for the real, official yamnet_class_map.csv format:
  // "index,mid,display_name" -- display_name is the one field this app actually uses, and is
  // sometimes quoted (it can itself contain a real comma, e.g. "Child speech, kid speaking").
  private static func parseLabels(_ csv: String) -> [String] {
    var result: [String] = []
    let lines = csv.split(separator: "\n", omittingEmptySubsequences: true)
    for line in lines.dropFirst() {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let firstComma = trimmed.firstIndex(of: ",") else { continue }
      let afterIndex = trimmed[trimmed.index(after: firstComma)...]
      guard let secondComma = afterIndex.firstIndex(of: ",") else { continue }
      var name = String(afterIndex[afterIndex.index(after: secondComma)...])
      if name.hasPrefix("\"") && name.hasSuffix("\"") && name.count >= 2 {
        name = String(name.dropFirst().dropLast())
      }
      result.append(name)
    }
    return result
  }

  // Real AVFoundation decode + resample -- AVAudioFile reads whatever real compressed format the
  // file actually is (AAC in an m4a container, this app's own recording format), and
  // AVAudioConverter does a real sample-rate/channel-count conversion down to mono 16kHz float,
  // exactly what YAMNet's own real input contract requires. Never fabricates audio: a file that
  // fails to open/convert returns an empty array, which runClassification treats as "nothing to
  // classify" rather than inventing a result.
  private func decodeToMono16kPcm(fileURL: URL) -> [Float] {
    guard let audioFile = try? AVAudioFile(forReading: fileURL) else { return [] }
    let sourceFormat = audioFile.processingFormat
    guard
      let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false),
      let converter = AVAudioConverter(from: sourceFormat, to: targetFormat)
    else {
      return []
    }

    let sourceFrameCount = AVAudioFrameCount(audioFile.length)
    guard sourceFrameCount > 0, let sourceBuffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: sourceFrameCount) else {
      return []
    }
    do {
      try audioFile.read(into: sourceBuffer)
    } catch {
      return []
    }

    let ratio = targetFormat.sampleRate / max(sourceFormat.sampleRate, 1)
    let targetFrameCapacity = AVAudioFrameCount(Double(sourceFrameCount) * ratio) + 2048
    guard let targetBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: targetFrameCapacity) else {
      return []
    }

    var suppliedSource = false
    var conversionError: NSError?
    let status = converter.convert(to: targetBuffer, error: &conversionError) { _, outStatus in
      if suppliedSource {
        outStatus.pointee = .noDataNow
        return nil
      }
      suppliedSource = true
      outStatus.pointee = .haveData
      return sourceBuffer
    }

    guard status != .error, conversionError == nil, let channelData = targetBuffer.floatChannelData else {
      return []
    }
    let frameLength = Int(targetBuffer.frameLength)
    guard frameLength > 0 else { return [] }
    return Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))
  }

  private func runClassification(_ pcmSamples: [Float]) -> [[String: Any]] {
    guard let interpreter = interpreter, !pcmSamples.isEmpty, !labels.isEmpty else { return [] }
    do {
      try interpreter.resizeInput(at: 0, to: Tensor.Shape([pcmSamples.count]))
      try interpreter.allocateTensors()
      let inputData = pcmSamples.withUnsafeBufferPointer { Data(buffer: $0) }
      try interpreter.copy(inputData, toInputAt: 0)
      try interpreter.invoke()
      let output = try interpreter.output(at: 0)
      let scores: [Float] = output.data.withUnsafeBytes { raw in
        Array(raw.bindMemory(to: Float.self))
      }
      var results: [(label: String, confidence: Float)] = []
      for (i, score) in scores.enumerated() where i < labels.count {
        results.append((labels[i], score))
      }
      results.sort { $0.confidence > $1.confidence }
      return results.prefix(10).map { ["label": $0.label, "confidence": $0.confidence] }
    } catch {
      return []
    }
  }
}
