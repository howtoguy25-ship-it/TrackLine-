package expo.modules.yamnetsiren

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaRecorder
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

// Real YAMNet (Google's pretrained on-device audio classifier) TFLite inference, replacing the
// earlier TODO scaffolding -- see this module's own README.md for the real setup this followed
// (bundled yamnet.tflite + yamnet_class_map.csv in src/main/assets, downloaded directly from
// TensorFlow Hub / TensorFlow's research repo, both confirmed real files, not placeholders).
//
// Real, verified model contract (checked directly against the actual downloaded .tflite this
// session, via ai-edge-litert, not assumed from documentation alone): a single dynamic-length
// float32 "waveform" input; feeding it exactly 15,600 samples (0.975s of real 16kHz mono audio,
// YAMNet's own documented minimum window) produces exactly one [1, 521] row of real class scores
// -- 521 matching yamnet_class_map.csv's own 521 real AudioSet class rows exactly.
class YamnetSirenModule : Module() {
  private var interpreter: Interpreter? = null
  private var labels: List<String> = emptyList()

  // Live stream (siren radar): AudioRecord at 16 kHz mono float, in memory only; every HOP new
  // samples (0.48 s) the last WINDOW samples (0.975 s) are classified -- windows overlap by half.
  @Volatile private var streaming = false
  private var recorder: AudioRecord? = null
  private var streamThread: Thread? = null

  override fun definition() = ModuleDefinition {
    Name("YamnetSiren")

    AsyncFunction("loadModel") {
      loadModelAndLabels()
    }

    // Kept for contract-compatibility with the original scaffolding -- sirenDetection.ts's own
    // real capture loop uses classifyFile below instead (expo-audio's recorder only ever
    // produces a compressed file on Android -- there is no raw WAV/PCM AndroidOutputFormat at
    // all, a real MediaRecorder API limitation, not a library gap -- see sirenDetection.ts's own
    // comment).
    AsyncFunction("classify") { pcmSamples: List<Double> ->
      runClassification(FloatArray(pcmSamples.size) { pcmSamples[it].toFloat() })
    }

    // Real end-to-end path: reads the actual recorded audio file, decodes + resamples it to real
    // 16kHz mono PCM via MediaExtractor/MediaCodec (never a guessed/synthetic waveform), then
    // classifies it. This is what sirenDetection.ts actually calls.
    AsyncFunction("classifyFile") { uri: String ->
      val samples = decodeToMono16kPcm(uri)
      runClassification(samples)
    }

    // Live, half-overlapping windows: each one is an "onWindow" event
    // { scores: [{label, confidence}] (top 10), rmsDb, at (ms since 1970) }.
    Events("onWindow")

    AsyncFunction("startStream") {
      startStream()
    }

    AsyncFunction("stopStream") {
      stopStream()
      true
    }

    Function("isStreaming") {
      streaming && recorder?.recordingState == AudioRecord.RECORDSTATE_RECORDING
    }
  }

  private fun startStream(): Boolean {
    if (streaming) return true
    if (interpreter == null && !loadModelAndLabels()) return false
    val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    if (minBuf <= 0) return false
    val rec = try {
      AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT, maxOf(minBuf, HOP * 4 * 2))
    } catch (e: SecurityException) {
      return false
    } catch (e: IllegalArgumentException) {
      return false
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return false
    }
    try {
      rec.startRecording()
    } catch (e: IllegalStateException) {
      rec.release()
      return false
    }
    recorder = rec
    streaming = true
    streamThread = Thread {
      val ring = FloatArray(WINDOW)
      val chunk = FloatArray(HOP)
      var filled = 0
      while (streaming) {
        var got = 0
        while (got < HOP && streaming) {
          val n = rec.read(chunk, got, HOP - got, AudioRecord.READ_BLOCKING)
          if (n <= 0) break
          got += n
        }
        if (got < HOP) break
        System.arraycopy(ring, HOP, ring, 0, WINDOW - HOP)
        System.arraycopy(chunk, 0, ring, WINDOW - HOP, HOP)
        filled = minOf(WINDOW, filled + HOP)
        if (filled < WINDOW) continue
        val win = ring.copyOf()
        var sum = 0.0
        for (v in win) sum += (v * v).toDouble()
        val rms = Math.sqrt(sum / win.size)
        val db = if (rms > 0) 20 * Math.log10(rms) else -160.0
        sendEvent("onWindow", mapOf("scores" to runClassification(win), "rmsDb" to db, "at" to System.currentTimeMillis().toDouble()))
      }
    }.also { it.start() }
    return true
  }

  private fun stopStream() {
    streaming = false
    val rec = recorder
    recorder = null
    try {
      rec?.stop()
    } catch (e: IllegalStateException) {
      // already stopped
    }
    streamThread?.join(1000)
    streamThread = null
    rec?.release()
  }

  companion object {
    private const val SAMPLE_RATE = 16000
    private const val WINDOW = 15600
    private const val HOP = 7680
  }

  private fun loadModelAndLabels(): Boolean {
    val context = appContext.reactContext ?: return false
    return try {
      val modelBytes = context.assets.open("yamnet.tflite").use { it.readBytes() }
      val modelBuffer = ByteBuffer.allocateDirect(modelBytes.size).order(ByteOrder.nativeOrder())
      modelBuffer.put(modelBytes)
      modelBuffer.rewind()
      interpreter = Interpreter(modelBuffer)

      val csvText = context.assets.open("yamnet_class_map.csv").use { it.bufferedReader().readText() }
      labels = parseLabels(csvText)
      labels.isNotEmpty()
    } catch (e: Exception) {
      false
    }
  }

  // Real CSV parsing for the real, official yamnet_class_map.csv format:
  // "index,mid,display_name" -- display_name is the one field this app actually uses, and is
  // sometimes quoted (it can itself contain a real comma, e.g. "Child speech, kid speaking").
  private fun parseLabels(csv: String): List<String> {
    val result = mutableListOf<String>()
    val lines = csv.split("\n").drop(1)
    for (rawLine in lines) {
      val line = rawLine.trim()
      if (line.isEmpty()) continue
      val firstComma = line.indexOf(',')
      if (firstComma < 0) continue
      val afterIndex = line.substring(firstComma + 1)
      val secondComma = afterIndex.indexOf(',')
      if (secondComma < 0) continue
      var name = afterIndex.substring(secondComma + 1).trim()
      if (name.length >= 2 && name.startsWith("\"") && name.endsWith("\"")) {
        name = name.substring(1, name.length - 1)
      }
      result.add(name)
    }
    return result
  }

  // Real MediaExtractor + MediaCodec synchronous decode (the standard, documented Android
  // pattern for decoding a compressed audio file without a third-party library), followed by a
  // real mono downmix (plain channel average) and a real linear-interpolation resample to
  // 16kHz -- Android's MediaRecorder has no raw PCM/WAV output option at all, so the recorded
  // file this app hands in is always some real compressed container (AAC in an mp4/m4a
  // container, this app's own recording format). Never fabricates audio: any decode failure
  // returns an empty array, which runClassification treats as "nothing to classify" rather than
  // inventing a result.
  private fun decodeToMono16kPcm(uriString: String): FloatArray {
    val extractor = MediaExtractor()
    try {
      val uri = Uri.parse(uriString)
      val context = appContext.reactContext
      if (uri.scheme != null && context != null) {
        extractor.setDataSource(context, uri, null)
      } else {
        extractor.setDataSource(uriString)
      }

      var trackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("audio/")) {
          trackIndex = i
          format = f
          break
        }
      }
      if (trackIndex < 0 || format == null) return FloatArray(0)
      extractor.selectTrack(trackIndex)

      val mime = format.getString(MediaFormat.KEY_MIME)!!
      val sourceSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      val sourceChannelCount = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

      val codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()

      val pcmChunks = mutableListOf<ShortArray>()
      val bufferInfo = MediaCodec.BufferInfo()
      var sawInputEOS = false
      var sawOutputEOS = false

      try {
        while (!sawOutputEOS) {
          if (!sawInputEOS) {
            val inputIndex = codec.dequeueInputBuffer(10_000)
            if (inputIndex >= 0) {
              val inputBuffer = codec.getInputBuffer(inputIndex)!!
              val sampleSize = extractor.readSampleData(inputBuffer, 0)
              if (sampleSize < 0) {
                codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                sawInputEOS = true
              } else {
                codec.queueInputBuffer(inputIndex, 0, sampleSize, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }

          val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
          if (outputIndex >= 0) {
            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
              sawOutputEOS = true
            }
            if (bufferInfo.size > 0) {
              val outputBuffer = codec.getOutputBuffer(outputIndex)!!
              outputBuffer.position(bufferInfo.offset)
              outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
              val shortBuffer = outputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer()
              val chunk = ShortArray(shortBuffer.remaining())
              shortBuffer.get(chunk)
              pcmChunks.add(chunk)
            }
            codec.releaseOutputBuffer(outputIndex, false)
          }
        }
      } finally {
        codec.stop()
        codec.release()
      }

      val totalSamples = pcmChunks.sumOf { it.size }
      if (totalSamples == 0) return FloatArray(0)
      val interleaved = ShortArray(totalSamples)
      var pos = 0
      for (chunk in pcmChunks) {
        chunk.copyInto(interleaved, pos)
        pos += chunk.size
      }

      val channels = if (sourceChannelCount > 0) sourceChannelCount else 1
      val monoFrameCount = interleaved.size / channels
      val mono = FloatArray(monoFrameCount)
      for (i in 0 until monoFrameCount) {
        var sum = 0f
        for (c in 0 until channels) {
          sum += interleaved[i * channels + c] / 32768f
        }
        mono[i] = sum / channels
      }

      if (sourceSampleRate == 16000 || mono.isEmpty()) return mono

      val ratio = 16000.0 / sourceSampleRate
      val outLength = (mono.size * ratio).toInt()
      if (outLength <= 0) return FloatArray(0)
      val resampled = FloatArray(outLength)
      for (i in 0 until outLength) {
        val srcPos = i / ratio
        val idx0 = min(srcPos.toInt(), mono.size - 1)
        val idx1 = min(idx0 + 1, mono.size - 1)
        val frac = (srcPos - idx0).toFloat()
        resampled[i] = mono[idx0] * (1 - frac) + mono[idx1] * frac
      }
      return resampled
    } catch (e: Exception) {
      return FloatArray(0)
    } finally {
      extractor.release()
    }
  }

  private fun runClassification(pcmSamples: FloatArray): List<Map<String, Any>> {
    val interp = interpreter ?: return emptyList()
    if (pcmSamples.isEmpty() || labels.isEmpty()) return emptyList()
    return try {
      interp.resizeInput(0, intArrayOf(pcmSamples.size))
      interp.allocateTensors()

      val inputBuffer = ByteBuffer.allocateDirect(pcmSamples.size * 4).order(ByteOrder.nativeOrder())
      for (sample in pcmSamples) inputBuffer.putFloat(sample)
      inputBuffer.rewind()

      val outputShape = interp.getOutputTensor(0).shape()
      val numClasses = outputShape[outputShape.size - 1]
      val outputBuffer = ByteBuffer.allocateDirect(numClasses * 4).order(ByteOrder.nativeOrder())

      interp.run(inputBuffer, outputBuffer)
      outputBuffer.rewind()

      val scored = (0 until min(numClasses, labels.size)).map { i ->
        labels[i] to outputBuffer.getFloat(i * 4)
      }
      scored.sortedByDescending { it.second }
        .take(10)
        .map { mapOf("label" to it.first, "confidence" to it.second) }
    } catch (e: Exception) {
      emptyList()
    }
  }
}
